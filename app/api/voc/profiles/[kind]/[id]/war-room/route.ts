import { getCurrentSession } from "../../../../../../../src/features/auth/current-session";
import type { AuthUser } from "../../../../../../../src/features/auth/types";
import { createProfileInsightCard } from "../../../../../../../src/features/feishu-bot/cards";
import type { FeishuCard } from "../../../../../../../src/features/feishu-bot/card-types";
import { createWarRoomChat } from "../../../../../../../src/features/feishu-bot/chat-client";
import { sendFeishuMessage } from "../../../../../../../src/features/feishu-bot/client";
import {
  ruleBasedProvider,
  type ProfileInsight,
  type ProfileInsightProvider,
} from "../../../../../../../src/features/profiles/insight";
import {
  claimIdentityWarRoom,
  readIdentityWarRoom,
} from "../../../../../../../src/features/store/identity-war-rooms";
import {
  readIdentityOwnerOpenIds,
  readIdentityRecords,
  readProfile,
} from "../../../../../../../src/features/store/workbench-query";
import type { WorkbenchTicket } from "../../../../../../../src/features/workbench/data";
import type { IdentityProfile } from "../../../../../../../src/features/workbench/profiles";
import { readBotEnv } from "../../../../../../../src/lib/env";

// 拉群处理 for one identity, from 用户画像 or 设备追踪 — the same move the ticket path
// offers, for a subject that is not a ticket.
//
// Differences from the ticket path, all forced by what an identity is:
//
//   - There is no Bitable row to write 协同群 ID onto (an identity spans many rows), so
//     idempotence lives in Postgres. See store/identity-war-rooms.ts.
//   - Members are the operator plus whoever owns this identity's unfinished tickets:
//     those are the people who would otherwise be told about the group second-hand.
//   - The card posted in is the analysis. A group created empty leaves everyone who was
//     just added asking what it is for.
//
// A group is a real, outward-facing thing that appears in colleagues' Feishu. It is
// created only on an explicit click, only once per identity, and the response always says
// which group the operator should be in.
export type ProfileWarRoomDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  getProfile: (
    kind: "user" | "device",
    id: string,
  ) => Promise<IdentityProfile | null>;
  getRecords: (
    kind: "user" | "device",
    id: string,
  ) => Promise<readonly WorkbenchTicket[]>;
  // Separate from getRecords because WorkbenchTicket deliberately omits owner open_ids:
  // an open_id names a person and those rows come from a cache shared by every viewer.
  // The group needs the ids, so they are read here and nowhere else.
  getOwnerOpenIds: (
    kind: "user" | "device",
    id: string,
  ) => Promise<readonly string[]>;
  provider: ProfileInsightProvider;
  existingChat: (kind: "user" | "device", id: string) => Promise<string | null>;
  createChat: (name: string, memberOpenIds: readonly string[]) => Promise<string>;
  claimChat: (
    kind: "user" | "device",
    id: string,
    chatId: string,
    createdBy: string,
  ) => Promise<Readonly<{ chatId: string; created: boolean }>>;
  sendCard: (chatId: string, card: FeishuCard) => Promise<void>;
  now: () => number;
}>;

const TERMINAL = new Set(["已闭环", "无需跟进"]);

// `VOC-用户-<id>`, matching the shape warRoomName gives a ticket's group so a person
// scanning their Feishu sidebar can tell what any of them is about.
export function identityWarRoomName(
  kind: "user" | "device",
  id: string,
  level: string,
): string {
  return `VOC-${kind === "user" ? "用户" : "设备"}-${id}-${level}`;
}

export function createProfileWarRoomRoute(
  dependencies: ProfileWarRoomDependencies,
) {
  return async function POST(
    _request: Request,
    context: { params: Promise<{ kind: string; id: string }> },
  ): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }

      const { kind, id } = await context.params;
      if (kind !== "user" && kind !== "device") {
        return Response.json(
          { error: "bad_request", message: "只支持用户或设备画像" },
          { status: 400 },
        );
      }
      const identity = decodeURIComponent(id);
      if (identity.length === 0) {
        return Response.json(
          { error: "bad_request", message: "缺少标识" },
          { status: 400 },
        );
      }

      // Idempotence before anything expensive, and before anything outward-facing: a
      // second click must never produce a second group.
      const existing = await dependencies.existingChat(kind, identity);
      if (existing) {
        return Response.json({
          ok: true,
          created: false,
          chatId: existing,
          message: "协同群已存在，请在飞书中打开",
        });
      }

      const [profile, records, ownerOpenIds] = await Promise.all([
        dependencies.getProfile(kind, identity),
        dependencies.getRecords(kind, identity),
        dependencies.getOwnerOpenIds(kind, identity),
      ]);
      if (!profile) {
        return Response.json(
          { error: "not_found", message: "找不到这个标识" },
          { status: 404 },
        );
      }

      const insight: ProfileInsight = await dependencies.provider.analyze({
        kind,
        profile,
        records,
        now: dependencies.now(),
      });

      const openTickets = records.filter(
        (record) => record.ticketOpenedAt !== null && !TERMINAL.has(record.state),
      );
      // De-duplicated by the chat client, but assembled here so the intent is legible:
      // whoever clicked, plus whoever already owns unfinished work on this identity.
      const members = [user.openId, ...ownerOpenIds];

      let chatId: string;
      try {
        chatId = await dependencies.createChat(
          identityWarRoomName(kind, identity, insight.level),
          members,
        );
      } catch {
        return Response.json(
          { error: "chat_failed", message: "协同群创建失败，请稍后重试" },
          { status: 502 },
        );
      }

      // Claimed immediately after creation, before the card: if two operators raced, the
      // loser is told about the winner's group instead of both posting into two.
      const claim = await dependencies.claimChat(
        kind,
        identity,
        chatId,
        user.openId,
      );
      if (!claim.created) {
        return Response.json({
          ok: true,
          created: false,
          chatId: claim.chatId,
          message: "协同群已存在，请在飞书中打开",
        });
      }

      try {
        await dependencies.sendCard(
          chatId,
          createProfileInsightCard({
            kind,
            id: identity,
            level: insight.level,
            headline: insight.headline,
            labels: insight.labels,
            signals: insight.signals,
            actions: insight.actions,
            producedBy: insight.producedBy,
            openTicketNumbers: openTickets.map((record) => record.recordNumber),
          }),
        );
      } catch {
        // The group exists and is recorded; a failed post is cosmetic. Reported so the
        // operator shares the analysis themselves rather than wondering why the group is
        // empty — the same choice the ticket path makes.
        return Response.json({
          ok: true,
          created: true,
          chatId,
          message: "协同群已创建，但分析卡片发送失败，请在群内手动说明",
        });
      }

      return Response.json({
        ok: true,
        created: true,
        chatId,
        message: `协同群已创建，已拉入 ${new Set(members).size} 人`,
      });
    } catch {
      return Response.json(
        { error: "internal", message: "服务暂时不可用，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

export const POST = createProfileWarRoomRoute({
  session: getCurrentSession,
  getProfile: readProfile,
  getRecords: readIdentityRecords,
  getOwnerOpenIds: readIdentityOwnerOpenIds,
  provider: ruleBasedProvider,
  existingChat: async (kind, id) => (await readIdentityWarRoom(kind, id))?.chatId ?? null,
  createChat: (name, memberOpenIds) =>
    createWarRoomChat({ env: readBotEnv(), name, memberOpenIds }),
  claimChat: claimIdentityWarRoom,
  // sendFeishuMessage's input is a union of chatId or openId, never both; this always
  // takes the chatId branch because it only ever posts into the group it just created.
  sendCard: (chatId, card) =>
    sendFeishuMessage({
      env: readBotEnv(),
      chatId,
      message: { msgType: "interactive", content: JSON.stringify(card) },
    }),
  now: () => Date.now(),
});
