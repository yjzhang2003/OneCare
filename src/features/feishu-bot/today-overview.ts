import type { BitableClient } from "../bitable/client";
import { VOC_FIELD_NAMES } from "../bitable/field-map";

// Task 14: the "今日概览" menu card used to call getVocDashboardMetrics, which
// reads every VOC record back and aggregates it in memory — measured at
// ~10.7s end to end for 3628 records. aggregateVocMetrics's other numbers
// (negativeShare, averageClosureHours, taggingCoverage, dimensionTop) all
// need that full record set: a polarity histogram, a per-record hour delta,
// a dimension frequency table — none of them reduce to "how many rows match
// this filter", so none of them belong in a counts-only model. This card's
// whole reason to exist is a three-second reply from a menu tap, not a
// second copy of the workbench dashboard; the button on it already points at
// the page (app/api/voc/dashboard, still backed by getVocDashboardMetrics
// untouched by this file) that computes the rest properly.
export type TodayOverviewCounts = Readonly<{
  total: number;
  ticketsOpened: number;
  ticketsClosed: number;
  closureRate: number;
}>;

export type TodayOverviewResult =
  | Readonly<{ status: "ok"; counts: TodayOverviewCounts }>
  | Readonly<{ status: "unavailable" }>;

// Narrowed to the one method this reply touches, same as
// operator-summary.ts's OperatorSummaryBitable.
export type TodayOverviewBitable = Pick<BitableClient, "countRecords">;

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

// service-event.ts's RULES only ever move a record into 待跟进 via the 需建单
// transition (the one place VOC_FIELD_NAMES.ticketOpenedAt gets written —
// analyze/route.ts), and forward from there through 跟进中 and 待闭环 to the
// one terminal state 已闭环; nothing regresses to 已分析 or earlier. So "已建单"
// is exactly the count of rows currently sitting in any of these four
// states, and "已闭环" is the one terminal state among them —
// aggregateVocMetrics's own ticketOpenedAt/closedAt-presence check
// (metrics.ts) reduces to the same split, computed here from state counts
// instead of timestamps on records this file never reads.
export async function readTodayOverviewCounts(
  bitable: TodayOverviewBitable,
): Promise<TodayOverviewResult> {
  const countByState = (state: string) =>
    bitable.countRecords([{ field_name: VOC_FIELD_NAMES.state, value: [state] }]);

  try {
    // Five independent counts, concurrent via Promise.all — the same
    // reasoning as operator-summary.ts's readOperatorSummary: five ~1.0s
    // requests run together cost about as much as the slowest one, not five
    // times that. Any single failure rejects the whole Promise.all and this
    // returns "unavailable", never a partial set of numbers next to a silent
    // 0 for whichever count failed.
    const [total, pendingFollowUp, inProgress, pendingClosure, closed] =
      await Promise.all([
        bitable.countRecords([]),
        countByState("待跟进"),
        countByState("跟进中"),
        countByState("待闭环"),
        countByState("已闭环"),
      ]);

    const ticketsOpened = pendingFollowUp + inProgress + pendingClosure + closed;
    const ticketsClosed = closed;

    return {
      status: "ok",
      counts: {
        total,
        ticketsOpened,
        ticketsClosed,
        closureRate: ratio(ticketsClosed, ticketsOpened),
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
