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
import { syncTicketCardsInBackground } from "../../../../../../src/features/feishu-bot/card-sync-wiring";
import { createEngineerTaskCard } from "../../../../../../src/features/feishu-bot/cards";
import type { FeishuCard } from "../../../../../../src/features/feishu-bot/card-types";
import { sendFeishuMessage } from "../../../../../../src/features/feishu-bot/client";
import { ruleBasedProvider } from "../../../../../../src/features/profiles/insight";
import { writeRecord } from "../../../../../../src/features/store/mirror";
import { readRecordById } from "../../../../../../src/features/store/records";
import {
  readIdentityRecords,
  readProfile,
} from "../../../../../../src/features/store/workbench-query";
import { VOC_RECORDS_CACHE_TAG } from "../../../../../../src/features/voc/cache-tags";
import { rememberTicketCard } from "../../../../../../src/features/store/ticket-cards";
import { dispatchTicket } from "../../../../../../src/features/voc/dispatch";
import { listOwnerRuleRecords } from "../../../../../../src/features/voc/owner-directory";
import type { OwnerRuleRecord } from "../../../../../../src/features/voc/owner-rules";
import {
  defaultNotifyDependencies,
  notify,
  type NotifyInput,
} from "../../../../../../src/features/notify/deliver";
import { readBitableEnv, readBotEnv } from "../../../../../../src/lib/env";

// 派工: hand a ticket to the engineer who will go on site.
//
// The 客服 owner keeps the ticket — 上门工程师 is a second person column beside 负责人,
// not a replacement for it. That distinction is the whole point: the owner still answers
// for closing it, and the engineer answers for what happens at the customer's home.
//
// What the engineer gets is a card in Feishu, not an account on this workbench. They are
// standing in a stairwell with a toolbox; the surface that fits is the one already in
// their pocket. Everything they need to avoid the "多次上门、多次描述" loop the brief
// names is on that card — the machine, the customer's words, and how many times this same
// device has been reported before.
export const maxDuration = 60;

export type DispatchDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  updateRecord: (recordId: string, fields: Record<string, unknown>) => Promise<void>;
  // The routing table doubles as the roster: 工程师 rows are who may be dispatched to,
  // and 管理员 rows are who may dispatch a ticket they do not own.
  listRoster: () => Promise<readonly OwnerRuleRecord[]>;
  // This device's other records, for the history block on the card. Failing to read
  // them costs the card a block; it never blocks the dispatch.
  deviceContext: (deviceRef: string) => Promise<
    Readonly<{
      total: number;
      open: number;
      recurrence: Readonly<{
        level: string;
        headline: string;
        actions: readonly string[];
        producedBy: string;
      }> | null;
    }>
  >;
  // Returns the sent message's id so the caller can register the card for later
  // redraws; null when the transport cannot supply one.
  sendCard: (openId: string, card: FeishuCard) => Promise<string | null>;
  // The console's copy of this event. Separate from sendCard because the card is the
  // message and this is the row that makes it findable afterwards.
  notify: (input: NotifyInput) => Promise<void>;
  rememberCard: typeof rememberTicketCard;
  syncCards: (recordId: string) => Promise<unknown>;
  revalidate: () => void;
  now: () => number;
}>;

const TERMINAL = new Set(["已闭环", "无需跟进"]);

export function parseDispatch(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const openId = (body as { engineerOpenId?: unknown }).engineerOpenId;
  return typeof openId === "string" && openId.trim().length > 0 ? openId : null;
}

export function createDispatchRoute(dependencies: DispatchDependencies) {
  return async function POST(
    request: Request,
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
      const engineerOpenId = parseDispatch(await request.json().catch(() => null));
      if (!recordId || !engineerOpenId) {
        return Response.json(
          { error: "bad_request", message: "请选择要派工的工程师" },
          { status: 400 },
        );
      }

      const result = await dispatchTicket(
        {
          recordId,
          engineerOpenId,
          operatorOpenId: user.openId,
          operatorName: user.name,
        },
        {
          getRecord: dependencies.getRecord,
          listRoster: dependencies.listRoster,
          updateRecord: dependencies.updateRecord,
          now: dependencies.now,
          sendTaskCard: async (dispatched, openId) => {
            const context_ = await dependencies
              .deviceContext(dispatched.deviceRef)
              .catch(() => ({ total: 0, open: 0, recurrence: null }));
            const payload = {
              dispatcherName: user.name,
              model: dispatched.model,
              userRef: dispatched.userRef,
              deviceRef: dispatched.deviceRef,
              deviceTotal: context_.total,
              deviceOpen: context_.open,
              recurrence: context_.recurrence,
            };
            try {
              const messageId = await dependencies.sendCard(
                openId,
                createEngineerTaskCard({
                  record: dispatched,
                  tag: {
                    summary: dispatched.summary,
                    polarity: dispatched.polarity ?? "—",
                    dimensions: dispatched.dimensions,
                    replies: dispatched.replies,
                  },
                  ...payload,
                }),
              );
              await dependencies.rememberCard({
                messageId,
                recordId,
                audience: "engineer",
                payload,
              });
              return true;
            } catch {
              return false;
            }
          },
        },
      );

      if (result.kind === "not_found") {
        return Response.json(
          { error: "not_found", message: "记录不存在或已被删除" },
          { status: 404 },
        );
      }
      if (result.kind === "forbidden") {
        return Response.json(
          { error: "forbidden", message: result.message },
          { status: 403 },
        );
      }
      if (result.kind === "rejected") {
        return Response.json(
          { error: "rejected", message: result.message },
          { status: 422 },
        );
      }
      if (result.kind === "write_failed") {
        return Response.json(
          { error: "write_failed", message: "派工写入失败，请稍后重试" },
          { status: 502 },
        );
      }
      if (result.kind === "already") {
        return Response.json({
          ok: true,
          dispatched: false,
          message: `${result.engineerName}已经在这条工单上了`,
        });
      }

      dependencies.revalidate();

      await dependencies.notify({
        kind: "engineer_dispatched",
        openId: engineerOpenId,
        recordId,
        sendFeishuText: false,
        subject: {
          recordNumber: result.record.recordNumber,
          channel: result.record.channel,
          category: result.record.category,
          summary: result.record.summary,
          content: result.record.content,
          severity: result.record.severity,
          state: result.record.state,
          actorName: user.name,
        },
      });

      if (!result.cardSent) {
        return Response.json({
          ok: true,
          dispatched: true,
          message: `已派工给${result.engineerName}，但上门任务卡发送失败，请在飞书里手动通知`,
        });
      }

      // The owner's card and the war room's copy both still say 跟进中; the
      // ticket is 上门中 now, and whoever is looking at either surface should see
      // that without being told twice.
      await dependencies.syncCards(recordId);

      return Response.json({
        ok: true,
        dispatched: true,
        message: `已派工给${result.engineerName}，上门任务卡已发到他的飞书`,
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

export const POST = createDispatchRoute({
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
  listRoster: () =>
    listOwnerRuleRecords({ bitable: readBitableEnv(), token: getTokenProvider() }),
  deviceContext: async (deviceRef) => {
    if (deviceRef.trim().length === 0) {
      return { total: 0, open: 0, recurrence: null };
    }
    const [profile, records] = await Promise.all([
      readProfile("device", deviceRef),
      readIdentityRecords("device", deviceRef),
    ]);
    const open = records.filter(
      (record) => record.ticketOpenedAt !== null && !TERMINAL.has(record.state),
    ).length;
    if (!profile) return { total: records.length, open, recurrence: null };

    const insight = await ruleBasedProvider.analyze({
      kind: "device",
      profile,
      records,
      now: Date.now(),
    });
    return {
      total: records.length,
      open,
      recurrence: {
        level: insight.level,
        headline: insight.headline,
        actions: insight.actions,
        producedBy: insight.producedBy,
      },
    };
  },
  notify: (input) => notify(input, defaultNotifyDependencies()),
  sendCard: async (openId, card) => {
    return await sendFeishuMessage({
      env: readBotEnv(),
      openId,
      message: { msgType: "interactive", content: JSON.stringify(card) },
    });
  },
  rememberCard: rememberTicketCard,
  syncCards: (recordId) => syncTicketCardsInBackground(recordId),
  revalidate: () => revalidateTag(VOC_RECORDS_CACHE_TAG, { expire: 0 }),
  now: () => Date.now(),
});
