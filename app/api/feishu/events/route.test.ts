import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { BotEnv } from "../../../../src/lib/env";
import type { CountFilterCondition } from "../../../../src/features/bitable/client";
import type { VocRecord } from "../../../../src/features/bitable/field-map";
import {
  parseFeishuEvent,
  type FeishuEventOutcome,
} from "../../../../src/features/feishu-bot/event-handler";
import type {
  CardActionResult,
  VocActionBitable,
} from "../../../../src/features/feishu-bot/card-actions";
import {
  ONECARE_CARD_ACTIONS,
  ONECARE_CASE_ID,
  VOC_NOTE_FIELD_NAME,
  type FeishuOutboundMessage,
  type OneCareCardAction,
  type VocCardAction,
} from "../../../../src/features/feishu-bot/card-types";
import {
  createAnswerGroupQuestion,
  createFeishuEventRoute,
  createOperationsReply,
  createResolveAction,
  createTodayOverviewReply,
  type WarRoomActionDependencies,
} from "./route";

const env: BotEnv = {
  appId: "cli_onecare",
  appSecret: "server-only-secret",
  verificationToken: "verification-token",
  encryptKey: "12345678901234567890123456789012",
};

function request() {
  return new Request("https://onecare.example/api/feishu/events", {
    method: "POST",
    body: JSON.stringify({ schema: "2.0" }),
    headers: { "content-type": "application/json" },
  });
}

function dependencies(outcome: FeishuEventOutcome) {
  const scheduled: Array<() => Promise<void>> = [];
  return {
    scheduled,
    dependencies: {
      readEnv: vi.fn(() => env),
      parseEvent: vi.fn(async () => outcome),
      operationsReply: vi.fn(async (_operatorOpenId: string) => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ schema: "2.0", card: "operations" }),
      })),
      todayOverviewReply: vi.fn(async () => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ schema: "2.0", card: "today-overview" }),
      })),
      createMenuHint: vi.fn(() => ({
        msgType: "text" as const,
        content: JSON.stringify({ text: "请使用菜单查看数据" }),
      })),
      createWelcome: vi.fn(() => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ welcome: true }),
      })),
      replyMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
      // Explicitly typed (not a zero-arg `async () => undefined`) so
      // `.mock.calls[0]` in the menu-click tests below is a real one-element
      // tuple — the same trap this file's other live-dependency fakes already
      // guard against.
      sendDirectMessage: vi.fn(
        async (_input: {
          env: BotEnv;
          openId: string;
          message: FeishuOutboundMessage;
        }) => undefined,
      ),
      resolveAction: vi.fn(
        async (_input: {
          action: OneCareCardAction | VocCardAction;
          recordId: string;
          operatorOpenId: string;
          note: string;
        }): Promise<CardActionResult> => ({
          kind: "navigate" as const,
          message: {
            msgType: "interactive" as const,
            content: JSON.stringify({ schema: "2.0", view: "pending" }),
          },
          toast: "已打开待确认服务",
        }),
      ),
      answerGroupQuestion: vi.fn(
        async (_input: { chatId: string; text: string }) => ({
          msgType: "text" as const,
          content: JSON.stringify({ text: "这条投诉本周同维度还有 12 条。" }),
        }),
      ),
      schedule: vi.fn((task: () => Promise<void>) => scheduled.push(task)),
      reportFailure: vi.fn(),
    },
  };
}

describe("POST /api/feishu/events", () => {
  it("returns a URL verification challenge without scheduling work", async () => {
    const setup = dependencies({
      kind: "challenge",
      challenge: "challenge-value",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "challenge-value",
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callbacks without scheduling work", async () => {
    const setup = dependencies({ kind: "unauthorized" });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
  });

  it("acknowledges ignored authentic events", async () => {
    const setup = dependencies({ kind: "ignored" });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
  });

  // Task 13: a bare p2p text message no longer builds the operator's real
  // card — that only happens now for a "我的工单" menu click (see the "menu
  // clicks" describe block below). Any text at all gets the same short menu
  // hint instead, which is exactly the fix for "typing anything reopens an
  // unsolicited card".
  it("acknowledges a message before the scheduled menu hint reply runs", async () => {
    const setup = dependencies({
      kind: "message",
      messageId: "om_message",
      text: "随便问点什么",
      operatorOpenId: "ou_onecare",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    expect(setup.dependencies.replyMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.operationsReply).not.toHaveBeenCalled();
    expect(setup.dependencies.todayOverviewReply).not.toHaveBeenCalled();
    expect(setup.dependencies.createMenuHint).toHaveBeenCalledWith();
    expect(setup.dependencies.replyMessage).toHaveBeenCalledWith({
      env,
      messageId: "om_message",
      message: {
        msgType: "text",
        content: JSON.stringify({ text: "请使用菜单查看数据" }),
      },
    });
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    expect(setup.dependencies.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("acknowledges a chat entry before the welcome card is sent", async () => {
    const setup = dependencies({
      kind: "entered",
      chatId: "oc_onecare_chat",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.createWelcome).toHaveBeenCalledWith();
    expect(setup.dependencies.sendMessage).toHaveBeenCalledWith({
      env,
      chatId: "oc_onecare_chat",
      message: {
        msgType: "interactive",
        content: JSON.stringify({ welcome: true }),
      },
    });
    expect(setup.dependencies.replyMessage).not.toHaveBeenCalled();
  });

  it("reports scheduled reply failures without leaking the exception", async () => {
    const setup = dependencies({
      kind: "message",
      messageId: "om_message",
      text: "开始体验",
      operatorOpenId: "ou_onecare",
    });
    setup.dependencies.replyMessage.mockRejectedValueOnce(
      new Error("private upstream response"),
    );

    await createFeishuEventRoute(setup.dependencies)(request());
    await setup.scheduled[0]();

    expect(setup.dependencies.reportFailure).toHaveBeenCalledWith();
  });

  // Task 13: createMenuHint is synchronous (it touches no I/O at all), but
  // the scheduled task's own try/catch has to guard a synchronous throw from
  // it exactly as it would an async rejection — a hint that fails to build
  // must report the same way a replyMessage failure does, never leak
  // upstream.
  it("reports failure without leaking the exception when building the menu hint itself fails", async () => {
    const setup = dependencies({
      kind: "message",
      messageId: "om_message",
      text: "随便问点什么",
      operatorOpenId: "ou_onecare",
    });
    setup.dependencies.createMenuHint.mockImplementationOnce(() => {
      throw new Error("private upstream response");
    });

    await createFeishuEventRoute(setup.dependencies)(request());
    await setup.scheduled[0]();

    expect(setup.dependencies.reportFailure).toHaveBeenCalledWith();
    expect(setup.dependencies.replyMessage).not.toHaveBeenCalled();
  });

  it("reports scheduled welcome failures without leaking the exception", async () => {
    const setup = dependencies({
      kind: "entered",
      chatId: "oc_onecare_chat",
    });
    setup.dependencies.sendMessage.mockRejectedValueOnce(
      new Error("private upstream response"),
    );

    await createFeishuEventRoute(setup.dependencies)(request());
    await setup.scheduled[0]();

    expect(setup.dependencies.reportFailure).toHaveBeenCalledWith();
  });

  it("acknowledges a navigation button before sending the next card", async () => {
    const setup = dependencies({
      kind: "card_action",
      action: "open_pending",
      recordId: "",
      operatorOpenId: "",
      note: "",
      chatId: "oc_onecare_chat",
      messageId: "om_onecare_card",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toast: { type: "info", content: "已打开待确认服务" },
    });
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.resolveAction).toHaveBeenCalledWith({
      action: "open_pending",
      recordId: "",
      operatorOpenId: "",
      note: "",
    });
    expect(setup.dependencies.sendMessage).toHaveBeenCalledWith({
      env,
      chatId: "oc_onecare_chat",
      message: {
        msgType: "interactive",
        content: JSON.stringify({ schema: "2.0", view: "pending" }),
      },
    });
  });

  it("updates the clicked card synchronously for state actions", async () => {
    const setup = dependencies({
      kind: "card_action",
      action: "create_ticket",
      recordId: "",
      operatorOpenId: "",
      note: "",
      chatId: "oc_onecare_chat",
      messageId: "om_onecare_card",
    });
    setup.dependencies.resolveAction.mockResolvedValueOnce({
      kind: "update",
      response: {
        toast: { type: "success", content: "操作已记录（演示）" },
        card: {
          type: "raw",
          data: { schema: "2.0", completed: true },
        },
      },
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toast: { type: "success", content: "操作已记录（演示）" },
      card: {
        type: "raw",
        data: { schema: "2.0", completed: true },
      },
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });

  it("returns a neutral toast for a verified unsupported button", async () => {
    const setup = dependencies({ kind: "invalid_card_action" });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toast: { type: "info", content: "暂不支持该操作" },
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });

  it("dispatches a VOC card action through resolveAction with its record id and operator", async () => {
    const setup = dependencies({
      kind: "card_action",
      action: "voc_start_follow_up",
      recordId: "rec12345",
      operatorOpenId: "ou_owner",
      note: "",
      chatId: "oc_onecare_chat",
      messageId: "om_onecare_card",
    });
    setup.dependencies.resolveAction.mockResolvedValueOnce({
      kind: "update",
      response: { toast: { type: "success", content: "已更新为跟进中" } },
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toast: { type: "success", content: "已更新为跟进中" },
    });
    expect(setup.dependencies.resolveAction).toHaveBeenCalledWith({
      action: "voc_start_follow_up",
      recordId: "rec12345",
      operatorOpenId: "ou_owner",
      note: "",
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });

  it("returns a safe toast when a VOC action's authorization or write fails unexpectedly", async () => {
    const setup = dependencies({
      kind: "card_action",
      action: "voc_start_follow_up",
      recordId: "rec12345",
      operatorOpenId: "ou_owner",
      note: "",
      chatId: "oc_onecare_chat",
      messageId: "om_onecare_card",
    });
    setup.dependencies.resolveAction.mockImplementationOnce(() => {
      throw new Error("private bitable failure details");
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toast: { type: "error", content: "操作未完成，请稍后重试" },
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });

  it("returns a safe toast when card construction fails", async () => {
    const setup = dependencies({
      kind: "card_action",
      action: "open_pending",
      recordId: "",
      operatorOpenId: "",
      note: "",
      chatId: "oc_onecare_chat",
      messageId: "om_onecare_card",
    });
    setup.dependencies.resolveAction.mockImplementationOnce(() => {
      throw new Error("private card construction details");
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toast: { type: "error", content: "操作未完成，请稍后重试" },
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Task 13: the bot's custom menu (application.bot.menu_v6, dispatched by
// event.event_key). "打开工作台" is a link-type menu item configured entirely
// on the Feishu side — it never produces an event here — so only the two
// server-side items are exercised: "我的工单" (reuses the existing operator
// card) and "今日概览" (the new global card). These tests drive
// createFeishuEventRoute over a mocked `menu_click` outcome, the same way the
// block above drives every other outcome kind; the real parseFeishuEvent
// parsing of application.bot.menu_v6 — including the operator_id.open_id
// nesting — is covered end to end further below and directly in
// event-handler.test.ts.
// ---------------------------------------------------------------------------

describe("POST /api/feishu/events — menu clicks", () => {
  it("replies to voc_my_tickets by DM with the existing personal operator card", async () => {
    const setup = dependencies({
      kind: "menu_click",
      eventKey: "voc_my_tickets",
      operatorOpenId: "ou_operator",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(setup.dependencies.sendDirectMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.operationsReply).toHaveBeenCalledWith("ou_operator");
    expect(setup.dependencies.todayOverviewReply).not.toHaveBeenCalled();
    expect(setup.dependencies.sendDirectMessage).toHaveBeenCalledWith({
      env,
      openId: "ou_operator",
      message: {
        msgType: "interactive",
        content: JSON.stringify({ schema: "2.0", card: "operations" }),
      },
    });
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    expect(setup.dependencies.replyMessage).not.toHaveBeenCalled();
  });

  it("replies to voc_today_overview by DM with the new global overview card", async () => {
    const setup = dependencies({
      kind: "menu_click",
      eventKey: "voc_today_overview",
      operatorOpenId: "ou_operator",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.todayOverviewReply).toHaveBeenCalledWith();
    expect(setup.dependencies.operationsReply).not.toHaveBeenCalled();
    expect(setup.dependencies.sendDirectMessage).toHaveBeenCalledWith({
      env,
      openId: "ou_operator",
      message: {
        msgType: "interactive",
        content: JSON.stringify({ schema: "2.0", card: "today-overview" }),
      },
    });
  });

  // The regression this test guards: a card whose numbers belong to nobody in
  // particular must never be sent to whoever happened to be signed in as this
  // server instance's "default" recipient. An operator id that resolved to ""
  // (event-handler.ts's readMenuOperatorOpenId — a missing or malformed
  // operator_id path degrades to this, silently, never a throw) has nowhere
  // legitimate to go, so this must not crash and must not attempt to send
  // anything to anyone.
  it("skips sending anything for either menu item when the operator id is empty", async () => {
    for (const eventKey of ["voc_my_tickets", "voc_today_overview"] as const) {
      const setup = dependencies({ kind: "menu_click", eventKey, operatorOpenId: "" });

      const response = await createFeishuEventRoute(setup.dependencies)(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({});
      expect(setup.scheduled).toHaveLength(0);
      expect(setup.dependencies.operationsReply).not.toHaveBeenCalled();
      expect(setup.dependencies.todayOverviewReply).not.toHaveBeenCalled();
      expect(setup.dependencies.sendDirectMessage).not.toHaveBeenCalled();
    }
  });

  it("reports failure without leaking the exception when the DM send fails", async () => {
    const setup = dependencies({
      kind: "menu_click",
      eventKey: "voc_my_tickets",
      operatorOpenId: "ou_operator",
    });
    setup.dependencies.sendDirectMessage.mockRejectedValueOnce(
      new Error("private upstream response"),
    );

    await createFeishuEventRoute(setup.dependencies)(request());
    await setup.scheduled[0]();

    expect(setup.dependencies.reportFailure).toHaveBeenCalledWith();
  });

  it("reports failure without leaking the exception when the today-overview reply itself fails", async () => {
    const setup = dependencies({
      kind: "menu_click",
      eventKey: "voc_today_overview",
      operatorOpenId: "ou_operator",
    });
    setup.dependencies.todayOverviewReply.mockRejectedValueOnce(
      new Error("private upstream response"),
    );

    await createFeishuEventRoute(setup.dependencies)(request());
    await setup.scheduled[0]();

    expect(setup.dependencies.reportFailure).toHaveBeenCalledWith();
    expect(setup.dependencies.sendDirectMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// End-to-end, through the seam
//
// Everything above replaces `parseEvent` and `resolveAction` with vi.fn(), and
// card-actions.test.ts passes the note in as a parameter. Neither side could
// see the join, which is exactly how 跟进记录/闭环结论 shipped unreachable: the
// route called resolveVocCardAction without them, the parameters were optional
// so the compiler was satisfied, and every unit test on both sides stayed
// green. These tests use the REAL parseFeishuEvent and the REAL card-action
// resolver over a genuinely signed request body, faking only the Bitable HTTP
// boundary. A regression in the join fails here.
// ---------------------------------------------------------------------------

function signedHeaders(rawBody: string): Headers {
  const timestamp = "1784371200";
  const nonce = "onecare-nonce";
  const signature = createHash("sha256")
    .update(`${timestamp}${nonce}${env.encryptKey}${rawBody}`)
    .digest("hex");

  return new Headers({
    "content-type": "application/json",
    "x-lark-request-timestamp": timestamp,
    "x-lark-request-nonce": nonce,
    "x-lark-signature": signature,
  });
}

function signedRequest(body: object): Request {
  const rawBody = JSON.stringify(body);
  return new Request("https://onecare.example/api/feishu/events", {
    method: "POST",
    body: rawBody,
    headers: signedHeaders(rawBody),
  });
}

function cardActionBody(
  action: string,
  value: Record<string, unknown>,
  overrides: Readonly<{
    operatorOpenId?: string;
    formValue?: Record<string, unknown>;
  }> = {},
) {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_card_action",
      event_type: "card.action.trigger",
      create_time: "1784371200000",
      token: env.verificationToken,
      app_id: env.appId,
      tenant_key: "tenant_onecare",
    },
    event: {
      operator: { open_id: overrides.operatorOpenId ?? "ou_owner" },
      token: "card-update-token",
      action: {
        tag: "button",
        name: "voc_note_submit",
        value: { action, ...value },
        // Card 2.0 delivers form-container values under action.form_value,
        // keyed by each component's `name`
        // (open.feishu.cn/document/feishu-cards/card-callback-communication).
        ...(overrides.formValue ? { form_value: overrides.formValue } : {}),
      },
      context: {
        open_chat_id: "oc_onecare_chat",
        open_message_id: "om_onecare_card",
      },
    },
  };
}

function vocRecord(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec12345",
    recordNumber: "VOC-0001",
    channel: "电商评价",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "维修师傅约了三天还没上门",
    rating: 2,
    feedbackAt: "2026-01-20T00:00:00.000Z",
    state: "待跟进",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "用户反馈上门维修延迟三天",
    replies: [{ tone: "致歉安抚", text: "非常抱歉给您带来不便" }],
    severity: "中",
    ownerOpenIds: ["ou_owner"],
    ownerNames: [],
    retryCount: 0,
    ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    closedAt: null,
    warRoomChatId: "",
    engineerOpenIds: [],
    engineerNames: [],
    dispatchedAt: null,
    sourceTicketNo: "CAS-42567239-Q7Q8Q",
    userRef: "U-3878645B",
    deviceRef: "D-91C2A70E",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ...overrides,
  };
}

function bitable(record: VocRecord | null) {
  return {
    getRecord: vi.fn(async (_recordId: string) => record),
    updateRecord: vi.fn(
      async (
        _recordId: string,
        _fields: Record<string, unknown>,
      ): Promise<void> => undefined,
    ),
  };
}

// Default war-room dependencies for `liveDependencies` callers that never
// intend to exercise voc_open_war_room/voc_decline_war_room: every function
// throws if actually invoked. This is deliberate, not a placeholder — every
// existing state-action test below builds its setup with these defaults, so
// if createResolveAction's routing ever regressed to sending a state action
// through resolveWarRoomAction (or vice versa), the thrown error would
// surface as a changed toast rather than passing silently.
const unusedWarRoomDependencies: WarRoomActionDependencies = {
  fallbackOpenIds: async () => {
    throw new Error("fallbackOpenIds should not be called for this test");
  },
  createChat: async () => {
    throw new Error("createChat should not be called for this test");
  },
  sendToChat: async () => {
    throw new Error("sendToChat should not be called for this test");
  },
  notifyOperator: async () => {
    throw new Error("notifyOperator should not be called for this test");
  },
};

// Only `readEnv` and the two outbound message senders are faked; parseEvent
// and resolveAction are the production functions.
function liveDependencies(
  client: VocActionBitable,
  warRoom: WarRoomActionDependencies = unusedWarRoomDependencies,
) {
  const scheduled: Array<() => Promise<void>> = [];
  // One shared scheduler for both createResolveAction's own war-room
  // background task (Task 11 follow-up) and createFeishuEventRoute's
  // ordinary deferred message-sends: production wires both through the same
  // `after()` primitive, so a single `scheduled` array is what a test needs
  // to inspect "everything this click deferred past its synchronous
  // response" — exactly what "the sync section returned before the
  // background section ran" means operationally.
  const schedule = (task: () => Promise<void>) => {
    scheduled.push(task);
  };
  return {
    scheduled,
    dependencies: {
      readEnv: () => env,
      // None of the tests this factory serves send a group message, so the
      // bot identity lookup is never exercised — a fixed stub is enough.
      parseEvent: (input: {
        rawBody: string;
        headers: Headers;
        env: BotEnv;
      }) => parseFeishuEvent({ ...input, botOpenId: async () => "ou_bot_unused" }),
      // None of the tests this factory serves send a p2p text message or a
      // menu click, so none of these three are ever exercised — present only
      // to satisfy FeishuEventRouteDependencies.
      operationsReply: vi.fn(async (_operatorOpenId: string) => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ card: "operations" }),
      })),
      todayOverviewReply: vi.fn(async () => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ card: "today-overview" }),
      })),
      createMenuHint: vi.fn(() => ({
        msgType: "text" as const,
        content: JSON.stringify({ text: "menu hint" }),
      })),
      createWelcome: vi.fn(() => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ welcome: true }),
      })),
      replyMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
      sendDirectMessage: vi.fn(async () => undefined),
      resolveAction: createResolveAction(() => client, warRoom, schedule),
      // None of the card-action tests this factory serves ever produce a
      // group_question outcome, so this is never exercised — present only to
      // satisfy FeishuEventRouteDependencies.
      answerGroupQuestion: createAnswerGroupQuestion(
        () => ({
          findByWarRoomChatId: async () => null,
          listRecords: async () => [],
        }),
        async () => null,
        // The aggregates come from SQL in production; a unit test hands them over
        // directly rather than reaching for a database.
        async () => ({
          sameDimension: { total: 0, closed: 0 },
          sameModel: 0,
          sameDevice: { total: 0, open: 0 },
        }),
      ),
      schedule,
      reportFailure: vi.fn(),
    },
  };
}

type CardCallbackResponse = Readonly<{
  toast?: { type: string; content: string };
  card?: { type: string; data: Record<string, unknown> };
}>;

function statusTags(card: Record<string, unknown>): unknown[] {
  const header = card.header as Record<string, unknown> | undefined;
  const list = header?.text_tag_list;
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const tag = item as Record<string, unknown>;
    const text = tag.text as Record<string, unknown> | undefined;
    return text?.content;
  });
}

describe("POST /api/feishu/events — VOC closure loop end to end", () => {
  it("advances 待跟进 → 跟进中 and returns the re-rendered card", async () => {
    const client = bitable(vocRecord({ state: "待跟进" }));
    const setup = liveDependencies(client);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody("voc_start_follow_up", { record_id: "rec12345" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(client.updateRecord).toHaveBeenCalledTimes(1);
    const [recordId, fields] = client.updateRecord.mock.calls[0];
    expect(recordId).toBe("rec12345");
    expect(fields["流程状态"]).toBe("跟进中");

    const body = (await response.json()) as CardCallbackResponse;
    expect(body.toast?.type).toBe("success");
    // I4: the clicked card must not stay frozen at the old state while the
    // Base moves behind it.
    expect(body.card?.type).toBe("raw");
    expect(statusTags(body.card?.data ?? {})).toContain("跟进中");
    expect(JSON.stringify(body.card?.data)).toContain("voc_submit_follow_up");
    // Exactly one card in exactly one response: the callback token may update
    // a card at most twice, so one click must not spend more than one update.
    expect(setup.scheduled).toHaveLength(0);
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });

  it("advances 跟进中 → 待闭环 and writes the follow-up note the owner typed", async () => {
    const client = bitable(vocRecord({ state: "跟进中" }));
    const setup = liveDependencies(client);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_submit_follow_up",
          { record_id: "rec12345" },
          { formValue: { [VOC_NOTE_FIELD_NAME]: "已联系用户，约定明天上门" } },
        ),
      ),
    );

    expect(response.status).toBe(200);
    expect(client.updateRecord).toHaveBeenCalledTimes(1);
    const [, fields] = client.updateRecord.mock.calls[0];
    expect(fields["流程状态"]).toBe("待闭环");
    expect(fields["跟进记录"]).toBe("已联系用户，约定明天上门");

    const body = (await response.json()) as CardCallbackResponse;
    expect(body.toast?.type).toBe("success");
    expect(statusTags(body.card?.data ?? {})).toContain("待闭环");
    expect(JSON.stringify(body.card?.data)).toContain("voc_confirm_closure");
  });

  it("advances 待闭环 → 已闭环 and writes the closing note plus an epoch-ms 闭环时间", async () => {
    const client = bitable(vocRecord({ state: "待闭环" }));
    const setup = liveDependencies(client);
    const before = Date.now();

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_confirm_closure",
          { record_id: "rec12345" },
          { formValue: { [VOC_NOTE_FIELD_NAME]: "已完成维修并完成回访" } },
        ),
      ),
    );
    const after = Date.now();

    expect(response.status).toBe(200);
    expect(client.updateRecord).toHaveBeenCalledTimes(1);
    const [, fields] = client.updateRecord.mock.calls[0];
    expect(fields["流程状态"]).toBe("已闭环");
    expect(fields["闭环结论"]).toBe("已完成维修并完成回访");
    // 闭环时间 feeds 闭环率 and 平均闭环时长 on the public dashboard, and a
    // Bitable DateTime is epoch milliseconds on the wire — an ISO string here
    // is silently rejected and the closure never lands.
    expect(typeof fields["闭环时间"]).toBe("number");
    expect(fields["闭环时间"] as number).toBeGreaterThanOrEqual(before);
    expect(fields["闭环时间"] as number).toBeLessThanOrEqual(after);

    const body = (await response.json()) as CardCallbackResponse;
    expect(statusTags(body.card?.data ?? {})).toContain("已闭环");
  });

  it("advances 已分析 → 无需跟进 for voc_mark_no_action", async () => {
    const client = bitable(vocRecord({ state: "已分析" }));
    const setup = liveDependencies(client);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody("voc_mark_no_action", { record_id: "rec12345" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(client.updateRecord).toHaveBeenCalledTimes(1);
    const [, fields] = client.updateRecord.mock.calls[0];
    expect(fields["流程状态"]).toBe("无需跟进");
  });

  it.each([
    ["a missing form value", undefined],
    ["an empty form value", { [VOC_NOTE_FIELD_NAME]: "" }],
    ["a whitespace-only form value", { [VOC_NOTE_FIELD_NAME]: "   \n  " }],
    ["a non-string form value", { [VOC_NOTE_FIELD_NAME]: 42 }],
  ])(
    "still refuses to submit a follow-up with %s and writes nothing",
    async (_label, formValue) => {
      const client = bitable(vocRecord({ state: "跟进中" }));
      const setup = liveDependencies(client);

      const response = await createFeishuEventRoute(setup.dependencies)(
        signedRequest(
          cardActionBody(
            "voc_submit_follow_up",
            { record_id: "rec12345" },
            formValue ? { formValue } : {},
          ),
        ),
      );

      const body = (await response.json()) as CardCallbackResponse;
      expect(body.toast?.type).toBe("error");
      expect(body.toast?.content).toContain("跟进记录不能为空");
      // The guard is the point: it must reject, not be satisfied by a
      // server-invented placeholder note.
      expect(client.updateRecord).not.toHaveBeenCalled();
      expect(body.card).toBeUndefined();
    },
  );

  it("still refuses to confirm closure without a closing note", async () => {
    const client = bitable(vocRecord({ state: "待闭环" }));
    const setup = liveDependencies(client);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_confirm_closure",
          { record_id: "rec12345" },
          { formValue: { [VOC_NOTE_FIELD_NAME]: "  " } },
        ),
      ),
    );

    const body = (await response.json()) as CardCallbackResponse;
    expect(body.toast?.type).toBe("error");
    expect(body.toast?.content).toContain("闭环结论不能为空");
    expect(client.updateRecord).not.toHaveBeenCalled();
  });

  it("refuses a signed click from someone who is not the owner and writes nothing", async () => {
    const client = bitable(vocRecord({ state: "跟进中" }));
    const setup = liveDependencies(client);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_submit_follow_up",
          { record_id: "rec12345" },
          {
            operatorOpenId: "ou_stranger",
            formValue: { [VOC_NOTE_FIELD_NAME]: "我随手点了一下" },
          },
        ),
      ),
    );

    const body = (await response.json()) as CardCallbackResponse;
    expect(body.toast?.type).toBe("error");
    expect(body.toast?.content).toContain("负责人");
    expect(client.updateRecord).not.toHaveBeenCalled();
    expect(body.card).toBeUndefined();
  });

  it("reads the record exactly once per click", async () => {
    const client = bitable(vocRecord({ state: "待跟进" }));
    const setup = liveDependencies(client);

    await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody("voc_start_follow_up", { record_id: "rec12345" }),
      ),
    );

    expect(client.getRecord).toHaveBeenCalledTimes(1);
  });

  it("refuses an illegal transition and writes nothing", async () => {
    const client = bitable(vocRecord({ state: "待跟进" }));
    const setup = liveDependencies(client);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_confirm_closure",
          { record_id: "rec12345" },
          { formValue: { [VOC_NOTE_FIELD_NAME]: "看起来已经好了" } },
        ),
      ),
    );

    const body = (await response.json()) as CardCallbackResponse;
    expect(body.toast?.type).toBe("error");
    expect(client.updateRecord).not.toHaveBeenCalled();
  });

  it("refuses a click on a deleted record and writes nothing", async () => {
    const client = bitable(null);
    const setup = liveDependencies(client);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody("voc_start_follow_up", { record_id: "rec12345" }),
      ),
    );

    const body = (await response.json()) as CardCallbackResponse;
    expect(body.toast?.type).toBe("error");
    expect(client.updateRecord).not.toHaveBeenCalled();
  });

  // Regression net for the nine demo actions: none of them touch Bitable, and
  // their case_id gate must keep behaving exactly as before this task.
  it.each(ONECARE_CARD_ACTIONS)(
    "keeps the %s demo action working with the fixed demo case",
    async (action) => {
      const client = bitable(null);
      const setup = liveDependencies(client);

      const response = await createFeishuEventRoute(setup.dependencies)(
        signedRequest(cardActionBody(action, { case_id: ONECARE_CASE_ID })),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as CardCallbackResponse;
      expect(body.toast?.type === "info" || body.toast?.type === "success").toBe(
        true,
      );
      expect(client.getRecord).not.toHaveBeenCalled();
      expect(client.updateRecord).not.toHaveBeenCalled();
    },
  );

  it.each(ONECARE_CARD_ACTIONS)(
    "still rejects the %s demo action with a wrong case id",
    async (action) => {
      const client = bitable(null);
      const setup = liveDependencies(client);

      const response = await createFeishuEventRoute(setup.dependencies)(
        signedRequest(cardActionBody(action, { case_id: "OC-forged" })),
      );

      await expect(response.json()).resolves.toEqual({
        toast: { type: "info", content: "暂不支持该操作" },
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Task 11: createResolveAction actually dispatches voc_open_war_room /
// voc_decline_war_room to resolveWarRoomAction instead of letting them fall
// into resolveVocCardAction's inert "该操作暂不支持" guard. Same seam as the
// closure-loop describe block above (real parseFeishuEvent, real
// createResolveAction, only the Bitable/war-room network boundary faked) —
// stubbing resolveAction itself is exactly how this gap went unnoticed before.
//
// Task 11 follow-up: a "create" decision now answers synchronously with an
// interim toast and defers createChat/updateRecord/sendToChat into
// `setup.scheduled` via `after()` (see liveDependencies' shared `schedule`
// above) rather than doing them inline — a real-tenant measurement put the
// old all-synchronous path at ~2725ms against Feishu's ~3000ms callback
// deadline. Every test below that reaches a "create" decision therefore
// asserts the synchronous response *before* running `setup.scheduled[0]()`,
// and only then asserts the three deferred calls happened.
// ---------------------------------------------------------------------------
describe("POST /api/feishu/events — VOC war room actions, wired for real", () => {
  it("answers voc_open_war_room with an interim toast, and defers chat creation to the background — members include both owner and operator", async () => {
    const client = bitable(
      vocRecord({ ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
    );
    const createChat = vi.fn(
      async (_name: string, _memberOpenIds: readonly string[]): Promise<string> =>
        "oc_new_room",
    );
    const sendToChat = vi.fn(
      async (_chatId: string, _card: Record<string, unknown>): Promise<void> =>
        undefined,
    );
    const setup = liveDependencies(client, {
      // The operator approving the escalation is a fallback owner, not this
      // ticket's assigned owner — the one case that actually distinguishes
      // "operator" from "owner" in the members list.
      fallbackOpenIds: async () => ["ou_fallback"],
      createChat,
      sendToChat,
      notifyOperator: async () => {
        throw new Error("notifyOperator should not be called on the happy path");
      },
    });

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_open_war_room",
          { record_id: "rec12345" },
          { operatorOpenId: "ou_fallback" },
        ),
      ),
    );

    // Synchronous response: an interim toast, nothing created or written yet.
    expect(response.status).toBe(200);
    const body = (await response.json()) as CardCallbackResponse;
    expect(body.toast?.type).toBe("info");
    expect(body.toast?.content).toContain("正在创建");
    expect(createChat).not.toHaveBeenCalled();
    expect(client.updateRecord).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    // Background: the deferred task actually does the three slow steps.
    await setup.scheduled[0]();

    expect(createChat).toHaveBeenCalledTimes(1);
    const [, members] = createChat.mock.calls[0];
    expect(members).toContain("ou_owner");
    expect(members).toContain("ou_fallback");
    expect(sendToChat).toHaveBeenCalledWith("oc_new_room", expect.anything());
    expect(client.updateRecord).toHaveBeenCalledTimes(1);
    const [, fields] = client.updateRecord.mock.calls[0];
    expect(fields["协同群 ID"]).toBe("oc_new_room");
  });

  it("DMs the operator through notifyOperator when the background chat creation fails", async () => {
    const client = bitable(
      vocRecord({ ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
    );
    const notifyOperator = vi.fn(
      async (_openId: string, _text: string): Promise<void> => undefined,
    );
    const setup = liveDependencies(client, {
      fallbackOpenIds: async () => [],
      createChat: async () => {
        throw new Error("feishu down");
      },
      sendToChat: async () => {
        throw new Error("sendToChat should not be called when createChat failed");
      },
      notifyOperator,
    });

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_open_war_room",
          { record_id: "rec12345" },
          { operatorOpenId: "ou_owner" },
        ),
      ),
    );

    expect(response.status).toBe(200);
    expect(setup.scheduled).toHaveLength(1);
    expect(notifyOperator).not.toHaveBeenCalled();

    await setup.scheduled[0]();

    expect(client.updateRecord).not.toHaveBeenCalled();
    expect(notifyOperator).toHaveBeenCalledTimes(1);
    const [openId, text] = notifyOperator.mock.calls[0];
    expect(openId).toBe("ou_owner");
    expect(text).toContain("创建失败");
  });

  it("routes voc_decline_war_room to resolveWarRoomAction synchronously: writes declined, never creates a chat, and schedules nothing", async () => {
    const client = bitable(
      vocRecord({ ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
    );
    const createChat = vi.fn(
      async (_name: string, _memberOpenIds: readonly string[]): Promise<string> => {
        throw new Error("createChat should not be called for a decline");
      },
    );
    const setup = liveDependencies(client, {
      fallbackOpenIds: async () => [],
      createChat,
      sendToChat: async () => {
        throw new Error("sendToChat should not be called for a decline");
      },
      notifyOperator: async () => {
        throw new Error("notifyOperator should not be called for a decline");
      },
    });

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_decline_war_room",
          { record_id: "rec12345" },
          { operatorOpenId: "ou_owner" },
        ),
      ),
    );

    expect(response.status).toBe(200);
    expect(createChat).not.toHaveBeenCalled();
    // Declining is decided entirely in the synchronous section — nothing is ever
    // deferred by this function for it. The Bitable push that production defers
    // belongs to the store-backed client injected as `bitable`, not to the resolver,
    // which is why a test driving it over a fake client sees no scheduled work.
    expect(setup.scheduled).toHaveLength(0);
    expect(client.updateRecord).toHaveBeenCalledTimes(1);
    const [, fields] = client.updateRecord.mock.calls[0];
    expect(fields["协同群 ID"]).toBe("declined");

    const body = (await response.json()) as CardCallbackResponse;
    expect(body.toast?.content).toContain("暂不需要");
  });

  it.each([
    ["a stranger with no owner/fallback claim", "ou_stranger", ""],
    ["an already-existing war room", "ou_owner", "oc_existing"],
    ["a previously declined war room", "ou_owner", "declined"],
  ])(
    "schedules nothing for %s (the four already-decided outcomes never reach the background)",
    async (_label, operatorOpenId, warRoomChatId) => {
      const client = bitable(
        vocRecord({ ownerOpenIds: ["ou_owner"], warRoomChatId }),
      );
      const setup = liveDependencies(client, {
        fallbackOpenIds: async () => [],
        createChat: async () => {
          throw new Error("createChat should not be called for this case");
        },
        sendToChat: async () => {
          throw new Error("sendToChat should not be called for this case");
        },
        notifyOperator: async () => {
          throw new Error("notifyOperator should not be called for this case");
        },
      });

      const response = await createFeishuEventRoute(setup.dependencies)(
        signedRequest(
          cardActionBody(
            "voc_open_war_room",
            { record_id: "rec12345" },
            { operatorOpenId },
          ),
        ),
      );

      expect(response.status).toBe(200);
      expect(setup.scheduled).toHaveLength(0);
      expect(client.updateRecord).not.toHaveBeenCalled();
    },
  );

  it("schedules nothing for a click on a record that does not exist", async () => {
    const client = bitable(null);
    const setup = liveDependencies(client, {
      fallbackOpenIds: async () => [],
      createChat: async () => {
        throw new Error("createChat should not be called for a missing record");
      },
      sendToChat: async () => {
        throw new Error("sendToChat should not be called for a missing record");
      },
      notifyOperator: async () => {
        throw new Error("notifyOperator should not be called for a missing record");
      },
    });

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_open_war_room",
          { record_id: "rec12345" },
          { operatorOpenId: "ou_owner" },
        ),
      ),
    );

    expect(response.status).toBe(200);
    expect(setup.scheduled).toHaveLength(0);
  });

  // The load-bearing case: the same relaxation that lets a fallback approver
  // (who is not this ticket's owner) open the war room must not leak into the
  // four status actions, which keep resolveVocCardAction's strict
  // owner-only check. One record, one operator identity, two different card
  // clicks — proving both halves at once is the point, not a convenience.
  it("lets a fallback (non-owner) open the war room, but still rejects the same fallback for a state action", async () => {
    const client = bitable(
      vocRecord({
        state: "待跟进",
        ownerOpenIds: ["ou_owner"],
        warRoomChatId: "",
        engineerOpenIds: [],
        engineerNames: [],
        dispatchedAt: null,
        sourceTicketNo: "CAS-42567239-Q7Q8Q",
        userRef: "U-3878645B",
        deviceRef: "D-91C2A70E",
        sourceUrl: "",
        sourceDetail: "400投诉",
        businessUnit: "冰冷事业部",
        categoryLevel1: "安装调试",
      }),
    );
    const createChat = vi.fn(
      async (_name: string, _memberOpenIds: readonly string[]): Promise<string> =>
        "oc_fallback_room",
    );
    const sendToChat = vi.fn(
      async (_chatId: string, _card: Record<string, unknown>): Promise<void> =>
        undefined,
    );
    const setup = liveDependencies(client, {
      fallbackOpenIds: async () => ["ou_fallback"],
      createChat,
      sendToChat,
      notifyOperator: async () => {
        throw new Error("notifyOperator should not be called on the happy path");
      },
    });

    const openResponse = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_open_war_room",
          { record_id: "rec12345" },
          { operatorOpenId: "ou_fallback" },
        ),
      ),
    );
    const openBody = (await openResponse.json()) as CardCallbackResponse;
    expect(openBody.toast?.type).toBe("info");
    expect(setup.scheduled).toHaveLength(1);
    await setup.scheduled[0]();
    expect(createChat).toHaveBeenCalledTimes(1);

    // Same record, same operator, a status action instead: resolveVocCardAction
    // reads this ticket's ownerOpenIds (["ou_owner"]) — "ou_fallback" is not in
    // it — and must reject exactly as it would for any other non-owner.
    const followUpResponse = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_start_follow_up",
          { record_id: "rec12345" },
          { operatorOpenId: "ou_fallback" },
        ),
      ),
    );
    const followUpBody = (await followUpResponse.json()) as CardCallbackResponse;
    expect(followUpBody.toast?.type).toBe("error");
    expect(followUpBody.toast?.content).toContain("负责人");
    // Only the war-room click's background write above touched the record;
    // the rejected state click must not have.
    expect(client.updateRecord).toHaveBeenCalledTimes(1);
    // And it must not have queued a second background task — the only one is the war
    // room's own, queued and run above.
    expect(setup.scheduled).toHaveLength(1);
  });

  // Complements the closure-loop describe block above: those tests already
  // pin down state-action behavior (transitions, notes, rejections) using
  // `liveDependencies`' default war-room fakes, which throw if ever invoked.
  // This test names the property directly instead of leaving it implicit.
  it("never touches the war-room dependencies (fallbackOpenIds/createChat/sendToChat/notifyOperator) for a status action, and schedules nothing", async () => {
    const client = bitable(vocRecord({ state: "待跟进", ownerOpenIds: ["ou_owner"] }));
    // liveDependencies' default `unusedWarRoomDependencies` throws on any
    // call, so simply not throwing here already proves the point; the
    // explicit assertions below make that intent legible.
    const setup = liveDependencies(client);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        cardActionBody(
          "voc_start_follow_up",
          { record_id: "rec12345" },
          { operatorOpenId: "ou_owner" },
        ),
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as CardCallbackResponse;
    expect(body.toast?.type).toBe("success");
    expect(setup.scheduled).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Group @ Q&A, end to end through the same seam as the VOC closure loop
// above: real parseFeishuEvent, real createAnswerGroupQuestion, only the
// Bitable HTTP boundary and the answer-skill call are faked. This is where
// "does not answer when there is no ticket" and "any failure comes back as
// null, not a guess" are actually exercised, rather than asserted at the unit
// level against a mock that could not tell a correct wiring from a broken one.
// ---------------------------------------------------------------------------

// This app holds the "获取群组中所有消息" grant (confirmed live on
// 2026-08-12), so im.message.receive_v1 fires for every group message, not
// only ones that @ the bot. GROUP_BOT_OPEN_ID is what liveGroupDependencies'
// botOpenId stub resolves to, so a mentions array containing it is "this
// message addresses the bot" and any other content is ordinary group
// chatter the tests below must prove gets ignored.
const GROUP_BOT_OPEN_ID = "ou_group_bot_self";

function botMention() {
  return {
    key: "@_user_1",
    id: { open_id: GROUP_BOT_OPEN_ID, union_id: "on_bot", user_id: "bot" },
    name: "OneCare",
    tenant_key: "tenant_onecare",
  };
}

function groupMessageBody(
  text: string,
  chatId = "oc_group_chat",
  // Defaults to "the bot is mentioned" so every test written for the answer
  // pipeline itself (not for mention-gating specifically) keeps exercising a
  // legitimate question unless it deliberately overrides this.
  mentions: readonly unknown[] = [botMention()],
) {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_group_message",
      event_type: "im.message.receive_v1",
      create_time: "1784371200000",
      token: env.verificationToken,
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
        message_id: "om_group_message",
        chat_id: chatId,
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text }),
        mentions,
      },
    },
  };
}

function groupBitable(
  ticket: VocRecord | null,
  records: readonly VocRecord[] = [],
) {
  return {
    findByWarRoomChatId: vi.fn(async (_chatId: string) => ticket),
    listRecords: vi.fn(async () => records),
  };
}

function groupTicket(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec_group_1",
    recordNumber: "VOC-0099",
    channel: "电商评价",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "维修师傅约了三天还没上门",
    rating: 2,
    feedbackAt: "2026-08-09T00:00:00.000Z",
    state: "跟进中",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "用户反馈上门维修延迟三天",
    replies: [{ tone: "致歉安抚", text: "非常抱歉给您带来不便" }],
    severity: "高",
    ownerOpenIds: ["ou_owner"],
    ownerNames: ["张三"],
    retryCount: 0,
    ticketOpenedAt: "2026-08-09T02:00:00.000Z",
    closedAt: null,
    warRoomChatId: "oc_group_chat",
    engineerOpenIds: [],
    engineerNames: [],
    dispatchedAt: null,
    sourceTicketNo: "CAS-42567239-Q7Q8Q",
    userRef: "U-3878645B",
    deviceRef: "D-91C2A70E",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ...overrides,
  };
}

// Only readEnv and the two outbound message senders are faked; parseEvent
// and answerGroupQuestion (the real createAnswerGroupQuestion) are the
// production functions, over a fake Bitable client and a fake answer skill.
function liveGroupDependencies(
  bitable: ReturnType<typeof groupBitable>,
  answer: (question: string, facts: string) => Promise<string | null>,
) {
  const scheduled: Array<() => Promise<void>> = [];
  return {
    scheduled,
    dependencies: {
      readEnv: () => env,
      parseEvent: (input: { rawBody: string; headers: Headers; env: BotEnv }) =>
        parseFeishuEvent({ ...input, botOpenId: async () => GROUP_BOT_OPEN_ID }),
      // None of these three are exercised by this describe block: a p2p text
      // message here gets the menu hint (createMenuHint), not this card, and
      // no test in this file drives a menu_click through the real
      // parseFeishuEvent. Present only to satisfy FeishuEventRouteDependencies.
      operationsReply: vi.fn(async (_operatorOpenId: string) => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ card: "operations" }),
      })),
      todayOverviewReply: vi.fn(async () => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ card: "today-overview" }),
      })),
      // Exercised by "leaves the single-chat p2p command path untouched"
      // below — that test checks replyMessage was called once with exactly
      // this hint, proving a p2p text message never reaches the group
      // Q&A pipeline this describe block otherwise exists to test.
      createMenuHint: vi.fn(() => ({
        msgType: "text" as const,
        content: JSON.stringify({ text: "请使用菜单查看数据" }),
      })),
      createWelcome: vi.fn(() => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ welcome: true }),
      })),
      replyMessage: vi.fn(async () => undefined),
      // Explicitly typed (not inferred from a zero-arg `async () => ...`) so
      // `.mock.calls[0]` below is a real one-element tuple rather than `[]` —
      // the same trap the project's own fetcher fakes already guard against.
      sendMessage: vi.fn(
        async (_input: {
          env: BotEnv;
          chatId: string;
          message: FeishuOutboundMessage;
        }) => undefined,
      ),
      sendDirectMessage: vi.fn(async () => undefined),
      // No card action test in this describe block ever fires, so this stub
      // is never invoked.
      resolveAction: vi.fn(
        async (_input: {
          action: OneCareCardAction | VocCardAction;
          recordId: string;
          operatorOpenId: string;
          note: string;
        }): Promise<CardActionResult> => ({
          kind: "update",
          response: {},
        }),
      ),
      answerGroupQuestion: createAnswerGroupQuestion(() => bitable, answer, async () => ({
        sameDimension: { total: 2, closed: 1 },
        sameModel: 3,
        sameDevice: { total: 7, open: 2 },
      })),
      schedule: (task: () => Promise<void>) => {
        scheduled.push(task);
      },
      reportFailure: vi.fn(),
    },
  };
}

type TextMessageResponse = Readonly<{ text: string }>;

function textOf(message: { content: string }): string {
  return (JSON.parse(message.content) as TextMessageResponse).text;
}

describe("POST /api/feishu/events — group @ Q&A end to end", () => {
  it("acknowledges the group message before the lookup and reply run", async () => {
    const bitable = groupBitable(groupTicket());
    const answer = vi.fn(async (_q: string, _f: string) => "answer");
    const setup = liveGroupDependencies(bitable, answer);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(groupMessageBody("@_user_1 同维度还有几条")),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.sendMessage).toHaveBeenCalledTimes(1);
  });

  // This app holds the "获取群组中所有消息" grant, so im.message.receive_v1
  // fires for every message in every group the bot belongs to — including
  // members talking to each other with no intention of asking the bot
  // anything. The three tests below are the positive proof that mention
  // gating, not the event subscription, is what keeps this route from
  // answering all of it: each asserts zero calls to both Bitable and the
  // answer skill, not just "no reply sent".
  it("ignores a group message that mentions someone else, never touching Bitable or the skill", async () => {
    const bitable = groupBitable(groupTicket());
    const answer = vi.fn(async (_q: string, _f: string) => "should never be seen");
    const setup = liveGroupDependencies(bitable, answer);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        groupMessageBody("@_user_1 这个你处理一下", "oc_group_chat", [
          { key: "@_user_1", id: { open_id: "ou_someone_else" }, name: "张三" },
        ]),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(setup.scheduled).toHaveLength(0);
    expect(bitable.findByWarRoomChatId).not.toHaveBeenCalled();
    expect(bitable.listRecords).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });

  it("ignores an ordinary group message with no mentions, never touching Bitable or the skill", async () => {
    const bitable = groupBitable(groupTicket());
    const answer = vi.fn(async (_q: string, _f: string) => "should never be seen");
    const setup = liveGroupDependencies(bitable, answer);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(groupMessageBody("今天天气不错", "oc_group_chat", [])),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(setup.scheduled).toHaveLength(0);
    expect(bitable.findByWarRoomChatId).not.toHaveBeenCalled();
    expect(bitable.listRecords).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
  });

  it("answers when the mentions array actually names the bot", async () => {
    const bitable = groupBitable(groupTicket());
    const answer = vi.fn(async (_q: string, _f: string) => "answer");
    const setup = liveGroupDependencies(bitable, answer);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(
        groupMessageBody("@_user_1 同维度还有几条", "oc_group_chat", [botMention()]),
      ),
    );

    expect(response.status).toBe(200);
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(bitable.findByWarRoomChatId).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(setup.dependencies.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("tells the group there is no ticket rather than asking the model anything", async () => {
    const bitable = groupBitable(null);
    const answer = vi.fn(async (_q: string, _f: string) => "should never be seen");
    const setup = liveGroupDependencies(bitable, answer);

    await createFeishuEventRoute(setup.dependencies)(
      signedRequest(groupMessageBody("@_user_1 这条投诉以前出现过吗")),
    );
    await setup.scheduled[0]();

    // The load-bearing assertion: a group with no linked ticket must never
    // reach the model at all.
    expect(answer).not.toHaveBeenCalled();
    const [call] = setup.dependencies.sendMessage.mock.calls;
    expect(call[0].chatId).toBe("oc_group_chat");
    expect(textOf(call[0].message)).toBe("这个群没有关联的 VOC 工单");
  });

  it("sends the ticket card instead of asking the model when the message is only a mention", async () => {
    const ticket = groupTicket({ recordNumber: "VOC-0555" });
    const bitable = groupBitable(ticket);
    const answer = vi.fn(async (_q: string, _f: string) => "should never be seen");
    const setup = liveGroupDependencies(bitable, answer);

    await createFeishuEventRoute(setup.dependencies)(
      signedRequest(groupMessageBody("@_user_1")),
    );
    await setup.scheduled[0]();

    expect(answer).not.toHaveBeenCalled();
    const [call] = setup.dependencies.sendMessage.mock.calls;
    expect(call[0].message.msgType).toBe("interactive");
    expect(call[0].message.content).toContain("VOC-0555");
    // The in-group card shows the untruncated complaint, like the war room's
    // opening card.
    expect(call[0].message.content).toContain(ticket.content);
  });

  it("answers from the ticket's own facts, with the record id kept out of them", async () => {
    const ticket = groupTicket();
    const other = groupTicket({
      recordId: "rec_group_2",
      feedbackAt: "2026-08-09T00:00:00.000Z",
      state: "已闭环",
    });
    const bitable = groupBitable(ticket, [ticket, other]);
    const answer = vi.fn(async (_question: string, _facts: string) => "这条投诉本周同维度还有 2 条。");
    const setup = liveGroupDependencies(bitable, answer);

    await createFeishuEventRoute(setup.dependencies)(
      signedRequest(groupMessageBody("@_user_1 同维度还有几条")),
    );
    await setup.scheduled[0]();

    expect(answer).toHaveBeenCalledTimes(1);
    const [question, facts] = answer.mock.calls[0];
    expect(question).toBe("同维度还有几条");
    expect(facts).not.toContain(ticket.recordId);
    expect(facts).not.toContain(ticket.warRoomChatId);
    expect(JSON.parse(facts)).toMatchObject({
      aggregates: { sameDimensionLast7Days: 2, sameDimensionClosed: 1 },
    });

    const [call] = setup.dependencies.sendMessage.mock.calls;
    expect(textOf(call[0].message)).toBe("这条投诉本周同维度还有 2 条。");
  });

  it("tells the group it cannot answer right now when the skill returns null", async () => {
    const bitable = groupBitable(groupTicket());
    const answer = vi.fn(async (_q: string, _f: string) => null);
    const setup = liveGroupDependencies(bitable, answer);

    await createFeishuEventRoute(setup.dependencies)(
      signedRequest(groupMessageBody("@_user_1 同维度还有几条")),
    );
    await setup.scheduled[0]();

    const [call] = setup.dependencies.sendMessage.mock.calls;
    expect(textOf(call[0].message)).toBe(
      "暂时答不上来，可以稍后再问，或直接在多维表格里查这条记录",
    );
  });

  it("tells the group it cannot answer right now when the Bitable lookup itself fails", async () => {
    const bitable = {
      findByWarRoomChatId: vi.fn(async (_chatId: string) => {
        throw new Error("bitable outage");
      }),
      listRecords: vi.fn(async () => []),
    };
    const answer = vi.fn(async (_q: string, _f: string) => "should never be seen");
    const setup = liveGroupDependencies(bitable, answer);

    await createFeishuEventRoute(setup.dependencies)(
      signedRequest(groupMessageBody("@_user_1 同维度还有几条")),
    );
    await setup.scheduled[0]();

    expect(answer).not.toHaveBeenCalled();
    const [call] = setup.dependencies.sendMessage.mock.calls;
    expect(textOf(call[0].message)).toBe(
      "暂时答不上来，可以稍后再问，或直接在多维表格里查这条记录",
    );
  });

  it("reports failure without a reply if even the fallback send fails", async () => {
    const bitable = groupBitable(null);
    const answer = vi.fn(async (_q: string, _f: string) => null);
    const setup = liveGroupDependencies(bitable, answer);
    setup.dependencies.sendMessage.mockRejectedValueOnce(
      new Error("private upstream response"),
    );

    await createFeishuEventRoute(setup.dependencies)(
      signedRequest(groupMessageBody("@_user_1 问题")),
    );
    await setup.scheduled[0]();

    expect(setup.dependencies.reportFailure).toHaveBeenCalledWith();
  });

  it("leaves the single-chat p2p command path untouched", async () => {
    const bitable = groupBitable(groupTicket());
    const answer = vi.fn(async (_q: string, _f: string) => "should never be seen");
    const setup = liveGroupDependencies(bitable, answer);

    const rawBody = JSON.stringify({
      schema: "2.0",
      header: {
        event_id: "evt_p2p_message",
        event_type: "im.message.receive_v1",
        create_time: "1784371200000",
        token: env.verificationToken,
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
          message_id: "om_p2p_message",
          chat_id: "oc_onecare_chat",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "开始体验" }),
        },
      },
    });

    await createFeishuEventRoute(setup.dependencies)(
      new Request("https://onecare.example/api/feishu/events", {
        method: "POST",
        body: rawBody,
        headers: signedHeaders(rawBody),
      }),
    );
    await setup.scheduled[0]();

    expect(bitable.findByWarRoomChatId).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    expect(setup.dependencies.replyMessage).toHaveBeenCalledTimes(1);
    expect(setup.dependencies.replyMessage).toHaveBeenCalledWith({
      env,
      messageId: "om_p2p_message",
      message: {
        msgType: "text",
        content: JSON.stringify({ text: "请使用菜单查看数据" }),
      },
    });
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    expect(setup.dependencies.sendDirectMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createOperationsReply, Task 12 (wired to the "我的工单" menu click since
// Task 13). Task 14 replaced its data source: instead of a fake `readRecords`
// standing in for readVocRecordsCached's ~10.7s full-table scan, this now
// drives readOperatorSummary over a fake BitableClient exposing only
// countRecords — this project's real Bitable client is never touched by any
// test, in this file or elsewhere, per the project rule against calling real
// Feishu/Bitable APIs from a test.
// ---------------------------------------------------------------------------

// A minimal fake BitableClient exposing only countRecords, keyed by
// 负责人+流程状态 the same way readOperatorSummary actually queries it. `null`
// makes every call reject, standing in for a failed Bitable count.
function personalCountBitable(
  byOwnerAndState: Readonly<{
    total: number;
    counts: Record<string, Record<string, number>>;
  }> | null,
) {
  return {
    countRecords: vi.fn(async (conditions: readonly CountFilterCondition[]) => {
      if (!byOwnerAndState) {
        throw new Error("Bitable count failed (code 99991400)");
      }
      if (conditions.length === 0) return byOwnerAndState.total;
      const owner = conditions.find((c) => c.field_name === "负责人")?.value[0] ?? "";
      const state = conditions.find((c) => c.field_name === "流程状态")?.value[0] ?? "";
      return byOwnerAndState.counts[owner]?.[state] ?? 0;
    }),
  };
}

describe("createOperationsReply", () => {
  it("builds a card carrying only the requesting operator's own counts", async () => {
    const client = personalCountBitable({
      total: 2,
      counts: { ou_a: { 待跟进: 1 } },
    });
    const reply = createOperationsReply(() => client);

    const message = await reply("ou_a");

    expect(message.content).toContain("我的待跟进");
    expect(message.content).toContain("1 条");
  });

  it("produces the unavailable card, with no numbers anywhere, when a count fails", async () => {
    const client = personalCountBitable(null);
    const reply = createOperationsReply(() => client);

    const message = await reply("ou_a");
    const card = JSON.parse(message.content) as Record<string, unknown>;
    const elementsJson = JSON.stringify(
      (card.body as Record<string, unknown>).elements,
    );

    expect(elementsJson).not.toMatch(/[0-9]/);
    expect(elementsJson).toContain("暂不可用");
  });
});

// ---------------------------------------------------------------------------
// createTodayOverviewReply, Task 13: the wiring behind the "今日概览" menu
// click. Task 14 replaced its data source the same way as createOperationsReply
// above: `getMetrics`'s full VocMetricsResult (from getVocDashboardMetrics's
// ~10.7s full-table aggregation) is gone, replaced by readTodayOverviewCounts
// over a fake BitableClient exposing only countRecords.
// ---------------------------------------------------------------------------

function overviewCountBitable(
  byState: Readonly<{ total: number; counts: Record<string, number> }> | null,
) {
  return {
    countRecords: vi.fn(async (conditions: readonly CountFilterCondition[]) => {
      if (!byState) {
        throw new Error("Bitable count failed (code 99991400)");
      }
      if (conditions.length === 0) return byState.total;
      const state = conditions[0]?.value[0] ?? "";
      return byState.counts[state] ?? 0;
    }),
  };
}

describe("createTodayOverviewReply", () => {
  it("carries the read counts straight through to the card, with no per-operator filtering", async () => {
    const client = overviewCountBitable({
      total: 42,
      counts: { 待跟进: 5, 跟进中: 5, 待闭环: 0, 已闭环: 30 },
    });
    const reply = createTodayOverviewReply(() => client);

    const message = await reply();

    expect(message.content).toContain("反馈总量");
    expect(message.content).toContain("42");
    expect(message.content).toContain("已建单");
    expect(message.content).toContain("40");
    expect(message.content).toContain("已闭环");
    expect(message.content).toContain("30");
    expect(message.content).toContain("闭环率");
    expect(message.content).toContain("75%");
  });

  it("produces the unavailable card, with no numbers anywhere, when a count fails", async () => {
    const client = overviewCountBitable(null);
    const reply = createTodayOverviewReply(() => client);

    const message = await reply();
    const card = JSON.parse(message.content) as Record<string, unknown>;
    const elementsJson = JSON.stringify(
      (card.body as Record<string, unknown>).elements,
    );

    expect(elementsJson).not.toMatch(/[0-9]/);
    expect(elementsJson).toContain("暂不可用");
  });
});

// ---------------------------------------------------------------------------
// Chat entry, end to end: real parseFeishuEvent, not a mocked outcome — this
// is where "the fix lives in the parser, not a dedup cache" is actually
// exercised. A test that fed parseEvent a hand-picked return value would
// happily replay whatever kind it was told to and prove nothing about
// whether the real event handler still treats this event type as a trigger
// for anything.
// ---------------------------------------------------------------------------

function enteredEventBody(chatId = "oc_onecare_chat") {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_entered_route",
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

describe("POST /api/feishu/events — chat entry sends nothing, end to end", () => {
  it("acknowledges the event and calls no outbound dependency at all", async () => {
    const bitable = groupBitable(groupTicket());
    const answer = vi.fn(async (_q: string, _f: string) => "should never be seen");
    const setup = liveGroupDependencies(bitable, answer);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(enteredEventBody()),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(setup.scheduled).toHaveLength(0);
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    expect(setup.dependencies.replyMessage).not.toHaveBeenCalled();
    expect(setup.dependencies.createWelcome).not.toHaveBeenCalled();
    expect(setup.dependencies.operationsReply).not.toHaveBeenCalled();
    expect(bitable.findByWarRoomChatId).not.toHaveBeenCalled();
  });

  it("still ignores the event, and still sends nothing, no matter which chat id it names", async () => {
    for (const chatId of ["oc_another_chat", "   ", ""]) {
      const setup = liveGroupDependencies(groupBitable(null), async () => null);

      const response = await createFeishuEventRoute(setup.dependencies)(
        signedRequest(enteredEventBody(chatId)),
      );

      expect(response.status).toBe(200);
      expect(setup.scheduled).toHaveLength(0);
      expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// The p2p operations reply, end to end: a real signed message body through
// the real parseFeishuEvent and the real createOperationsReply, over a fake
// records list — proving the sender's own open_id actually threads from the
// raw event payload through to which records get counted, not just that each
// layer works in isolation against a hand-built value.
// ---------------------------------------------------------------------------

// Task 13: a real application.bot.menu_v6 body, shaped exactly like Feishu's
// own schema 2.0 example for this event type — nesting the clicking
// operator's identity at event.operator.operator_id.open_id, one level
// deeper than a card callback's event.operator.open_id. This is what proves
// the operator id actually threads from the raw, signed event payload all the
// way to which records voc_my_tickets counts, not just that each layer works
// in isolation against a hand-built value — the same end-to-end standard the
// p2p operator-summary tests this replaces already held themselves to.
function menuClickEventBody(eventKey: string, operatorOpenId = "ou_operator") {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_menu_click_route",
      event_type: "application.bot.menu_v6",
      create_time: "1784371200000",
      token: env.verificationToken,
      app_id: env.appId,
      tenant_key: "tenant_onecare",
    },
    event: {
      operator: {
        operator_name: "张三",
        operator_id: {
          union_id: "on_operator",
          user_id: "u_operator",
          open_id: operatorOpenId,
        },
      },
      event_key: eventKey,
      timestamp: "1784371200000",
    },
  };
}

// Task 14: replaces the readVocRecordsCached/getVocDashboardMetrics-shaped
// fakes with a fake BitableClient exposing only countRecords — the same
// dependency surface production now wires both replies through. `null` for
// either forces every count for that card to fail, standing in for the old
// `{ status: "unavailable" }` / `{ ok: false }` sentinels.
function liveMenuDependencies(
  personal: Readonly<{
    total: number;
    counts: Record<string, Record<string, number>>;
  }> | null,
  overview: Readonly<{ total: number; counts: Record<string, number> }> | null,
) {
  const scheduled: Array<() => Promise<void>> = [];
  return {
    scheduled,
    dependencies: {
      readEnv: () => env,
      parseEvent: (input: { rawBody: string; headers: Headers; env: BotEnv }) =>
        parseFeishuEvent({ ...input, botOpenId: async () => "ou_bot_unused" }),
      operationsReply: createOperationsReply(() => personalCountBitable(personal)),
      todayOverviewReply: createTodayOverviewReply(() => overviewCountBitable(overview)),
      createMenuHint: vi.fn(() => ({
        msgType: "text" as const,
        content: JSON.stringify({ text: "请使用菜单查看数据" }),
      })),
      createWelcome: vi.fn(() => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ welcome: true }),
      })),
      replyMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
      // Explicitly typed (not a zero-arg `async () => undefined`) so
      // `.mock.calls[0]` below is a real one-element tuple — the same trap
      // this file's other live-dependency fakes already guard against.
      sendDirectMessage: vi.fn(
        async (_input: {
          env: BotEnv;
          openId: string;
          message: FeishuOutboundMessage;
        }) => undefined,
      ),
      resolveAction: vi.fn(async () => {
        throw new Error("resolveAction should not be called for this test");
      }),
      answerGroupQuestion: vi.fn(async () => {
        throw new Error("answerGroupQuestion should not be called for this test");
      }),
      schedule: (task: () => Promise<void>) => {
        scheduled.push(task);
      },
      reportFailure: vi.fn(),
    },
  };
}

describe("POST /api/feishu/events — menu clicks, end to end", () => {
  it("replies to voc_my_tickets with a real card carrying no demo markers, DMed to the real event body's operator", async () => {
    const setup = liveMenuDependencies(
      { total: 1, counts: { ou_operator: { 待跟进: 1 } } },
      null,
    );

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(menuClickEventBody("voc_my_tickets", "ou_operator")),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(setup.dependencies.sendDirectMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.sendDirectMessage).toHaveBeenCalledTimes(1);
    const [call] = setup.dependencies.sendDirectMessage.mock.calls;
    expect(call[0].openId).toBe("ou_operator");
    const content = call[0].message.content;
    expect(content).not.toContain("演示");
    expect(content).not.toContain(ONECARE_CASE_ID);
    expect(content).toContain("我的待跟进");
  });

  it("counts only the clicking operator's own records for voc_my_tickets, proven end to end from a real event body", async () => {
    const setup = liveMenuDependencies(
      {
        total: 3,
        counts: { ou_alice: { 待跟进: 1 }, ou_bob: { 待跟进: 2 } },
      },
      null,
    );

    await createFeishuEventRoute(setup.dependencies)(
      signedRequest(menuClickEventBody("voc_my_tickets", "ou_bob")),
    );
    await setup.scheduled[0]();

    const [call] = setup.dependencies.sendDirectMessage.mock.calls;
    expect(call[0].openId).toBe("ou_bob");
    const content = call[0].message.content;
    // ou_bob owns 2 of the 3 records; ou_alice's single record must not be
    // folded into that count.
    expect(content).toContain("我的待跟进");
    expect(content).toContain("2 条");
  });

  it("replies to voc_today_overview with the shared, un-recomputed counts, DMed to the clicking operator", async () => {
    const setup = liveMenuDependencies(null, {
      total: 120,
      counts: { 待跟进: 20, 跟进中: 20, 待闭环: 40, 已闭环: 60 },
    });

    await createFeishuEventRoute(setup.dependencies)(
      signedRequest(menuClickEventBody("voc_today_overview", "ou_operator")),
    );
    await setup.scheduled[0]();

    const [call] = setup.dependencies.sendDirectMessage.mock.calls;
    expect(call[0].openId).toBe("ou_operator");
    const content = call[0].message.content;
    expect(content).toContain("反馈总量");
    expect(content).toContain("120");
    expect(content).toContain("已建单");
    expect(content).toContain("已闭环");
    expect(content).toContain("60");
    expect(content).toContain("闭环率");
  });

  // The menu can grow new items from the Feishu console alone; this deploy
  // must treat one it does not recognise as a complete no-op, never a card.
  it("sends zero outbound calls for a menu item this deploy does not recognise", async () => {
    const setup = liveMenuDependencies(null, null);

    const response = await createFeishuEventRoute(setup.dependencies)(
      signedRequest(menuClickEventBody("voc_future_item", "ou_operator")),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(setup.scheduled).toHaveLength(0);
    expect(setup.dependencies.sendDirectMessage).not.toHaveBeenCalled();
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
    expect(setup.dependencies.replyMessage).not.toHaveBeenCalled();
  });
});
