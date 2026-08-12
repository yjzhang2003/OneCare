import type { BitableClient } from "../bitable/client";
import { VOC_FIELD_NAMES } from "../bitable/field-map";

// Task 14: this used to be computeOperatorSummary, a pure function over every
// VOC record the caller had already read — which meant the "我的工单" menu
// card cost a full readVocRecordsCached() scan first: 3628 records, paged
// eight times, measured at ~10.7s end to end. records/search's own `total`
// answers "how many of this operator's tickets are 待跟进" directly, in
// ~1.0s, without ever reading a record body back — so this file now issues
// that request instead of filtering an in-memory list.
export type OperatorSummary = Readonly<{
  myPendingFollowUp: number;
  myInProgress: number;
  myPendingClosure: number;
  // The one full-table-shaped number kept from the old OperatorSummary:
  // unlike myOverdue (a computed 72-hour-since-ticketOpenedAt check) and
  // newToday (a same-Beijing-day check on feedbackAt), a shop-wide total is
  // itself just a count with no filter at all — one more concurrent request,
  // not a second full scan. myOverdue and newToday are gone outright: both
  // needed a real record's timestamp fields, and keeping either would have
  // meant keeping the very full-table read this fix exists to remove.
  total: number;
}>;

// Narrowed to the one method this reply touches, the same reasoning as
// card-actions.ts's VocActionBitable: a fake standing in for this in a test
// cannot silently support a wider surface (a full record read) than this
// flow now actually uses.
export type OperatorSummaryBitable = Pick<BitableClient, "countRecords">;

const PERSONAL_STATES = ["待跟进", "跟进中", "待闭环"] as const;

// Four independent records/search counts — three personal states plus one
// unfiltered total — issued together via Promise.all rather than one after
// another. Four ~1.0s requests run concurrently cost about as much as the
// single slowest one; run serially (a `for` loop awaiting each in turn) they
// would cost roughly four times that, eating back most of the latency win
// this task exists to deliver.
//
// Any one of the four failing rejects the whole Promise.all, and this
// returns null rather than a partial summary. A per-field "—" was
// considered and rejected: this project's one hard rule (readVocRecordsCached's
// own comment states it first) is that a failed read must never render as a
// number a reader could mistake for real data, and Promise.all's
// all-or-nothing rejection already gives that for free — a mixed
// "some real numbers, one dash" card would need its own new rendering path
// and its own new tests for a partial-failure mode nobody has actually
// reported, whereas whole-card degrade reuses the exact "指标暂不可用" branch
// createOperatorSummaryCard already has and already tests.
export async function readOperatorSummary(
  bitable: OperatorSummaryBitable,
  operatorOpenId: string,
): Promise<OperatorSummary | null> {
  // No usable identity to filter by. event-handler.ts's
  // readMenuOperatorOpenId already degrades a malformed event to "" instead
  // of throwing, and route.ts's menu_click branch already refuses to call
  // this at all when that happens — this guard only stops a hypothetical
  // direct caller from sending Bitable a "负责人 is ['']" filter, which has
  // no defined meaning against a User field.
  if (operatorOpenId.trim().length === 0) return null;

  try {
    const [myPendingFollowUp, myInProgress, myPendingClosure, total] =
      await Promise.all([
        ...PERSONAL_STATES.map((state) =>
          bitable.countRecords([
            { field_name: VOC_FIELD_NAMES.owner, value: [operatorOpenId] },
            { field_name: VOC_FIELD_NAMES.state, value: [state] },
          ]),
        ),
        bitable.countRecords([]),
      ]);

    return { myPendingFollowUp, myInProgress, myPendingClosure, total };
  } catch {
    return null;
  }
}
