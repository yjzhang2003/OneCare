export const VOC_POLARITIES = ["好评", "中评", "差评"] as const;
export type VocPolarity = (typeof VOC_POLARITIES)[number];

export const VOC_DIMENSIONS = [
  "服务态度",
  "维修技术",
  "维修价格",
  "维修时间",
  "售后服务",
  "环境设施",
  "产品质量",
] as const;
export type VocDimension = (typeof VOC_DIMENSIONS)[number];

export type VocSeverity = "高" | "中" | "低";

export type TriageDecision = Readonly<{
  createTicket: boolean;
  severity: VocSeverity;
}>;

export function triage(
  input: Readonly<{
    polarity: VocPolarity;
    dimensions: readonly VocDimension[];
  }>,
): TriageDecision {
  if (input.polarity === "差评") {
    return {
      createTicket: true,
      severity: input.dimensions.length >= 2 ? "高" : "中",
    };
  }

  if (input.polarity === "中评" && input.dimensions.length > 0) {
    return { createTicket: true, severity: "中" };
  }

  return { createTicket: false, severity: "低" };
}
