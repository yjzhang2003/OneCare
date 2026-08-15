import { describe, expect, it } from "vitest";

import { parseTagEdit, toTagEditFields } from "./tag-edit";

const VALID = {
  polarity: "差评",
  dimensions: ["维修技术", "售后服务"],
  severity: "高",
  summary: "用户三次报修未解决",
};

describe("parseTagEdit", () => {
  it("takes a complete correction", () => {
    expect(parseTagEdit(VALID)).toEqual({
      polarity: "差评",
      dimensions: ["维修技术", "售后服务"],
      severity: "高",
      summary: "用户三次报修未解决",
    });
  });

  // Clearing has to be expressible: an operator who thinks nothing was ever decided
  // should not be forced to pick one of three.
  it("reads an empty or absent enum as cleared", () => {
    expect(parseTagEdit({ ...VALID, polarity: "", severity: null })).toMatchObject({
      polarity: null,
      severity: null,
    });
  });

  // The refusal that matters: a single-select in Bitable creates whatever option it is
  // handed, and every count downstream would then disagree with itself.
  it("refuses a value outside the enums rather than inventing an option", () => {
    expect(parseTagEdit({ ...VALID, severity: "很高" })).toBeNull();
    expect(parseTagEdit({ ...VALID, polarity: "还行" })).toBeNull();
    expect(parseTagEdit({ ...VALID, dimensions: ["维修技术", "态度不好"] })).toBeNull();
  });

  it("de-duplicates dimensions, which are counted downstream", () => {
    expect(
      parseTagEdit({ ...VALID, dimensions: ["维修技术", "维修技术"] })?.dimensions,
    ).toEqual(["维修技术"]);
  });

  it("refuses a body that is not an edit at all", () => {
    expect(parseTagEdit(null)).toBeNull();
    expect(parseTagEdit({ ...VALID, dimensions: "维修技术" })).toBeNull();
    expect(parseTagEdit({ polarity: "差评", severity: "高", summary: "x" })).toBeNull();
    expect(parseTagEdit({ ...VALID, summary: 7 })).toBeNull();
  });
});

describe("toTagEditFields", () => {
  it("writes the four columns and stamps who corrected them", () => {
    expect(toTagEditFields(parseTagEdit(VALID)!, "张禹健")).toEqual({
      情绪极性: "差评",
      问题维度: ["维修技术", "售后服务"],
      严重度: "高",
      "AI 摘要": "用户三次报修未解决",
      打标来源: "manual:张禹健",
    });
  });

  it("clears an enum with an empty string, which reads back as null", () => {
    const fields = toTagEditFields(
      parseTagEdit({ ...VALID, polarity: "", severity: "" })!,
      "张禹健",
    );
    expect(fields).toMatchObject({ 情绪极性: "", 严重度: "" });
  });

  // Never 流程状态 and never 负责人: correcting a label is not a reason to move a ticket
  // someone is working, and re-running the pipeline is what re-decides those.
  it("touches nothing about the ticket's flow", () => {
    const fields = toTagEditFields(parseTagEdit(VALID)!, "张禹健");
    expect(Object.keys(fields)).not.toContain("流程状态");
    expect(Object.keys(fields)).not.toContain("负责人");
  });
});
