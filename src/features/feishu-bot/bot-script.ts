export type BotReplyKind =
  | "help"
  | "operations"
  | "pending"
  | "ticket"
  | "progress"
  | "tasks"
  | "diagnosis"
  | "result";

export type BotReply = Readonly<{
  kind: BotReplyKind;
  text: string;
}>;

export type FeishuOutboundMessage = Readonly<{
  msgType: "text" | "interactive";
  content: string;
}>;

const replies: Readonly<Record<BotReplyKind, string>> = {
  help: [
    "万护 OneCare 员工协同演示",
    "当前案例：OC-240718-037 · 冷藏室温度持续偏高。",
    "请从底部菜单进入对应岗位：",
    "• 客服工作台：确认服务、创建演示工单、查询进度",
    "• 工程师工作台：查看任务、AI 预诊与配件、提交演示结果",
    "• 运营后台：查看服务闭环与 VOC 风险",
  ].join("\n"),
  operations: [
    "万护 OneCare 运营后台演示",
    "服务总览：1 个主动预警案例正在流转。",
    "当前阶段：AI 已完成预诊，等待客服确认。",
    "闭环风险：若 30 分钟内未确认，将触发协同提醒。",
    "VOC 主题：冷藏温度偏高反馈近期出现聚集趋势。",
  ].join("\n"),
  pending: [
    "万护 OneCare 待确认服务演示",
    "案例：OC-240718-037 · 冷藏室温度持续偏高。",
    "AI 预诊：优先检查温度传感器、门体密封与风道循环。",
    "当前状态：等待客服确认是否创建服务工单。",
  ].join("\n"),
  ticket: [
    "万护 OneCare 演示工单",
    "工单号：OC-240718-037",
    "问题：冷藏室温度持续偏高",
    "建议：安排工程师携带温度传感器备件上门核验。",
    "说明：仅生成演示摘要，未写入真实工单系统。",
  ].join("\n"),
  progress: [
    "万护 OneCare 服务进度演示",
    "● 发现异常",
    "● 完成预诊",
    "◉ 客服确认（当前）",
    "○ 预约上门",
    "案例 OC-240718-037 尚未进入真实服务系统。",
  ].join("\n"),
  tasks: [
    "万护 OneCare 工程师任务演示",
    "今日上门任务：1 项",
    "案例：OC-240718-037 · 冷藏室温度持续偏高",
    "时间窗：14:00–16:00",
    "服务地点：青岛市 · 详细地址已脱敏",
  ].join("\n"),
  diagnosis: [
    "万护 OneCare AI 预诊演示",
    "可能原因：温度传感器漂移、门体密封异常或风道循环受阻。",
    "建议携带：冷藏室温度传感器、密封检测工具和风道清洁组件。",
    "上门前请先核验设备型号与历史告警。",
  ].join("\n"),
  result: [
    "万护 OneCare 服务结果演示",
    "已记录演示结果：完成传感器核验与风道清理，温度恢复观察中。",
    "下一步：系统将在服务完成后触发自动回访与满意度评价。",
    "说明：本次结果未写入真实服务或回访系统。",
  ].join("\n"),
};

function normalize(input: string): string {
  return input
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replaceAll("’", "'")
    .replaceAll("／", "/")
    .replace(/\s*\/\s*/g, " / ");
}

const commandGroups: ReadonlyArray<
  readonly [BotReplyKind, readonly string[]]
> = [
    ["help", ["使用帮助", "help", "使用帮助 / help"]],
    [
      "operations",
      ["运营后台", "operations center", "运营后台 / operations center"],
    ],
    [
      "pending",
      ["待确认服务", "pending services", "待确认服务 / pending services"],
    ],
    [
      "ticket",
      ["创建服务工单", "create ticket", "创建服务工单 / create ticket"],
    ],
    [
      "progress",
      ["查询服务进度", "track progress", "查询服务进度 / track progress"],
    ],
    [
      "tasks",
      ["今日任务", "today's tasks", "今日任务 / today's tasks"],
    ],
    [
      "diagnosis",
      [
        "ai预诊与配件",
        "ai diagnosis & parts",
        "ai预诊与配件 / ai diagnosis & parts",
      ],
    ],
    [
      "result",
      ["提交服务结果", "submit result", "提交服务结果 / submit result"],
    ],
  ];

const commandAliases = new Map<string, BotReplyKind>(
  commandGroups.flatMap(([kind, aliases]) =>
    aliases.map((alias) => [normalize(alias), kind] as const),
  ),
);

export function createBotReply(input: string): BotReply {
  const kind = commandAliases.get(normalize(input)) ?? "help";
  return { kind, text: replies[kind] };
}

export function createWelcomeMessage(): FeishuOutboundMessage {
  return {
    msgType: "interactive",
    content: JSON.stringify({
      config: { wide_screen_mode: true },
      header: {
        template: "turquoise",
        title: { tag: "plain_text", content: "万护 OneCare" },
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content:
              "**AI 驱动的用户服务全链路协同助手**\n用于客服、工程师和运营人员协同，不面向消费者。",
          },
        },
        { tag: "hr" },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content:
              "**当前演示案例**\nOC-240718-037 · 冷藏室温度持续偏高\n**当前状态**\nAI 已完成预诊，等待客服确认。",
          },
        },
        {
          tag: "note",
          elements: [
            { tag: "plain_text", content: "请从下方菜单选择工作入口。" },
          ],
        },
      ],
    }),
  };
}
