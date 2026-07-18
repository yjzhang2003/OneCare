import { describe, expect, it } from "vitest";

import { createBotReply } from "./bot-script";

describe("createBotReply", () => {
  it.each(["开始体验", "开始", "你好", "无法识别的内容"])(
    "returns the welcome menu for %s",
    (input) => {
      const reply = createBotReply(input);

      expect(reply.kind).toBe("welcome");
      expect(reply.text).toContain("1 饮料不够凉");
      expect(reply.text).toContain("演示流程");
    },
  );

  it.each(["1", "饮料不够凉", " 2 ", "刚才开始", "3", "没有影响"])(
    "returns knowledge help for %s",
    (input) => {
      const reply = createBotReply(input);

      expect(reply.kind).toBe("knowledge");
      expect(reply.text).toContain("确认冰箱门体已完全闭合");
      expect(reply.text).toContain("回复「已解决」或「转人工」");
    },
  );

  it("closes the self-service path", () => {
    expect(createBotReply(" 已解决 ")).toMatchObject({ kind: "resolved" });
  });

  it("creates a clearly simulated handoff summary", () => {
    const reply = createBotReply("转人工");

    expect(reply.kind).toBe("handoff");
    expect(reply.text).toContain("预诊摘要");
    expect(reply.text).toContain("未创建真实工单");
  });

  it("always restarts from the welcome menu", () => {
    expect(createBotReply("重新开始").kind).toBe("welcome");
  });
});
