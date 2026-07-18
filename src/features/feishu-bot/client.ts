import { Client, LoggerLevel } from "@larksuiteoapi/node-sdk";

import type { BotEnv } from "../../lib/env";

type ReplyPayload = Readonly<{
  path: { message_id: string };
  data: { content: string; msg_type: string };
}>;

export type FeishuBotClient = {
  im: {
    message: {
      reply: (
        payload: ReplyPayload,
      ) => Promise<{ code?: number; msg?: string }>;
    };
  };
};

export class FeishuBotError extends Error {
  constructor(public readonly code: "reply_failed") {
    super(code);
    this.name = "FeishuBotError";
  }
}

export async function replyToFeishuMessage(
  input: Readonly<{ env: BotEnv; messageId: string; text: string }>,
  createClient: () => FeishuBotClient = () =>
    new Client({
      appId: input.env.appId,
      appSecret: input.env.appSecret,
      loggerLevel: LoggerLevel.error,
    }),
): Promise<void> {
  const response = await createClient().im.message.reply({
    path: { message_id: input.messageId },
    data: {
      msg_type: "text",
      content: JSON.stringify({ text: input.text }),
    },
  });

  if (response.code !== 0) {
    throw new FeishuBotError("reply_failed");
  }
}
