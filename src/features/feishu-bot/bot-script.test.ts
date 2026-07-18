import { describe, expect, it } from "vitest";

import { createBotReply, createWelcomeMessage } from "./bot-script";

const commandCases = [
  {
    kind: "help",
    aliases: ["使用帮助", "Help", "使用帮助 / Help"],
    expected: "客服工作台",
  },
  {
    kind: "operations",
    aliases: [
      "运营后台",
      "Operations Center",
      "运营后台 / Operations Center",
    ],
    expected: "闭环风险",
  },
  {
    kind: "pending",
    aliases: [
      "待确认服务",
      "Pending Services",
      "待确认服务 / Pending Services",
    ],
    expected: "等待客服确认",
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
    expected: "今日上门任务",
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
    expected: "自动回访",
  },
] as const;

describe("createBotReply", () => {
  it.each(commandCases)(
    "maps the $kind employee menu command in every configured language",
    ({ kind, aliases, expected }) => {
      for (const alias of aliases) {
        const reply = createBotReply(`  ${alias}  `);

        expect(reply.kind).toBe(kind);
        expect(reply.text).toContain(expected);
        expect(reply.text).toContain("演示");
      }
    },
  );

  it("accepts a straight apostrophe in the English task command", () => {
    expect(createBotReply("Today's Tasks").kind).toBe("tasks");
  });

  it("falls back to staff help instead of the consumer diagnosis flow", () => {
    const reply = createBotReply("无法识别的内容");

    expect(reply.kind).toBe("help");
    expect(reply.text).toContain("客服工作台");
    expect(reply.text).not.toContain("饮料不够凉");
  });
});

describe("createWelcomeMessage", () => {
  it("builds the staff welcome card", () => {
    const message = createWelcomeMessage();
    const card = JSON.parse(message.content) as {
      header: { title: { content: string } };
    };

    expect(message.msgType).toBe("interactive");
    expect(card.header.title.content).toBe("万护 OneCare");
    expect(message.content).toContain("AI 驱动的用户服务全链路协同助手");
    expect(message.content).toContain("OC-240718-037");
    expect(message.content).toContain("等待客服确认");
    expect(message.content).toContain("请从下方菜单选择工作入口");
  });
});
