import { revalidateTag } from "next/cache";

import { getCurrentSession } from "../../../../../../src/features/auth/current-session";
import { isGuest, refuseGuestWrite } from "../../../../../../src/features/auth/guest";
import type { AuthUser } from "../../../../../../src/features/auth/types";
import {
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../../../src/features/bitable/client";
import type { VocRecord } from "../../../../../../src/features/bitable/field-map";
import type { FeishuCard } from "../../../../../../src/features/feishu-bot/card-types";
import { createWarRoomChat } from "../../../../../../src/features/feishu-bot/chat-client";
import { sendFeishuMessage } from "../../../../../../src/features/feishu-bot/client";
import { resolveWarRoomAction } from "../../../../../../src/features/feishu-bot/war-room-actions";
import { writeRecord } from "../../../../../../src/features/store/mirror";
import { readRecordById } from "../../../../../../src/features/store/records";
import { VOC_RECORDS_CACHE_TAG } from "../../../../../../src/features/voc/cache-tags";
import { warRoomDecision } from "../../../../../../src/features/warroom/naming";
import { readBitableEnv, readBotEnv } from "../../../../../../src/lib/env";
import { listOwnerRuleRecords } from "../../../../../../src/features/voc/owner-directory";
import { adminOpenIds } from "../../../../../../src/features/voc/owner-rules";

// 拉群处理 for one ticket, from the workbench.
//
// The chain itself already existed — it is what the escalation card's 确认拉群 button
// runs — but its only entry point was that card, which fires **at the moment tagging
// judges a ticket 高严重度** and never again. So a ticket that needed a group an hour
// later had no way to get one, and the 49 high-severity tickets already in the data
// had missed their moment permanently. This route gives every ticket the same button.
//
// Every rule is resolveWarRoomAction's, called rather than restated: who may do it
// (负责人 or 兜底人), what a second click does (nothing — the 协同群 ID column is the
// idempotence record), what the group is called, who is in it, and what is posted into
// it. Two things differ, both because a browser is not a card callback:
//
//   - The slow half runs inline. The card path defers it because Feishu kills a
//     callback at ~3s; an HTTP request has no such deadline, so the operator gets the
//     real outcome instead of "正在创建".
//   - `notifyOperator` is captured rather than sent as a DM. Nobody needs a Feishu
//     message about a click they are watching the response of.
export const maxDuration = 60;

export type TicketWarRoomDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  updateRecord: (recordId: string, fields: Record<string, unknown>) => Promise<void>;
  fallbackOpenIds: () => Promise<readonly string[]>;
  createChat: (name: string, memberOpenIds: readonly string[]) => Promise<string>;
  sendToChat: (chatId: string, card: FeishuCard) => Promise<void>;
  revalidate: () => void;
}>;

// A manual click supersedes an earlier 暂不需要. The decline marker exists to stop the
// pipeline from proposing the same group twice; it was never meant to make a group
// unobtainable, and there is no second proposal to accept once it is set. Expressed by
// clearing the marker before the decision runs, so resolveWarRoomAction stays the only
// place that knows what a 协同群 ID column means.
function supersedeDecline(record: VocRecord): VocRecord {
  return warRoomDecision(record.warRoomChatId) === "declined"
    ? { ...record, warRoomChatId: "" }
    : record;
}

export function createTicketWarRoomRoute(dependencies: TicketWarRoomDependencies) {
  return async function POST(
    _request: Request,
    context: { params: Promise<{ recordId: string }> },
  ): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }
      if (isGuest(user)) return refuseGuestWrite();

      const { recordId } = await context.params;
      if (!recordId) {
        return Response.json(
          { error: "bad_request", message: "缺少工单 ID" },
          { status: 400 },
        );
      }

      // What the background task would have sent as a direct message. Captured so the
      // HTTP response can carry it instead: "协同群已创建但未记录" is exactly the kind
      // of half-failure the operator must not have to discover from a toast that says
      // success.
      let failure: string | null = null;

      const outcome = await resolveWarRoomAction({
        action: "voc_open_war_room",
        recordId,
        operatorOpenId: user.openId,
        getRecord: async (id) => {
          const record = await dependencies.getRecord(id);
          return record === null ? null : supersedeDecline(record);
        },
        updateRecord: dependencies.updateRecord,
        fallbackOpenIds: dependencies.fallbackOpenIds,
        createChat: dependencies.createChat,
        sendToChat: dependencies.sendToChat,
        notifyOperator: async (_openId, text) => {
          failure = text;
        },
      });

      // No background task means the decision was already final: no such record, not
      // authorized, or a group that already exists. The toast content is the message —
      // one wording for the card and the console both.
      const toast =
        outcome.result.kind === "update"
          ? (outcome.result.response.toast?.content ?? "")
          : "";

      if (!outcome.background) {
        const status = toast.includes("未找到")
          ? 404
          : toast.includes("不是该工单的负责人")
            ? 403
            : 200;
        return Response.json(
          status === 200
            ? { ok: true, created: false, message: toast }
            : { error: status === 404 ? "not_found" : "forbidden", message: toast },
          { status },
        );
      }

      await outcome.background();

      if (failure !== null) {
        // 协同群创建失败 leaves nothing behind; the other two leave a real group that the
        // record either does or does not point at. All three are the operator's to act
        // on, so none of them is reported as success.
        return Response.json(
          { error: "chat_failed", message: failure },
          { status: 502 },
        );
      }

      // Only now: the 协同群 ID column changed, so the row the console is showing is
      // stale. Same primitive and same reasoning as the sibling action route.
      dependencies.revalidate();

      return Response.json({
        ok: true,
        created: true,
        message: "协同群已创建，工单卡已发进群",
      });
    } catch {
      return Response.json(
        { error: "internal", message: "服务暂时不可用，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

// ---------------------------------------------------------------------------

let tokenProvider: TenantTokenProvider | null = null;
function getTokenProvider(): TenantTokenProvider {
  if (!tokenProvider) {
    const botEnv = readBotEnv();
    tokenProvider = createTenantTokenProvider(botEnv.appId, botEnv.appSecret);
  }
  return tokenProvider;
}

let bitableClient: BitableClient | null = null;
function getBitableClient(): BitableClient {
  if (!bitableClient) {
    bitableClient = createBitableClient(readBitableEnv(), getTokenProvider());
  }
  return bitableClient;
}

export const POST = createTicketWarRoomRoute({
  session: getCurrentSession,
  getRecord: readRecordById,
  updateRecord: async (recordId, fields) => {
    const pushes: Promise<void>[] = [];
    await writeRecord(
      { bitable: getBitableClient(), defer: (task) => pushes.push(task()) },
      recordId,
      fields,
    );
    await Promise.all(pushes);
  },
  // Who may pull a group on a ticket they do not own: the 兜底人 (which is what
  // resolveWarRoomAction's parameter is named for) and, since roles landed, the
  // 管理员 — the same widening the workbench write path makes.
  fallbackOpenIds: async () => {
    const rules = await listOwnerRuleRecords({
      bitable: readBitableEnv(),
      token: getTokenProvider(),
    });
    return [
      ...rules
        .filter(
          (rule) =>
            rule.role === "客服" && rule.fallback && rule.openId.trim().length > 0,
        )
        .map((rule) => rule.openId),
      ...adminOpenIds(rules),
    ];
  },
  createChat: (name, memberOpenIds) =>
    createWarRoomChat({ env: readBotEnv(), name, memberOpenIds }),
  sendToChat: (chatId, card) =>
    sendFeishuMessage({
      env: readBotEnv(),
      chatId,
      message: { msgType: "interactive", content: JSON.stringify(card) },
    }),
  revalidate: () => revalidateTag(VOC_RECORDS_CACHE_TAG, { expire: 0 }),
});
