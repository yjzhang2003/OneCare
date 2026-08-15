// 消息链路：一件事发生时，谁该被告知，以及告诉他什么。
//
// Every hand-off in this system moves work from one person to another, and until now
// only two of them said so out loud (建单 pushed a ticket card, 派工 pushed a task card).
// 改派 moved a ticket to a colleague who found out by refreshing; a 工程师 filing their
// report handed the ticket back to the 客服 with nothing but a state change to show for
// it. Both are exactly the moments a system should speak.
//
// This module is the wording and nothing else — no database, no Feishu. What it produces
// is used twice per event, once for the console's own inbox and once for the bot message,
// so the two channels cannot describe the same event differently.

export const NOTIFICATION_KINDS = [
  // 建单：打标判定要建单，工单落到客服负责人手上。
  "ticket_assigned",
  // 改派：另一个人把工单交给了你。
  "ticket_reassigned",
  // 派工：你被派去上门。
  "engineer_dispatched",
  // 回填：工程师报了现场结果，球回到客服脚下。
  "engineer_reported",
  // 闭环：客服确认解决，通知在这条工单上出过力的工程师。
  "ticket_closed",
  // 升级提请：高严重度，等你决定要不要拉群。
  "escalation_requested",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationSubject = Readonly<{
  recordNumber: string;
  channel: string;
  category: string;
  // The AI/manual summary if there is one, else the raw complaint — the recipient needs
  // to know what this is about without opening anything.
  summary: string;
  content: string;
  severity: string | null;
  state: string;
  // Who caused this to land on the recipient. Empty for the pipeline, which is not a
  // person and should not be dressed up as one.
  actorName: string;
}>;

export type NotificationCopy = Readonly<{
  title: string;
  body: string;
}>;

const TITLES: Readonly<Record<NotificationKind, string>> = {
  ticket_assigned: "新工单到你手上",
  ticket_reassigned: "工单改派给你",
  engineer_dispatched: "新的上门任务",
  engineer_reported: "工程师已回填，等你确认闭环",
  ticket_closed: "你上门的工单已闭环",
  escalation_requested: "高严重度工单，等你决定是否拉群",
};

// One line of context, then the subject. Deliberately short: this is a notification, and
// everything else is one click away on the ticket itself.
export function notificationCopy(
  kind: NotificationKind,
  subject: NotificationSubject,
): NotificationCopy {
  const what = subject.summary.trim().length > 0 ? subject.summary : subject.content;
  const scope = [subject.channel, subject.category].filter((part) => part.trim().length > 0);
  const severity = subject.severity ? `严重度${subject.severity}` : null;
  const who = subject.actorName.trim();

  const lead: Readonly<Record<NotificationKind, string>> = {
    ticket_assigned: "按路由规则分给你",
    ticket_reassigned: who.length > 0 ? `${who}改派给你` : "被改派给你",
    engineer_dispatched: who.length > 0 ? `${who}派你上门` : "派你上门",
    engineer_reported: who.length > 0 ? `${who}已回填现场结果` : "工程师已回填现场结果",
    ticket_closed: who.length > 0 ? `${who}已确认闭环` : "已确认闭环",
    escalation_requested: "打标判定为高严重度",
  };

  const head = [lead[kind], ...scope, severity].filter(Boolean).join(" · ");
  return {
    title: TITLES[kind],
    body: `${head}\n${truncate(what, 60)}`,
  };
}

function truncate(text: string, limit: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

// The Feishu text a notification sends. A plain text message, not a card: the card for
// each of these already exists where one is warranted (the ticket card, the task card),
// and a second interactive card for the same event would give the recipient two places
// to click and one of them would be wrong.
export function notificationText(
  kind: NotificationKind,
  subject: NotificationSubject,
  href: string,
): string {
  const copy = notificationCopy(kind, subject);
  return `【${copy.title}】${subject.recordNumber}\n${copy.body}\n${href}`;
}
