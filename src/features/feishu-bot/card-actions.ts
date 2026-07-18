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
