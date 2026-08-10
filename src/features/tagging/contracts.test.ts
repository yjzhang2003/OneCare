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
});
