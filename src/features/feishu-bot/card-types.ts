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
  "voc_open_war_room",
  "voc_decline_war_room",
] as const;

export type VocCardAction = (typeof VOC_CARD_ACTIONS)[number];

// The three Card 2.0 form identifiers that carry an owner's typed note back to
// this server. They live here, shared by the card builder that writes them and
// the event parser that reads them, because the round trip only works if both
// sides spell them identically — and a silent mismatch would look exactly like
// "the owner submitted an empty note".
//
// Feishu requires `name` on every interactive component inside a form
// container, requires it to be unique within the card, and returns form data
// keyed by that name under `action.form_value`
// (open.feishu.cn/document/feishu-cards/card-json-v2-components/containers/form-container,
// open.feishu.cn/document/feishu-cards/card-callback-communication). One name
// serves both text-carrying actions because a ticket card only ever offers one
// of them at a time; which Base column the text lands in is decided by the
// action, not by the field name.
export const VOC_NOTE_FORM_NAME = "voc_note_form";
export const VOC_NOTE_FIELD_NAME = "voc_note";
export const VOC_NOTE_SUBMIT_NAME = "voc_note_submit";

// max_length on a Card 2.0 input accepts 1–1000 and defaults to 1000; 1000 is
// the platform ceiling, not a choice this project can raise.
export const VOC_NOTE_MAX_LENGTH = 1000;

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

// "interactive" carries a card's JSON as `content`; "text" (added for the war
// room's free-Q&A replies, Task 8) carries a plain `{"text": "..."}` payload —
// a prose answer or a one-line failure message is an ordinary chat message,
// not another card to render.
export type FeishuOutboundMessage = Readonly<{
  msgType: "interactive" | "text";
  content: string;
}>;

export type FeishuCardCallbackResponse = Readonly<{
  toast?: Readonly<{ type: "info" | "success" | "warning" | "error"; content: string }>;
  card?: Readonly<{ type: "raw"; data: FeishuCard }>;
}>;
