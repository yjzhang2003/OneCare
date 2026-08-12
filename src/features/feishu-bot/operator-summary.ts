import type { VocRecord } from "../bitable/field-map";
import { toWorkbenchTicket } from "../workbench/data";
import { isOverdue } from "../workbench/query";

// Task 12: what a p2p text message from an operator now gets back, in place
// of the demo command menu — this operator's own real VOC workload, matched
// off `负责人` (VocRecord.ownerOpenIds) against the sender's own open_id from
// the signed message event (event-handler.ts's readMessageSenderOpenId).
export type OperatorSummary = Readonly<{
  myPendingFollowUp: number;
  myInProgress: number;
  myPendingClosure: number;
  // Reuses workbench/query.ts's own isOverdue (72 hours, not yet closed)
  // rather than redefining the threshold here — the workbench page and this
  // card must never disagree about what "overdue" means.
  myOverdue: number;
  newToday: number;
  total: number;
}>;

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

// Asia/Shanghai has carried a flat UTC+8 offset with no DST since 1991, so
// shifting the instant by a fixed 8 hours and reading off its UTC calendar
// date is exactly the Beijing calendar date — no Intl.DateTimeFormat/timeZone
// machinery required for what is, in the end, a same-day comparison.
function beijingDateKey(iso: string): string | null {
  const parsedMs = Date.parse(iso);
  if (!Number.isFinite(parsedMs)) return null;
  return new Date(parsedMs + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

export function computeOperatorSummary(
  records: readonly VocRecord[],
  operatorOpenId: string,
  now: Date,
): OperatorSummary {
  // An empty operatorOpenId (a message Feishu somehow sent with no sender —
  // see event-handler.ts) matches nothing here, the same way it matches no
  // Base row's 负责人 column: this never throws, it just reports an all-zero
  // personal workload for an identity that resolved to nothing.
  const mine = operatorOpenId
    ? records.filter((record) => record.ownerOpenIds.includes(operatorOpenId))
    : [];

  const myOverdue = mine
    .map(toWorkbenchTicket)
    .filter((ticket) => isOverdue(ticket, now.getTime())).length;

  const todayKey = beijingDateKey(now.toISOString());
  const newToday = records.filter(
    (record) =>
      record.feedbackAt !== null &&
      beijingDateKey(record.feedbackAt) === todayKey,
  ).length;

  return {
    myPendingFollowUp: mine.filter((record) => record.state === "待跟进").length,
    myInProgress: mine.filter((record) => record.state === "跟进中").length,
    myPendingClosure: mine.filter((record) => record.state === "待闭环").length,
    myOverdue,
    newToday,
    total: records.length,
  };
}
