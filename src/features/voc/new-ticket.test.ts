import { describe, expect, it } from "vitest";

import { MANUAL_SOURCE_DETAIL, newTicketFields, parseNewTicket } from "./new-ticket";

const OPTIONS = {
  channels: ["400 客服", "电商评价", "社媒"],
  categories: ["冰箱", "电视"],
};

const DRAFT = {
  channel: "400 客服",
  category: "电视",
  model: "海信 65E5Q-PRO",
  content: "电视三次上门都没修好，还要再等一周",
  userRef: "U-DEMO",
  deviceRef: "D-DEMO",
};

describe("parseNewTicket", () => {
  it("takes a complete draft", () => {
    expect(parseNewTicket(DRAFT, OPTIONS)).toEqual({ draft: DRAFT });
  });

  // Both columns are single-selects: an unknown value would not be rejected by Bitable,
  // it would silently become a new option in the enterprise's own table.
  it("refuses a channel or category the Base does not already have", () => {
    expect(parseNewTicket({ ...DRAFT, channel: "抖音" }, OPTIONS)).toMatchObject({
      problems: ["请选择一个数据里已有的渠道"],
    });
    expect(parseNewTicket({ ...DRAFT, category: "热水器" }, OPTIONS)).toMatchObject({
      problems: ["请选择一个数据里已有的品类"],
    });
  });

  it("lets the category be left out, the way many real rows have it", () => {
    expect(parseNewTicket({ ...DRAFT, category: "" }, OPTIONS)).toMatchObject({
      draft: { category: "" },
    });
  });

  // The content is what the model reads. An empty one produces a tagging run with
  // nothing to tag.
  it("refuses an empty or trivial complaint", () => {
    expect(parseNewTicket({ ...DRAFT, content: "" }, OPTIONS)).toMatchObject({
      problems: ["请把用户说的话写清楚，至少 5 个字"],
    });
    expect(parseNewTicket({ ...DRAFT, content: "坏了" }, OPTIONS)).toMatchObject({
      problems: ["请把用户说的话写清楚，至少 5 个字"],
    });
  });

  it("refuses a body that is not a draft at all", () => {
    expect(parseNewTicket(null, OPTIONS)).toMatchObject({ problems: expect.any(Array) });
  });
});

describe("newTicketFields", () => {
  const NOW = Date.parse("2026-08-15T03:00:00.000Z");

  it("starts the ticket at 待分析 and marks where the row came from", () => {
    const fields = newTicketFields(DRAFT, "uuid-1", NOW);
    expect(fields).toMatchObject({
      记录编号: "uuid-1",
      反馈时间: NOW,
      渠道: "400 客服",
      产品品类: "电视",
      原始内容: DRAFT.content,
      流程状态: "待分析",
      // Answerable from the Base itself: which rows did we type in ourselves.
      来源明细: MANUAL_SOURCE_DETAIL,
    });
  });

  // An empty optional column is left out rather than written as "": a blank single-select
  // write is a different thing from not touching the column.
  it("omits the optional columns that were left blank", () => {
    const fields = newTicketFields(
      { ...DRAFT, category: "", model: "", userRef: "", deviceRef: "" },
      "uuid-2",
      NOW,
    );
    expect(Object.keys(fields)).not.toContain("产品品类");
    expect(Object.keys(fields)).not.toContain("机型");
    expect(Object.keys(fields)).not.toContain("用户标识");
    expect(Object.keys(fields)).not.toContain("设备标识");
  });

  // Never the AI columns and never an owner: a new ticket is untagged and unrouted by
  // definition, and the pipeline is what decides both.
  it("writes nothing the pipeline is supposed to decide", () => {
    const keys = Object.keys(newTicketFields(DRAFT, "uuid-3", NOW));
    for (const forbidden of ["情绪极性", "问题维度", "AI 摘要", "严重度", "负责人", "建单时间"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
