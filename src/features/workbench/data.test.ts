import { describe, expect, it } from "vitest";

import { buildWorkbench, toWorkbenchTicket } from "./data";
import type { VocRecord } from "../bitable/field-map";
import { DECLINED_MARKER } from "../warroom/naming";

function record(over: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec1",
    recordNumber: "R-001",
    channel: "电商评价",
    category: "冰箱",
    model: "BCD-525WNK1PU",
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
    warRoomChatId: "",
    ...over,
  } as VocRecord;
}

describe("toWorkbenchTicket", () => {
  it("carries the columns the workbench renders", () => {
    expect(toWorkbenchTicket(record())).toEqual({
      recordId: "rec1",
      retryCount: 0,
      hasOwner: true,
      hasWarRoom: false,
      recordNumber: "R-001",
      feedbackAt: "2026-01-23T02:00:00.000Z",
      channel: "电商评价",
      category: "冰箱",
      model: "BCD-525WNK1PU",
      content: "报修后等了三天没人上门",
      polarity: "差评",
      dimensions: ["维修时间"],
      summary: "等待三天无人上门",
      replies: [],
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

  it("carries the AI summary and reply drafts through for the ticket detail view", () => {
    const ticket = toWorkbenchTicket(
      record({
        summary: "冰箱异响，用户要求上门检修",
        replies: [{ tone: "安抚", text: "非常抱歉给您带来不便，我们会尽快安排上门。" }],
      }),
    );

    expect(ticket.summary).toBe("冰箱异响，用户要求上门检修");
    expect(ticket.replies).toEqual([
      { tone: "安抚", text: "非常抱歉给您带来不便，我们会尽快安排上门。" },
    ]);
  });

  // Narrowed from "neither the record id nor owner open ids": the write path
  // has to address a row, so recordId is now carried deliberately. open_ids
  // still are not — they name people, and nothing rendered needs them. The
  // ownership question the panel would use them for is answered by the route
  // handler instead, which is also the only place that can answer it correctly.
  it("carries the record id but never owner open ids", () => {
    const ticket = toWorkbenchTicket(record());

    expect(ticket.recordId).toBe("rec1");
    expect(ticket).not.toHaveProperty("ownerOpenIds");
  });

  // hasOwner is what replaces ownerOpenIds for the panel's purposes: enough to
  // choose between offering a claim and reporting an owner, carrying no identity.
  it("reduces ownership to a boolean", () => {
    expect(toWorkbenchTicket(record({ ownerOpenIds: [] })).hasOwner).toBe(false);
    expect(toWorkbenchTicket(record({ ownerOpenIds: ["ou_a"] })).hasOwner).toBe(
      true,
    );
  });

  it.each([
    { label: "a real group id", warRoomChatId: "oc_group", expected: true },
    { label: "the declined marker", warRoomChatId: DECLINED_MARKER, expected: false },
    { label: "an empty decision", warRoomChatId: "", expected: false },
  ] as const)("projects $label to hasWarRoom=$expected", ({ warRoomChatId, expected }) => {
    expect(toWorkbenchTicket(record({ warRoomChatId })).hasWarRoom).toBe(expected);
  });

  it("never serializes the real group id or the declined marker field", () => {
    const tickets = [
      toWorkbenchTicket(record({ warRoomChatId: "oc_group" })),
      toWorkbenchTicket(record({ warRoomChatId: DECLINED_MARKER })),
    ];
    const serialized = JSON.stringify(tickets);

    for (const ticket of tickets) {
      expect(ticket).not.toHaveProperty("warRoomChatId");
    }
    expect(serialized).not.toContain("warRoomChatId");
    expect(serialized).not.toContain("oc_group");
    expect(serialized).not.toContain(DECLINED_MARKER);
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
