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
import { createCard, createCardMessage } from "./cards";

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

const ACTION_TO_TRANSITION: Readonly<Record<VocCardAction, VocAction>> = {
  voc_start_follow_up: "开始跟进",
  voc_submit_follow_up: "提交跟进结果",
  voc_confirm_closure: "确认闭环",
  voc_mark_no_action: "无需建单",
};

// Narrowed to exactly what the triple check needs: one getRecord to read
// state/owner/retryCount, one updateRecord to write the outcome. The real
// BitableClient (Task 9) has more methods (listRecords, listFieldNames) but
// satisfies this structurally, so production wiring just passes it through.
type VocActionBitable = Pick<BitableClient, "getRecord" | "updateRecord">;

export type ResolveVocCardActionInput = Readonly<{
  action: VocCardAction;
  recordId: string;
  operatorOpenId: string;
  followUpNote?: string;
  closingNote?: string;
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

  const outcome = transition(record.state, ACTION_TO_TRANSITION[input.action], {
    retryCount: record.retryCount,
    hasOwner: record.ownerOpenIds.length > 0,
    followUpNote: input.followUpNote,
    closingNote: input.closingNote,
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
  if (input.followUpNote) {
    fields[VOC_FIELD_NAMES.followUpNote] = input.followUpNote;
  }
  if (input.closingNote) {
    fields[VOC_FIELD_NAMES.closingNote] = input.closingNote;
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

  return {
    kind: "update",
    response: {
      toast: { type: "success", content: `已更新为${outcome.next}` },
    },
  };
}
