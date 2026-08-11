import { describe, expect, it, vi } from "vitest";
import { LoggerLevel } from "@larksuiteoapi/node-sdk";

import type { BotEnv } from "../../lib/env";
import {
  FeishuBotError,
  createFeishuBotClient,
  replyToFeishuMessage,
  sendFeishuMessage,
  type FeishuBotClient,
  type FeishuSdkClientOptions,
} from "./client";

const env: BotEnv = {
  appId: "cli_onecare",
  appSecret: "server-only-secret",
  verificationToken: "verification-token",
  encryptKey: "12345678901234567890123456789012",
};

describe("replyToFeishuMessage", () => {
  it("replies to the original message with interactive card content", async () => {
    const reply = vi.fn(async () => ({ code: 0, msg: "success" }));
    const create = vi.fn(async () => ({ code: 0, msg: "success" }));
    const client: FeishuBotClient = { im: { message: { create, reply } } };

    await replyToFeishuMessage(
      {
        env,
        messageId: "om_message",
        message: { msgType: "interactive", content: '{"schema":"2.0"}' },
      },
      () => client,
    );

    expect(reply).toHaveBeenCalledWith({
      path: { message_id: "om_message" },
      data: {
        msg_type: "interactive",
        content: '{"schema":"2.0"}',
      },
    });
  });

  it("creates SDK clients with a silent logger, not just a low logger level", () => {
    const create = vi.fn(async () => ({ code: 0, msg: "success" }));
    const reply = vi.fn(async () => ({ code: 0, msg: "success" }));
    const client: FeishuBotClient = { im: { message: { create, reply } } };
    const factory = vi.fn((_options: FeishuSdkClientOptions) => client);

    expect(createFeishuBotClient(env, factory)).toBe(client);

    const [options] = factory.mock.calls[0];
    expect(options).toMatchObject({
      appId: env.appId,
      appSecret: env.appSecret,
      loggerLevel: LoggerLevel.fatal,
    });

    // loggerLevel alone is not enough: LoggerLevel.fatal is 0, and the SDK
    // resolves its level with `params.loggerLevel || LoggerLevel.info`, so the
    // most restrictive level is falsy and silently becomes the most verbose
    // one. An explicit logger is what actually silences it, because the SDK
    // resolves that with `params.logger || defaultLogger`.
    expect(options?.logger).toBeDefined();
  });

  // The SDK's default logger console.logs the whole axios error object on a
  // failed call. That object carries the Authorization header
  // (`Bearer t-...`), the request body — which for a token exchange is the app
  // secret — and the full card payload, which contains a customer's verbatim
  // VOC text. On Vercel that is a permanent runtime log entry. Verified
  // against the live API while a send was failing on a missing scope, so this
  // is an observed leak, not a hypothetical one.
  it("logs nothing at any level, so a failed call cannot leak a token or VOC text", () => {
    const create = vi.fn(async () => ({ code: 0, msg: "success" }));
    const reply = vi.fn(async () => ({ code: 0, msg: "success" }));
    const client: FeishuBotClient = { im: { message: { create, reply } } };
    const factory = vi.fn((_options: FeishuSdkClientOptions) => client);

    createFeishuBotClient(env, factory);
    const logger = factory.mock.calls[0][0]?.logger;
    if (!logger) throw new Error("expected a logger");

    const spies = (
      ["log", "info", "warn", "error", "debug", "trace"] as const
    ).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

    try {
      for (const level of ["error", "warn", "info", "debug", "trace"] as const) {
        logger[level]("Bearer t-secret-token", { app_secret: "s3cret" });
      }
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
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
        {
          env,
          messageId: "om_message",
          message: { msgType: "interactive", content: '{"schema":"2.0"}' },
        },
        () => client,
      ),
    ).rejects.toEqual(new FeishuBotError("reply_failed"));
    await expect(
      replyToFeishuMessage(
        {
          env,
          messageId: "om_message",
          message: { msgType: "interactive", content: '{"schema":"2.0"}' },
        },
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

  // Routing a VOC ticket to its owner means addressing a person, not a chat:
  // the bot has no chat id for an owner it has never spoken to. Before this,
  // receive_id_type was hardcoded to "chat_id", so the open_id path this
  // depends on did not exist at all.
  it("sends a proactive interactive message to an owner by open_id", async () => {
    const create = vi.fn(async () => ({ code: 0, msg: "success" }));
    const reply = vi.fn(async () => ({ code: 0, msg: "success" }));
    const client: FeishuBotClient = { im: { message: { create, reply } } };

    await sendFeishuMessage(
      {
        env,
        openId: "ou_owner",
        message: {
          msgType: "interactive",
          content: JSON.stringify({ card: true }),
        },
      },
      () => client,
    );

    expect(create).toHaveBeenCalledWith({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: "ou_owner",
        msg_type: "interactive",
        content: JSON.stringify({ card: true }),
      },
    });
  });

  it("maps an open_id send failure to the same stable error", async () => {
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
          openId: "ou_owner",
          message: { msgType: "interactive", content: "{}" },
        },
        () => client,
      ),
    ).rejects.toEqual(new FeishuBotError("send_failed"));
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
