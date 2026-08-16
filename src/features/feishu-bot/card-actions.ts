import type { BitableClient } from "../bitable/client";
import { VOC_FIELD_NAMES } from "../bitable/field-map";
import { transition, type VocAction } from "../voc/service-event";
import { transitionFields } from "../voc/transition-fields";
import { buildAnswerFacts } from "../warroom/facts";
import { warRoomDecision } from "../warroom/naming";
import type {
  FeishuCardCallbackResponse,
  FeishuOutboundMessage,
  OneCareCardAction,
  OneCareCardView,
  VocCardAction,
} from "./card-types";
import {
  createCard,
  createCardMessage,
  createVocTicketCard,
} from "./cards";

export type CardActionResult =
  | Readonly<{
      kind: "navigate";
      message: FeishuOutboundMessage;
      toast: string;
    }>
  | Readonly<{
      kind: "update";
      response: FeishuCardCallbackResponse;
    }>;

type NavigationCardAction = Extract<OneCareCardAction, `open_${string}`>;

const navigationViews: Readonly<
  Record<NavigationCardAction, OneCareCardView>
> = {
  open_pending: "pending",
  open_tasks: "tasks",
  open_operations: "operations",
  open_diagnosis: "diagnosis",
  open_progress: "progress",
  open_result: "result",
};

const navigationLabels: Readonly<Record<NavigationCardAction, string>> = {
  open_pending: "待确认服务",
  open_tasks: "今日任务",
  open_operations: "运营后台",
  open_diagnosis: "AI 预诊与配件",
  open_progress: "服务进度",
  open_result: "服务结果",
};

function isNavigationAction(
  action: OneCareCardAction,
): action is NavigationCardAction {
  return action in navigationViews;
}

function updateResponse(view: OneCareCardView): CardActionResult {
  return {
    kind: "update",
    response: {
      toast: { type: "success", content: "操作已记录（演示）" },
      card: { type: "raw", data: createCard(view, "completed") },
    },
  };
}

export function resolveCardAction(action: OneCareCardAction): CardActionResult {
  if (isNavigationAction(action)) {
    const view = navigationViews[action];
    return {
      kind: "navigate",
      message: createCardMessage(view),
      toast: `已打开${navigationLabels[action]}`,
    };
  }

  switch (action) {
    case "create_ticket":
      return updateResponse("ticket");
    case "confirm_parts":
      return updateResponse("diagnosis");
    case "submit_result":
      return updateResponse("result");
    default: {
      const unreachable: never = action;
      throw new Error(`Unsupported card action: ${unreachable}`);
    }
  }
}

// Partial, not total: voc_open_war_room / voc_decline_war_room (Task 5) are
// not state-machine transitions at all — resolveWarRoomAction (Task 6) owns
// them, on its own relaxed authorization (owner OR fallback, not owner only).
// Forcing them onto some VocAction here to satisfy a total Record would let
// either button silently drive transition() with a fabricated action once
// something starts routing real clicks to this resolver. The guard just below
// this map is the placeholder: it keeps both actions inert here — no read of
// the state machine, no write — until whatever wires the war room card past
// this function routes them to resolveWarRoomAction instead.
const ACTION_TO_TRANSITION: Readonly<Partial<Record<VocCardAction, VocAction>>> = {
  voc_start_follow_up: "开始跟进",
  voc_submit_follow_up: "提交跟进结果",
  voc_confirm_closure: "确认闭环",
  voc_mark_no_action: "无需建单",
};

// Narrowed to exactly what the triple check needs: one getRecord to read
// state/owner/retryCount, one updateRecord to write the outcome. The real
// BitableClient (Task 9) has more methods (listRecords, listFieldNames) but
// satisfies this structurally, so production wiring just passes it through.
// Exported so an end-to-end test can drive the production resolver over a fake
// Bitable boundary instead of replacing the resolver itself with a stub —
// stubbing it is how the missing-note defect stayed invisible.
export type VocActionBitable = Pick<BitableClient, "getRecord" | "updateRecord">;

// Which Base column an action's note belongs in. Absent means the action
// carries no text at all, which is a different thing from "carries empty
// text": 开始跟进 has no note to write, whereas 提交跟进结果 with an empty note
// is a submission the state machine must refuse.
const NOTE_COLUMN: Readonly<
  Partial<Record<VocCardAction, "followUpNote" | "closingNote">>
> = {
  voc_submit_follow_up: "followUpNote",
  voc_confirm_closure: "closingNote",
};

// What a dispatched engineer may do from their 上门任务卡: arrive, and report. Not
// 确认闭环, and not 无需建单 — both are the owner's call on whether the ticket is done.
const ENGINEER_ACTIONS: readonly VocCardAction[] = [
  "voc_start_follow_up",
  "voc_submit_follow_up",
];

export type ResolveVocCardActionInput = Readonly<{
  action: VocCardAction;
  recordId: string;
  operatorOpenId: string;
  // One required field instead of two optional ones. The previous shape
  // (`followUpNote?`/`closingNote?`) let the only production caller omit both
  // and still compile, so every 提交跟进结果 and 确认闭环 click was rejected by
  // its own guard while both sides' unit tests passed. Required means a caller
  // that forgets it does not build; which column it lands in is derived from
  // the action rather than chosen by the caller.
  note: string;
  bitable: VocActionBitable;
  // Closure archival (Task 9) — both optional so every existing caller (and
  // every test above this one) that has no notion of a group keeps compiling
  // unchanged. There is deliberately no `chatId` parameter here: the gate is
  // "does this ticket have a war room", and that is a fact already sitting on
  // the record this call read for the triple check above, not something the
  // caller needs to determine or pass in. Threading it through the route
  // layer would either need a second `getRecord` (the exact duplicate read
  // this module's design already refuses — see VocActionBitable's own
  // comment) or force the caller to guess whether a given click's chat
  // happens to be the war room, which is the wrong question anyway: a ticket
  // closed from a plain single chat still has a war room worth archiving if
  // one exists, and a ticket with no war room has nothing to archive no
  // matter which chat the click came from. `readTranscript` takes the war
  // room's chat id as its argument, unlike a plain `() => Promise<...>`: the
  // caller cannot close over "which chat" in advance the way it could when
  // `chatId` was an explicit input, because it does not know a war room
  // exists — let alone which one — until this call resolves it from the
  // record.
  readTranscript?: (chatId: string) => Promise<readonly string[]>;
  // `facts` (built from the very record this call already read, via Task 8's
  // buildAnswerFacts) and whatever `readTranscript` returned are the only
  // grounding a closing summary gets. `null` means "cannot summarise right
  // now" — the same never-invent-an-answer contract createAnswerProvider
  // (Task 8) already keeps for the group's own questions, reused here rather
  // than redefined.
  summarise?: (
    facts: string,
    transcript: readonly string[],
  ) => Promise<string | null>;
}>;

function errorToast(content: string): CardActionResult {
  return { kind: "update", response: { toast: { type: "error", content } } };
}

// The three checks below — record exists, operator is the owner, the
// transition is legal — all happen before any write, from a single
// `getRecord` call. Authorization has to resolve inside this synchronous
// response: Feishu wants a card callback answered within three seconds, and
// deferring the verdict to after() would mean replying before we know
// whether the click is even allowed, while a card can only be updated twice.
// A rejected operator, a missing record, and an illegal transition all write
// nothing at all: `updateRecord` is only reached once every check passes.
export async function resolveVocCardAction(
  input: ResolveVocCardActionInput,
): Promise<CardActionResult> {
  let record: Awaited<ReturnType<VocActionBitable["getRecord"]>>;
  try {
    record = await input.bitable.getRecord(input.recordId);
  } catch {
    return errorToast("读取记录失败，请稍后重试");
  }

  if (!record) {
    return errorToast("记录不存在或已被删除");
  }

  // Two people can act on a ticket from a card: the 客服 who owns it, and the 工程师 it
  // was dispatched to. The engineer's half is deliberately narrower — they report what
  // happened on site; whether that closes the ticket is the owner's judgement, and the
  // 上门任务卡 never offers them the button.
  const isOwner = record.ownerOpenIds.includes(input.operatorOpenId);
  const isEngineer = record.engineerOpenIds.includes(input.operatorOpenId);
  if (!isOwner && !isEngineer) {
    return errorToast("只有该记录的负责人可以操作");
  }
  if (!isOwner && !ENGINEER_ACTIONS.includes(input.action)) {
    return errorToast("上门工程师可以回填处理结果，闭环由负责人确认");
  }

  const transitionAction = ACTION_TO_TRANSITION[input.action];
  if (!transitionAction) {
    // voc_open_war_room / voc_decline_war_room: this resolver does not decide
    // them (see ACTION_TO_TRANSITION above). Nothing is read from or written
    // to the state machine for either action here.
    return errorToast("该操作暂不支持");
  }

  const noteColumn = NOTE_COLUMN[input.action];
  const outcome = transition(record.state, transitionAction, {
    retryCount: record.retryCount,
    hasOwner: record.ownerOpenIds.length > 0,
    ...(noteColumn === "followUpNote" ? { followUpNote: input.note } : {}),
    ...(noteColumn === "closingNote" ? { closingNote: input.note } : {}),
  });

  if (outcome.kind === "rejected") {
    return errorToast(outcome.reason);
  }

  if (outcome.kind === "noop") {
    return {
      kind: "update",
      response: {
        toast: { type: "info", content: `当前已是${outcome.state}` },
      },
    };
  }

  // Which columns a transition writes now lives in transitionFields, shared
  // with the workbench's web write path (src/features/workbench/write-actions.ts).
  // Two copies of this decision would drift, and the drift would surface as
  // "tickets touched from a card carry different data than tickets touched from
  // the web" — a quiet inconsistency in the Base rather than a test failure.
  //
  // One behavioural difference from the inline version this replaces: reaching
  // 待跟进 stamps 建单时间. No card action can reach 待跟进 — ACTION_TO_TRANSITION
  // maps no card to 需建单 — so for this call site the difference is
  // unreachable, and this refactor is behaviour-neutral in production.
  //
  // The note is passed straight through rather than switched on noteColumn:
  // transitionFields keys the note column off the target state, and each of the
  // two note-carrying actions is the only action reaching its target state, so
  // the two are equivalent.
  const fields = transitionFields(outcome.next, input.note, Date.now());

  try {
    await input.bitable.updateRecord(input.recordId, fields);
  } catch {
    return errorToast("状态写回失败，请稍后重试");
  }

  // Closure is a fact that already happened the instant the write above
  // landed — everything below is a second, independent write layered on top
  // of that fact, never a rollback path for it. This is the one rule the
  // whole feature exists to protect: a model outage must close over the
  // summary alone, not reopen (or fail to close) a ticket that is already
  // closed in the Base. `readTranscript`/`summarise` are captured into local
  // consts (rather than read off `input` again after the `await`s below) so
  // the narrowing from this guard survives across them.
  const readTranscript = input.readTranscript;
  const summarise = input.summarise;
  // `record.warRoomChatId` is untouched by the write above (that write only
  // ever sets state/note/closedAt fields), so reading it off the pre-write
  // `record` is not the stale-data trap it would be for a field the write
  // just changed — it is exactly the same value a fresh read would return.
  //
  // Three values live in this column, not two: "" (no war room chat has ever
  // been created — warRoomDecision's "create"), a real `oc_*` chat id
  // ("exists"), and the literal string "declined" (warRoomDecision's own
  // DECLINED_MARKER — the operator chose "暂不需要协同群" in
  // resolveWarRoomAction). "declined" is non-empty text but is not a chat
  // id: handing it to a transcript reader would be a guaranteed-to-fail API
  // call instead of a correct no-op. Only "exists" has anything to archive.
  let closureSuffix = "";
  if (
    outcome.next === "已闭环" &&
    warRoomDecision(record.warRoomChatId) === "exists" &&
    readTranscript &&
    summarise
  ) {
    try {
      const transcript = await readTranscript(record.warRoomChatId);
      const facts = buildAnswerFacts({
        // `record` is what getRecord returned before this call's own write —
        // still showing the pre-closure state. The write above has already
        // landed, so the facts handed to the model describe the ticket as of
        // right now (`outcome.next`), the same correction the card re-render
        // below makes for the same reason.
        ticket: { ...record, state: outcome.next },
        // No cross-ticket aggregates: a closing summary is grounded in this
        // ticket and this conversation alone, unlike the group Q&A skill
        // (Task 8) which cites how many other tickets share a dimension or
        // model. VocActionBitable (above) exposes only getRecord/
        // updateRecord, so there is no listRecords call here to compute real
        // aggregates from even if the question wanted them.
        sameDimension: { total: 0, closed: 0 },
        sameModel: 0,
      });
      const closingSummary = await summarise(facts, transcript);
      if (closingSummary) {
        // Appended, never substituted. The operator typed their own 闭环结论 into
        // the card's form seconds ago and it has already been written; replacing
        // it with the model's version would delete a person's words in favour of
        // a summary of them — and the ticket page shows this column, so what is
        // lost here is lost visibly.
        // Guaranteed non-empty on this path — 确认闭环's own guard rejects an empty
        // 闭环结论 before any of this runs — but read defensively so a future caller
        // that skips the state machine cannot produce a note reading "AI 闭环纪要：".
        const typed = (input.note ?? "").trim();
        await input.bitable.updateRecord(input.recordId, {
          [VOC_FIELD_NAMES.closingNote]: typed
            ? `${typed}\n\nAI 闭环纪要：${closingSummary}`
            : closingSummary,
        });
      } else {
        closureSuffix = "（结论生成失败）";
      }
    } catch {
      // Transcript read, model call, or this second write itself — any of
      // the three failing lands here. The ticket is closed regardless; only
      // the toast says the summary did not make it.
      closureSuffix = "（结论生成失败）";
    }
  }

  // One card, in this one synchronous response. Without it the owner got a
  // green toast on a card still showing the old status tag and the button they
  // just used — in an unedited screen recording the card looks frozen while
  // the Base changes behind it. The re-render is built from the record already
  // read above (no second getRecord) and from outcome.next rather than a
  // re-read state, and it is returned exactly once: the callback token allows
  // at most two card updates, so one click must not spend more than one.
  return {
    kind: "update",
    response: {
      toast: {
        type: "success",
        content: `已更新为${outcome.next}${closureSuffix}`,
      },
      card: {
        type: "raw",
        data: createVocTicketCard(
          { ...record, state: outcome.next },
          {
            summary: record.summary,
            polarity: record.polarity ?? "—",
            dimensions: record.dimensions,
            replies: record.replies,
          },
        ),
      },
    },
  };
}
