export type Perspective = Readonly<{
  index: string;
  title: string;
  value: string;
  sceneLine: string;
  handoff: string;
  capabilities: readonly string[];
}>;

export type ServiceIdentity = Readonly<{
  label: string;
  description: string;
}>;

export type ConnectedSystem = Readonly<{
  id: "aijia" | "customer-service" | "iot" | "engineer" | "parts";
  label: string;
  description: string;
}>;

export type ArchitectureLayer = Readonly<{
  index: string;
  title: string;
  summary: string;
  capabilities: readonly string[];
}>;

export type DecisionPath = Readonly<{
  id: "self-service" | "human-review";
  title: string;
  criteria: string;
  action: string;
}>;

export type ClosedLoopStep = Readonly<{
  index: string;
  title: string;
  description: string;
}>;

export type PilotTarget = Readonly<{
  label: string;
  value: string;
  status: "试点目标";
}>;

export type RolloutStage = Readonly<{
  index: string;
  title: string;
  description: string;
}>;

export type TeamMember = Readonly<{
  index: string;
  name: string;
  role: string;
  education: readonly string[];
  highlights: readonly string[];
  capabilities: readonly string[];
}>;

export const perspectives: readonly Perspective[] = [
  {
    index: "01",
    title: "用户视角",
    value: "少描述、少等待，随时知道服务走到哪一步。",
    sceneLine: "冰箱好像不太冷了",
    handoff: "设备异常 → 主动提醒",
    capabilities: ["AI 对话", "主动提醒", "进度追踪"],
  },
  {
    index: "02",
    title: "客服视角",
    value: "一次理解用户，把复杂问题交给正确的人。",
    sceneLine: "一次理解，不再重复描述",
    handoff: "用户自助 → 人工服务",
    capabilities: ["诉求摘要", "知识建议", "智能路由"],
  },
  {
    index: "03",
    title: "工程师视角",
    value: "上门前获得诊断与配件线索，推动一次解决。",
    sceneLine: "一次带对",
    handoff: "预诊建议 → 配件与上门计划",
    capabilities: ["设备预诊", "配件建议", "现场反馈"],
  },
  {
    index: "04",
    title: "后台视角",
    value: "看见全局服务质量，让每个问题沉淀为改善。",
    sceneLine: "一次解决，持续学习",
    handoff: "服务结果 → VOC 改善",
    capabilities: ["VOC 趋势", "异常预警", "闭环治理"],
  },
] as const;

export const serviceIdentities: readonly ServiceIdentity[] = [
  {
    label: "用户 ID",
    description: "识别服务对象与连续服务关系",
  },
  {
    label: "设备 ID",
    description: "关联设备状态、型号与历史记录",
  },
  {
    label: "服务事件 ID",
    description: "串联本次问题从发现到回访的全部信息",
  },
] as const;

export const connectedSystems: readonly ConnectedSystem[] = [
  {
    id: "aijia",
    label: "海信爱家",
    description: "计划承接用户入口、设备绑定与服务进度",
  },
  {
    id: "customer-service",
    label: "400 客服",
    description: "计划同步用户诉求、审核记录与服务交接",
  },
  {
    id: "iot",
    label: "IoT 平台",
    description: "计划提供设备运行趋势与异常预警线索",
  },
  {
    id: "engineer",
    label: "工程师",
    description: "计划连接上门任务、诊断证据与维修结果",
  },
  {
    id: "parts",
    label: "备件系统",
    description: "计划提供库存与配件匹配信息",
  },
] as const;

export const architectureLayers: readonly ArchitectureLayer[] = [
  {
    index: "01",
    title: "数据与知识层",
    summary: "计划汇聚服务证据与知识，为预警、问诊和执行提供可信依据。",
    capabilities: [
      "设备运行数据、用户反馈与历史工单",
      "备件库存、产品说明书与维修案例",
      "基于 IoT 异常趋势形成设备健康预警线索",
    ],
  },
  {
    index: "02",
    title: "智能编排层",
    summary: "拟完成判断、资源匹配与过程追踪，并把人工审核纳入决策边界。",
    capabilities: [
      "多模态问诊、问题分级与置信度判断",
      "结构化工单生成、工程师与配件匹配",
      "全流程追踪、异常识别与介入触发",
    ],
  },
  {
    index: "03",
    title: "多角色应用层",
    summary: "计划为用户、客服和工程师提供连续但职责清楚的服务触点。",
    capabilities: [
      "用户：自助服务、问题补充与结果确认",
      "客服：服务方案审核、补充判断与协同派单",
      "工程师：诊断辅助、配件核验与维修反馈",
    ],
  },
] as const;

export const decisionPaths: readonly DecisionPath[] = [
  {
    id: "self-service",
    title: "AI 自助解决",
    criteria: "标准化、低风险且置信度达到规则要求",
    action: "AI 计划提供可执行的自助建议，并由用户确认处理结果。",
  },
  {
    id: "human-review",
    title: "人工审核后执行",
    criteria: "复杂、低置信度或高风险",
    action:
      "拟形成包含用户描述、设备数据、历史记录和已完成操作的服务方案，经人工审核后再执行。",
  },
] as const;

export const closedLoopSteps: readonly ClosedLoopStep[] = [
  {
    index: "01",
    title: "智能分流",
    description: "计划按问题标准化程度、风险和置信度选择处理路径。",
  },
  {
    index: "02",
    title: "人工审核",
    description: "复杂或高风险方案由客服等责任角色确认后执行。",
  },
  {
    index: "03",
    title: "自动编排",
    description: "拟连接工单、工程师、配件和服务时效，形成执行计划。",
  },
  {
    index: "04",
    title: "异常介入",
    description: "计划在超时、资源不匹配或执行异常时触发人工介入。",
  },
  {
    index: "05",
    title: "结果反馈与持续优化",
    description: "拟用客服对话、维修结果和回访优化问诊规则与维修知识。",
  },
] as const;

export const pilotTargets: readonly PilotTarget[] = [
  { label: "首次响应时间", value: "降低 30%–50%", status: "试点目标" },
  { label: "工单整理时间", value: "降低 40%", status: "试点目标" },
  { label: "平均服务周期", value: "缩短 20%", status: "试点目标" },
  { label: "重复上门率", value: "降低 15%", status: "试点目标" },
] as const;

export const rolloutStages: readonly RolloutStage[] = [
  {
    index: "01",
    title: "API 轻量接入",
    description: "计划先连接试点所需的最小数据与服务接口。",
  },
  {
    index: "02",
    title: "聚焦试点",
    description: "从单一重点产品和代表性区域开始验证。",
  },
  {
    index: "03",
    title: "验证后推广",
    description: "在口径、流程与效果得到验证后逐步推广。",
  },
] as const;

export const teamMembers: readonly TeamMember[] = [
  {
    index: "01",
    name: "张禹健",
    role: "AI 工程与系统架构",
    education: [
      "南京大学软件工程硕士研究生",
      "南京邮电大学计算机科学与技术本科",
    ],
    highlights: [
      "参与飞书智能伙伴 Aily 后端研发，负责用户上下文模块与 Aily CLI。",
      "搭建企业级 AI 自动修复工作流，形成扫描、定位、修复、构建验证与提交闭环。",
    ],
    capabilities: ["Agent 工程", "系统架构", "工程闭环"],
  },
  {
    index: "02",
    name: "张睿哲",
    role: "安全仿真与算法研究",
    education: [
      "西安电子科技大学网络与信息安全硕士研究生",
      "南京邮电大学信息安全本科",
    ],
    highlights: [
      "基于 CARLA-Air 搭建无人机与地面车辆协同仿真及多模态数据采集场景。",
      "开展三维车辆多视角仿真与可微渲染研究，并参与 Fuzzer 自动化安全测试。",
    ],
    capabilities: ["安全研究", "仿真建模", "算法验证"],
  },
  {
    index: "03",
    name: "黄齐",
    role: "AI 产品与业务洞察",
    education: [
      "卡内基梅隆大学人工智能系统管理硕士研究生",
      "苏州大学物流管理本科",
    ],
    highlights: [
      "参与政务数据场景的自然语言到 SQL/DSL 智能查询系统，负责多 Agent 拆解与 RAG 检索模块。",
      "构建多模态 RAG、事实核查 Agent 与多 Agent 调试系统，并具有供应链建模和质量分析经验。",
    ],
    capabilities: ["AI 产品化", "数据洞察", "业务建模"],
  },
] as const;
