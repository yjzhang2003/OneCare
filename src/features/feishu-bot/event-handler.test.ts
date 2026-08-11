import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { BotEnv } from "../../lib/env";
import { VOC_CARD_ACTIONS, VOC_NOTE_FIELD_NAME } from "./card-types";
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
  recordId?: string;
  tag?: string;
  appId?: string;
  tenantKey?: string;
  token?: string;
  chatId?: string;
  messageId?: string;
  operatorId?: string;
  formValue?: Record<string, unknown>;
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
          // Demo card buttons never send a record_id at all (see cards.ts),
          // so this key is only added when a test explicitly asks for one.
          ...(overrides?.recordId !== undefined
            ? { record_id: overrides.recordId }
            : {}),
        },
        // Card 2.0 returns form-container values here, keyed by each
        // component's `name`, and only for cards that actually contain a form
        // — hence the conditional spread rather than an always-present {}.
        ...(overrides?.formValue !== undefined
          ? { form_value: overrides.formValue }
          : {}),
      },
      context: {
        open_chat_id: overrides?.chatId ?? "oc_onecare_chat",
        open_message_id: overrides?.messageId ?? "om_onecare_card",
      },
    },
  };
}

function vocCardActionOutcome(overrides: {
  action?: string;
  recordId?: string;
  operatorId?: string;
  formValue?: Record<string, unknown>;
}) {
  const rawBody = JSON.stringify(
    cardActionBody({
      action: "voc_start_follow_up",
      recordId: "rec12345",
      operatorId: "ou_owner",
      ...overrides,
    }),
  );
  return parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env });
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
      // The demo cards address a fixed case number, not a real Bitable row,
      // so a demo action carries no record id or operator identity.
      recordId: "",
      operatorOpenId: "",
      // No demo card carries a form, so there is never a note to read.
      note: "",
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

  it("ignores authentic non-text events regardless of chat type", async () => {
    for (const body of [
      messageBody({ messageType: "image" }),
      messageBody({ chatType: "group", messageType: "image" }),
    ]) {
      const rawBody = JSON.stringify(body);

      await expect(
        parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
      ).resolves.toEqual({ kind: "ignored" });
    }
  });

  it("accepts an authenticated group text event as a group question", async () => {
    // A group message reaches im.message.receive_v1 at all only because this
    // app's event subscription fires on an @-mention in groups, not on every
    // message — so the mention placeholder text ("@_user_1 ") is expected to
    // still be here; stripMention (Task 8) removes it downstream, not this
    // parser.
    const rawBody = JSON.stringify(
      messageBody({ chatType: "group", text: "@_user_1 这条投诉以前出现过吗" }),
    );

    await expect(
      parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "group_question",
      chatId: "oc_onecare_chat",
      text: "@_user_1 这条投诉以前出现过吗",
    });
  });

  it.each([
    ["a missing chat id", undefined],
    ["a whitespace-only chat id", "   "],
  ])("ignores a group text event with %s", async (_label, chatId) => {
    const body = messageBody({ chatType: "group" });
    const rawBody = JSON.stringify({
      ...body,
      event: {
        ...body.event,
        message: { ...body.event.message, chat_id: chatId },
      },
    });

    await expect(
      parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "ignored" });
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

describe("parseFeishuEvent VOC card actions", () => {
  it("carries the record id and the operator open id", async () => {
    await expect(
      vocCardActionOutcome({
        action: "voc_start_follow_up",
        recordId: "rec12345",
        operatorId: "ou_owner",
      }),
    ).resolves.toEqual({
      kind: "card_action",
      action: "voc_start_follow_up",
      recordId: "rec12345",
      operatorOpenId: "ou_owner",
      note: "",
      chatId: "oc_onecare_chat",
      messageId: "om_onecare_card",
    });
  });

  it.each(VOC_CARD_ACTIONS)(
    "accepts the %s action given a valid record id and operator",
    async (action) => {
      await expect(
        vocCardActionOutcome({ action }),
      ).resolves.toMatchObject({ kind: "card_action", action });
    },
  );

  it.each([
    ["an empty record id", { recordId: "" }],
    [
      "a record id that is not a Bitable record id",
      { recordId: "OC-240718-037" },
    ],
    ["a missing or empty operator open id", { operatorId: "" }],
    // normalizeCardAction only checks truthiness, so a whitespace-only
    // open_id ("   ") sails past it; only our own trim-then-check in
    // readOperatorOpenId catches it.
    ["a whitespace-only operator open id", { operatorId: "   " }],
    ["an action outside the whitelist", { action: "drop_table" }],
  ])("rejects a VOC card action with %s", async (_label, overrides) => {
    await expect(vocCardActionOutcome(overrides)).resolves.toEqual({
      kind: "invalid_card_action",
    });
  });
});

// @larksuiteoapi/node-sdk 1.71.1's normalizeCardAction keeps only value/tag/
// name/option off the action — `form_value` appears nowhere in the package
// (grep of types/index.d.ts, lib/index.js, es/index.js: zero hits) — so this
// value has to be read off the raw payload. These tests lock that read, since
// the alternative failure mode is silent: every submission would look like the
// owner typed nothing.
describe("parseFeishuEvent VOC form values", () => {
  it("carries the note the owner typed in the card's form", async () => {
    await expect(
      vocCardActionOutcome({
        action: "voc_submit_follow_up",
        formValue: { [VOC_NOTE_FIELD_NAME]: "已联系用户，约定明天上门" },
      }),
    ).resolves.toMatchObject({
      kind: "card_action",
      action: "voc_submit_follow_up",
      note: "已联系用户，约定明天上门",
    });
  });

  it("keeps newlines inside a multi-line note", async () => {
    await expect(
      vocCardActionOutcome({
        action: "voc_confirm_closure",
        formValue: { [VOC_NOTE_FIELD_NAME]: "第一步：已上门\n第二步：已换件" },
      }),
    ).resolves.toMatchObject({ note: "第一步：已上门\n第二步：已换件" });
  });

  it.each([
    ["no form_value at all", undefined],
    ["an unrelated field only", { other_field: "x" }],
    ["an empty string", { [VOC_NOTE_FIELD_NAME]: "" }],
    ["whitespace only", { [VOC_NOTE_FIELD_NAME]: "  \n\t " }],
    ["a non-string value", { [VOC_NOTE_FIELD_NAME]: 42 }],
    ["a null value", { [VOC_NOTE_FIELD_NAME]: null }],
    ["an array value", { [VOC_NOTE_FIELD_NAME]: ["a"] }],
  ])("reports an empty note for %s", async (_label, formValue) => {
    await expect(
      vocCardActionOutcome({
        action: "voc_submit_follow_up",
        ...(formValue === undefined ? {} : { formValue }),
      }),
    ).resolves.toMatchObject({ kind: "card_action", note: "" });
  });

  it("reports an empty note when form_value is not an object", async () => {
    const rawBody = JSON.stringify(
      cardActionBody({
        action: "voc_submit_follow_up",
        recordId: "rec12345",
        operatorId: "ou_owner",
        formValue: "not-an-object" as never,
      }),
    );

    await expect(
      parseFeishuEvent({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toMatchObject({ kind: "card_action", note: "" });
  });

  it("trims a note that is padded with whitespace", async () => {
    await expect(
      vocCardActionOutcome({
        action: "voc_submit_follow_up",
        formValue: { [VOC_NOTE_FIELD_NAME]: "  已回访  " },
      }),
    ).resolves.toMatchObject({ note: "已回访" });
  });
});
