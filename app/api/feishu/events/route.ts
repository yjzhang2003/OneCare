import { after } from "next/server";

import { writeRecord } from "../../../../src/features/store/mirror";
import { readRecordById } from "../../../../src/features/store/records";

import type { VocRecord } from "../../../../src/features/bitable/field-map";
import {
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../src/features/bitable/client";
import {
  resolveCardAction,
  resolveVocCardAction,
  type CardActionResult,
  type VocActionBitable,
} from "../../../../src/features/feishu-bot/card-actions";
import {
  VOC_CARD_ACTIONS,
  type FeishuCard,
  type FeishuOutboundMessage,
  type OneCareCardAction,
  type VocCardAction,
} from "../../../../src/features/feishu-bot/card-types";
import {
  createMenuHintMessage,
  createOperatorSummaryMessage,
  createTextMessage,
  createTodayOverviewMessage,
  createProfileInsightCard,
  createVocTicketCard,
  createWelcomeMessage,
} from "../../../../src/features/feishu-bot/cards";
import {
  createBotOpenIdProvider,
  createWarRoomChat,
  listChatMessages,
} from "../../../../src/features/feishu-bot/chat-client";
import {
  replyToFeishuMessage,
  sendFeishuMessage,
} from "../../../../src/features/feishu-bot/client";
import {
  parseFeishuEvent,
  type FeishuEventOutcome,
} from "../../../../src/features/feishu-bot/event-handler";
import {
  readOperatorSummary,
  type OperatorSummaryBitable,
} from "../../../../src/features/feishu-bot/operator-summary";
import {
  readTodayOverviewCounts,
  type TodayOverviewBitable,
} from "../../../../src/features/feishu-bot/today-overview";
import { resolveWarRoomAction } from "../../../../src/features/feishu-bot/war-room-actions";
import {
  defaultNotifyDependencies,
  notify,
} from "../../../../src/features/notify/deliver";
import { handOffNotifications } from "../../../../src/features/notify/hand-off";
import { ruleBasedProvider } from "../../../../src/features/profiles/insight";
import {
  claimIdentityWarRoom,
  readIdentityWarRoom,
} from "../../../../src/features/store/identity-war-rooms";
import {
  readIdentityRecords,
  readIdentityResponderOpenIds,
  readProfile,
} from "../../../../src/features/store/workbench-query";
import {
  openIdentityWarRoom,
  type IdentityWarRoomOutcome,
} from "../../../../src/features/warroom/identity";
import { buildAnswerFacts, stripMention } from "../../../../src/features/warroom/facts";
import { readFactsAggregates } from "../../../../src/features/store/workbench-query";
import {
  createAnswerProvider,
  type AnswerProvider,
} from "../../../../src/features/tagging/answer-provider";
import {
  readBitableEnv,
  readBotEnv,
  readTaggingEnv,
  type BotEnv,
} from "../../../../src/lib/env";
// Task 11: the fix for this file's own oldest gap reuses analyze/route.ts's
// existing 负责人表 read and its "usable, deduplicated 兜底 openId list" filter
// rather than re-parsing the owner table a second, independent way — see
// getFallbackOpenIds below.
import {
  fallbackOwnerOpenIds,
  listOwnerRules,
} from "../../voc/analyze/route";

// `runtime = "nodejs"` was dropped: it is the App Router default anyway, and
// task 14 enables `cacheComponents` in next.config.ts (for the VOC
// dashboard's `use cache`), which rejects this route segment config outright.
// 10 was the platform default, and it is what killed the war room's answers: the
// synchronous card callback is answered in milliseconds, but the deferred work an
// @-mention starts (resolve the ticket, gather the facts, call the aily skill) was being
// terminated mid-flight — "Task timed out after 10 seconds" — so the group never heard
// back. The reply path now costs about two seconds; this is headroom for a slow skill,
// not a budget anything is expected to spend.
export const maxDuration = 60;

// Exported so createResolveAction's own third parameter (below) can carry the
// same type as a documented, reusable shape rather than an inline function
// type repeated at each call site.
export type Scheduler = (task: () => Promise<void>) => void;

type FeishuEventRouteDependencies = {
  readEnv: () => BotEnv;
  parseEvent: (input: {
    rawBody: string;
    headers: Headers;
    env: BotEnv;
  }) => Promise<FeishuEventOutcome>;
  // Task 13: what the "我的工单" custom-menu item gets back — the clicking
  // operator's own real VOC workload. Unchanged since Task 12 except for who
  // calls it: a bare p2p text message no longer does (see createMenuHint
  // below), only a menu_click outcome for eventKey "voc_my_tickets" does now.
  operationsReply: (operatorOpenId: string) => Promise<FeishuOutboundMessage>;
  // Task 13: what the "今日概览" custom-menu item gets back — the whole-org
  // view, no operator filtering. Takes no argument: unlike operationsReply,
  // this reply is the same for whoever clicked.
  todayOverviewReply: () => Promise<FeishuOutboundMessage>;
  // Task 13: what a bare p2p text message gets back now — a short pointer to
  // the custom menu (or to @-mentioning the bot in a war room), never a card.
  // Sync, like createWelcome below: building it touches no I/O.
  createMenuHint: () => FeishuOutboundMessage;
  createWelcome: () => FeishuOutboundMessage;
  replyMessage: (input: {
    env: BotEnv;
    messageId: string;
    message: FeishuOutboundMessage;
  }) => Promise<void>;
  sendMessage: (input: {
    env: BotEnv;
    chatId: string;
    message: FeishuOutboundMessage;
  }) => Promise<void>;
  // Task 13: a menu click carries no chat id at all, only the clicking
  // operator's own open_id — its reply can only ever be a direct message, not
  // sendMessage's chatId-shaped call above. Kept as its own dependency
  // (rather than widening sendMessage's declared parameter to the
  // {chatId}|{openId} union sendFeishuMessage already accepts) so every
  // existing sendMessage fake in this file's tests — every one of them typed
  // to the chatId shape alone — keeps compiling unchanged.
  sendDirectMessage: (
    input: Readonly<{ env: BotEnv; openId: string; message: FeishuOutboundMessage }>,
  ) => Promise<void>;
  resolveAction: (input: CardActionRequest) => Promise<CardActionResult>;
  answerGroupQuestion: (
    input: Readonly<{ chatId: string; text: string }>,
  ) => Promise<FeishuOutboundMessage>;
  schedule: Scheduler;
  reportFailure: () => void;
  // 标识拉群, shared with the console's own route so the two cannot disagree about who is
  // in the group or what a second click does.
  openIdentityWarRoom: (
    input: Readonly<{
      kind: "user" | "device";
      id: string;
      operatorOpenId: string;
    }>,
  ) => Promise<IdentityWarRoomOutcome>;
};

// Every field the dispatcher needs, all required. `note` is not optional here
// on purpose: the previous shape omitted it entirely, so this route called
// resolveVocCardAction without 跟进记录/闭环结论, TypeScript was satisfied
// because they were optional parameters, and both actions were rejected by
// their own guards in production while every test on both sides passed.
type CardActionRequest = Readonly<{
  action: OneCareCardAction | VocCardAction;
  recordId: string;
  operatorOpenId: string;
  note: string;
}>;

function isVocCardAction(
  action: OneCareCardAction | VocCardAction,
): action is VocCardAction {
  return (VOC_CARD_ACTIONS as readonly string[]).includes(action);
}

// Built once per server instance and reused across requests, exactly like
// createTenantTokenProvider's own internal cache: a card callback has a
// three second budget and cannot afford to re-read env vars or re-exchange a
// token on every click. Constructed lazily (only when a VOC action or a war
// room question actually arrives) so a missing Bitable env var never breaks
// the nine demo actions, which never touch it.
let tokenProvider: TenantTokenProvider | null = null;
function getTokenProvider(): TenantTokenProvider {
  if (!tokenProvider) {
    const botEnv = readBotEnv();
    tokenProvider = createTenantTokenProvider(botEnv.appId, botEnv.appSecret);
  }
  return tokenProvider;
}

let bitableClient: BitableClient | null = null;
function getBitableClient(): BitableClient {
  if (!bitableClient) {
    bitableClient = createBitableClient(readBitableEnv(), getTokenProvider());
  }
  return bitableClient;
}

// What card actions read and write through in production: reads from the Postgres
// mirror, writes Postgres-first with the Bitable push deferred past Feishu's three
// second deadline.
//
// Both halves have to move together. A card reading the Bitable while the web writes
// to Postgres would evaluate its state machine one step behind — approving a war room
// for a ticket already declined, or advancing a state twice.
//
// Supplied here rather than inside createResolveAction so the injected boundary stays
// a boundary: that function takes `bitable` precisely so its tests can drive the real
// resolver over a fake, and hardcoding the store inside it broke sixteen of them.
function storeBackedBitable(): VocActionBitable {
  return {
    getRecord: (recordId) => readRecordById(recordId),
    updateRecord: (recordId, fields) =>
      writeRecord(
        { bitable: getBitableClient(), defer: (task) => after(task) },
        recordId,
        fields,
      ),
  };
}

// Feeds event-handler.ts's mention check (see ParseFeishuEventInput there for
// why this exists at all: this app can see every group message, not only
// ones that @ it). `async` so a synchronous throw from getTokenProvider()
// (a missing bot credential) becomes a rejected promise like any other
// failure here, rather than an uncaught exception — parseFeishuEvent treats
// any rejection the same as "cannot confirm identity" and ignores the
// message rather than guessing it was mentioned.
let botOpenIdProvider: ReturnType<typeof createBotOpenIdProvider> | null = null;
async function getBotOpenId(): Promise<string> {
  if (!botOpenIdProvider) {
    botOpenIdProvider = createBotOpenIdProvider(getTokenProvider());
  }
  return botOpenIdProvider();
}

// Lazy and swallowing its own configuration errors on purpose: a tenant
// running the field-shortcut tagging track (or one that has not configured
// the war room answer skill at all) has no aily answer skill to call, and
// that absence must read exactly like any other "cannot answer right now"
// failure — never as a 503 that takes the rest of this route down with it.
let answerProvider: AnswerProvider | null = null;
function getAnswerProvider(): AnswerProvider | null {
  try {
    if (!answerProvider) {
      const taggingEnv = readTaggingEnv();
      if (taggingEnv.provider !== "aily") return null;
      answerProvider = createAnswerProvider({
        ailyAppId: taggingEnv.ailyAppId,
        skillId: taggingEnv.answerSkillId,
        // Same credential rule as the tagging call (Task 8 prerequisite P1,
        // analyze/route.ts's getTaggingProvider): the aily skill-start API
        // resolves the calling application from the credential, not from the
        // app id in the URL, so a tenant whose aily app is published under
        // its own app id needs that app's credential here too.
        tenantAccessToken: taggingEnv.credential
          ? createTenantTokenProvider(
              taggingEnv.credential.appId,
              taggingEnv.credential.appSecret,
            )
          : getTokenProvider(),
      });
    }
    return answerProvider;
  } catch {
    return null;
  }
}

// Task 9's closure archival, wired for real: resolveVocCardAction calls these
// only after 确认闭环's own write has already landed and only when it has
// resolved, from the record it already read, that a real war room chat
// exists — this route never decides that itself and never does a second
// getRecord to find out.
const CLOSURE_SUMMARY_QUESTION =
  "请把这次协同过程收敛成一段闭环结论，说明问题、处理动作与结果";

// AnswerProvider.answer takes exactly two string scalars (question, facts) —
// aily's custom skill parameters are String/Boolean/Float/Integer only, no
// object (buildAnswerFacts's own comment documents the same constraint) — so
// the transcript has nowhere to travel as a third parameter. It rides folded
// into the same `facts` string instead. `facts` here is always
// buildAnswerFacts's own output (resolveVocCardAction is the only caller),
// so the parse is not expected to ever fail; the catch just keeps a
// hypothetical malformed value from crashing the closing-summary attempt
// instead of degrading it to "cannot answer right now" like every other
// failure on this path.
function closureFacts(facts: string, transcript: readonly string[]): string {
  let ticket: unknown = facts;
  try {
    ticket = JSON.parse(facts);
  } catch {
    // See comment above: defensive only.
  }
  return JSON.stringify({ ticket, transcript });
}

async function summariseClosure(
  facts: string,
  transcript: readonly string[],
): Promise<string | null> {
  const provider = getAnswerProvider();
  if (!provider) return null;
  return provider.answer(
    CLOSURE_SUMMARY_QUESTION,
    closureFacts(facts, transcript),
  );
}

// `chatId` arrives from resolveVocCardAction, which is the only party that
// knows a war room exists (and which chat it is) by the time this runs — see
// its own ResolveVocCardActionInput.readTranscript comment for why this
// cannot be pre-bound the way a simpler `() => Promise<...>` would be.
// listChatMessages (Task 4) already turns every failure mode — network
// error, non-zero Feishu code, an empty group, an unparseable message — into
// an empty transcript rather than a throw, so nothing extra is caught here;
// a summary built from zero messages is exactly as "cannot summarise
// meaningfully" as an outright failure, and resolveVocCardAction's own
// null-check on the model's response handles that uniformly.
function readWarRoomTranscript(chatId: string): Promise<readonly string[]> {
  return listChatMessages({ env: readBotEnv(), chatId });
}

const NO_TICKET_MESSAGE = "这个群没有关联的 VOC 工单";
const CANNOT_ANSWER_MESSAGE =
  "暂时答不上来，可以稍后再问，或直接在多维表格里查这条记录";

function ticketCardMessage(ticket: VocRecord): FeishuOutboundMessage {
  return {
    msgType: "interactive",
    content: JSON.stringify(
      createVocTicketCard(
        ticket,
        {
          summary: ticket.summary,
          polarity: ticket.polarity ?? "—",
          dimensions: ticket.dimensions,
          replies: ticket.replies,
        },
        // Untruncated, like the war room's opening card (war-room-actions.ts):
        // everyone in this group was deliberately added to work the ticket.
        { fullContent: true },
      ),
    ),
  };
}

// Everything the group Q&A flow needs from Bitable, named narrowly (like
// VocActionBitable above it) rather than accepting the whole BitableClient —
// a fake standing in for this in a test cannot silently support a wider
// surface than this flow actually touches.
type GroupAnswerBitable = Pick<
  BitableClient,
  "findByWarRoomChatId" | "listRecords"
>;

// Spec §6.1's ordered flow, and the one place the "查不到关联工单时不要去问模型"
// requirement is enforced: a chat id that resolves to no ticket returns
// NO_TICKET_MESSAGE and never reaches `answer` at all — there is no fact base
// to ground a reply in, and answering anyway is exactly the behaviour that
// would make the whole feature untrustworthy. A Bitable failure while looking
// the ticket up (a real outage, not "no ticket") gets the same
// CANNOT_ANSWER_MESSAGE as an answer-skill failure — both mean "the bot could
// not do its job this time", and neither is the group's problem to guess at.
export function createAnswerGroupQuestion(
  bitable: () => GroupAnswerBitable,
  answer: (question: string, facts: string) => Promise<string | null>,
  aggregatesFor: (
    ticket: VocRecord,
  ) => Promise<Awaited<ReturnType<typeof readFactsAggregates>>> = (ticket) =>
    readFactsAggregates({
      dimensions: ticket.dimensions,
      model: ticket.model,
      deviceRef: ticket.deviceRef,
      now: Date.now(),
    }),
): (
  input: Readonly<{ chatId: string; text: string }>,
) => Promise<FeishuOutboundMessage> {
  return async function answerGroupQuestion(input) {
    let ticket: VocRecord | null;
    try {
      ticket = await bitable().findByWarRoomChatId(input.chatId);
    } catch {
      return createTextMessage(CANNOT_ANSWER_MESSAGE);
    }

    if (!ticket) {
      return createTextMessage(NO_TICKET_MESSAGE);
    }

    const question = stripMention(input.text);
    if (question.length === 0) {
      return ticketCardMessage(ticket);
    }

    // From the mirror, in one query. This used to pull all 3628 records out of the
    // Bitable to count two things, which took longer than the whole request was allowed
    // to live.
    let aggregates: Awaited<ReturnType<typeof readFactsAggregates>>;
    try {
      aggregates = await aggregatesFor(ticket);
    } catch {
      return createTextMessage(CANNOT_ANSWER_MESSAGE);
    }

    const facts = buildAnswerFacts({ ticket, ...aggregates });

    let prose: string | null;
    try {
      prose = await answer(question, facts);
    } catch {
      prose = null;
    }

    return prose
      ? createTextMessage(prose)
      : createTextMessage(CANNOT_ANSWER_MESSAGE);
  };
}

// The capabilities resolveWarRoomAction (Task 6) needs beyond
// getRecord/updateRecord (already covered by VocActionBitable, reused as-is
// below). Pulled out as its own injectable type — like VocActionBitable next
// to it — so a test can drive createResolveAction's real routing logic over
// fakes instead of stubbing resolveAction itself, which is exactly how the
// missing wiring this task fixes went unnoticed for ten prior tasks.
//
// notifyOperator (added alongside the sync/background split below) is a DM
// to whoever clicked, used only from the background half — see
// war-room-actions.ts's WarRoomActionInput for why a background failure can
// no longer produce a toast.
export type WarRoomActionDependencies = Readonly<{
  fallbackOpenIds: () => Promise<readonly string[]>;
  createChat: (name: string, memberOpenIds: readonly string[]) => Promise<string>;
  sendToChat: (chatId: string, card: FeishuCard) => Promise<void>;
  notifyOperator: (openId: string, text: string) => Promise<void>;
}>;

// 负责人表's fallback column, read fresh on every call (no caching layer):
// escalateToWarRoom in analyze/route.ts reads the same table the same way,
// once per Cron shard, and that call is not cached either — a cache here
// would just be a second, differently-invalidated source of truth for a
// table small enough that re-reading it costs one Bitable round trip. This
// one runs in the synchronous section (see createResolveAction below) — it
// is one of the two reads measured into the ~1.4s synchronous budget.
async function getFallbackOpenIds(): Promise<readonly string[]> {
  const ownerRules = await listOwnerRules(readBitableEnv(), getTokenProvider());
  return fallbackOwnerOpenIds(ownerRules);
}

// Runs only inside the background task (see createResolveAction below) —
// never in the synchronous section.
function createWarRoomChatForRecord(
  name: string,
  memberOpenIds: readonly string[],
): Promise<string> {
  return createWarRoomChat({ env: readBotEnv(), name, memberOpenIds });
}

// sendFeishuMessage's input is a discriminated union of "chatId" or "openId"
// (never both) — this always takes the chatId branch, since resolveWarRoomAction
// only ever posts into the war room chat it just created, never to a person.
// Runs only inside the background task, same as createWarRoomChatForRecord.
function sendCardToWarRoomChat(chatId: string, card: FeishuCard): Promise<void> {
  return sendFeishuMessage({
    env: readBotEnv(),
    chatId,
    message: { msgType: "interactive", content: JSON.stringify(card) },
  });
}

// The openId branch of sendFeishuMessage, reusing createTextMessage the same
// way the group Q&A fallback replies do — a DM is an ordinary chat message,
// not another card. Runs only inside the background task: this is how a
// createChat/updateRecord/sendToChat failure is reported once the callback
// itself has already answered with the "creating" toast (see
// createResolveAction below).
function notifyOperatorByDirectMessage(openId: string, text: string): Promise<void> {
  return sendFeishuMessage({ env: readBotEnv(), openId, message: createTextMessage(text) });
}

const defaultWarRoomDependencies: WarRoomActionDependencies = {
  fallbackOpenIds: getFallbackOpenIds,
  createChat: createWarRoomChatForRecord,
  sendToChat: sendCardToWarRoomChat,
  notifyOperator: notifyOperatorByDirectMessage,
};

function isWarRoomCardAction(
  action: OneCareCardAction | VocCardAction,
): action is "voc_open_war_room" | "voc_decline_war_room" {
  return action === "voc_open_war_room" || action === "voc_decline_war_room";
}

// The single dispatch point for every card click, demo or real: a VOC action
// carries a real record id and operator identity and goes through the triple
// check (Task 12); the nine demo actions keep using the untouched, synchronous
// demo resolver.
//
// Task 11: voc_open_war_room / voc_decline_war_room are checked, and
// dispatched to resolveWarRoomAction, before the isVocCardAction branch below
// — even though VOC_CARD_ACTIONS (and therefore isVocCardAction) still
// considers both of them VocCardActions. Without this earlier branch they
// fall through to resolveVocCardAction, which enforces strict owner-only
// authorization and has no state-machine transition defined for either
// action (see its own ACTION_TO_TRANSITION comment) — that misrouting is the
// entire defect this task exists to fix: every real click on either button
// returned "该操作暂不支持" and created nothing. resolveWarRoomAction's own
// "owner OR fallback" relaxation is not reimplemented here; it is applied
// only inside that function, and only for these two actions.
//
// Task 11 follow-up: resolveWarRoomAction returns a WarRoomActionOutcome, not
// a bare CardActionResult, precisely so this dispatcher can split its work —
// `result` answers the callback synchronously in every case; `background`,
// present only when a new group is actually being created, is scheduled with
// `schedule` (Next's `after()` by default, the same primitive
// createFeishuEventRoute already uses below for every other kind of deferred
// work in this file) instead of being awaited here. This split exists
// because a real-tenant measurement on 2026-08-12 put the five network calls
// a fresh "create" decision used to make — getRecord, fallbackOpenIds,
// createChat, updateRecord, sendToChat, all inside the one synchronous
// callback — at ~2725ms against Feishu's ~3000ms deadline, using a fast
// parameter-validation reject for createChat/sendToChat rather than the
// slower real calls. A timeout there is worse than merely slow: Feishu marks
// the callback failed while the group and the `协同群 ID` write have already
// landed, so the very next click reports "already exists" and the operator
// reasonably concludes their original click failed. Only getRecord and
// fallbackOpenIds (~1.4s measured) remain in the synchronous section inside
// resolveWarRoomAction itself, alongside the idempotence decision and the
// authorization check — see that function's own comment for why those in
// particular cannot move: idempotence is the only guard against a double
// click creating two groups, and authorization must reject a stranger before
// any "creating" toast is ever shown.
//
// The Bitable client arrives as a parameter so this dispatcher — the exact
// code production runs — can be driven end to end over a fake Bitable
// boundary. Replacing this function with a stub in tests is what let the
// missing note reach production: the route's own tests never saw the call it
// actually makes.
// The two card actions that hand the ticket to somebody else. Named here rather than
// imported from card-actions' private table: this file needs the state machine's action,
// not the card's, and only for the two that produce a notification.
const CARD_ACTION_TRANSITIONS: Readonly<Record<string, string | undefined>> = {
  voc_submit_follow_up: "提交跟进结果",
  voc_confirm_closure: "确认闭环",
};

// Reads the record back after the write so the notification describes the ticket as it
// now is, and so nothing has to be threaded through resolveVocCardAction's return value.
async function notifyHandOff(
  recordId: string,
  operatorOpenId: string,
  action: string,
): Promise<void> {
  try {
    const record = await getBitableClient().getRecord(recordId);
    if (!record) return;
    const events = handOffNotifications({
      action,
      operatorOpenId,
      ownerOpenIds: record.ownerOpenIds,
      engineerOpenIds: record.engineerOpenIds,
    });
    for (const event of events) {
      await notify(
        {
          kind: event.kind,
          openId: event.openId,
          recordId,
          sendFeishuText: true,
          subject: {
            recordNumber: record.recordNumber,
            channel: record.channel,
            category: record.category,
            summary: record.summary,
            content: record.content,
            severity: record.severity,
            state: record.state,
            actorName: "",
          },
        },
        defaultNotifyDependencies(),
      );
    }
  } catch (error) {
    console.error(
      "Hand-off notification failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function createResolveAction(
  bitable: () => VocActionBitable,
  warRoom: WarRoomActionDependencies = defaultWarRoomDependencies,
  schedule: Scheduler = (task) => after(task),
): (input: CardActionRequest) => Promise<CardActionResult> {
  return async function resolveAction(input) {
    if (isWarRoomCardAction(input.action)) {
      const outcome = await resolveWarRoomAction({
        action: input.action,
        recordId: input.recordId,
        operatorOpenId: input.operatorOpenId,
        getRecord: (recordId) => bitable().getRecord(recordId),
        updateRecord: (recordId, fields) => bitable().updateRecord(recordId, fields),
        fallbackOpenIds: warRoom.fallbackOpenIds,
        createChat: warRoom.createChat,
        sendToChat: warRoom.sendToChat,
        notifyOperator: warRoom.notifyOperator,
      });
      if (outcome.background) {
        schedule(outcome.background);
      }
      return outcome.result;
    }
    if (isVocCardAction(input.action)) {
      const result = await resolveVocCardAction({
        action: input.action,
        recordId: input.recordId,
        operatorOpenId: input.operatorOpenId,
        note: input.note,
        bitable: bitable(),
        // Both unconditionally injected: resolveVocCardAction only ever
        // calls them for voc_confirm_closure, and only once it has resolved
        // a real war room chat off the record it already read. Every other
        // action (and the no-war-room / declined cases of this one) leaves
        // them untouched.
        readTranscript: readWarRoomTranscript,
        summarise: summariseClosure,
      });

      // The hand-off this click caused, told to whoever it landed on. Scheduled rather
      // than awaited: Feishu wants the callback answered in ~3 seconds and this is a
      // read plus two writes. Skipped when the click was refused — an error toast means
      // nothing moved.
      const refused =
        result.kind === "update" && result.response.toast?.type === "error";
      const action = CARD_ACTION_TRANSITIONS[input.action];
      if (!refused && action) {
        schedule(() => notifyHandOff(input.recordId, input.operatorOpenId, action));
      }
      return result;
    }
    return resolveCardAction(input.action);
  };
}

// Task 14: this used to read every VOC record back via readVocRecordsCached
// (the public dashboard's cached full-table scan) and filter it in memory —
// measured at ~10.7s end to end against the live Base for 3628 records. That
// full read is gone from this path entirely; `bitable` now supplies only
// countRecords (see readOperatorSummary), and each menu click costs four
// concurrent ~1.0s counts instead. Exported and DI'd the same way
// createAnswerGroupQuestion above is, so a test never has to touch a real
// Bitable/env boundary to prove this wiring is correct.
export function createOperationsReply(
  bitable: () => OperatorSummaryBitable = getBitableClient,
): (operatorOpenId: string) => Promise<FeishuOutboundMessage> {
  return async function operationsReply(operatorOpenId) {
    // A failed count must produce no numbers at all, never a silent 0 a
    // reader could mistake for a real measurement — readOperatorSummary
    // itself already resolves "any count failed" to null for exactly this
    // reason; createOperatorSummaryMessage(null) is the "指标暂不可用" card,
    // not an all-zero one.
    const summary = await readOperatorSummary(bitable(), operatorOpenId);
    return createOperatorSummaryMessage(summary);
  };
}

// Task 13: the "今日概览" menu reply. Task 14 replaced its data source the
// same way as createOperationsReply above: getVocDashboardMetrics's full
// VocMetricsResult (a second full-table aggregation) is gone, replaced by
// readTodayOverviewCounts's five concurrent, count-only requests. This still
// hands the whole TodayOverviewResult straight to createTodayOverviewMessage
// — no branching on `.status` here, no re-deriving a boolean first —
// exactly as before, just fed by a different, much cheaper read.
export function createTodayOverviewReply(
  bitable: () => TodayOverviewBitable = getBitableClient,
): () => Promise<FeishuOutboundMessage> {
  return async function todayOverviewReply() {
    return createTodayOverviewMessage(await readTodayOverviewCounts(bitable()));
  };
}

const defaultDependencies: FeishuEventRouteDependencies = {
  readEnv: () => readBotEnv(),
  parseEvent: (input) => parseFeishuEvent({ ...input, botOpenId: getBotOpenId }),
  operationsReply: createOperationsReply(getBitableClient),
  todayOverviewReply: createTodayOverviewReply(getBitableClient),
  createMenuHint: createMenuHintMessage,
  createWelcome: createWelcomeMessage,
  replyMessage: replyToFeishuMessage,
  sendMessage: sendFeishuMessage,
  sendDirectMessage: sendFeishuMessage,
  resolveAction: createResolveAction(storeBackedBitable),
  answerGroupQuestion: createAnswerGroupQuestion(getBitableClient, async (question, facts) => {
    const provider = getAnswerProvider();
    return provider ? provider.answer(question, facts) : null;
  }),
  schedule: (task) => after(task),
  reportFailure: () => console.error("[onecare-bot] reply_failed"),
  openIdentityWarRoom: (input) =>
    openIdentityWarRoom(input, {
      getProfile: readProfile,
      getRecords: readIdentityRecords,
      getResponderOpenIds: readIdentityResponderOpenIds,
      provider: ruleBasedProvider,
      existingChat: async (kind, id) =>
        (await readIdentityWarRoom(kind, id))?.chatId ?? null,
      createChat: (name, memberOpenIds) =>
        createWarRoomChat({ env: readBotEnv(), name, memberOpenIds }),
      claimChat: claimIdentityWarRoom,
      buildCard: ({ kind, id, insight, openTicketNumbers }) =>
        createProfileInsightCard({
          kind,
          id,
          level: insight.level,
          headline: insight.headline,
          labels: insight.labels,
          signals: insight.signals,
          actions: insight.actions,
          producedBy: insight.producedBy,
          openTicketNumbers,
        }),
      sendCard: (chatId, card) =>
        sendFeishuMessage({
          env: readBotEnv(),
          chatId,
          message: { msgType: "interactive", content: JSON.stringify(card) },
        }),
      now: () => Date.now(),
    }),
};

function json(data: object, status = 200): Response {
  return Response.json(data, { status });
}

export function createFeishuEventRoute(
  dependencies: FeishuEventRouteDependencies = defaultDependencies,
) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const env = dependencies.readEnv();
      const rawBody = await request.text();
      const outcome = await dependencies.parseEvent({
        rawBody,
        headers: request.headers,
        env,
      });

      if (outcome.kind === "challenge") {
        return json({ challenge: outcome.challenge });
      }
      if (outcome.kind === "unauthorized") {
        return json({ error: "unauthorized" }, 403);
      }
      if (outcome.kind === "ignored") {
        return json({});
      }
      if (outcome.kind === "invalid_card_action") {
        return json({
          toast: { type: "info", content: "暂不支持该操作" },
        });
      }

      if (outcome.kind === "entered") {
        dependencies.schedule(async () => {
          try {
            await dependencies.sendMessage({
              env,
              chatId: outcome.chatId,
              message: dependencies.createWelcome(),
            });
          } catch {
            dependencies.reportFailure();
          }
        });
        return json({});
      }

      if (outcome.kind === "card_action") {
        let result: CardActionResult;
        try {
          result = await dependencies.resolveAction({
            action: outcome.action,
            recordId: outcome.recordId,
            operatorOpenId: outcome.operatorOpenId,
            note: outcome.note,
          });
        } catch {
          return json({
            toast: { type: "error", content: "操作未完成，请稍后重试" },
          });
        }
        if (result.kind === "update") {
          return json(result.response);
        }

        dependencies.schedule(async () => {
          try {
            await dependencies.sendMessage({
              env,
              chatId: outcome.chatId,
              message: result.message,
            });
          } catch {
            dependencies.reportFailure();
          }
        });
        return json({ toast: { type: "info", content: result.toast } });
      }

      // 设备预警卡 / 用户画像卡 的「拉群处理」。The synchronous half answers the click
      // immediately — Feishu kills a callback at ~3s and creating a group takes longer
      // than that — and the group itself is built in the deferred half, exactly like the
      // ticket war room's own button.
      if (outcome.kind === "identity_card_action") {
        dependencies.schedule(async () => {
          console.log(
            `[onecare-bot] identity_war_room start ${outcome.identityKind}=${outcome.identityId}`,
          );
          try {
            const result = await dependencies.openIdentityWarRoom({
              kind: outcome.identityKind,
              id: outcome.identityId,
              operatorOpenId: outcome.operatorOpenId,
            });
            await dependencies.sendDirectMessage({
              env,
              openId: outcome.operatorOpenId,
              message: createTextMessage(result.message),
            });
            console.log(`[onecare-bot] identity_war_room ${result.kind}`);
          } catch (error) {
            console.error(
              "[onecare-bot] identity_war_room failed:",
              error instanceof Error ? error.message : String(error),
            );
            dependencies.reportFailure();
          }
        });
        return json({
          toast: { type: "info", content: "正在创建协同群，稍后会在群里看到分析卡" },
        });
      }

      if (outcome.kind === "group_question") {
        dependencies.schedule(async () => {
          // Logged at both ends on purpose. This task is deferred, so nothing about it
          // reaches the caller: when it stopped producing answers, production told us
          // only that the request had arrived, and every guess about where it died cost
          // a deploy. Two lines make the next one a log read.
          console.log(`[onecare-bot] group_question start chat=${outcome.chatId}`);
          try {
            const message = await dependencies.answerGroupQuestion({
              chatId: outcome.chatId,
              text: outcome.text,
            });
            await dependencies.sendMessage({
              env,
              chatId: outcome.chatId,
              message,
            });
            console.log(`[onecare-bot] group_question sent chat=${outcome.chatId}`);
          } catch (error) {
            console.error(
              "[onecare-bot] group_question failed:",
              error instanceof Error ? error.message : String(error),
            );
            dependencies.reportFailure();
          }
        });
        return json({});
      }

      if (outcome.kind === "menu_click") {
        const operatorOpenId = outcome.operatorOpenId;
        // No usable recipient (see event-handler.ts's readMenuOperatorOpenId
        // comment: a malformed or missing operator_id path degrades to "",
        // silently, never a throw). There is nowhere to send a reply and no
        // identity to build voc_my_tickets's personal counts from, so this
        // takes the same "do nothing at all" outcome as an event this route
        // never recognised in the first place — never a card whose numbers
        // could be mistaken for someone else's.
        if (operatorOpenId.length === 0) {
          return json({});
        }

        const buildReply =
          outcome.eventKey === "voc_my_tickets"
            ? () => dependencies.operationsReply(operatorOpenId)
            : dependencies.todayOverviewReply;

        dependencies.schedule(async () => {
          try {
            const message = await buildReply();
            await dependencies.sendDirectMessage({
              env,
              openId: operatorOpenId,
              message,
            });
          } catch {
            dependencies.reportFailure();
          }
        });
        return json({});
      }

      // Task 13: a bare p2p text message no longer builds the operator's real
      // card (that now happens only for the "我的工单" menu click above) — it
      // gets a short, synchronous pointer to the custom menu instead. This is
      // the fix for "any text at all reopens a card nobody asked for": the
      // menu now exists as the deliberate way to ask for real numbers, so a
      // stray typed message should not compete with it.
      dependencies.schedule(async () => {
        try {
          await dependencies.replyMessage({
            env,
            messageId: outcome.messageId,
            message: dependencies.createMenuHint(),
          });
        } catch {
          dependencies.reportFailure();
        }
      });
      return json({});
    } catch {
      return json({ error: "configuration_unavailable" }, 503);
    }
  };
}

export const POST = createFeishuEventRoute();
