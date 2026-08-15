import { getCurrentSession } from "../../../../../../../src/features/auth/current-session";
import { isGuest, refuseGuestWrite } from "../../../../../../../src/features/auth/guest";
import type { AuthUser } from "../../../../../../../src/features/auth/types";
import { createProfileInsightCard } from "../../../../../../../src/features/feishu-bot/cards";
import { createWarRoomChat } from "../../../../../../../src/features/feishu-bot/chat-client";
import { sendFeishuMessage } from "../../../../../../../src/features/feishu-bot/client";
import { ruleBasedProvider } from "../../../../../../../src/features/profiles/insight";
import {
  claimIdentityWarRoom,
  readIdentityWarRoom,
} from "../../../../../../../src/features/store/identity-war-rooms";
import {
  readIdentityResponderOpenIds,
  readIdentityRecords,
  readProfile,
} from "../../../../../../../src/features/store/workbench-query";
import {
  openIdentityWarRoom,
  type IdentityWarRoomDependencies,
} from "../../../../../../../src/features/warroom/identity";
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
export function createProfileWarRoomRoute(
  dependencies: IdentityWarRoomDependencies & {
    session: () => Promise<AuthUser | null>;
  },
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
      if (isGuest(user)) return refuseGuestWrite();

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

      // Every rule lives in openIdentityWarRoom, which the 设备预警卡's own button calls
      // too — the console and the card must not be able to disagree about who is in the
      // group or what a second click does.
      const outcome = await openIdentityWarRoom(
        { kind, id: identity, operatorOpenId: user.openId },
        dependencies,
      );

      if (outcome.kind === "not_found") {
        return Response.json(
          { error: "not_found", message: outcome.message },
          { status: 404 },
        );
      }
      if (outcome.kind === "chat_failed") {
        return Response.json(
          { error: "chat_failed", message: outcome.message },
          { status: 502 },
        );
      }

      return Response.json({
        ok: true,
        // A group whose analysis card failed to post is still a group that now exists:
        // reporting created: false there would invite a second click and a second group.
        created: outcome.kind === "created" || outcome.kind === "card_failed",
        chatId: outcome.chatId,
        message: outcome.message,
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
  getResponderOpenIds: readIdentityResponderOpenIds,
  provider: ruleBasedProvider,
  existingChat: async (kind, id) => (await readIdentityWarRoom(kind, id))?.chatId ?? null,
  createChat: (name, memberOpenIds) =>
    createWarRoomChat({ env: readBotEnv(), name, memberOpenIds }),
  claimChat: claimIdentityWarRoom,
  buildCard: ({ kind, id, insight, openTicketNumbers }) =>
    createProfileInsightCard({
      kind,
      id,
      level: insight.level,
      headline: insight.headline,
      labels: insight.labels,
      signals: insight.signals,
      actions: insight.actions,
      producedBy: insight.producedBy,
      openTicketNumbers,
    }),
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
