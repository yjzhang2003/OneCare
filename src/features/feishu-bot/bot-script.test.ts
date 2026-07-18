import { describe, expect, it } from "vitest";

import { createBotReply } from "./bot-script";

const commandCases = [
  {
    kind: "help",
    aliases: ["使用帮助", "Help", "使用帮助 / Help"],
    expected: "员工协同工作台",
  },
  {
    kind: "operations",
    aliases: [
      "运营后台",
      "Operations Center",
      "运营后台 / Operations Center",
    ],
    expected: "闭环提醒",
  },
  {
    kind: "pending",
    aliases: [
      "待确认服务",
      "Pending Services",
      "待确认服务 / Pending Services",
    ],
    expected: "知识库辅助用户自查",
  },
  {
    kind: "ticket",
    aliases: [
      "创建服务工单",
      "Create Ticket",
      "创建服务工单 / Create Ticket",
    ],
    expected: "演示工单",
  },
  {
    kind: "progress",
    aliases: [
      "查询服务进度",
      "Track Progress",
      "查询服务进度 / Track Progress",
    ],
    expected: "客服确认",
  },
  {
    kind: "tasks",
    aliases: ["今日任务", "Today’s Tasks", "今日任务 / Today’s Tasks"],
    expected: "今日上门",
  },
  {
    kind: "diagnosis",
    aliases: [
      "AI预诊与配件",
      "AI Diagnosis & Parts",
      "AI预诊与配件 / AI Diagnosis & Parts",
    ],
    expected: "建议携带",
  },
  {
    kind: "result",
    aliases: [
      "提交服务结果",
      "Submit Result",
      "提交服务结果 / Submit Result",
    ],
    expected: "自动触发回访",
  },
] as const;

describe("createBotReply", () => {
  it.each(commandCases)(
    "maps the $kind employee menu command in every configured language",
    ({ kind, aliases, expected }) => {
      for (const alias of aliases) {
        const reply = createBotReply(`  ${alias}  `);

        expect(reply.kind).toBe(kind);
        expect(reply.message.msgType).toBe("interactive");
        expect(reply.message.content).toContain(expected);
        expect(reply.message.content).toContain("演示");
      }
    },
  );

  it("accepts a straight apostrophe in the English task command", () => {
    expect(createBotReply("Today's Tasks").kind).toBe("tasks");
  });

  it("falls back to staff help instead of the consumer diagnosis flow", () => {
    const reply = createBotReply("无法识别的内容");

    expect(reply.kind).toBe("help");
    expect(reply.message.msgType).toBe("interactive");
    expect(reply.message.content).toContain("员工协同工作台");
    expect(reply.message.content).not.toContain("饮料不够凉");
  });
});
