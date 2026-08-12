import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { BotEnv } from "../../lib/env";
import { VOC_CARD_ACTIONS, VOC_NOTE_FIELD_NAME } from "./card-types";
import { parseFeishuEvent, type ParseFeishuEventInput } from "./event-handler";

const env: BotEnv = {
  appId: "cli_onecare",
  appSecret: "server-only-secret",
  verificationToken: "verification-token",
  encryptKey: "12345678901234567890123456789012",
};

// The bot's own open_id, as bot/v3/info would report it. Fixed for the whole
// file so a test only ever has to vary the *event's* mentions, never this.
const BOT_OPEN_ID = "ou_bot_self";

// Every existing call site defaults to "the bot successfully confirms its
// own identity as BOT_OPEN_ID" — the tests that care about mention-gating
// vary `mentions` on the event body instead of this, and only the identity-
// lookup-failure test overrides `botOpenId` itself.
function parse(
  input: Omit<ParseFeishuEventInput, "botOpenId">,
  botOpenId: () => Promise<string> = async () => BOT_OPEN_ID,
) {
  return parseFeishuEvent({ ...input, botOpenId });
}

function botMention() {
  return {
    key: "@_user_1",
    id: { open_id: BOT_OPEN_ID, union_id: "on_bot", user_id: "bot" },
    name: "OneCare",
    tenant_key: "tenant_onecare",
  };
}

function otherMention() {
  return {
    key: "@_user_1",
    id: { open_id: "ou_someone_else", union_id: "on_someone", user_id: "someone" },
    name: "张三",
    tenant_key: "tenant_onecare",
  };
}

function messageBody(overrides?: {
  chatType?: "p2p" | "group";
  messageType?: string;
  text?: string;
  token?: string;
  // Only meaningful for chatType "group" — the p2p path never reads mentions
  // at all. Defaults to "the bot itself is mentioned" so every existing group
  // test (written before mention-gating existed) keeps exercising "a
  // legitimate group question" unless a test deliberately asks otherwise.
  mentions?: readonly unknown[];
  // Task 12: the p2p operator summary reply needs to know who sent the
  // message. Defaults to the same fixed sender every other test in this file
  // already assumes, so only the tests that care about identity threading
  // need to override it.
  senderOpenId?: string;
  // Omits event.sender entirely rather than setting senderOpenId to a falsy
  // value — a real Feishu payload without a sender is a different shape than
  // one with an empty open_id, and the "degrades to an empty operator id"
  // guarantee has to hold for the former, not just the latter.
  omitSender?: boolean;
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
      ...(overrides?.omitSender
        ? {}
        : {
            sender: {
              sender_id: { open_id: overrides?.senderOpenId ?? "ou_onecare" },
              sender_type: "user",
              tenant_key: "tenant_onecare",
            },
          }),
      message: {
        message_id: "om_onecare_message",
        chat_id: "oc_onecare_chat",
        chat_type: overrides?.chatType ?? "p2p",
        message_type: overrides?.messageType ?? "text",
        content: JSON.stringify({ text: overrides?.text ?? "开始体验" }),
        ...(overrides?.chatType === "group"
          ? { mentions: overrides?.mentions ?? [botMention()] }
          : {}),
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

// Shaped exactly like Feishu's own schema 2.0 example body for
// application.bot.menu_v6: the clicking operator's identity nests at
// event.operator.operator_id.open_id — one level deeper than a card
// callback's event.operator.open_id (cardActionBody below).
function menuClickBody(overrides?: {
  eventKey?: string;
  operatorOpenId?: string;
  // Omits event.operator.operator_id entirely — a shape Feishu's own docs
  // never actually produce, but readMenuOperatorOpenId still has to degrade
  // to "" rather than throw if it ever did.
  omitOperatorId?: boolean;
  // Omits event.operator entirely.
  omitOperator?: boolean;
  // The shallow, card-callback-shaped field (event.operator.open_id) a
  // maintainer could mistakenly reach for instead of the real nested path.
  // Present only when a test deliberately asks for it, to prove
  // readMenuOperatorOpenId never reads it.
  shallowOperatorOpenId?: string;
  token?: string;
  appId?: string;
  tenantKey?: string;
}) {
  const operator: Record<string, unknown> = { operator_name: "张三" };
  if (!overrides?.omitOperatorId) {
    operator.operator_id = {
      union_id: "on_operator",
      user_id: "u_operator",
      open_id: overrides?.operatorOpenId ?? "ou_operator",
    };
  }
  if (overrides?.shallowOperatorOpenId !== undefined) {
    operator.open_id = overrides.shallowOperatorOpenId;
  }

  return {
    schema: "2.0",
    header: {
      event_id: "evt_menu_click",
      event_type: "application.bot.menu_v6",
      create_time: "1784371200000",
      token: overrides?.token ?? env.verificationToken,
      app_id: overrides?.appId ?? env.appId,
      tenant_key: overrides?.tenantKey ?? "tenant_onecare",
    },
    event: {
      ...(overrides?.omitOperator ? {} : { operator }),
      event_key: overrides?.eventKey ?? "voc_my_tickets",
      timestamp: "1784371200000",
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
  return parse({ rawBody, headers: signedHeaders(rawBody), env });
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
      parse({ rawBody, headers: new Headers(), env }),
    ).resolves.toEqual({ kind: "challenge", challenge: "challenge-value" });
  });

  it("rejects a challenge with the wrong verification token", async () => {
    const rawBody = JSON.stringify({
      type: "url_verification",
      token: "wrong-token",
      challenge: "must-not-return",
    });

    await expect(
      parse({ rawBody, headers: new Headers(), env }),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("accepts an authenticated p2p text event, carrying the sender's own open id", async () => {
    const rawBody = JSON.stringify(messageBody({ text: "转人工" }));

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "message",
      messageId: "om_onecare_message",
      text: "转人工",
      operatorOpenId: "ou_onecare",
    });
  });

  it("trims a whitespace-padded sender open id on a p2p text event", async () => {
    const rawBody = JSON.stringify(
      messageBody({ text: "转人工", senderOpenId: "  ou_padded  " }),
    );

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toMatchObject({ operatorOpenId: "ou_padded" });
  });

  it("degrades to an empty operator id, rather than throwing, when a p2p message carries no sender at all", async () => {
    const rawBody = JSON.stringify(
      messageBody({ text: "转人工", omitSender: true }),
    );

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toMatchObject({ kind: "message", operatorOpenId: "" });
  });

  // Task 12: Feishu has no "first ever entry" flavour of this event — it
  // fires on every visit to the p2p chat — so responding to it at all is
  // what caused the welcome card to resend on every reopen. The fix lives
  // here, in the parser itself, rather than in a dedup cache: every entry
  // event, real chat id or not, now comes back exactly like an event this
  // app was never asked to handle.
  it("ignores an authenticated bot p2p chat entry event, even one naming a real chat", async () => {
    const rawBody = JSON.stringify(enteredBody("oc_onecare_chat"));

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "ignored" });
  });

  it("accepts an authenticated allowlisted Card 2.0 button action", async () => {
    const rawBody = JSON.stringify(cardActionBody());

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
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
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "invalid_card_action" });
  });

  it.each([
    ["wrong app id", { appId: "cli_other" }],
    ["missing tenant", { tenantKey: "" }],
    ["wrong token", { token: "wrong-token" }],
  ])("denies a card callback with %s", async (_label, overrides) => {
    const rawBody = JSON.stringify(cardActionBody(overrides));

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("denies a card callback with a bad request signature", async () => {
    const rawBody = JSON.stringify(cardActionBody());

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody, false), env }),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("also ignores a chat entry event with no usable chat id at all", async () => {
    for (const chatId of [undefined, "", "   "]) {
      const rawBody = JSON.stringify(enteredBody(chatId));

      await expect(
        parse({ rawBody, headers: signedHeaders(rawBody), env }),
      ).resolves.toEqual({ kind: "ignored" });
    }
  });

  it("rejects an event with an invalid signature or token", async () => {
    const validBody = JSON.stringify(messageBody());
    const wrongTokenBody = JSON.stringify(
      messageBody({ token: "wrong-token" }),
    );

    await expect(
      parse({
        rawBody: validBody,
        headers: signedHeaders(validBody, false),
        env,
      }),
    ).resolves.toEqual({ kind: "unauthorized" });
    await expect(
      parse({
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
        parse({ rawBody, headers: signedHeaders(rawBody), env }),
      ).resolves.toEqual({ kind: "ignored" });
    }
  });

  it("accepts a group text event that actually mentions the bot as a group question", async () => {
    // This app has the "获取群组中所有消息" grant, so im.message.receive_v1
    // fires for every group message, not only ones that @ the bot — the
    // mention check below (not the event subscription) is what keeps this
    // route from answering every line of group chatter. The mention
    // placeholder text ("@_user_1 ") is expected to still be here regardless;
    // stripMention (Task 8) removes it downstream, not this parser.
    const rawBody = JSON.stringify(
      messageBody({
        chatType: "group",
        text: "@_user_1 这条投诉以前出现过吗",
        mentions: [botMention()],
      }),
    );

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "group_question",
      chatId: "oc_onecare_chat",
      text: "@_user_1 这条投诉以前出现过吗",
    });
  });

  // The load-bearing regression net for the mention-gating fix: this app can
  // see every group message (see the grant note above), so a message that
  // does not actually address the bot must come back "ignored" — not
  // "group_question" — or the bot answers every line said in every war room.
  it("ignores a group message that mentions someone else, not the bot", async () => {
    const rawBody = JSON.stringify(
      messageBody({
        chatType: "group",
        text: "@_user_1 这个你处理一下",
        mentions: [otherMention()],
      }),
    );

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "ignored" });
  });

  it("ignores an ordinary group message with no mentions at all", async () => {
    const rawBody = JSON.stringify(
      messageBody({ chatType: "group", text: "今天天气不错", mentions: [] }),
    );

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "ignored" });
  });

  it("ignores a group message mentioning the bot among several people", async () => {
    // mentions can carry more than one entry; the bot's open_id only has to
    // be one of them, in any position.
    const rawBody = JSON.stringify(
      messageBody({
        chatType: "group",
        text: "@_user_1 @_user_2 同维度还有几条",
        mentions: [otherMention(), botMention()],
      }),
    );

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toMatchObject({ kind: "group_question" });
  });

  it("ignores a group message when confirming the bot's own identity fails", async () => {
    // bot/v3/info can fail (network blip, token exchange failure). Rather
    // than guess, a failure to resolve the bot's own open_id must be treated
    // exactly like "not mentioned" — the alternative is answering every
    // message in every war room the one time that lookup has a bad day.
    const rawBody = JSON.stringify(
      messageBody({
        chatType: "group",
        text: "@_user_1 同维度还有几条",
        mentions: [botMention()],
      }),
    );

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }, async () => {
        throw new Error("bot/v3/info unreachable");
      }),
    ).resolves.toEqual({ kind: "ignored" });
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
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "ignored" });
  });

  it("ignores authentic subscribed group lifecycle events", async () => {
    const rawBody = JSON.stringify(groupLifecycleBody());

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "ignored" });
  });

  it("ignores malformed request bodies", async () => {
    await expect(
      parse({ rawBody: "not-json", headers: new Headers(), env }),
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
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
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

// Task 13: the bot's custom menu (我的工单 / 今日概览 / 打开工作台) fires
// application.bot.menu_v6 for its two server-side items — "打开工作台" is a
// link-type item configured entirely in the Feishu console and never reaches
// this server at all. The operator identity for this event type nests one
// level deeper than a card callback's own event.operator.open_id
// (readOperatorOpenId, exercised by the VOC card action tests above): Feishu's
// own schema 2.0 example carries it at event.operator.operator_id.open_id.
// Getting that extra nesting wrong does not throw — it silently resolves to
// "", exactly like a genuinely missing operator — so this suite tests that
// path in isolation, with the exact nested shape Feishu's docs show.
describe("parseFeishuEvent menu clicks", () => {
  it("accepts voc_my_tickets, reading the operator's open id from the nested operator_id.open_id path", async () => {
    const rawBody = JSON.stringify(
      menuClickBody({ eventKey: "voc_my_tickets", operatorOpenId: "ou_operator" }),
    );

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "menu_click",
      eventKey: "voc_my_tickets",
      operatorOpenId: "ou_operator",
    });
  });

  it("accepts voc_today_overview the same way", async () => {
    const rawBody = JSON.stringify(
      menuClickBody({ eventKey: "voc_today_overview", operatorOpenId: "ou_operator" }),
    );

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "menu_click",
      eventKey: "voc_today_overview",
      operatorOpenId: "ou_operator",
    });
  });

  // The bot's custom menu can grow new items from the Feishu console alone,
  // with no deploy here — an event_key this file does not yet define must be
  // silently harmless to the *user*: never an error and never a card built
  // from a key nothing here recognises.
  it("ignores an event_key the menu does not yet define, with zero crash", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rawBody = JSON.stringify(menuClickBody({ eventKey: "voc_future_item" }));

      await expect(
        parse({ rawBody, headers: signedHeaders(rawBody), env }),
      ).resolves.toEqual({ kind: "ignored" });
    } finally {
      errorSpy.mockRestore();
    }
  });

  // Task 14: "silently harmless to the user" must not mean "silent,
  // full stop" — a user reported "今日概览" doing nothing, and the second
  // suspected cause (alongside the ~10.7s full-table read Task 14 also
  // fixes) was that the event_key configured on the Feishu console side
  // might not actually be "voc_today_overview". Before this task there was
  // no way to tell, from Vercel's own logs, what event_key had actually
  // arrived — an unrecognised key vanished with no trace anywhere. This
  // locks that a server-side console.error line now carries the exact
  // event_key received, while the outcome the caller sees is unchanged.
  it("logs the unrecognised event_key to the server console, even though the outcome is still 'ignored'", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rawBody = JSON.stringify(
        menuClickBody({ eventKey: "voc_mystery_item" }),
      );

      await parse({ rawBody, headers: signedHeaders(rawBody), env });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      // console.error(...) is called with the fixed prefix as one argument
      // and the received event_key as another (the same "label, then data"
      // shape this codebase already uses, e.g. dashboard/route.ts's "VOC
      // Bitable read failed:" logging) — checking the whole argument list
      // is what actually proves the key itself was logged, not just some
      // fixed string.
      expect(errorSpy.mock.calls[0]).toContain("voc_mystery_item");
    } finally {
      errorSpy.mockRestore();
    }
  });

  // The flip side of the test above: a recognised event_key is the expected,
  // routine case and must never spam the server log.
  it("logs nothing at all for a recognised event_key", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rawBody = JSON.stringify(menuClickBody({ eventKey: "voc_today_overview" }));

      await parse({ rawBody, headers: signedHeaders(rawBody), env });

      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  // Never sends anything back to the user for an unrecognised key — the log
  // above is a server-side diagnostic only, not a behaviour change to what
  // the menu click's own outcome is or what route.ts does with it.
  it("still sends nothing to the user for an unrecognised event_key beyond the logged line", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rawBody = JSON.stringify(menuClickBody({ eventKey: "voc_mystery_item" }));

      const outcome = await parse({ rawBody, headers: signedHeaders(rawBody), env });

      expect(outcome).toEqual({ kind: "ignored" });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("trims a whitespace-padded nested operator open id", async () => {
    const rawBody = JSON.stringify(menuClickBody({ operatorOpenId: "  ou_padded  " }));

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toMatchObject({ operatorOpenId: "ou_padded" });
  });

  it("degrades to an empty operator id, without crashing, when operator_id is missing entirely", async () => {
    const rawBody = JSON.stringify(menuClickBody({ omitOperatorId: true }));

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "menu_click",
      eventKey: "voc_my_tickets",
      operatorOpenId: "",
    });
  });

  it("degrades to an empty operator id, without crashing, when operator is missing entirely", async () => {
    const rawBody = JSON.stringify(menuClickBody({ omitOperator: true }));

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "menu_click",
      eventKey: "voc_my_tickets",
      operatorOpenId: "",
    });
  });

  // The load-bearing regression test the task calls for: a card callback's
  // operator identity sits at event.operator.open_id — one level shallower
  // than this event's own event.operator.operator_id.open_id. Getting the
  // nesting wrong does not error, it just silently resolves to whatever sits
  // at the wrong path (here, someone else's plausible-looking open_id) — so
  // this proves the shallow path is never consulted, even when it is present.
  it("never reads the shallow event.operator.open_id path a card callback would use", async () => {
    const rawBody = JSON.stringify(
      menuClickBody({
        omitOperatorId: true,
        shallowOperatorOpenId: "ou_wrong_shallow_path",
      }),
    );

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({
      kind: "menu_click",
      eventKey: "voc_my_tickets",
      operatorOpenId: "",
    });
  });

  it("denies a menu click with the wrong app id", async () => {
    const rawBody = JSON.stringify(menuClickBody({ appId: "cli_other" }));

    await expect(
      parse({ rawBody, headers: signedHeaders(rawBody), env }),
    ).resolves.toEqual({ kind: "unauthorized" });
  });
});
