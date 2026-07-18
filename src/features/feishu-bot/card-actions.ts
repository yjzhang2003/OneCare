import type {
  FeishuCardCallbackResponse,
  FeishuOutboundMessage,
  OneCareCardAction,
  OneCareCardView,
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

const navigationViews: Readonly<
  Partial<Record<OneCareCardAction, OneCareCardView>>
> = {
  open_pending: "pending",
  open_tasks: "tasks",
  open_operations: "operations",
  open_diagnosis: "diagnosis",
  open_progress: "progress",
  open_result: "result",
};

const navigationLabels: Readonly<Partial<Record<OneCareCardAction, string>>> = {
  open_pending: "待确认服务",
  open_tasks: "今日任务",
  open_operations: "运营后台",
  open_diagnosis: "AI 预诊与配件",
  open_progress: "服务进度",
  open_result: "服务结果",
};

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
  const view = navigationViews[action];
  if (view) {
    return {
      kind: "navigate",
      message: createCardMessage(view),
      toast: `已打开${navigationLabels[action] ?? "工作台"}`,
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
