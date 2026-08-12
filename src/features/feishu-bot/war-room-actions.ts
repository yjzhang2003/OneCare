import type { VocRecord } from "../bitable/field-map";
import { VOC_FIELD_NAMES } from "../bitable/field-map";
import { DECLINED_MARKER, warRoomDecision, warRoomName } from "../warroom/naming";
import type { CardActionResult } from "./card-actions";
import type { FeishuCard } from "./card-types";
import { createVocTicketCard } from "./cards";

// Everything this module needs from the outside world arrives as an injected
// function. Unlike resolveVocCardAction (which takes a BitableClient-shaped
// object), the two war room actions have no shared "bitable" boundary of
// their own — creating a chat and posting into it are Feishu concerns, not
// Bitable ones — so each capability is its own parameter instead of being
// bundled behind one interface that would misname what half of it does.
export type WarRoomActionInput = Readonly<{
  action: "voc_open_war_room" | "voc_decline_war_room";
  recordId: string;
  operatorOpenId: string;
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  updateRecord: (recordId: string, fields: Record<string, unknown>) => Promise<void>;
  fallbackOpenIds: () => Promise<readonly string[]>;
  createChat: (name: string, memberOpenIds: readonly string[]) => Promise<string>;
  sendToChat: (chatId: string, card: FeishuCard) => Promise<void>;
  // Real-tenant measurement (2026-08-12, cross-border): getRecord ~651ms +
  // fallbackOpenIds ~742ms + createChat ~195ms (a fast parameter-validation
  // reject, not a real group create) + updateRecord ~753ms + sendToChat
  // ~384ms totals ~2725ms against Feishu's 3000ms card-callback deadline —
  // 275ms of headroom against an already-optimistic number, since a real
  // createChat (creating the group, adding members, assigning an owner) and
  // a real sendToChat are necessarily slower than the reject/failure round
  // trips that produced 195ms/384ms. That is why createChat/updateRecord/
  // sendToChat happen in the caller's background task (see
  // WarRoomActionOutcome below) instead of here: a timeout here means Feishu
  // marks the callback failed and shows the operator an error or nothing,
  // while the group and the `协同群 ID` write have both already landed — the
  // next click then reports "already exists" and the operator reasonably
  // concludes their first click did nothing. `notifyOperator` is this
  // module's replacement for the toast a failure in that background task can
  // no longer produce: a direct message to whoever clicked, since nothing is
  // listening for a callback response by the time these steps run.
  notifyOperator: (openId: string, text: string) => Promise<void>;
}>;

// The card-callback response to return synchronously (always present), plus
// — only when `getRecord`/authorization/idempotence together decided a new
// group should be created — the slow work still to do. Every other outcome
// (missing record, unauthorized, exists, declined) has no `background`: an
// already-decided outcome has nothing left to run, and running something
// anyway would be indistinguishable from a bug that ignored the idempotence
// check that just ran.
export type WarRoomActionOutcome = Readonly<{
  result: CardActionResult;
  background?: () => Promise<void>;
}>;

function toast(
  type: "success" | "info" | "error",
  content: string,
): CardActionResult {
  return { kind: "update", response: { toast: { type, content } } };
}

function settled(result: CardActionResult): WarRoomActionOutcome {
  return { result };
}

// The three slow steps that used to run inside the synchronous callback
// response (see WarRoomActionInput.notifyOperator's comment for the
// measurement that moved them here). Order and each step's own toast wording
// are unchanged from before the split — only the destination changed, from a
// returned CardActionResult to a direct message, because nothing is waiting
// on a return value by the time this runs. `record` is the same value
// resolveWarRoomAction's synchronous section already read; no second
// getRecord.
async function createWarRoomInBackground(
  input: WarRoomActionInput,
  record: VocRecord,
): Promise<void> {
  // A failure notification's own failure has no further channel to report on
  // — swallowed here, once, so neither call site below has to repeat the
  // same dead end.
  const notify = (text: string) =>
    input.notifyOperator(input.operatorOpenId, text).catch(() => {});

  let chatId: string;
  try {
    chatId = await input.createChat(warRoomName(record), [
      ...record.ownerOpenIds,
      input.operatorOpenId,
    ]);
  } catch {
    // The group itself never came into being: nothing to write, nothing to
    // clean up.
    await notify("协同群创建失败，请重试");
    return;
  }

  try {
    await input.updateRecord(input.recordId, {
      [VOC_FIELD_NAMES.warRoomChatId]: chatId,
    });
  } catch {
    // A real group now exists that the Base cannot point anyone to. That is
    // the accepted lesser evil over a record pointing at a group that was
    // never created — but only if the operator is told, so they retry
    // instead of assuming the click did nothing.
    await notify("协同群已创建但未记录，请重试");
    return;
  }

  try {
    await input.sendToChat(
      chatId,
      createVocTicketCard(
        record,
        {
          summary: record.summary,
          polarity: record.polarity ?? "—",
          dimensions: record.dimensions,
          replies: record.replies,
        },
        { fullContent: true },
      ),
    );
  } catch {
    // The group exists and the Base already points to it — a failed post is
    // cosmetic, not a state to roll back. Only the message differs.
    await notify("协同群已创建，但工单卡片发送失败，请稍后在群内分享");
  }
}

// Order below is load-bearing (see the module-level ordering note above each
// branch): record, then authorization, then idempotence, then create.
//
// 1. getRecord first: a record that does not exist is rejected before any
//    other check runs, so a bad record id never reaches authorization or the
//    idempotence read.
// 2. Authorization before the idempotence check: reversing these would let a
//    stranger learn, from the toast wording alone, whether this ticket
//    already has a group — a fact they have no right to.
// 3. Idempotence (warRoomDecision) before create: only "create" reaches
//    createChat; "exists" and "declined" both return early with no side
//    effect.
//
// ---- Synchronous vs. background split -------------------------------------
// Everything above this comment block's three steps (getRecord,
// fallbackOpenIds, the decline write, or the idempotence read) must complete
// inside Feishu's ~3s card-callback deadline — see WarRoomActionInput's own
// comment for the real-tenant measurement that makes this a hard constraint,
// not a style preference. All four of "no such record" / "not authorized" /
// "already exists" / "already declined" are decided here and returned with
// no `background`, because by definition there is nothing left to do. Only
// the "create" decision returns a `background` task (createWarRoomInBackground
// above): the caller (createResolveAction, app/api/feishu/events/route.ts)
// answers the callback with an immediate "creating" toast and schedules that
// task with Next's `after()`, the same primitive already used elsewhere in
// that file for deferred work.
export async function resolveWarRoomAction(
  input: WarRoomActionInput,
): Promise<WarRoomActionOutcome> {
  const record = await input.getRecord(input.recordId);
  if (!record) {
    return settled(toast("error", "未找到该工单记录"));
  }

  const fallbackIds = await input.fallbackOpenIds();
  const isAuthorized =
    record.ownerOpenIds.includes(input.operatorOpenId) ||
    fallbackIds.includes(input.operatorOpenId);
  if (!isAuthorized) {
    return settled(toast("error", "你不是该工单的负责人或兜底人"));
  }

  if (input.action === "voc_decline_war_room") {
    await input.updateRecord(input.recordId, {
      [VOC_FIELD_NAMES.warRoomChatId]: DECLINED_MARKER,
    });
    return settled(toast("success", "已记录：暂不需要协同群"));
  }

  const decision = warRoomDecision(record.warRoomChatId);
  if (decision === "exists") {
    return settled(toast("info", "协同群已存在"));
  }
  if (decision === "declined") {
    return settled(toast("info", "此前已选择暂不需要"));
  }

  return {
    result: toast("info", "正在创建协同群，稍后会在群里看到工单卡"),
    background: () => createWarRoomInBackground(input, record),
  };
}
