export type Perspective = Readonly<{
  index: string;
  title: string;
  value: string;
  capabilities: readonly string[];
}>;

export type ServiceLayer = Readonly<{
  index: string;
  title: string;
  english: string;
  input: string;
  action: string;
  output: string;
}>;

export type ScenarioStep = Readonly<{
  layer: string;
  title: string;
  description: string;
}>;

export type TeamMember = Readonly<{
  index: string;
  title: string;
  capabilities: readonly string[];
}>;

export const perspectives: readonly Perspective[] = [
  {
    index: "01",
    title: "用户视角",
    value: "少描述、少等待，随时知道服务走到哪一步。",
    capabilities: ["AI 对话", "主动提醒", "进度追踪"],
  },
  {
    index: "02",
    title: "客服视角",
    value: "一次理解用户，把复杂问题交给正确的人。",
    capabilities: ["诉求摘要", "知识建议", "智能路由"],
  },
  {
    index: "03",
    title: "工程师视角",
    value: "上门前获得诊断与配件线索，推动一次解决。",
    capabilities: ["设备预诊", "配件建议", "现场反馈"],
  },
  {
    index: "04",
    title: "后台视角",
    value: "看见全局服务质量，让每个问题沉淀为改善。",
    capabilities: ["VOC 趋势", "异常预警", "闭环治理"],
  },
] as const;

export const serviceLayers: readonly ServiceLayer[] = [
  {
    index: "01",
    title: "感知",
    english: "SENSE",
    input: "IoT 设备信号、用户声音、服务记录",
    action: "统一采集并识别异常与意图",
    output: "可处理的问题信号",
  },
  {
    index: "02",
    title: "诊断",
    english: "DIAGNOSE",
    input: "问题信号、历史案例、设备知识",
    action: "风险判断、原因推断、置信度评估",
    output: "诊断建议与信息缺口",
  },
  {
    index: "03",
    title: "编排",
    english: "ORCHESTRATE",
    input: "诊断建议、人员、配件、时效规则",
    action: "任务拆解、角色路由、资源匹配",
    output: "可执行的服务计划",
  },
  {
    index: "04",
    title: "服务",
    english: "SERVE",
    input: "服务计划、用户偏好、现场反馈",
    action: "智能客服辅助、工程师执行、进度同步",
    output: "解决结果与用户确认",
  },
  {
    index: "05",
    title: "学习",
    english: "LEARN",
    input: "处理结果、回访、满意度、VOC",
    action: "效果评估、知识沉淀、问题聚类",
    output: "下一轮预诊与产品改善",
  },
] as const;

export const scenarioSteps: readonly ScenarioStep[] = [
  {
    layer: "感知",
    title: "异常信号出现",
    description: "设备温度波动与用户历史反馈形成异常信号。",
  },
  {
    layer: "诊断",
    title: "形成预诊建议",
    description: "AI 给出传感器或风道相关建议，并标注待确认信息。",
  },
  {
    layer: "编排",
    title: "匹配服务资源",
    description: "系统匹配工程师、建议配件和可预约时间。",
  },
  {
    layer: "服务",
    title: "带着上下文上门",
    description: "用户收到连续进度，工程师完成服务并记录结果。",
  },
  {
    layer: "学习",
    title: "沉淀改善线索",
    description: "回访进入 VOC 聚类，更新案例知识与产品改善线索。",
  },
] as const;

export const teamMembers: readonly TeamMember[] = [
  {
    index: "01",
    title: "产品策略与业务洞察",
    capabilities: ["业务建模", "用户研究", "方案规划"],
  },
  {
    index: "02",
    title: "AI 工程与系统架构",
    capabilities: ["AI 应用", "系统设计", "工程实现"],
  },
  {
    index: "03",
    title: "体验设计与服务创新",
    capabilities: ["服务设计", "交互原型", "视觉表达"],
  },
] as const;
