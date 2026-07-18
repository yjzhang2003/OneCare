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

export const customerDemo = {
  caseId: serviceCase.id,
  prompt: "饮料不够凉",
  greeting: "检测到冷藏室温度持续偏高，需要我帮你一起确认吗？",
  reading: "正在读取设备运行数据…",
  diagnosis: "结合温度曲线，可能与冷藏温度传感器或风道密封有关。",
  confirmation: `已为你提交 ${serviceCase.visitWindow} 上门服务，客服确认后我会第一时间通知你。`,
  progress: ["发现异常", "完成预诊", "客服确认", "预约上门"],
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

export const engineerDemo = {
  caseId: serviceCase.id,
  confidence: 87,
  parts: ["冷藏温度传感器 ×1", "风道密封条 ×1"],
  contactPreference: "到达前 20 分钟联系",
  possibleCauses: ["冷藏温度传感器漂移", "风道密封效率下降"],
} as const;

export const vocTopics = [
  {
    id: "temperature",
    label: "冷藏室温度偏高",
    voices: 128,
    change: "+18%",
    models: 3,
    relatedCaseId: serviceCase.id,
  },
  {
    id: "installation",
    label: "安装等待时间",
    voices: 76,
    change: "+7%",
    models: 5,
    relatedCaseId: serviceCase.id,
  },
  {
    id: "repetition",
    label: "客服重复询问",
    voices: 54,
    change: "−11%",
    models: 2,
    relatedCaseId: serviceCase.id,
  },
] as const;

export type VocTopicId = (typeof vocTopics)[number]["id"];
