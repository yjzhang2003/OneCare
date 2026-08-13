export const serviceCase = {
  id: "OC-240718-037",
  customer: "李女士",
  product: "BCD-510W 智能冰箱",
  currentTemperature: 9,
  targetTemperature: 4,
  anomalyMinutes: 26,
  visitWindow: "14:30–15:30",
  address: "青岛市崂山区 · 已脱敏",
} as const;

export const agentDemo = {
  caseId: serviceCase.id,
  confidence: 87,
  route: "制冷服务",
  engineer: "周启明",
  suggestedPart: "冷藏温度传感器",
  workOrderId: "OC-WO-037",
  summary: "用户反馈饮料不够凉；设备连续 26 分钟高于目标温度，无需重复询问型号与异常时长。",
} as const;

export const customerDemo = {
  caseId: serviceCase.id,
  prompt: "饮料不够凉",
  greeting: "检测到冷藏室温度持续偏高，需要我帮你一起确认吗？",
  reading: "正在读取设备运行数据…",
  diagnosis: "结合温度曲线，可能与冷藏温度传感器或风道密封有关。",
  knowledgeIntro: "先按知识库建议做一次快速排查：",
  knowledgeSteps: [
    "确认冰箱门体已完全闭合",
    "保持冷藏室出风口无遮挡",
    "减少开门并等待十分钟后复查",
  ],
  selfResolved: "本次问题已通过 AI 指引解决，我会继续关注设备状态。",
  serviceRequested: "自助排查仍未解决，已把设备数据和排查记录提交给客服。",
  workOrderConfirmation: `客服已创建 ${agentDemo.workOrderId}，${agentDemo.engineer} 将在 ${serviceCase.visitWindow} 上门。`,
  serviceCompleted: "本次服务已完成，设备状态将继续由万护关注。",
  progress: ["发现异常", "AI 自助", "客服建单", "服务完成"],
} as const;

export const engineerDemo = {
  caseId: serviceCase.id,
  confidence: 87,
  parts: ["冷藏温度传感器 ×1", "风道密封条 ×1"],
  contactPreference: "到达前 20 分钟联系",
  possibleCauses: ["冷藏温度传感器漂移", "风道密封效率下降"],
} as const;
