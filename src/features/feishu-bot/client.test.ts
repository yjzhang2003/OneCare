import { describe, expect, it, vi } from "vitest";

import type { BotEnv } from "../../lib/env";
import {
  FeishuBotError,
  replyToFeishuMessage,
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
    const client: FeishuBotClient = { im: { message: { reply } } };

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
    const client: FeishuBotClient = { im: { message: { reply } } };

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
});
