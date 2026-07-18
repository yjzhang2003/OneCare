import { describe, expect, it, vi } from "vitest";

import type { BotEnv } from "../../../../src/lib/env";
import type { FeishuEventOutcome } from "../../../../src/features/feishu-bot/event-handler";
import type { CardActionResult } from "../../../../src/features/feishu-bot/card-actions";
import { createFeishuEventRoute } from "./route";

const env: BotEnv = {
  appId: "cli_onecare",
  appSecret: "server-only-secret",
  verificationToken: "verification-token",
  encryptKey: "12345678901234567890123456789012",
};

function request() {
  return new Request("https://onecare.example/api/feishu/events", {
    method: "POST",
    body: JSON.stringify({ schema: "2.0" }),
    headers: { "content-type": "application/json" },
  });
}

function dependencies(outcome: FeishuEventOutcome) {
  const scheduled: Array<() => Promise<void>> = [];
  return {
    scheduled,
    dependencies: {
      readEnv: vi.fn(() => env),
      parseEvent: vi.fn(async () => outcome),
      createReply: vi.fn((text: string) => ({
        kind: "help" as const,
        message: {
          msgType: "interactive" as const,
          content: JSON.stringify({ schema: "2.0", reply: text }),
        },
      })),
      createWelcome: vi.fn(() => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ welcome: true }),
      })),
      replyMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
      resolveAction: vi.fn((_action): CardActionResult => ({
        kind: "navigate" as const,
        message: {
          msgType: "interactive" as const,
          content: JSON.stringify({ schema: "2.0", view: "pending" }),
        },
        toast: "已打开待确认服务",
      })),
      schedule: vi.fn((task: () => Promise<void>) => scheduled.push(task)),
      reportFailure: vi.fn(),
    },
  };
}

describe("POST /api/feishu/events", () => {
  it("returns a URL verification challenge without scheduling work", async () => {
    const setup = dependencies({
      kind: "challenge",
      challenge: "challenge-value",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "challenge-value",
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callbacks without scheduling work", async () => {
    const setup = dependencies({ kind: "unauthorized" });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
  });

  it("acknowledges ignored authentic events", async () => {
    const setup = dependencies({ kind: "ignored" });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
  });

  it("acknowledges a message before the scheduled reply runs", async () => {
    const setup = dependencies({
      kind: "message",
      messageId: "om_message",
      text: "开始体验",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    expect(setup.dependencies.replyMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.createReply).toHaveBeenCalledWith("开始体验");
    expect(setup.dependencies.replyMessage).toHaveBeenCalledWith({
      env,
      messageId: "om_message",
      message: {
        msgType: "interactive",
        content: JSON.stringify({ schema: "2.0", reply: "开始体验" }),
      },
    });
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });

  it("acknowledges a chat entry before the welcome card is sent", async () => {
    const setup = dependencies({
      kind: "entered",
      chatId: "oc_onecare_chat",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.createWelcome).toHaveBeenCalledWith();
    expect(setup.dependencies.sendMessage).toHaveBeenCalledWith({
      env,
      chatId: "oc_onecare_chat",
      message: {
        msgType: "interactive",
        content: JSON.stringify({ welcome: true }),
      },
    });
    expect(setup.dependencies.replyMessage).not.toHaveBeenCalled();
  });

  it("reports scheduled reply failures without leaking the exception", async () => {
    const setup = dependencies({
      kind: "message",
      messageId: "om_message",
      text: "开始体验",
    });
    setup.dependencies.replyMessage.mockRejectedValueOnce(
      new Error("private upstream response"),
    );

    await createFeishuEventRoute(setup.dependencies)(request());
    await setup.scheduled[0]();

    expect(setup.dependencies.reportFailure).toHaveBeenCalledWith();
  });

  it("reports scheduled welcome failures without leaking the exception", async () => {
    const setup = dependencies({
      kind: "entered",
      chatId: "oc_onecare_chat",
    });
    setup.dependencies.sendMessage.mockRejectedValueOnce(
      new Error("private upstream response"),
    );

    await createFeishuEventRoute(setup.dependencies)(request());
    await setup.scheduled[0]();

    expect(setup.dependencies.reportFailure).toHaveBeenCalledWith();
  });

  it("acknowledges a navigation button before sending the next card", async () => {
    const setup = dependencies({
      kind: "card_action",
      action: "open_pending",
      chatId: "oc_onecare_chat",
      messageId: "om_onecare_card",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toast: { type: "info", content: "已打开待确认服务" },
    });
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.resolveAction).toHaveBeenCalledWith(
      "open_pending",
    );
    expect(setup.dependencies.sendMessage).toHaveBeenCalledWith({
      env,
      chatId: "oc_onecare_chat",
      message: {
        msgType: "interactive",
        content: JSON.stringify({ schema: "2.0", view: "pending" }),
      },
    });
  });

  it("updates the clicked card synchronously for state actions", async () => {
    const setup = dependencies({
      kind: "card_action",
      action: "create_ticket",
      chatId: "oc_onecare_chat",
      messageId: "om_onecare_card",
    });
    setup.dependencies.resolveAction.mockReturnValueOnce({
      kind: "update",
      response: {
        toast: { type: "success", content: "操作已记录（演示）" },
        card: {
          type: "raw",
          data: { schema: "2.0", completed: true },
        },
      },
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toast: { type: "success", content: "操作已记录（演示）" },
      card: {
        type: "raw",
        data: { schema: "2.0", completed: true },
      },
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });

  it("returns a neutral toast for a verified unsupported button", async () => {
    const setup = dependencies({ kind: "invalid_card_action" });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toast: { type: "info", content: "暂不支持该操作" },
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });

  it("returns a safe toast when card construction fails", async () => {
    const setup = dependencies({
      kind: "card_action",
      action: "open_pending",
      chatId: "oc_onecare_chat",
      messageId: "om_onecare_card",
    });
    setup.dependencies.resolveAction.mockImplementationOnce(() => {
      throw new Error("private card construction details");
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toast: { type: "error", content: "操作未完成，请稍后重试" },
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });
});
