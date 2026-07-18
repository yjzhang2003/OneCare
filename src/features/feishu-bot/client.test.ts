import { describe, expect, it, vi } from "vitest";

import type { BotEnv } from "../../lib/env";
import {
  FeishuBotError,
  replyToFeishuMessage,
  sendFeishuMessage,
  type FeishuBotClient,
} from "./client";

const env: BotEnv = {
  appId: "cli_onecare",
  appSecret: "server-only-secret",
  verificationToken: "verification-token",
  encryptKey: "12345678901234567890123456789012",
};

describe("replyToFeishuMessage", () => {
  it("replies to the original message with text content", async () => {
    const reply = vi.fn(async () => ({ code: 0, msg: "success" }));
    const create = vi.fn(async () => ({ code: 0, msg: "success" }));
    const client: FeishuBotClient = { im: { message: { create, reply } } };

    await replyToFeishuMessage(
      { env, messageId: "om_message", text: "演示回复" },
      () => client,
    );

    expect(reply).toHaveBeenCalledWith({
      path: { message_id: "om_message" },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text: "演示回复" }),
      },
    });
  });

  it("maps upstream failures to a stable error without response details", async () => {
    const reply = vi.fn(async () => ({
      code: 999,
      msg: "upstream response containing private details",
    }));
    const create = vi.fn(async () => ({ code: 0, msg: "success" }));
    const client: FeishuBotClient = { im: { message: { create, reply } } };

    await expect(
      replyToFeishuMessage(
        { env, messageId: "om_message", text: "演示回复" },
        () => client,
      ),
    ).rejects.toEqual(new FeishuBotError("reply_failed"));
    await expect(
      replyToFeishuMessage(
        { env, messageId: "om_message", text: "演示回复" },
        () => client,
      ),
    ).rejects.not.toThrow("private details");
  });

  it("sends a proactive interactive message to the entered p2p chat", async () => {
    const create = vi.fn(async () => ({ code: 0, msg: "success" }));
    const reply = vi.fn(async () => ({ code: 0, msg: "success" }));
    const client: FeishuBotClient = { im: { message: { create, reply } } };

    await sendFeishuMessage(
      {
        env,
        chatId: "oc_onecare_chat",
        message: {
          msgType: "interactive",
          content: JSON.stringify({ card: true }),
        },
      },
      () => client,
    );

    expect(create).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_onecare_chat",
        msg_type: "interactive",
        content: JSON.stringify({ card: true }),
      },
    });
  });

  it("maps proactive send failures without preserving response details", async () => {
    const create = vi.fn(async () => ({
      code: 999,
      msg: "upstream response containing private details",
    }));
    const reply = vi.fn(async () => ({ code: 0, msg: "success" }));
    const client: FeishuBotClient = { im: { message: { create, reply } } };

    await expect(
      sendFeishuMessage(
        {
          env,
          chatId: "oc_onecare_chat",
          message: { msgType: "interactive", content: "{}" },
        },
        () => client,
      ),
    ).rejects.toEqual(new FeishuBotError("send_failed"));
    await expect(
      sendFeishuMessage(
        {
          env,
          chatId: "oc_onecare_chat",
          message: { msgType: "interactive", content: "{}" },
        },
        () => client,
      ),
    ).rejects.not.toThrow("private details");
  });
});
