import { createHash, timingSafeEqual } from "node:crypto";

import {
  AESCipher,
  EventDispatcher,
  LoggerLevel,
} from "@larksuiteoapi/node-sdk";

import type { BotEnv } from "../../lib/env";

export type FeishuEventOutcome =
  | Readonly<{ kind: "challenge"; challenge: string }>
  | Readonly<{ kind: "message"; messageId: string; text: string }>
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "unauthorized" }>;

export type ParseFeishuEventInput = Readonly<{
  rawBody: string;
  headers: Headers;
  env: BotEnv;
}>;

type JsonObject = Record<string, unknown>;

type ReceiveMessageEvent = {
  message?: {
    message_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
  };
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeEqual(received: unknown, expected: string): boolean {
  if (typeof received !== "string") return false;

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function signatureMatches(
  rawBody: string,
  headers: Headers,
  encryptKey: string,
): boolean {
  const timestamp = headers.get("x-lark-request-timestamp");
  const nonce = headers.get("x-lark-request-nonce");
  const receivedSignature = headers.get("x-lark-signature");
  if (!timestamp || !nonce || !receivedSignature) return false;

  const expectedSignature = createHash("sha256")
    .update(`${timestamp}${nonce}${encryptKey}${rawBody}`)
    .digest("hex");
  return safeEqual(receivedSignature, expectedSignature);
}

function decryptPayload(body: JsonObject, encryptKey: string): JsonObject | null {
  if (typeof body.encrypt !== "string") return body;

  try {
    const decrypted = JSON.parse(
      new AESCipher(encryptKey).decrypt(body.encrypt),
    ) as unknown;
    return isJsonObject(decrypted) ? decrypted : null;
  } catch {
    return null;
  }
}

function payloadToken(payload: JsonObject): unknown {
  if (payload.token !== undefined) return payload.token;
  return isJsonObject(payload.header) ? payload.header.token : undefined;
}

function textFromContent(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isJsonObject(parsed) || typeof parsed.text !== "string") return null;
    const text = parsed.text.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}

export async function parseFeishuEvent({
  rawBody,
  headers,
  env,
}: ParseFeishuEventInput): Promise<FeishuEventOutcome> {
  let body: JsonObject;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isJsonObject(parsed)) return { kind: "ignored" };
    body = parsed;
  } catch {
    return { kind: "ignored" };
  }

  const payload = decryptPayload(body, env.encryptKey);
  if (!payload) return { kind: "unauthorized" };

  if (payload.type === "url_verification") {
    if (!safeEqual(payloadToken(payload), env.verificationToken)) {
      return { kind: "unauthorized" };
    }
    return typeof payload.challenge === "string"
      ? { kind: "challenge", challenge: payload.challenge }
      : { kind: "ignored" };
  }

  if (
    !signatureMatches(rawBody, headers, env.encryptKey) ||
    !safeEqual(payloadToken(payload), env.verificationToken)
  ) {
    return { kind: "unauthorized" };
  }

  const dispatcher = new EventDispatcher({
    verificationToken: env.verificationToken,
    encryptKey: env.encryptKey,
    loggerLevel: LoggerLevel.error,
  }).register({
    "im.message.receive_v1": (event: ReceiveMessageEvent) => {
      const message = event.message;
      if (
        message?.chat_type !== "p2p" ||
        message.message_type !== "text" ||
        typeof message.message_id !== "string" ||
        typeof message.content !== "string"
      ) {
        return { kind: "ignored" } as const;
      }

      const text = textFromContent(message.content);
      return text
        ? ({ kind: "message", messageId: message.message_id, text } as const)
        : ({ kind: "ignored" } as const);
    },
  });
  const requestData = Object.assign(Object.create({ headers }), body);
  const outcome = (await dispatcher.invoke(requestData, {
    needCheck: false,
  })) as unknown;

  return isJsonObject(outcome) &&
    (outcome.kind === "message" || outcome.kind === "ignored")
    ? (outcome as FeishuEventOutcome)
    : { kind: "ignored" };
}
