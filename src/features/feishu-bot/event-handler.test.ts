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

function enteredBody(chatId?: string) {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_entered",
      event_type: "im.chat.access_event.bot_p2p_chat_entered_v1",
      create_time: "1784371200000",
      token: env.verificationToken,
      app_id: env.appId,
      tenant_key: "tenant_onecare",
    },
    event: {
      chat_id: chatId,
      operator_id: { open_id: "ou_onecare" },
      last_message_id: "om_previous",
      last_message_create_time: "1784371100000",
    },
  };
}

function groupLifecycleBody() {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_group_disbanded",
      event_type: "im.chat.disbanded_v1",
      create_time: "1784371200000",
      token: env.verificationToken,
      app_id: env.appId,
      tenant_key: "tenant_onecare",
    },
    event: {
      chat_id: "oc_group_chat",
      operator_id: { open_id: "ou_onecare" },
    },
  };
}

function cardActionBody(overrides?: {
  action?: string;
  caseId?: string;
  tag?: string;
  appId?: string;
  tenantKey?: string;
  token?: string;
  chatId?: string;
  messageId?: string;
  operatorId?: string;
}) {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_card_action",
      event_type: "card.action.trigger",
      create_time: "1784371200000",
      token: overrides?.token ?? env.verificationToken,
      app_id: overrides?.appId ?? env.appId,
      tenant_key: overrides?.tenantKey ?? "tenant_onecare",
    },
    event: {
      operator: { open_id: overrides?.operatorId ?? "ou_onecare" },
      token: "card-update-token",
      action: {
        tag: overrides?.tag ?? "button",
        value: {
          action: overrides?.action ?? "open_pending",
          case_id: overrides?.caseId ?? "OC-240718-037",
        },
      },
      context: {
        open_chat_id: overrides?.chatId ?? "oc_onecare_chat",
        open_message_id: overrides?.messageId ?? "om_onecare_card",
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

  it("accepts an authenticated bot p2p chat entry event", async () => {
    const rawBody = JSON.stringify(enteredBody("oc_onecare_chat"));

    await expect(
      parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "entered",
      chatId: "oc_onecare_chat",
    });
  });

  it("accepts an authenticated allowlisted Card 2.0 button action", async () => {
    const rawBody = JSON.stringify(cardActionBody());

    await expect(
      parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "card_action",
      action: "open_pending",
      chatId: "oc_onecare_chat",
      messageId: "om_onecare_card",
    });
  });

  it.each([
    ["unknown action", { action: "delete_case" }],
    ["wrong demo case", { caseId: "OC-other" }],
    ["non-button action", { tag: "select_static" }],
    ["missing chat id", { chatId: "" }],
    ["missing message id", { messageId: "" }],
    ["missing operator id", { operatorId: "" }],
  ])("rejects a verified card callback with %s", async (_label, overrides) => {
    const rawBody = JSON.stringify(cardActionBody(overrides));

    await expect(
      parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "invalid_card_action" });
  });

  it.each([
    ["wrong app id", { appId: "cli_other" }],
    ["missing tenant", { tenantKey: "" }],
    ["wrong token", { token: "wrong-token" }],
  ])("denies a card callback with %s", async (_label, overrides) => {
    const rawBody = JSON.stringify(cardActionBody(overrides));

    await expect(
      parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("denies a card callback with a bad request signature", async () => {
    const rawBody = JSON.stringify(cardActionBody());

    await expect(
      parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody, false), env }),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("ignores a chat entry event without a usable chat id", async () => {
    for (const chatId of [undefined, "", "   "]) {
      const rawBody = JSON.stringify(enteredBody(chatId));

      await expect(
        parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
      ).resolves.toEqual({ kind: "ignored" });
    }
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

  it("ignores authentic subscribed group lifecycle events", async () => {
    const rawBody = JSON.stringify(groupLifecycleBody());

    await expect(
      parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "ignored" });
  });

  it("ignores malformed request bodies", async () => {
    await expect(
      parseFeishuEvent({ rawBody: "not-json", headers: new Headers(), env }),
    ).resolves.toEqual({ kind: "ignored" });
  });
});
