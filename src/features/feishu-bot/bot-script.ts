import type { FeishuOutboundMessage, OneCareCardView } from "./card-types";
import { createCardMessage, createWelcomeMessage } from "./cards";

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
  message: FeishuOutboundMessage;
}>;

const views: Readonly<Record<BotReplyKind, OneCareCardView>> = {
  help: "workbench",
  operations: "operations",
  pending: "pending",
  ticket: "ticket",
  progress: "progress",
  tasks: "tasks",
  diagnosis: "diagnosis",
  result: "result",
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
  return { kind, message: createCardMessage(views[kind]) };
}

export { createWelcomeMessage };
export type { FeishuOutboundMessage } from "./card-types";
