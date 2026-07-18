import { Client, LoggerLevel } from "@larksuiteoapi/node-sdk";

import type { BotEnv } from "../../lib/env";
import type { FeishuOutboundMessage } from "./card-types";

type ReplyPayload = Readonly<{
  path: { message_id: string };
  data: { content: string; msg_type: string };
}>;

type CreatePayload = Readonly<{
  params: { receive_id_type: "chat_id" };
  data: {
    receive_id: string;
    msg_type: string;
    content: string;
  };
}>;

export type FeishuBotClient = {
  im: {
    message: {
      create: (
        payload: CreatePayload,
      ) => Promise<{ code?: number; msg?: string }>;
      reply: (
        payload: ReplyPayload,
      ) => Promise<{ code?: number; msg?: string }>;
    };
  };
};

export class FeishuBotError extends Error {
  constructor(public readonly code: "reply_failed" | "send_failed") {
    super(code);
    this.name = "FeishuBotError";
  }
}

type FeishuSdkClientOptions = ConstructorParameters<typeof Client>[0];
type FeishuSdkClientFactory = (
  options: FeishuSdkClientOptions,
) => FeishuBotClient;

export function createFeishuBotClient(
  env: BotEnv,
  createSdkClient: FeishuSdkClientFactory = (options) => new Client(options),
): FeishuBotClient {
  return createSdkClient({
    appId: env.appId,
    appSecret: env.appSecret,
    loggerLevel: LoggerLevel.fatal,
  });
}

export async function sendFeishuMessage(
  input: Readonly<{
    env: BotEnv;
    chatId: string;
    message: FeishuOutboundMessage;
  }>,
  createClient: () => FeishuBotClient = () => createFeishuBotClient(input.env),
): Promise<void> {
  const response = await createClient().im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: input.chatId,
      msg_type: input.message.msgType,
      content: input.message.content,
    },
  });

  if (response.code !== 0) {
    throw new FeishuBotError("send_failed");
  }
}

export async function replyToFeishuMessage(
  input: Readonly<{
    env: BotEnv;
    messageId: string;
    message: FeishuOutboundMessage;
  }>,
  createClient: () => FeishuBotClient = () => createFeishuBotClient(input.env),
): Promise<void> {
  const response = await createClient().im.message.reply({
    path: { message_id: input.messageId },
    data: {
      msg_type: input.message.msgType,
      content: input.message.content,
    },
  });

  if (response.code !== 0) {
    throw new FeishuBotError("reply_failed");
  }
}
