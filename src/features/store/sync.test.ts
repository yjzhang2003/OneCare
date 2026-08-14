import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../bitable/field-map";

// The sync's own SQL is exercised against the real table by
// scripts/verify-query-equivalence; what these tests pin is the decision it makes
// about which rows to write, because getting that wrong destroys an operator's work
// rather than merely showing it late.
import { syncFromBitable } from "./records";

const upsertRecords = vi.fn(async (records: readonly VocRecord[]) => records.length);

function record(recordId: string): VocRecord {
  return {
    recordId,
    recordNumber: `VOC-${recordId}`,
    channel: "400 客服",
    category: "冰箱",
    model: "",
    content: "制冷不足",
    rating: null,
    feedbackAt: "2026-01-24T00:00:00.000Z",
    state: "待分析",
    polarity: null,
    dimensions: [],
    summary: "",
    replies: [],
    severity: null,
    ownerOpenIds: [],
    ownerNames: [],
    retryCount: 0,
    ticketOpenedAt: null,
    closedAt: null,
    warRoomChatId: "",
    engineerOpenIds: [],
    engineerNames: [],
    dispatchedAt: null,
    userRef: "",
    deviceRef: "",
    sourceTicketNo: "",
    sourceUrl: "",
    sourceDetail: "",
    businessUnit: "",
    categoryLevel1: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncFromBitable", () => {
  it("writes every record when nothing is awaiting a push", async () => {
    const result = await syncFromBitable({
      listRecords: async () => [record("a"), record("b")],
      pendingIds: async () => new Set<string>(),
      upsert: upsertRecords,
    });

    expect(result).toEqual({ read: 2, written: 2, skipped: 0 });
    expect(upsertRecords).toHaveBeenCalledTimes(1);
    expect(upsertRecords.mock.calls[0]?.[0].map((r) => r.recordId)).toEqual([
      "a",
      "b",
    ]);
  });

  // The failure this guard exists for: a write lands in Postgres, its Bitable push is
  // still in flight, and a sync overwrites the fresh local row with the older Bitable
  // values — silently undoing the state change the operator just made.
  it("skips rows whose local write has not reached the Bitable yet", async () => {
    const result = await syncFromBitable({
      listRecords: async () => [record("a"), record("b"), record("c")],
      pendingIds: async () => new Set(["b"]),
      upsert: upsertRecords,
    });

    expect(result).toEqual({ read: 3, written: 2, skipped: 1 });
    expect(upsertRecords.mock.calls[0]?.[0].map((r) => r.recordId)).toEqual([
      "a",
      "c",
    ]);
  });

  it("writes nothing when every record is awaiting a push", async () => {
    const result = await syncFromBitable({
      listRecords: async () => [record("a"), record("b")],
      pendingIds: async () => new Set(["a", "b"]),
      upsert: upsertRecords,
    });

    expect(result).toEqual({ read: 2, written: 0, skipped: 2 });
  });

  it("handles an empty Bitable without touching the mirror", async () => {
    const result = await syncFromBitable({
      listRecords: async () => [],
      pendingIds: async () => new Set<string>(),
      upsert: upsertRecords,
    });

    expect(result).toEqual({ read: 0, written: 0, skipped: 0 });
  });
});
