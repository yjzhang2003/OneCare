import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { BotEnv } from "../../lib/env";
import { parseFeishuEvent } from "./event-handler";

const env: BotEnv = {
  appId: "cli_onecare",
  appSecret: "server-only-secret",
  verificationToken: "verification-token",
  encryptKey: "12345678901234567890123456789012",
};

function messageBody(overrides?: {
  chatType?: "p2p" | "group";
  messageType?: string;
  text?: string;
  token?: string;
}) {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_onecare",
      event_type: "im.message.receive_v1",
      create_time: "1784371200000",
      token: overrides?.token ?? env.verificationToken,
      app_id: env.appId,
      tenant_key: "tenant_onecare",
    },
    event: {
      sender: {
        sender_id: { open_id: "ou_onecare" },
        sender_type: "user",
        tenant_key: "tenant_onecare",
      },
      message: {
        message_id: "om_onecare_message",
        chat_id: "oc_onecare_chat",
        chat_type: overrides?.chatType ?? "p2p",
        message_type: overrides?.messageType ?? "text",
        content: JSON.stringify({ text: overrides?.text ?? "开始体验" }),
      },
    },
  };
}

function signedHeaders(rawBody: string, valid = true): Headers {
  const timestamp = "1784371200";
  const nonce = "onecare-nonce";
  const signature = createHash("sha256")
    .update(`${timestamp}${nonce}${env.encryptKey}${rawBody}`)
    .digest("hex");

  return new Headers({
    "x-lark-request-timestamp": timestamp,
    "x-lark-request-nonce": nonce,
    "x-lark-signature": valid ? signature : "0".repeat(64),
  });
}

describe("parseFeishuEvent", () => {
  it("returns an authenticated URL verification challenge", async () => {
    const rawBody = JSON.stringify({
      type: "url_verification",
      token: env.verificationToken,
      challenge: "challenge-value",
    });

    await expect(
      parseFeishuEvent({ rawBody, headers: new Headers(), env }),
    ).resolves.toEqual({ kind: "challenge", challenge: "challenge-value" });
  });

  it("rejects a challenge with the wrong verification token", async () => {
    const rawBody = JSON.stringify({
      type: "url_verification",
      token: "wrong-token",
      challenge: "must-not-return",
    });

    await expect(
      parseFeishuEvent({ rawBody, headers: new Headers(), env }),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("accepts an authenticated p2p text event", async () => {
    const rawBody = JSON.stringify(messageBody({ text: "转人工" }));

    await expect(
      parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "message",
      messageId: "om_onecare_message",
      text: "转人工",
    });
  });

  it("rejects an event with an invalid signature or token", async () => {
    const validBody = JSON.stringify(messageBody());
    const wrongTokenBody = JSON.stringify(
      messageBody({ token: "wrong-token" }),
    );

    await expect(
      parseFeishuEvent({
        rawBody: validBody,
        headers: signedHeaders(validBody, false),
        env,
      }),
    ).resolves.toEqual({ kind: "unauthorized" });
    await expect(
      parseFeishuEvent({
        rawBody: wrongTokenBody,
        headers: signedHeaders(wrongTokenBody),
        env,
      }),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("ignores authentic group and non-text events", async () => {
    for (const body of [
      messageBody({ chatType: "group" }),
      messageBody({ messageType: "image" }),
    ]) {
      const rawBody = JSON.stringify(body);

      await expect(
        parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
      ).resolves.toEqual({ kind: "ignored" });
    }
  });

  it("ignores malformed request bodies", async () => {
    await expect(
      parseFeishuEvent({ rawBody: "not-json", headers: new Headers(), env }),
    ).resolves.toEqual({ kind: "ignored" });
  });
});
