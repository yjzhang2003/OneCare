import { describe, expect, it } from "vitest";

import type { CountFilterCondition } from "../bitable/client";
import { readTodayOverviewCounts, type TodayOverviewBitable } from "./today-overview";

// Task 14: the "今日概览" menu card measured ~10.7s because getVocDashboardMetrics
// read every VOC record back just to aggregate it. This module replaces the
// counts a menu-tap reply can afford with five concurrent records/search
// counts (~1.0s each, measured against the live Base) — total, and one per
// ticket-lifecycle state. Metrics that need the full record set in memory
// (negativeShare, averageClosureHours, taggingCoverage, dimensionTop) are
// deliberately not reproduced here; they stay behind the "打开运营工作台"
// button, which already points at the page that computes them properly.

type FakeCall = readonly CountFilterCondition[];

function fakeBitable(handler: (conditions: FakeCall) => Promise<number>): TodayOverviewBitable {
  return { countRecords: handler };
}

describe("readTodayOverviewCounts", () => {
  it("counts the unfiltered total plus each of the four ticket-lifecycle states", async () => {
    const calls: FakeCall[] = [];
    const bitable = fakeBitable(async (conditions) => {
      calls.push(conditions);
      return 0;
    });

    await readTodayOverviewCounts(bitable);

    expect(calls).toContainEqual([]);
    for (const state of ["待跟进", "跟进中", "待闭环", "已闭环"]) {
      expect(calls).toContainEqual([{ field_name: "流程状态", value: [state] }]);
    }
    expect(calls).toHaveLength(5);
  });

  it("derives 已建单 as the sum of every post-建单 state, and 已闭环 as its own terminal state", async () => {
    const bitable = fakeBitable(async (conditions) => {
      if (conditions.length === 0) return 3628;
      const state = conditions[0]?.value[0];
      if (state === "待跟进") return 100;
      if (state === "跟进中") return 200;
      if (state === "待闭环") return 50;
      if (state === "已闭环") return 650;
      throw new Error(`unexpected conditions: ${JSON.stringify(conditions)}`);
    });

    const result = await readTodayOverviewCounts(bitable);

    expect(result).toEqual({
      status: "ok",
      counts: {
        total: 3628,
        ticketsOpened: 1000, // 100 + 200 + 50 + 650
        ticketsClosed: 650,
        closureRate: 0.65, // 650 / 1000
      },
    });
  });

  it("reports a zero closure rate rather than dividing by zero when nothing has been opened", async () => {
    const bitable = fakeBitable(async () => 0);

    const result = await readTodayOverviewCounts(bitable);

    expect(result).toEqual({
      status: "ok",
      counts: { total: 0, ticketsOpened: 0, ticketsClosed: 0, closureRate: 0 },
    });
  });

  // The same concurrency proof as operator-summary.test.ts's equivalent
  // test: five ~1.0s requests run together cost about as much as the
  // slowest one; a serial loop would cost roughly five times that.
  it("issues all five counts concurrently rather than one after another", async () => {
    const calls: FakeCall[] = [];
    const resolvers: Array<(value: number) => void> = [];
    const bitable = fakeBitable(
      (conditions) =>
        new Promise<number>((resolve) => {
          calls.push(conditions);
          resolvers.push(resolve);
        }),
    );

    const pending = readTodayOverviewCounts(bitable);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(5);

    resolvers.forEach((resolve, index) => resolve(index));
    await expect(pending).resolves.toMatchObject({ status: "ok" });
  });

  // Same rule as readOperatorSummary: any one of the five counts failing
  // must degrade the whole result, never a partial set of numbers next to a
  // silent 0 for whichever count failed.
  it("degrades to unavailable, not a partial result, when any one count fails", async () => {
    const bitable = fakeBitable(async (conditions) => {
      if (conditions[0]?.value[0] === "待闭环") {
        throw new Error("Bitable count failed (code 99991400)");
      }
      return 10;
    });

    await expect(readTodayOverviewCounts(bitable)).resolves.toEqual({
      status: "unavailable",
    });
  });
});
