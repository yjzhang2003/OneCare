import { describe, expect, it } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import { computeOperatorSummary } from "./operator-summary";

function vocRecord(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec1",
    recordNumber: "VOC-0001",
    channel: "电商评价",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "冷藏室温度持续偏高",
    rating: 2,
    feedbackAt: "2026-08-10T02:00:00.000Z",
    state: "待跟进",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "",
    replies: [],
    severity: "中",
    ownerOpenIds: ["ou_operator_a"],
    ownerNames: ["张三"],
    retryCount: 0,
    ticketOpenedAt: "2026-08-10T02:00:00.000Z",
    closedAt: null,
    warRoomChatId: "",
    ...overrides,
  };
}

// A fixed instant so every test describes "now" the same way instead of
// depending on the real wall clock at test-run time. 2026-08-12T01:00:00Z is
// 2026-08-12T09:00:00+08:00 in Beijing — safely inside "today" there with
// room on both sides for the UTC-yesterday/Beijing-today fixture below.
const NOW = new Date("2026-08-12T01:00:00.000Z");

describe("computeOperatorSummary", () => {
  it("counts only the records owned by the requesting operator", () => {
    const records = [
      vocRecord({ recordId: "rec1", ownerOpenIds: ["ou_a"], state: "待跟进" }),
      vocRecord({ recordId: "rec2", ownerOpenIds: ["ou_a"], state: "跟进中" }),
      vocRecord({ recordId: "rec3", ownerOpenIds: ["ou_b"], state: "待跟进" }),
      vocRecord({ recordId: "rec4", ownerOpenIds: ["ou_b"], state: "待闭环" }),
    ];

    const forA = computeOperatorSummary(records, "ou_a", NOW);
    const forB = computeOperatorSummary(records, "ou_b", NOW);

    expect(forA.myPendingFollowUp).toBe(1);
    expect(forA.myInProgress).toBe(1);
    expect(forA.myPendingClosure).toBe(0);
    expect(forB.myPendingFollowUp).toBe(1);
    expect(forB.myInProgress).toBe(0);
    expect(forB.myPendingClosure).toBe(1);
    // Both operators still see the same shop-wide totals — those two fields
    // are never filtered by owner.
    expect(forA.total).toBe(4);
    expect(forB.total).toBe(4);
  });

  it("reports an all-zero personal workload for an operator who owns nothing", () => {
    const records = [
      vocRecord({ ownerOpenIds: ["ou_a"], state: "待跟进" }),
      vocRecord({ ownerOpenIds: ["ou_a"], state: "跟进中" }),
    ];

    const summary = computeOperatorSummary(records, "ou_stranger", NOW);

    expect(summary.myPendingFollowUp).toBe(0);
    expect(summary.myInProgress).toBe(0);
    expect(summary.myPendingClosure).toBe(0);
    expect(summary.myOverdue).toBe(0);
    // The two shop-wide numbers are unaffected by the empty personal match.
    expect(summary.total).toBe(2);
  });

  it("degrades to an all-zero personal workload for an empty operator id, without throwing", () => {
    const records = [vocRecord({ ownerOpenIds: ["ou_a"] })];

    expect(() => computeOperatorSummary(records, "", NOW)).not.toThrow();
    const summary = computeOperatorSummary(records, "", NOW);
    expect(summary.myPendingFollowUp).toBe(0);
    expect(summary.myOverdue).toBe(0);
  });

  // isOverdue (workbench/query.ts) is 72 hours since ticketOpenedAt (falling
  // back to feedbackAt) for a record not yet in a terminal state — reused
  // here rather than redefined, so this card and the workbench page can
  // never disagree about what "overdue" means.
  it("counts only the operator's own overdue tickets, reusing workbench/query.ts's isOverdue", () => {
    const records = [
      // 80 hours before NOW, still open: overdue.
      vocRecord({
        recordId: "rec_overdue",
        ownerOpenIds: ["ou_a"],
        state: "跟进中",
        ticketOpenedAt: "2026-08-08T17:00:00.000Z",
      }),
      // 10 hours before NOW, still open: not overdue.
      vocRecord({
        recordId: "rec_fresh",
        ownerOpenIds: ["ou_a"],
        state: "跟进中",
        ticketOpenedAt: "2026-08-11T15:00:00.000Z",
      }),
      // 80 hours before NOW but already closed: not overdue.
      vocRecord({
        recordId: "rec_closed",
        ownerOpenIds: ["ou_a"],
        state: "已闭环",
        ticketOpenedAt: "2026-08-08T17:00:00.000Z",
      }),
      // Someone else's overdue ticket must never count against this operator.
      vocRecord({
        recordId: "rec_other",
        ownerOpenIds: ["ou_b"],
        state: "跟进中",
        ticketOpenedAt: "2026-08-08T17:00:00.000Z",
      }),
    ];

    const summary = computeOperatorSummary(records, "ou_a", NOW);
    expect(summary.myOverdue).toBe(1);
  });

  it("counts today's new feedback in Beijing time, not UTC", () => {
    const records = [
      // UTC 2026-08-11 20:00 is Beijing 2026-08-12 04:00 — Beijing "today"
      // relative to NOW, even though the UTC calendar date is "yesterday".
      vocRecord({
        recordId: "rec_beijing_today",
        feedbackAt: "2026-08-11T20:00:00.000Z",
      }),
      // UTC 2026-08-11 10:00 is Beijing 2026-08-11 18:00 — genuinely
      // yesterday in both zones.
      vocRecord({
        recordId: "rec_yesterday",
        feedbackAt: "2026-08-11T10:00:00.000Z",
      }),
      // NOW itself: Beijing 2026-08-12 09:00 — today either way.
      vocRecord({ recordId: "rec_now", feedbackAt: NOW.toISOString() }),
    ];

    const summary = computeOperatorSummary(records, "ou_unused", NOW);
    expect(summary.newToday).toBe(2);
  });

  it("excludes a record with no feedback time from today's count", () => {
    const records = [vocRecord({ feedbackAt: null })];

    const summary = computeOperatorSummary(records, "ou_unused", NOW);
    expect(summary.newToday).toBe(0);
  });

  it("reports the shop-wide total as every record, regardless of owner or state", () => {
    const records = [
      vocRecord({ recordId: "rec1", state: "待分析" }),
      vocRecord({ recordId: "rec2", state: "已闭环" }),
      vocRecord({ recordId: "rec3", ownerOpenIds: [] }),
    ];

    expect(computeOperatorSummary(records, "ou_unused", NOW).total).toBe(3);
  });
});
