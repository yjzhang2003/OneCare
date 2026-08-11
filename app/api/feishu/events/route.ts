import { after } from "next/server";

import type { VocRecord } from "../../../../src/features/bitable/field-map";
import {
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../src/features/bitable/client";
import {
  createBotReply,
  type BotReply,
} from "../../../../src/features/feishu-bot/bot-script";
import {
  resolveCardAction,
  resolveVocCardAction,
  type CardActionResult,
  type VocActionBitable,
} from "../../../../src/features/feishu-bot/card-actions";
import {
  VOC_CARD_ACTIONS,
  type FeishuOutboundMessage,
  type OneCareCardAction,
  type VocCardAction,
} from "../../../../src/features/feishu-bot/card-types";
import {
  createTextMessage,
  createVocTicketCard,
  createWelcomeMessage,
} from "../../../../src/features/feishu-bot/cards";
import { createBotOpenIdProvider } from "../../../../src/features/feishu-bot/chat-client";
import {
  replyToFeishuMessage,
  sendFeishuMessage,
} from "../../../../src/features/feishu-bot/client";
import {
  parseFeishuEvent,
  type FeishuEventOutcome,
} from "../../../../src/features/feishu-bot/event-handler";
import {
  buildAnswerFacts,
  computeFactsAggregates,
  stripMention,
} from "../../../../src/features/warroom/facts";
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

// `runtime = "nodejs"` was dropped: it is the App Router default anyway, and
// task 14 enables `cacheComponents` in next.config.ts (for the VOC
// dashboard's `use cache`), which rejects this route segment config outright.
export const maxDuration = 10;

type Scheduler = (task: () => Promise<void>) => void;

type FeishuEventRouteDependencies = {
  readEnv: () => BotEnv;
  parseEvent: (input: {
    rawBody: string;
    headers: Headers;
    env: BotEnv;
  }) => Promise<FeishuEventOutcome>;
  createReply: (text: string) => BotReply;
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
  resolveAction: (input: CardActionRequest) => Promise<CardActionResult>;
  answerGroupQuestion: (
    input: Readonly<{ chatId: string; text: string }>,
  ) => Promise<FeishuOutboundMessage>;
  schedule: Scheduler;
  reportFailure: () => void;
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

    let records: readonly VocRecord[];
    try {
      records = await bitable().listRecords();
    } catch {
      return createTextMessage(CANNOT_ANSWER_MESSAGE);
    }

    const facts = buildAnswerFacts({
      ticket,
      ...computeFactsAggregates(ticket, records),
    });

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

// The single dispatch point for every card click, demo or real: a VOC action
// carries a real record id and operator identity and goes through the triple
// check (Task 12); the nine demo actions keep using the untouched, synchronous
// demo resolver.
//
// The Bitable client arrives as a parameter so this dispatcher — the exact
// code production runs — can be driven end to end over a fake Bitable
// boundary. Replacing this function with a stub in tests is what let the
// missing note reach production: the route's own tests never saw the call it
// actually makes.
export function createResolveAction(
  bitable: () => VocActionBitable,
): (input: CardActionRequest) => Promise<CardActionResult> {
  return async function resolveAction(input) {
    if (isVocCardAction(input.action)) {
      return resolveVocCardAction({
        action: input.action,
        recordId: input.recordId,
        operatorOpenId: input.operatorOpenId,
        note: input.note,
        bitable: bitable(),
      });
    }
    return resolveCardAction(input.action);
  };
}

const defaultDependencies: FeishuEventRouteDependencies = {
  readEnv: () => readBotEnv(),
  parseEvent: (input) => parseFeishuEvent({ ...input, botOpenId: getBotOpenId }),
  createReply: createBotReply,
  createWelcome: createWelcomeMessage,
  replyMessage: replyToFeishuMessage,
  sendMessage: sendFeishuMessage,
  resolveAction: createResolveAction(getBitableClient),
  answerGroupQuestion: createAnswerGroupQuestion(getBitableClient, async (question, facts) => {
    const provider = getAnswerProvider();
    return provider ? provider.answer(question, facts) : null;
  }),
  schedule: (task) => after(task),
  reportFailure: () => console.error("[onecare-bot] reply_failed"),
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

      if (outcome.kind === "group_question") {
        dependencies.schedule(async () => {
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
          } catch {
            dependencies.reportFailure();
          }
        });
        return json({});
      }

      const reply = dependencies.createReply(outcome.text);
      dependencies.schedule(async () => {
        try {
          await dependencies.replyMessage({
            env,
            messageId: outcome.messageId,
            message: reply.message,
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
