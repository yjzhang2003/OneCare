import { Client, LoggerLevel } from "@larksuiteoapi/node-sdk";

import type { BotEnv } from "../../lib/env";
import type { FeishuOutboundMessage } from "./card-types";

type ReplyPayload = Readonly<{
  path: { message_id: string };
  data: { content: string; msg_type: string };
}>;

// "open_id" joined "chat_id" when VOC ticket cards started being routed to the
// person who owns the row: the bot has no chat id for an owner it has never
// spoken to, so addressing a chat is not an option there. Both id types share
// the same im.message.create call — only this parameter and receive_id differ.
type ReceiveIdType = "chat_id" | "open_id";

type CreatePayload = Readonly<{
  params: { receive_id_type: ReceiveIdType };
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

// Exported so a test's fake factory can declare its parameter type. A
// `vi.fn(() => client)` infers a zero-arg signature, which makes
// `.mock.calls[0]` the empty tuple — vitest never type-checks it, but
// `tsc --noEmit` rejects the indexing outright.
export type FeishuSdkClientOptions = ConstructorParameters<typeof Client>[0];
type FeishuSdkClientFactory = (
  options: FeishuSdkClientOptions,
) => FeishuBotClient;

// `loggerLevel: LoggerLevel.fatal` does not silence this SDK: LoggerLevel.fatal
// is 0, and @larksuiteoapi/node-sdk 1.71.1 resolves the level with
// `params.loggerLevel || LoggerLevel.info`, so the most restrictive level is
// falsy and silently becomes the most verbose one. Its default logger then
// console.logs the entire axios error on any failed call — including the
// `Authorization: Bearer t-...` header, the request body (the app secret, for a
// token exchange) and the full card payload, which carries a customer's
// verbatim VOC text. On Vercel that is a permanent runtime log entry. Observed
// live while a card send was failing on a missing scope.
//
// The level is still passed (it is the correct intent, and a future SDK that
// fixes the falsy check will honour it), but the silent logger is what actually
// holds: the SDK resolves it with `params.logger || defaultLogger`, so any
// object provided here wins outright. Nothing in this app relies on the SDK's
// own logging — failures surface as FeishuBotError, as a counted notifyErrors,
// or as a fixed-string console.error the caller writes itself.
const silentLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
};

export function createFeishuBotClient(
  env: BotEnv,
  createSdkClient: FeishuSdkClientFactory = (options) => new Client(options),
): FeishuBotClient {
  return createSdkClient({
    appId: env.appId,
    appSecret: env.appSecret,
    loggerLevel: LoggerLevel.fatal,
    logger: silentLogger,
  });
}

// A closed two-member union rather than two optional keys: the recipient is
// exactly one of a chat or a person, and `chatId?: undefined` on the open_id
// member is what lets the check below narrow without a cast. Written out in
// full (instead of `Readonly<{env, message}> & (A | B)`) so the narrowing is
// structural and obvious rather than dependent on how TypeScript distributes
// an intersection over a union.
export type SendFeishuMessageInput =
  | Readonly<{
      env: BotEnv;
      chatId: string;
      openId?: undefined;
      message: FeishuOutboundMessage;
    }>
  | Readonly<{
      env: BotEnv;
      openId: string;
      chatId?: undefined;
      message: FeishuOutboundMessage;
    }>;

export async function sendFeishuMessage(
  input: SendFeishuMessageInput,
  createClient: () => FeishuBotClient = () => createFeishuBotClient(input.env),
): Promise<void> {
  const recipient =
    input.openId === undefined
      ? ({ receive_id_type: "chat_id", receive_id: input.chatId } as const)
      : ({ receive_id_type: "open_id", receive_id: input.openId } as const);

  const response = await createClient().im.message.create({
    params: { receive_id_type: recipient.receive_id_type },
    data: {
      receive_id: recipient.receive_id,
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
