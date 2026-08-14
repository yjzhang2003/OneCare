import { describe, expect, it } from "vitest";

import { RETRY_CEILING, VOC_STATES } from "../voc/service-event";
import { analyzeEligibility } from "./analyze-eligibility";

describe("analyzeEligibility", () => {
  it("runs an untagged record as it stands", () => {
    expect(analyzeEligibility({ state: "待分析", retryCount: 0 })).toEqual({
      kind: "ready",
      state: "待分析",
    });
  });

  // The pipeline can only start from 待分析 — buildTaggedWrite computes
  // 待分析 -> 已分析 -> {待跟进|无需跟进} through transition(), and a 分析失败 record
  // handed to it directly falls through every one of those and gets its AI fields
  // written while its 流程状态 stays at 分析失败. So the state reported here is the one
  // 重试 resolves to, not the record's own.
  it("presents a failed record as 待分析, which is the state the pipeline needs", () => {
    expect(analyzeEligibility({ state: "分析失败", retryCount: 1 })).toEqual({
      kind: "ready",
      state: "待分析",
    });
  });

  it("refuses a failed record that has used up its retries, in the state machine's words", () => {
    expect(
      analyzeEligibility({ state: "分析失败", retryCount: RETRY_CEILING }),
    ).toEqual({
      kind: "refused",
      reason: `重试次数已达上限 ${RETRY_CEILING}`,
    });
  });

  // Re-running the pipeline over a tagged record would overwrite its AI verdict and
  // re-resolve its owner from the routing rules, discarding whatever a person has done
  // with it since. Enumerated over every state so a new one added to the machine has to
  // be considered here rather than silently becoming re-taggable.
  const taggable = new Set(["待分析", "分析失败"]);
  it.each(VOC_STATES.filter((state) => !taggable.has(state)))(
    "refuses %s because it has already been tagged",
    (state) => {
      const outcome = analyzeEligibility({ state, retryCount: 0 });
      expect(outcome.kind).toBe("refused");
      expect(outcome.kind === "refused" && outcome.reason).toContain(state);
    },
  );

  // The ceiling is the state machine's rule, applied here rather than restated: this
  // module never compares retryCount to anything itself, which is why a change to
  // RETRY_CEILING needs no edit here.
  it("defers the retry budget entirely to the machine", () => {
    for (let used = 0; used < RETRY_CEILING; used += 1) {
      expect(
        analyzeEligibility({ state: "分析失败", retryCount: used }).kind,
      ).toBe("ready");
    }
    expect(
      analyzeEligibility({ state: "分析失败", retryCount: RETRY_CEILING }).kind,
    ).toBe("refused");
  });
});
