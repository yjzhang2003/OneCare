// src/features/voc/triage.test.ts
import { describe, expect, it } from "vitest";

import { triage, type VocDimension, type VocPolarity } from "./triage";

describe("triage", () => {
  it("raises a ticket for every negative review", () => {
    expect(triage({ polarity: "差评", dimensions: [] })).toEqual({
      createTicket: true,
      severity: "中",
    });
  });

  it("escalates a negative review touching two or more dimensions", () => {
    expect(
      triage({ polarity: "差评", dimensions: ["维修时间", "服务态度"] }),
    ).toEqual({ createTicket: true, severity: "高" });
  });

  it("raises a ticket for a neutral review that names a dimension", () => {
    expect(triage({ polarity: "中评", dimensions: ["维修价格"] })).toEqual({
      createTicket: true,
      severity: "中",
    });
  });

  it("does not raise a ticket for a neutral review with no dimension", () => {
    expect(triage({ polarity: "中评", dimensions: [] })).toEqual({
      createTicket: false,
      severity: "低",
    });
  });

  it.each([[[]], [["服务态度"] as VocDimension[]]])(
    "never raises a ticket for a positive review (dimensions %j)",
    (dimensions) => {
      expect(
        triage({ polarity: "好评", dimensions }).createTicket,
      ).toBe(false);
    },
  );

  it("is exhaustive over the polarity enum", () => {
    const polarities: readonly VocPolarity[] = ["好评", "中评", "差评"];

    for (const polarity of polarities) {
      expect(() => triage({ polarity, dimensions: [] })).not.toThrow();
    }
  });
});
