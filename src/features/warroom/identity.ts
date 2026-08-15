// 标识拉群: convene a group about a user or a device rather than about one ticket.
//
// Extracted from the HTTP route so a Feishu card can run it too. The 设备预警卡 lands in
// someone's chat with a verdict on it — "这台机器 7 次报修，建议按复发处理" — and the move
// that verdict calls for is a group. Making them leave the card, open the console, find
// the device and click there is three steps to reach a button we could have put on the
// card.
//
// The rules are the ones the route always had, and they are the reason this is a shared
// function rather than two copies:
//
//   - Idempotence lives in Postgres, not on a Bitable row: an identity spans many rows,
//     so there is no single record to write 协同群 ID onto. A second click joins the
//     first group instead of making a second.
//   - Members are whoever clicked plus everyone already working this identity's
//     unfinished tickets — 客服 and 工程师 both.
//   - The first message is the analysis. A group created empty leaves everyone who was
//     just added asking what it is for.

import type { ProfileInsight, ProfileInsightProvider } from "../profiles/insight";
import type { FeishuCard } from "../feishu-bot/card-types";
import type { IdentityProfile } from "../workbench/profiles";
import type { WorkbenchTicket } from "../workbench/data";

export type IdentityKind = "user" | "device";

export type IdentityWarRoomDependencies = Readonly<{
  getProfile: (kind: IdentityKind, id: string) => Promise<IdentityProfile | null>;
  getRecords: (kind: IdentityKind, id: string) => Promise<readonly WorkbenchTicket[]>;
  // Owners *and* engineers of this identity's unfinished tickets.
  getResponderOpenIds: (kind: IdentityKind, id: string) => Promise<readonly string[]>;
  provider: ProfileInsightProvider;
  existingChat: (kind: IdentityKind, id: string) => Promise<string | null>;
  createChat: (name: string, memberOpenIds: readonly string[]) => Promise<string>;
  claimChat: (
    kind: IdentityKind,
    id: string,
    chatId: string,
    createdBy: string,
  ) => Promise<Readonly<{ chatId: string; created: boolean }>>;
  buildCard: (
    input: Readonly<{
      kind: IdentityKind;
      id: string;
      insight: ProfileInsight;
      openTicketNumbers: readonly string[];
    }>,
  ) => FeishuCard;
  sendCard: (chatId: string, card: FeishuCard) => Promise<void>;
  now: () => number;
}>;

export type IdentityWarRoomOutcome =
  | Readonly<{ kind: "created"; chatId: string; message: string }>
  | Readonly<{ kind: "exists"; chatId: string; message: string }>
  | Readonly<{ kind: "not_found"; message: string }>
  | Readonly<{ kind: "chat_failed"; message: string }>
  | Readonly<{ kind: "card_failed"; chatId: string; message: string }>;

const TERMINAL = new Set(["已闭环", "无需跟进"]);

// `VOC-用户-<id>-<等级>`, matching the shape warRoomName gives a ticket's group so a
// person scanning their Feishu sidebar can tell what any of them is about.
export function identityWarRoomName(
  kind: IdentityKind,
  id: string,
  level: string,
): string {
  return `VOC-${kind === "user" ? "用户" : "设备"}-${id}-${level}`;
}

export async function openIdentityWarRoom(
  input: Readonly<{ kind: IdentityKind; id: string; operatorOpenId: string }>,
  dependencies: IdentityWarRoomDependencies,
): Promise<IdentityWarRoomOutcome> {
  // Before anything expensive and before anything outward-facing.
  const existing = await dependencies.existingChat(input.kind, input.id);
  if (existing) {
    return { kind: "exists", chatId: existing, message: "协同群已存在，请在飞书中打开" };
  }

  const [profile, records, responders] = await Promise.all([
    dependencies.getProfile(input.kind, input.id),
    dependencies.getRecords(input.kind, input.id),
    dependencies.getResponderOpenIds(input.kind, input.id),
  ]);
  if (!profile) {
    return { kind: "not_found", message: "找不到这个标识" };
  }

  const insight = await dependencies.provider.analyze({
    kind: input.kind,
    profile,
    records,
    now: dependencies.now(),
  });

  const openTickets = records.filter(
    (record) => record.ticketOpenedAt !== null && !TERMINAL.has(record.state),
  );
  const members = [...new Set([input.operatorOpenId, ...responders])].filter(
    (openId) => openId.trim().length > 0,
  );

  let chatId: string;
  try {
    chatId = await dependencies.createChat(
      identityWarRoomName(input.kind, input.id, insight.level),
      members,
    );
  } catch {
    return { kind: "chat_failed", message: "协同群创建失败，请稍后重试" };
  }

  // Claimed immediately after creation, before the card: if two people raced, the loser
  // is told about the winner's group instead of both posting into two.
  const claim = await dependencies.claimChat(
    input.kind,
    input.id,
    chatId,
    input.operatorOpenId,
  );
  if (!claim.created) {
    return {
      kind: "exists",
      chatId: claim.chatId,
      message: "协同群已存在，请在飞书中打开",
    };
  }

  try {
    await dependencies.sendCard(
      chatId,
      dependencies.buildCard({
        kind: input.kind,
        id: input.id,
        insight,
        openTicketNumbers: openTickets.map((record) => record.recordNumber),
      }),
    );
  } catch {
    return {
      kind: "card_failed",
      chatId,
      message: "协同群已创建，但分析卡片发送失败，请在群内手动说明",
    };
  }

  return {
    kind: "created",
    chatId,
    message: `协同群已创建，已拉入 ${members.length} 人`,
  };
}
