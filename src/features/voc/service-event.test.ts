import { describe, expect, it } from "vitest";

import {
  VOC_STATE_SEQUENCE,
  transition,
  type TransitionContext,
  type VocAction,
  type VocState,
} from "./service-event";

const base: TransitionContext = {
  retryCount: 0,
  hasOwner: true,
  followUpNote: "已联系用户",
  closingNote: "已换配件并回访",
};

describe("transition", () => {
  it.each([
    ["待分析", "打标成功", "已分析"],
    ["待分析", "打标失败", "分析失败"],
    ["分析失败", "重试", "待分析"],
    ["已分析", "需建单", "待跟进"],
    ["已分析", "无需建单", "无需跟进"],
    ["待跟进", "开始跟进", "跟进中"],
    ["跟进中", "提交跟进结果", "待闭环"],
    ["待闭环", "确认闭环", "已闭环"],
  ] satisfies ReadonlyArray<readonly [VocState, VocAction, VocState]>)(
    "moves %s through %s to %s",
    (current, action, expected) => {
      const result = transition(current, action, base);

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.next).toBe(expected);
    },
  );

  it("treats a repeated action as a no-op instead of an error", () => {
    const result = transition("跟进中", "开始跟进", base);

    expect(result).toEqual({ kind: "noop", state: "跟进中" });
  });

  it.each([
    ["已闭环", "开始跟进"],
    ["无需跟进", "需建单"],
    ["待分析", "确认闭环"],
    ["待跟进", "提交跟进结果"],
  ] satisfies ReadonlyArray<readonly [VocState, VocAction]>)(
    "rejects %s + %s",
    (current, action) => {
      const result = transition(current, action, base);

      expect(result.kind).toBe("rejected");
    },
  );

  it("rejects retry once the retry ceiling is reached", () => {
    const result = transition("分析失败", "重试", { ...base, retryCount: 3 });

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("重试");
  });

  it("rejects ticket creation with no owner resolved", () => {
    const result = transition("已分析", "需建单", { ...base, hasOwner: false });

    expect(result.kind).toBe("rejected");
  });

  it("rejects follow-up submission with an empty note", () => {
    const result = transition("跟进中", "提交跟进结果", {
      ...base,
      followUpNote: "   ",
    });

    expect(result.kind).toBe("rejected");
  });

  it("rejects closing with an empty conclusion", () => {
    const result = transition("待闭环", "确认闭环", {
      ...base,
      closingNote: "",
    });

    expect(result.kind).toBe("rejected");
  });

  it("only allows the analysis-failure rollback to lower the sequence", () => {
    expect(VOC_STATE_SEQUENCE["待分析"]).toBeLessThan(
      VOC_STATE_SEQUENCE["分析失败"],
    );

    const rollback = transition("分析失败", "重试", base);
    expect(rollback.kind).toBe("ok");
  });
});
