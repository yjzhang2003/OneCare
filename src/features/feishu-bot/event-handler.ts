import { createHash, timingSafeEqual } from "node:crypto";

import {
  AESCipher,
  EventDispatcher,
  LoggerLevel,
  normalizeCardAction,
} from "@larksuiteoapi/node-sdk";

import type { BotEnv } from "../../lib/env";
import {
  ONECARE_CARD_ACTIONS,
  ONECARE_CASE_ID,
  VOC_CARD_ACTIONS,
  VOC_NOTE_FIELD_NAME,
  type OneCareCardAction,
  type VocCardAction,
} from "./card-types";

export type FeishuEventOutcome =
  | Readonly<{ kind: "challenge"; challenge: string }>
  | Readonly<{
      kind: "message";
      messageId: string;
      text: string;
      // The sender's own open_id (event.sender.sender_id.open_id), trimmed.
      // Task 12's production reply has to know *whose* VOC workload to show,
      // and the only trustworthy source for that is the signed event payload
      // itself — exactly the same rule readOperatorOpenId already applies to
      // a card click's operator. A message Feishu sends with no sender at all
      // is not expected in practice, but this degrades to "" rather than
      // throwing; computeOperatorSummary then simply matches nobody's records
      // instead of crashing the reply.
      operatorOpenId: string;
    }>
  // A group message reaches the bot only via an @-mention (this app has no
  // "read every group message" grant), and the answer always goes back to
  // the group itself rather than as a threaded reply to one message — so
  // this outcome carries `chatId`, never `messageId`. Kept as its own kind
  // instead of a `p2p | group` flag on "message": the war room's fact-only
  // answering (Task 8) and the p2p operator summary reply (Task 12) read
  // their text for entirely different purposes, and a shared shape is
  // exactly the kind of same-name-two-meanings mixup that has bitten this
  // codebase before.
  | Readonly<{ kind: "group_question"; chatId: string; text: string }>
  | Readonly<{ kind: "entered"; chatId: string }>
  | Readonly<{
      kind: "card_action";
      action: OneCareCardAction | VocCardAction;
      recordId: string;
      operatorOpenId: string;
      // The text the owner typed into the card's form, already trimmed, or ""
      // when the action carries no form at all. Required — never optional —
      // because an optional note is precisely how 跟进记录/闭环结论 reached the
      // state machine as `undefined` from a route that compiled cleanly and
      // rejected every real click.
      note: string;
      chatId: string;
      messageId: string;
    }>
  | Readonly<{ kind: "invalid_card_action" }>
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "unauthorized" }>;

export type ParseFeishuEventInput = Readonly<{
  rawBody: string;
  headers: Headers;
  env: BotEnv;
  // Resolves to the bot's own open_id (GET bot/v3/info). Only ever awaited
  // for a group message — this app has the "获取群组中所有消息" grant, so
  // im.message.receive_v1 fires for every message in a group it belongs to,
  // not only ones that @ it, and this is the one thing that tells a message
  // actually addressed to the bot apart from ordinary group chatter.
  botOpenId: () => Promise<string>;
}>;

type JsonObject = Record<string, unknown>;

// The shape Feishu sends for each @-mention inside a message: `id.open_id`
// identifies who was mentioned, `key` is the placeholder token
// ("@_user_1", ...) that appears in the message's own text in that person's
// place. Only `id.open_id` is read here.
type MessageMention = {
  id?: { open_id?: string };
};

type ReceiveMessageEvent = {
  sender?: { sender_id?: { open_id?: string } };
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
    mentions?: readonly MessageMention[];
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

function authorizedEventHeader(payload: JsonObject, env: BotEnv): boolean {
  if (!isJsonObject(payload.header)) return false;

  const tenantKey = payload.header.tenant_key;
  return (
    safeEqual(payload.header.app_id, env.appId) &&
    typeof tenantKey === "string" &&
    tenantKey.trim().length > 0 &&
    typeof payload.header.event_id === "string" &&
    payload.header.event_id.trim().length > 0
  );
}

const RECORD_ID_PATTERN = /^rec[A-Za-z0-9]+$/;

function isOneCareCardAction(value: unknown): value is OneCareCardAction {
  return (
    typeof value === "string" &&
    (ONECARE_CARD_ACTIONS as readonly string[]).includes(value)
  );
}

function isVocCardAction(value: unknown): value is VocCardAction {
  return (
    typeof value === "string" &&
    (VOC_CARD_ACTIONS as readonly string[]).includes(value)
  );
}

// The operator identity is read from the signed event payload, never from the
// button's own value, so it cannot be forged by editing what the card sends
// back. Trimmed for the same reason authorizedEventHeader trims tenant_key:
// this value becomes the identity source for card-action authorization
// (Task 12), and a whitespace-only open_id must not pass as a real identity.
function readOperatorOpenId(payload: JsonObject): string {
  if (!isJsonObject(payload.event)) return "";
  const operator = payload.event.operator;
  if (!isJsonObject(operator)) return "";
  return typeof operator.open_id === "string" ? operator.open_id.trim() : "";
}

// Same rule as readOperatorOpenId above, applied to a plain message instead
// of a card click: Task 12's production reply for a p2p text message shows
// whoever sent it their own VOC workload, so this reads the sender identity
// off the typed event the dispatcher already handed the "message" branch
// rather than trusting anything the message content itself could claim.
function readMessageSenderOpenId(event: ReceiveMessageEvent): string {
  const openId = event.sender?.sender_id?.open_id;
  return typeof openId === "string" ? openId.trim() : "";
}

// Read straight off the raw payload, not off the normalized action, because
// @larksuiteoapi/node-sdk 1.71.1's normalizeCardAction whitelists exactly four
// action fields — value, tag, name, option — and neither `form_value` nor
// `input_value` appears anywhere in the package. Verified by grepping
// types/index.d.ts, lib/index.js and es/index.js for both names: zero hits.
// Its own `RawCardActionEvent` input type does not declare them either, so
// there is nothing to widen; the value only exists on the payload we already
// hold. This mirrors readOperatorOpenId, which reaches back into `payload` for
// the same reason.
//
// Feishu keys form data by each component's `name`
// (open.feishu.cn/document/feishu-cards/card-callback-communication:
// `"form_value": { "Input_lf4fmxwfrd9": "1234", ... }`). Trimmed here so what
// lands in the Base is what the owner meant to write, and so a whitespace-only
// submission arrives at the state machine's guard as the empty string it
// actually is rather than as text that passes a length check.
function readFormNote(payload: JsonObject): string {
  if (!isJsonObject(payload.event)) return "";
  const action = payload.event.action;
  if (!isJsonObject(action)) return "";
  const formValue = action.form_value;
  if (!isJsonObject(formValue)) return "";

  const value = formValue[VOC_NOTE_FIELD_NAME];
  return typeof value === "string" ? value.trim() : "";
}

function parseCardAction(payload: JsonObject): FeishuEventOutcome {
  if (!isJsonObject(payload.header) || !isJsonObject(payload.event)) {
    return { kind: "invalid_card_action" };
  }
  if (payload.header.event_type !== "card.action.trigger") {
    return { kind: "invalid_card_action" };
  }

  const normalized = normalizeCardAction(
    payload.event as Parameters<typeof normalizeCardAction>[0],
  );
  if (!normalized || normalized.action.tag !== "button") {
    return { kind: "invalid_card_action" };
  }
  if (!isJsonObject(normalized.action.value)) {
    return { kind: "invalid_card_action" };
  }

  const action = normalized.action.value.action;

  // The eight demo actions are gated by the fixed demo case number, exactly
  // as before card actions carried a real record id. This behaviour is
  // untouched: none of the demo cards send a record_id, so folding this
  // check into the record-id validation below would break every demo
  // button.
  if (isOneCareCardAction(action)) {
    const caseId = normalized.action.value.case_id;
    if (caseId !== ONECARE_CASE_ID) {
      return { kind: "invalid_card_action" };
    }

    return {
      kind: "card_action",
      action,
      recordId: "",
      operatorOpenId: "",
      // No demo card carries a form; a note would have nowhere to be written.
      note: "",
      chatId: normalized.chatId,
      messageId: normalized.messageId,
    };
  }

  // The four real VOC actions address an actual Bitable row instead of the
  // fixed demo case number, and require an operator identity taken from the
  // signed event payload.
  if (isVocCardAction(action)) {
    const recordId = normalized.action.value.record_id;
    const openId = readOperatorOpenId(payload);

    if (typeof recordId !== "string" || !RECORD_ID_PATTERN.test(recordId)) {
      return { kind: "invalid_card_action" };
    }
    if (openId.length === 0) {
      return { kind: "invalid_card_action" };
    }

    return {
      kind: "card_action",
      action,
      recordId,
      operatorOpenId: openId,
      note: readFormNote(payload),
      chatId: normalized.chatId,
      messageId: normalized.messageId,
    };
  }

  return { kind: "invalid_card_action" };
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

// The one thing standing between "answers a war room question" and "answers
// every line said in every group this bot is a member of" — this app holds
// the "获取群组中所有消息" grant, confirmed live on 2026-08-12, so
// im.message.receive_v1 fires for every group message regardless of whether
// the bot was addressed. `mentions` is empty for ordinary chatter and
// non-empty only when someone was @-ed; matching it against the bot's own
// open_id (not against placeholder text like "@_user_1", which any member
// can produce by @-ing anyone) is the only reliable signal.
//
// A failure to resolve the bot's own identity is treated the same as "not
// mentioned", never as "mentioned" — answering every message in every war
// room because bot/v3/info had one bad call would be far worse than missing
// a single legitimate question.
async function isBotMentioned(
  mentions: readonly MessageMention[] | undefined,
  botOpenId: () => Promise<string>,
): Promise<boolean> {
  if (!Array.isArray(mentions) || mentions.length === 0) return false;

  let selfOpenId: string;
  try {
    selfOpenId = await botOpenId();
  } catch {
    return false;
  }

  return mentions.some((mention) => mention.id?.open_id === selfOpenId);
}

export async function parseFeishuEvent({
  rawBody,
  headers,
  env,
  botOpenId,
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
    !safeEqual(payloadToken(payload), env.verificationToken) ||
    !authorizedEventHeader(payload, env)
  ) {
    return { kind: "unauthorized" };
  }

  if (
    isJsonObject(payload.header) &&
    payload.header.event_type === "card.action.trigger"
  ) {
    return parseCardAction(payload);
  }

  const dispatcher = new EventDispatcher({
    verificationToken: env.verificationToken,
    encryptKey: env.encryptKey,
    loggerLevel: LoggerLevel.fatal,
  }).register({
    "im.message.receive_v1": async (event: ReceiveMessageEvent) => {
      const message = event.message;
      if (
        message?.message_type !== "text" ||
        typeof message.message_id !== "string" ||
        typeof message.content !== "string"
      ) {
        return { kind: "ignored" } as const;
      }

      const text = textFromContent(message.content);
      if (!text) return { kind: "ignored" } as const;

      if (message.chat_type === "p2p") {
        return {
          kind: "message",
          messageId: message.message_id,
          text,
          operatorOpenId: readMessageSenderOpenId(event),
        } as const;
      }

      if (message.chat_type === "group" && typeof message.chat_id === "string") {
        const chatId = message.chat_id.trim();
        // Both conditions are cheap-to-expensive ordered: a blank chat id
        // (never observed in practice, but not Feishu's contract to keep)
        // short-circuits before ever awaiting the bot's own identity.
        if (chatId && (await isBotMentioned(message.mentions, botOpenId))) {
          return { kind: "group_question", chatId, text } as const;
        }
      }

      return { kind: "ignored" } as const;
    },
    // Fires every time a user opens this p2p chat with the bot — Feishu has
    // no "first ever entry" variant of this event — so treating it as a
    // trigger to send anything at all is exactly what caused the welcome
    // card to resend on every visit. The fix here is deliberately not an
    // in-memory dedup cache keyed by chat id: a Vercel function instance
    // recycles independently of any chat's own history, so "have I already
    // greeted this chat" tracked in memory is not the reliable guard it
    // looks like — it only changes the resend interval to match the
    // instance's recycle cadence, which is exactly the "every few dozen
    // minutes" behaviour reported in production. Zero state means never
    // responding to this event at all, full stop.
    "im.chat.access_event.bot_p2p_chat_entered_v1": () => {
      return { kind: "ignored" } as const;
    },
  });
  const requestData = Object.assign(Object.create({ headers }), body);
  const outcome = (await dispatcher.invoke(requestData, {
    needCheck: false,
  })) as unknown;

  return isJsonObject(outcome) &&
    (outcome.kind === "message" ||
      outcome.kind === "group_question" ||
      outcome.kind === "entered" ||
      outcome.kind === "ignored")
    ? (outcome as FeishuEventOutcome)
    : { kind: "ignored" };
}
