import { describe, expect, it } from "vitest";

import type { CountFilterCondition } from "../bitable/client";
import {
  readOperatorSummary,
  type OperatorSummaryBitable,
} from "./operator-summary";

// Task 14: computeOperatorSummary (the pure, full-record filter this file
// used to export) is gone. The "我的工单" menu card measured ~10.7s because it
// pulled every one of 3628 records back just to filter them in memory —
// readOperatorSummary replaces that with four concurrent, filtered
// records/search counts (~1.0s each, measured against the live Base) and
// never reads a record body at all.

type FakeCall = readonly CountFilterCondition[];

function fakeBitable(
  handler: (conditions: FakeCall) => Promise<number>,
): OperatorSummaryBitable {
  return { countRecords: handler };
}

describe("readOperatorSummary", () => {
  it("counts each of the three personal states filtered by 负责人 + 流程状态", async () => {
    const calls: FakeCall[] = [];
    const bitable = fakeBitable(async (conditions) => {
      calls.push(conditions);
      return 0;
    });

    await readOperatorSummary(bitable, "ou_a");

    // The three personal-state counts, each carrying both the owner filter
    // and one state filter — a bare owner filter alone cannot tell 待跟进
    // apart from 跟进中, and a bare state filter alone would count every
    // operator's tickets together.
    expect(calls).toContainEqual([
      { field_name: "负责人", value: ["ou_a"] },
      { field_name: "流程状态", value: ["待跟进"] },
    ]);
    expect(calls).toContainEqual([
      { field_name: "负责人", value: ["ou_a"] },
      { field_name: "流程状态", value: ["跟进中"] },
    ]);
    expect(calls).toContainEqual([
      { field_name: "负责人", value: ["ou_a"] },
      { field_name: "流程状态", value: ["待闭环"] },
    ]);
    // The shop-wide total: no owner filter, no state filter.
    expect(calls).toContainEqual([]);
    expect(calls).toHaveLength(4);
  });

  it("maps each count to the field it counted, positionally correct", async () => {
    const bitable = fakeBitable(async (conditions) => {
      if (conditions.length === 0) return 3628;
      const state = conditions.find((c) => c.field_name === "流程状态")?.value[0];
      if (state === "待跟进") return 11;
      if (state === "跟进中") return 22;
      if (state === "待闭环") return 33;
      throw new Error(`unexpected conditions: ${JSON.stringify(conditions)}`);
    });

    const summary = await readOperatorSummary(bitable, "ou_a");

    expect(summary).toEqual({
      myPendingFollowUp: 11,
      myInProgress: 22,
      myPendingClosure: 33,
      total: 3628,
    });
  });

  // The whole reason four separate requests are worth making at all instead
  // of one filtered listRecords() scan: run concurrently, their wall-clock
  // cost is the slowest single ~1.0s request, not four of them stacked. This
  // proves concurrency directly from call ordering (no timers, no real
  // clock) — a serial `for (const state of states) await countRecords(...)`
  // would only have made the first call by the time this assertion runs.
  it("issues all four counts concurrently rather than one after another", async () => {
    const calls: FakeCall[] = [];
    const resolvers: Array<(value: number) => void> = [];
    const bitable = fakeBitable(
      (conditions) =>
        new Promise<number>((resolve) => {
          calls.push(conditions);
          resolvers.push(resolve);
        }),
    );

    const pending = readOperatorSummary(bitable, "ou_a");

    // Flush microtasks so every synchronous call inside Promise.all has had
    // the chance to run, without resolving any of them yet.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(4);

    resolvers.forEach((resolve, index) => resolve(index));
    await expect(pending).resolves.not.toBeNull();
  });

  // The project's one hard rule (readVocRecordsCached's own comment): a
  // failed read must never render as a number a reader could mistake for
  // real data. Any single one of the four counts failing must not produce a
  // partial summary with a silent 0 sitting next to three real numbers.
  it("degrades to null, not a partial summary, when any one count fails", async () => {
    const bitable = fakeBitable(async (conditions) => {
      const state = conditions.find((c) => c.field_name === "流程状态")?.value[0];
      if (state === "跟进中") throw new Error("Bitable count failed (code 99991400)");
      return 5;
    });

    await expect(readOperatorSummary(bitable, "ou_a")).resolves.toBeNull();
  });

  it("returns null for an empty operator id without calling countRecords", async () => {
    const countRecords = async () => {
      throw new Error("should not be called");
    };

    await expect(readOperatorSummary({ countRecords }, "")).resolves.toBeNull();
    await expect(readOperatorSummary({ countRecords }, "   ")).resolves.toBeNull();
  });
});
