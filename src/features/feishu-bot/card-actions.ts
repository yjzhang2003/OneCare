import type { BitableClient } from "../bitable/client";
import { VOC_FIELD_NAMES } from "../bitable/field-map";
import { transition, type VocAction } from "../voc/service-event";
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

  if (!record.ownerOpenIds.includes(input.operatorOpenId)) {
    return errorToast("只有该记录的负责人可以操作");
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

  const fields: Record<string, unknown> = {
    [VOC_FIELD_NAMES.state]: outcome.next,
  };
  // Unconditional on the column, not on truthiness: the state machine has
  // already refused an empty note for the two actions that carry one, so
  // reaching here with a note column means there is real text to write.
  if (noteColumn === "followUpNote") {
    fields[VOC_FIELD_NAMES.followUpNote] = input.note;
  }
  if (noteColumn === "closingNote") {
    fields[VOC_FIELD_NAMES.closingNote] = input.note;
  }
  if (outcome.next === "已闭环") {
    // Calibrated against the live Base (field-map.ts): a Bitable DateTime
    // field is epoch milliseconds on the wire, not an ISO string. Writing an
    // ISO string here is silently rejected by the real API and turns a
    // legitimate closure into a "写回失败" error — this was caught by the
    // real-Base round trip, not by mocked unit tests.
    fields[VOC_FIELD_NAMES.closedAt] = Date.now();
  }

  try {
    await input.bitable.updateRecord(input.recordId, fields);
  } catch {
    return errorToast("状态写回失败，请稍后重试");
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
      toast: { type: "success", content: `已更新为${outcome.next}` },
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
