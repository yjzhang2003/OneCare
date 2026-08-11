import { describe, expect, it } from "vitest";

import { buildWorkbench, toWorkbenchTicket } from "./data";
import type { VocRecord } from "../bitable/field-map";

function record(over: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec1",
    recordNumber: "R-001",
    channel: "电商评价",
    category: "冰箱",
    content: "报修后等了三天没人上门",
    rating: 2,
    feedbackAt: "2026-01-23T02:00:00.000Z",
    state: "待跟进",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "等待三天无人上门",
    replies: [],
    severity: "中",
    ownerOpenIds: ["ou_a"],
    ownerNames: ["张三"],
    retryCount: 0,
    ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    closedAt: null,
    ...over,
  } as VocRecord;
}

describe("toWorkbenchTicket", () => {
  it("carries the columns the workbench renders", () => {
    expect(toWorkbenchTicket(record())).toEqual({
      recordNumber: "R-001",
      feedbackAt: "2026-01-23T02:00:00.000Z",
      channel: "电商评价",
      category: "冰箱",
      content: "报修后等了三天没人上门",
      polarity: "差评",
      dimensions: ["维修时间"],
      severity: "中",
      state: "待跟进",
      ownerNames: ["张三"],
      ticketOpenedAt: "2026-01-23T02:00:00.000Z",
      closedAt: null,
      durationHours: null,
    });
  });

  it("computes duration only once both timestamps parse", () => {
    expect(
      toWorkbenchTicket(record({ closedAt: "2026-01-24T02:00:00.000Z" }))
        .durationHours,
    ).toBe(24);
  });

  it("leaves duration null when the close timestamp is unparseable", () => {
    expect(
      toWorkbenchTicket(record({ closedAt: "not a date" })).durationHours,
    ).toBeNull();
  });

  it("never exposes the record id or owner open ids", () => {
    const ticket = toWorkbenchTicket(record());

    expect(ticket).not.toHaveProperty("recordId");
    expect(ticket).not.toHaveProperty("ownerOpenIds");
  });
});

describe("buildWorkbench", () => {
  it("returns aggregates and tickets from one pass", () => {
    const result = buildWorkbench([record(), record({ polarity: "好评" })], {
      manualMinutesPerRecord: 5,
    });

    expect(result.metrics.status).toBe("ok");
    if (result.metrics.status !== "ok") return;
    expect(result.metrics.metrics.total).toBe(2);
    expect(result.tickets).toHaveLength(2);
  });

  it("sorts tickets newest first", () => {
    const result = buildWorkbench(
      [
        record({ recordNumber: "old", feedbackAt: "2026-01-01T00:00:00.000Z" }),
        record({ recordNumber: "new", feedbackAt: "2026-02-01T00:00:00.000Z" }),
      ],
      {},
    );

    expect(result.tickets.map((t) => t.recordNumber)).toEqual(["new", "old"]);
  });

  it("puts tickets without a feedback time last rather than dropping them", () => {
    const result = buildWorkbench(
      [record({ recordNumber: "none", feedbackAt: null }), record({ recordNumber: "dated" })],
      {},
    );

    expect(result.tickets.map((t) => t.recordNumber)).toEqual(["dated", "none"]);
  });

  it("handles an empty record set without dividing by zero", () => {
    const result = buildWorkbench([], {});

    expect(result.tickets).toEqual([]);
    expect(result.metrics.status).toBe("ok");
    if (result.metrics.status !== "ok") return;
    expect(result.metrics.metrics.closureRate).toBe(0);
  });
});
