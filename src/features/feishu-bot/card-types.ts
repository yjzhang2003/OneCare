export const ONECARE_CASE_ID = "OC-240718-037";

export const ONECARE_CARD_ACTIONS = [
  "open_pending",
  "open_tasks",
  "open_operations",
  "open_diagnosis",
  "open_progress",
  "open_result",
  "create_ticket",
  "confirm_parts",
  "submit_result",
] as const;

export type OneCareCardAction = (typeof ONECARE_CARD_ACTIONS)[number];

export const VOC_CARD_ACTIONS = [
  "voc_start_follow_up",
  "voc_submit_follow_up",
  "voc_confirm_closure",
  "voc_mark_no_action",
] as const;

export type VocCardAction = (typeof VOC_CARD_ACTIONS)[number];

export type OneCareCardView =
  | "workbench"
  | "operations"
  | "pending"
  | "ticket"
  | "progress"
  | "tasks"
  | "diagnosis"
  | "result";

export type OneCareCardState = "initial" | "completed";

export type FeishuCard = Record<string, unknown>;

export type FeishuOutboundMessage = Readonly<{
  msgType: "interactive";
  content: string;
}>;

export type FeishuCardCallbackResponse = Readonly<{
  toast?: Readonly<{ type: "info" | "success" | "warning" | "error"; content: string }>;
  card?: Readonly<{ type: "raw"; data: FeishuCard }>;
}>;
