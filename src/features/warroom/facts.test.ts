import { describe, expect, it } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import { buildAnswerFacts, computeFactsAggregates, stripMention } from "./facts";

const ticket: VocRecord = {
  recordId: "rec12345",
  recordNumber: "VOC-0001",
  channel: "电商评价",
  category: "冰箱",
  model: "BCD-525WNK1PU",
  content: "维修师傅约了三天还没上门",
  rating: 2,
  feedbackAt: "2026-08-05T00:00:00.000Z",
  state: "跟进中",
  polarity: "差评",
  dimensions: ["维修时间"],
  summary: "用户反馈上门维修延迟三天",
  replies: [{ tone: "致歉安抚", text: "非常抱歉给您带来不便" }],
  severity: "高",
  ownerOpenIds: ["ou_owner"],
  ownerNames: ["张三"],
  retryCount: 0,
  ticketOpenedAt: "2026-08-05T02:00:00.000Z",
  closedAt: null,
  warRoomChatId: "oc_war_room_chat",
  engineerOpenIds: [],
  engineerNames: [],
  dispatchedAt: null,
  sourceTicketNo: "CAS-42567239-Q7Q8Q",
  userRef: "U-3878645B",
  deviceRef: "D-91C2A70E",
  sourceUrl: "",
  sourceDetail: "400投诉",
  businessUnit: "冰冷事业部",
  categoryLevel1: "安装调试",
};

describe("stripMention", () => {
  it("removes the @-mention Feishu puts in front of the question", () => {
    expect(stripMention("@_user_1 这条投诉以前出现过吗")).toBe("这条投诉以前出现过吗");
    expect(stripMention("@OneCare  同型号还有几条")).toBe("同型号还有几条");
  });

  it("leaves a question with no mention alone", () => {
    expect(stripMention("直接问的问题")).toBe("直接问的问题");
  });

  it("returns an empty string when the message is nothing but a mention", () => {
    // The caller uses "empty" to decide whether to answer at all, instead of
    // sending a blank question to the model and getting a hallucinated reply.
    expect(stripMention("@_user_1")).toBe("");
  });

  it("strips more than one chained mention", () => {
    expect(stripMention("@_user_1 @_user_2 这两个群都出现过吗")).toBe(
      "这两个群都出现过吗",
    );
  });
});

describe("buildAnswerFacts", () => {
  it("carries the ticket and every aggregate as JSON", () => {
    const facts = JSON.parse(
      buildAnswerFacts({
        ticket,
        sameDimension: { total: 12, closed: 5 },
        sameModel: 3,
        sameDevice: { total: 7, open: 2 },
      }),
    ) as { ticket: Record<string, unknown>; aggregates: Record<string, unknown> };

    expect(facts.ticket.recordNumber).toBe(ticket.recordNumber);
    expect(facts.aggregates).toEqual({
      sameDimensionLast7Days: 12,
      sameDimensionClosed: 5,
      sameModelTotal: 3,
      sameDeviceTotal: 7,
      sameDeviceOpen: 2,
    });
  });

  // "这台机器修过几次" is the first question a war room asks. Before the device counts
  // were in the facts, the honest answer the skill gave was 我不知道.
  it("counts this machine's own history, and zero when there is no 设备标识", () => {
    const withDevice = JSON.parse(
      buildAnswerFacts({
        ticket,
        sameDimension: { total: 0, closed: 0 },
        sameModel: 0,
        sameDevice: { total: 7, open: 2 },
      }),
    ) as { aggregates: Record<string, unknown> };
    expect(withDevice.aggregates.sameDeviceTotal).toBe(7);

    const without = JSON.parse(
      buildAnswerFacts({ ticket, sameDimension: { total: 0, closed: 0 }, sameModel: 0 }),
    ) as { aggregates: Record<string, unknown> };
    expect(without.aggregates.sameDeviceTotal).toBe(0);
  });

  it("omits the record id so the model cannot quote an internal identifier", () => {
    // The answer goes into a group chat. A Bitable record_id in it is noise at
    // best and a leak of internal addressing at worst.
    expect(buildAnswerFacts({ ticket, sameDimension: { total: 0, closed: 0 }, sameModel: 0 }))
      .not.toContain(ticket.recordId);
  });

  it("omits the war room chat id as well", () => {
    expect(buildAnswerFacts({ ticket, sameDimension: { total: 0, closed: 0 }, sameModel: 0 }))
      .not.toContain(ticket.warRoomChatId);
  });
});

describe("computeFactsAggregates", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");

  function record(overrides: Partial<VocRecord> = {}): VocRecord {
    return { ...ticket, recordId: `rec_${Math.random()}`, ...overrides };
  }

  it("counts same-dimension feedback from the last 7 days, and how many are already closed", () => {
    const records = [
      record({ dimensions: ["维修时间"], feedbackAt: "2026-08-09T00:00:00.000Z", state: "待跟进" }),
      record({ dimensions: ["维修时间"], feedbackAt: "2026-08-08T00:00:00.000Z", state: "已闭环" }),
      // Outside the 7-day window.
      record({ dimensions: ["维修时间"], feedbackAt: "2026-07-01T00:00:00.000Z", state: "已闭环" }),
      // Recent, but a different dimension entirely.
      record({ dimensions: ["产品质量"], feedbackAt: "2026-08-09T00:00:00.000Z", state: "已闭环" }),
    ];

    expect(computeFactsAggregates(ticket, records, now).sameDimension).toEqual({
      total: 2,
      closed: 1,
    });
  });

  it("counts a record that shares only one of several dimensions", () => {
    const records = [
      record({ dimensions: ["产品质量", "维修时间"], feedbackAt: "2026-08-09T00:00:00.000Z" }),
    ];

    expect(
      computeFactsAggregates(ticket, records, now).sameDimension.total,
    ).toBe(1);
  });

  it("returns zero same-dimension counts when the ticket itself has no dimensions", () => {
    const bare: VocRecord = { ...ticket, dimensions: [] };
    const records = [record({ dimensions: ["维修时间"], feedbackAt: "2026-08-09T00:00:00.000Z" })];

    expect(computeFactsAggregates(bare, records, now).sameDimension).toEqual({
      total: 0,
      closed: 0,
    });
  });

  it("counts same-model records across the whole table, with no time window", () => {
    const records = [
      record({ model: "BCD-525WNK1PU", feedbackAt: "2020-01-01T00:00:00.000Z" }),
      record({ model: "BCD-525WNK1PU", feedbackAt: "2026-08-09T00:00:00.000Z" }),
      record({ model: "别的型号" }),
    ];

    expect(computeFactsAggregates(ticket, records, now).sameModel).toBe(2);
  });

  it("skips the same-model count when the ticket's model is blank", () => {
    const blankModel: VocRecord = { ...ticket, model: "" };
    const records = [record({ model: "" }), record({ model: "" })];

    expect(computeFactsAggregates(blankModel, records, now).sameModel).toBe(0);
  });

  it("ignores a record with no feedback date for the same-dimension aggregate", () => {
    const records = [record({ dimensions: ["维修时间"], feedbackAt: null })];

    expect(
      computeFactsAggregates(ticket, records, now).sameDimension.total,
    ).toBe(0);
  });
});
