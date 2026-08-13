import { describe, expect, it } from "vitest";

import { parseTagPayload } from "./contracts";

function payload(results: unknown): string {
  return JSON.stringify({ results });
}

describe("parseTagPayload", () => {
  const good = {
    id: "rec1",
    sentiment: ["失望"],
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "等待三天无人上门",
    replies: [{ tone: "致歉安抚", text: "非常抱歉" }],
  };

  it("accepts a well formed result", () => {
    const [outcome] = parseTagPayload(payload([good]), ["rec1"]);

    expect(outcome).toEqual({
      kind: "tagged",
      result: {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: ["维修时间"],
        summary: "等待三天无人上门",
        replies: [{ tone: "致歉安抚", text: "非常抱歉" }],
      },
    });
  });

  it("fails every requested id when the payload is not JSON", () => {
    const outcomes = parseTagPayload("not json at all", ["rec1", "rec2"]);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.kind === "failed")).toBe(true);
    expect(outcomes[0]).toMatchObject({
      kind: "failed",
      recordId: "rec1",
      rawOutput: "not json at all",
    });
  });

  it("fails ids the model never returned", () => {
    const outcomes = parseTagPayload(payload([good]), ["rec1", "rec2"]);

    expect(outcomes[0]?.kind).toBe("tagged");
    expect(outcomes[1]).toMatchObject({ kind: "failed", recordId: "rec2" });
    if (outcomes[1]?.kind !== "failed") return;
    expect(outcomes[1].reason).toContain("未返回");
  });

  it("ignores ids that were never requested", () => {
    const outcomes = parseTagPayload(
      payload([good, { ...good, id: "recX" }]),
      ["rec1"],
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe("tagged");
  });

  it("keeps the first entry when an id repeats", () => {
    const outcomes = parseTagPayload(
      payload([good, { ...good, summary: "第二次" }]),
      ["rec1"],
    );

    expect(outcomes).toHaveLength(1);
    if (outcomes[0]?.kind !== "tagged") return;
    expect(outcomes[0].result.summary).toBe("等待三天无人上门");
  });

  it("fails a record whose polarity is outside the enum", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, polarity: "negative" }]),
      ["rec1"],
    );

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
    if (outcomes[0]?.kind !== "failed") return;
    expect(outcomes[0].reason).toContain("polarity");
  });

  it("fails a record whose dimension is outside the enum", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, dimensions: ["物流速度"] }]),
      ["rec1"],
    );

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
  });

  it("fails a record missing its summary", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, summary: "" }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("lets one bad record through without poisoning the batch", () => {
    const outcomes = parseTagPayload(
      payload([good, { ...good, id: "rec2", polarity: "??" }]),
      ["rec1", "rec2"],
    );

    expect(outcomes[0]?.kind).toBe("tagged");
    expect(outcomes[1]?.kind).toBe("failed");
  });

  it("accepts an empty reply list", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, replies: [] }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("tagged");
  });

  it("fails when results is not an array", () => {
    const outcomes = parseTagPayload(payload("nope"), ["rec1"]);

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("fails a record with an empty string in dimensions", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, dimensions: [""] }]),
      ["rec1"],
    );

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
    if (outcomes[0]?.kind !== "failed") return;
    expect(outcomes[0].reason).toContain("dimensions");
  });

  it("fails a record with empty string among valid dimensions", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, dimensions: ["维修时间", ""] }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("fails a record with empty string before valid dimensions", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, dimensions: ["", "维修时间"] }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("still accepts an empty dimensions array", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, dimensions: [] }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("tagged");
  });

  it("rejects sentiment with empty string elements", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, sentiment: [""] }]),
      ["rec1"],
    );

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
  });

  it("rejects sentiment with mixed empty and valid strings", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, sentiment: ["失望", ""] }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("rejects a sentiment word the Base has no option for", () => {
    // Not merely a schema nicety: these values are written to a Bitable
    // multi-select, which auto-creates whatever option it is handed, and
    // deleting the record afterwards does not remove it. One loose model output
    // would permanently add a junk option to the enterprise's field. Four such
    // leftovers already had to be cleaned out of 产品品类 by hand.
    const outcomes = parseTagPayload(
      payload([{ ...good, sentiment: ["郁闷"] }]),
      ["rec1"],
    );

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
    // The offending word must survive into the reason, or the only way to fix
    // the prompt is to guess which word did it.
    expect(
      outcomes[0]?.kind === "failed" ? outcomes[0].reason : "",
    ).toContain("郁闷");
  });

  it("rejects an unknown sentiment even when the rest of the entry is valid", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, sentiment: ["失望", "无语"] }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("accepts every sentiment option the Base actually defines", () => {
    // Guards the other direction: a typo in the enum would silently fail every
    // record carrying that word, and the symptom (everything goes to 分析失败)
    // looks like a model problem rather than a one-character repo bug.
    const outcomes = parseTagPayload(
      payload([
        {
          ...good,
          sentiment: [
            "愤怒",
            "失望",
            "着急",
            "沮丧",
            "感激",
            "开心",
            "有爱",
            "中性",
          ],
        },
      ]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("tagged");
  });

  it("rejects replies with empty tone", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, replies: [{ tone: "", text: "非常抱歉" }] }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("rejects replies with empty text", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, replies: [{ tone: "致歉安抚", text: "" }] }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("failed");
  });
});
