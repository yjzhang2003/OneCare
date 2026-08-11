import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { BotEnv } from "../../../../src/lib/env";
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
  type OneCareCardAction,
  type VocCardAction,
} from "../../../../src/features/feishu-bot/card-types";
import { createFeishuEventRoute, createResolveAction } from "./route";

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
      createReply: vi.fn((text: string) => ({
        kind: "help" as const,
        message: {
          msgType: "interactive" as const,
          content: JSON.stringify({ schema: "2.0", reply: text }),
        },
      })),
      createWelcome: vi.fn(() => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ welcome: true }),
      })),
      replyMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
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

  it("acknowledges a message before the scheduled reply runs", async () => {
    const setup = dependencies({
      kind: "message",
      messageId: "om_message",
      text: "开始体验",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    expect(setup.dependencies.replyMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.createReply).toHaveBeenCalledWith("开始体验");
    expect(setup.dependencies.replyMessage).toHaveBeenCalledWith({
      env,
      messageId: "om_message",
      message: {
        msgType: "interactive",
        content: JSON.stringify({ schema: "2.0", reply: "开始体验" }),
      },
    });
    expect(setup.dependencies.sendMessage).not.toHaveBeenCalled();
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
    });
    setup.dependencies.replyMessage.mockRejectedValueOnce(
      new Error("private upstream response"),
    );

    await createFeishuEventRoute(setup.dependencies)(request());
    await setup.scheduled[0]();

    expect(setup.dependencies.reportFailure).toHaveBeenCalledWith();
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

// Only `readEnv` and the two outbound message senders are faked; parseEvent
// and resolveAction are the production functions.
function liveDependencies(client: VocActionBitable) {
  const scheduled: Array<() => Promise<void>> = [];
  return {
    scheduled,
    dependencies: {
      readEnv: () => env,
      parseEvent: parseFeishuEvent,
      createReply: vi.fn((text: string) => ({
        kind: "help" as const,
        message: {
          msgType: "interactive" as const,
          content: JSON.stringify({ reply: text }),
        },
      })),
      createWelcome: vi.fn(() => ({
        msgType: "interactive" as const,
        content: JSON.stringify({ welcome: true }),
      })),
      replyMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
      resolveAction: createResolveAction(() => client),
      schedule: (task: () => Promise<void>) => {
        scheduled.push(task);
      },
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
