import { describe, expect, test } from "vitest";

import { transitionFields } from "./transition-fields";

const NOW = 1_770_000_000_000;

describe("transitionFields", () => {
  test("always writes the target state", () => {
    expect(transitionFields("跟进中", undefined, NOW)).toEqual({
      流程状态: "跟进中",
    });
  });

  // Matches what app/api/voc/analyze/route.ts writes when the pipeline opens a
  // ticket on its own, so a hand-opened ticket carries the same columns.
  test("stamps 建单时间 when a record becomes a ticket", () => {
    expect(transitionFields("待跟进", undefined, NOW)).toEqual({
      流程状态: "待跟进",
      建单时间: NOW,
    });
  });

  test("writes the follow-up note on reaching 待闭环", () => {
    expect(transitionFields("待闭环", "已联系用户，等待返厂", NOW)).toEqual({
      流程状态: "待闭环",
      跟进记录: "已联系用户，等待返厂",
    });
  });

  test("writes the closing note and 闭环时间 on closure", () => {
    expect(transitionFields("已闭环", "换新并致歉", NOW)).toEqual({
      流程状态: "已闭环",
      闭环结论: "换新并致歉",
      闭环时间: NOW,
    });
  });

  // Bitable DateTime fields are epoch milliseconds on the wire. An ISO string
  // is silently rejected by the real API, so the type of this value is the
  // difference between a closure that lands and one that reports 写回失败.
  test("timestamps are epoch milliseconds, not ISO strings", () => {
    const closed = transitionFields("已闭环", "x", NOW);
    const opened = transitionFields("待跟进", undefined, NOW);
    expect(typeof closed.闭环时间).toBe("number");
    expect(typeof opened.建单时间).toBe("number");
  });

  test("no note column is written when there is no note", () => {
    expect(transitionFields("已闭环", undefined, NOW)).toEqual({
      流程状态: "已闭环",
      闭环时间: NOW,
    });
  });

  // 无需跟进 is terminal but is not a closure: nothing was followed up, so
  // stamping 闭环时间 would inflate the closure metrics with records nobody
  // ever worked on.
  test("无需跟进 stamps no timestamp", () => {
    expect(transitionFields("无需跟进", undefined, NOW)).toEqual({
      流程状态: "无需跟进",
    });
  });
});
