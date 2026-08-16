// 派工: hand a ticket to the engineer who will go on site.
//
// Extracted from the HTTP route so the 客服's own ticket card can do it too. The
// owner's sequence is 跟进 → 派单 →（等上门）→ 确认闭环, and until now the middle
// step was the only one that required leaving Feishu for a browser — on a card
// that already carries every other step.
//
// The rules are the route's, unchanged, and they are the reason this is one
// function rather than two copies:
//
//   - Only the ticket's 客服 owner or an 管理员 may dispatch. An unowned ticket is
//     nobody's to hand out.
//   - Only someone 人员管理 lists as 工程师 may be dispatched to; a free-text open_id
//     would put a colleague on a rota nobody added them to.
//   - 派工 is a state transition (→ 上门中), so the state machine decides whether it
//     is legal from here. A second dispatch to another engineer replays into a noop
//     and only rewrites the engineer columns.
//   - The card is sent after the write: the record already says who is going, so a
//     card that fails to send is a notification problem, not a dispatch that did
//     not happen.

import { VOC_FIELD_NAMES, type VocRecord } from "../bitable/field-map";
import { transition } from "./service-event";
import { transitionFields } from "./transition-fields";
import { adminOpenIds, engineerRules, type OwnerRuleRecord } from "./owner-rules";

const TERMINAL = new Set(["已闭环", "无需跟进"]);

export type DispatchOutcome =
  | Readonly<{ kind: "dispatched"; record: VocRecord; engineerName: string; cardSent: boolean }>
  | Readonly<{ kind: "already"; engineerName: string }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "forbidden"; message: string }>
  | Readonly<{ kind: "rejected"; message: string }>
  | Readonly<{ kind: "write_failed" }>;

export type DispatchInput = Readonly<{
  recordId: string;
  engineerOpenId: string;
  operatorOpenId: string;
  operatorName: string;
}>;

export type DispatchDeps = Readonly<{
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  listRoster: () => Promise<readonly OwnerRuleRecord[]>;
  updateRecord: (recordId: string, fields: Record<string, unknown>) => Promise<void>;
  // Sends the 上门任务卡 and returns whether it landed. Never throws out of here: the
  // dispatch itself has already been written by the time this runs.
  sendTaskCard: (record: VocRecord, engineerOpenId: string) => Promise<boolean>;
  now: () => number;
}>;

export async function dispatchTicket(
  input: DispatchInput,
  dependencies: DispatchDeps,
): Promise<DispatchOutcome> {
  const [record, roster] = await Promise.all([
    dependencies.getRecord(input.recordId),
    dependencies.listRoster(),
  ]);
  if (!record) return { kind: "not_found" };

  const admins = adminOpenIds(roster);
  const allowed =
    record.ownerOpenIds.includes(input.operatorOpenId) ||
    admins.includes(input.operatorOpenId);
  if (!allowed) {
    return {
      kind: "forbidden",
      message: "只有该工单的负责人或管理员可以派工",
    };
  }

  if (TERMINAL.has(record.state)) {
    return {
      kind: "rejected",
      message: `工单已经是「${record.state}」，不需要再派工`,
    };
  }

  const engineer = engineerRules(roster).find(
    (rule) => rule.openId === input.engineerOpenId,
  );
  if (!engineer) {
    return {
      kind: "rejected",
      message: "这个人不是工程师——请先在人员管理里把他加成工程师",
    };
  }

  const engineerName = engineer.ownerName || "该工程师";
  if (record.engineerOpenIds.includes(input.engineerOpenId)) {
    return { kind: "already", engineerName };
  }

  const outcome = transition(record.state, "派工", {
    retryCount: record.retryCount,
    hasOwner: record.ownerOpenIds.length > 0,
  });
  if (outcome.kind === "rejected") {
    return { kind: "rejected", message: outcome.reason };
  }

  const dispatchedAt = dependencies.now();
  try {
    await dependencies.updateRecord(input.recordId, {
      ...(outcome.kind === "ok"
        ? transitionFields(outcome.next, undefined, dispatchedAt)
        : {}),
      [VOC_FIELD_NAMES.engineer]: [{ id: input.engineerOpenId }],
      [VOC_FIELD_NAMES.dispatchedAt]: dispatchedAt,
    });
  } catch {
    return { kind: "write_failed" };
  }

  const dispatched: VocRecord =
    outcome.kind === "ok" ? { ...record, state: outcome.next } : record;
  const cardSent = await dependencies
    .sendTaskCard(dispatched, input.engineerOpenId)
    .catch(() => false);

  return { kind: "dispatched", record: dispatched, engineerName, cardSent };
}
