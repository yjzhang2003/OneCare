export type BotReplyKind = "welcome" | "knowledge" | "resolved" | "handoff";

export type BotReply = Readonly<{
  kind: BotReplyKind;
  text: string;
}>;

const diagnosisInputs = new Set([
  "1",
  "2",
  "3",
  "饮料不够凉",
  "刚才开始",
  "没有影响",
]);

function normalize(input: string): string {
  return input.trim().toLocaleLowerCase("zh-CN");
}

export function createBotReply(input: string): BotReply {
  const value = normalize(input);

  if (value === "已解决") {
    return {
      kind: "resolved",
      text: "已记录为 AI 自助解决。本次为万护 OneCare 演示流程；回复「重新开始」可再次体验。",
    };
  }

  if (value === "转人工") {
    return {
      kind: "handoff",
      text: "预诊摘要｜冷藏室温度持续偏高，知识库排查后仍未解决，建议客服核验温度传感器与风道。本次为演示流程，未创建真实工单。回复「重新开始」可再次体验。",
    };
  }

  if (diagnosisInputs.has(value)) {
    return {
      kind: "knowledge",
      text: "知识库建议\n1. 确认冰箱门体已完全闭合\n2. 保持冷藏室出风口无遮挡\n3. 减少开门并等待十分钟后复查\n\n回复「已解决」或「转人工」。本次为演示流程。",
    };
  }

  return {
    kind: "welcome",
    text: "检测到冷藏室温度持续偏高。请选择最接近的情况：\n1 饮料不够凉\n2 刚才开始\n3 没有影响\n\n本次为万护 OneCare 演示流程。",
  };
}
