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

// The eight options that actually exist on the Base's 情绪标签 multi-select,
// read back from the live field schema rather than invented here. This list
// exists because Bitable auto-creates any option it is handed and deleting the
// record afterwards does not remove the option — so an unconstrained model
// output permanently pollutes the enterprise's field schema. Four such leftovers
// had to be cleaned out of 产品品类 by hand.
export const VOC_SENTIMENTS = [
  "愤怒",
  "失望",
  "着急",
  "沮丧",
  "感激",
  "开心",
  "有爱",
  "中性",
] as const;

export type VocSentiment = (typeof VOC_SENTIMENTS)[number];

export type VocSeverity = "高" | "中" | "低";

// Lives beside the type it enumerates. field-map.ts used to keep a private copy
// and the workbench query layer needed a third; one home for the enum means a
// change cannot land in two of three places.
export const VOC_SEVERITIES = ["高", "中", "低"] as const;

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
