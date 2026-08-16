import { describe, expect, it } from "vitest";

import {
  VOC_ACTIONS,
  VOC_STATE_SEQUENCE,
  VOC_STATES,
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

  // Guardrail for the 待分析 + 重试 idempotence case
  it("rejects retry from initial state with zero retries (caller bug)", () => {
    const result = transition("待分析", "重试", { ...base, retryCount: 0 });

    expect(result.kind).toBe("rejected");
  });

  it("treats retry from initial state as noop when retryCount >= 1 (idempotent replay)", () => {
    const result = transition("待分析", "重试", { ...base, retryCount: 1 });

    expect(result).toEqual({ kind: "noop", state: "待分析" });
  });

  it("rejects retry from initial state when ceiling is reached, even for replay", () => {
    const result = transition("待分析", "重试", { ...base, retryCount: 5 });

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("重试");
  });

  it("still allows normal retry from analysis-failure state under ceiling", () => {
    const result = transition("分析失败", "重试", { ...base, retryCount: 1 });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.next).toBe("待分析");
  });

  it("guards all other idempotent replays against guard violations", () => {
    // 已分析 + 需建单 without owner → rejected, not noop
    const noOwner = transition("待跟进", "需建单", {
      ...base,
      hasOwner: false,
    });
    expect(noOwner.kind).toBe("rejected");

    // 跟进中 + 提交跟进结果 with empty note → rejected, not noop
    const emptyNote = transition("待闭环", "提交跟进结果", {
      ...base,
      followUpNote: "",
    });
    expect(emptyNote.kind).toBe("rejected");
  });

  it("exhaustively checks every state-action combination for correct noop behavior", () => {
    const noopCombinations = new Set([
      "已分析|打标成功",
      "分析失败|打标失败",
      "待跟进|需建单",
      "无需跟进|无需建单",
      "跟进中|开始跟进",
      // A second 派工 — the owner sending a different engineer — replays instead of
      // failing: the ticket is already 上门中, and only the engineer columns change.
      "上门中|派工",
      "待闭环|提交跟进结果",
      "已闭环|确认闭环",
      // 待分析|重试 is special-cased above
    ]);

    const contextForRetryFromInitial = { ...base, retryCount: 1 };

    let noopCount = 0;
    for (const state of VOC_STATES) {
      for (const action of VOC_ACTIONS) {
        const ctx =
          action === "重试" && state === "待分析"
            ? contextForRetryFromInitial
            : base;
        const result = transition(state, action, ctx);

        if (result.kind === "noop") {
          noopCount++;
          // Only these combinations should return noop
          const key = `${state}|${action}`;
          expect(
            noopCombinations.has(key) || (action === "重试" && state === "待分析"),
            `Unexpected noop: ${key}`,
          ).toBe(true);
        }
      }
    }

    // The 8 listed replays plus 待分析|重试.
    expect(noopCount).toBe(9);
  });
});
