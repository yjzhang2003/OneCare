import type { VocRecord } from "../bitable/field-map";
import { VOC_FIELD_NAMES } from "../bitable/field-map";
import { DECLINED_MARKER, warRoomDecision, warRoomName } from "../warroom/naming";
import type { CardActionResult } from "./card-actions";
import type { FeishuCard } from "./card-types";
import { createVocTicketCard } from "./cards";

// Everything this module needs from the outside world arrives as an injected
// function. Unlike resolveVocCardAction (which takes a BitableClient-shaped
// object), the two war room actions have no shared "bitable" boundary of
// their own — creating a chat and posting into it are Feishu concerns, not
// Bitable ones — so each capability is its own parameter instead of being
// bundled behind one interface that would misname what half of it does.
export type WarRoomActionInput = Readonly<{
  action: "voc_open_war_room" | "voc_decline_war_room";
  recordId: string;
  operatorOpenId: string;
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  updateRecord: (recordId: string, fields: Record<string, unknown>) => Promise<void>;
  fallbackOpenIds: () => Promise<readonly string[]>;
  createChat: (name: string, memberOpenIds: readonly string[]) => Promise<string>;
  sendToChat: (chatId: string, card: FeishuCard) => Promise<void>;
}>;

function toast(
  type: "success" | "info" | "error",
  content: string,
): CardActionResult {
  return { kind: "update", response: { toast: { type, content } } };
}

// Order below is load-bearing (see the module-level ordering note above each
// branch): record, then authorization, then idempotence, then create.
//
// 1. getRecord first: a record that does not exist is rejected before any
//    other check runs, so a bad record id never reaches authorization or the
//    idempotence read.
// 2. Authorization before the idempotence check: reversing these would let a
//    stranger learn, from the toast wording alone, whether this ticket
//    already has a group — a fact they have no right to.
// 3. Idempotence (warRoomDecision) before create: only "create" reaches
//    createChat; "exists" and "declined" both return early with no side
//    effect.
export async function resolveWarRoomAction(
  input: WarRoomActionInput,
): Promise<CardActionResult> {
  const record = await input.getRecord(input.recordId);
  if (!record) {
    return toast("error", "未找到该工单记录");
  }

  const fallbackIds = await input.fallbackOpenIds();
  const isAuthorized =
    record.ownerOpenIds.includes(input.operatorOpenId) ||
    fallbackIds.includes(input.operatorOpenId);
  if (!isAuthorized) {
    return toast("error", "你不是该工单的负责人或兜底人");
  }

  if (input.action === "voc_decline_war_room") {
    await input.updateRecord(input.recordId, {
      [VOC_FIELD_NAMES.warRoomChatId]: DECLINED_MARKER,
    });
    return toast("success", "已记录：暂不需要协同群");
  }

  const decision = warRoomDecision(record.warRoomChatId);
  if (decision === "exists") {
    return toast("info", "协同群已存在");
  }
  if (decision === "declined") {
    return toast("info", "此前已选择暂不需要");
  }

  let chatId: string;
  try {
    chatId = await input.createChat(warRoomName(record), [
      ...record.ownerOpenIds,
      input.operatorOpenId,
    ]);
  } catch {
    // The group itself never came into being: nothing to write, nothing to
    // clean up.
    return toast("error", "协同群创建失败");
  }

  try {
    await input.updateRecord(input.recordId, {
      [VOC_FIELD_NAMES.warRoomChatId]: chatId,
    });
  } catch {
    // A real group now exists that the Base cannot point anyone to. That is
    // the accepted lesser evil over a record pointing at a group that was
    // never created — but only if the toast says so, so the operator retries
    // instead of assuming the click did nothing.
    return toast("error", "协同群已创建但未记录，请重试");
  }

  try {
    await input.sendToChat(
      chatId,
      createVocTicketCard(
        record,
        {
          summary: record.summary,
          polarity: record.polarity ?? "—",
          dimensions: record.dimensions,
          replies: record.replies,
        },
        { fullContent: true },
      ),
    );
  } catch {
    // The group exists and the Base already points to it — a failed post is
    // cosmetic, not a state to roll back. Only the toast wording changes.
    return toast("success", "协同群已创建，但工单卡片发送失败，请稍后在群内分享");
  }

  return toast("success", "协同群已创建");
}
