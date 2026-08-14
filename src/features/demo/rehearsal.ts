// 演示彩排：把录屏要用的那几条记录摆回起始状态，拍完再还原。
//
// Why this exists: every shot in the list consumes the state it demonstrates. Filming
// 立即分析 on a 待分析 record leaves it 已分析 — the second take has nothing to click.
// The same is true of the 分析失败 retry, and of every state transition in the flow.
// Without a reset, rehearsing costs a fresh record each time and the dataset drifts away
// from the shape the document describes.
//
// What it does NOT do, deliberately:
//
//   - It does not fabricate records. It picks ones that already exist and only moves them
//     between states the state machine already allows.
//   - It does not delete Feishu groups. Creating a group is outward-facing and permanent;
//     a restore clears the 协同群 ID on the record so the flow can be filmed again, and
//     says plainly that the group itself is still in everyone's sidebar.
//   - It does not touch the 19 rows the real aily skill tagged. Those are the only genuine
//     model output in the dataset and are never staging material.
//
// The snapshot is what makes restore honest: whatever those records looked like before
// the rehearsal is written down first, and restore puts exactly that back — rather than
// guessing at a "clean" state that may never have existed.

import type { VocRecord } from "../bitable/field-map";
import type { VocState } from "../voc/service-event";

// One record per shot, named by the shot it serves so a failed rehearsal points at the
// clip that will break.
export const REHEARSAL_ROLES = [
  {
    key: "analyze",
    shot: "S3",
    label: "立即分析（待分析 → AI 打标）",
    state: "待分析" as VocState,
  },
  {
    key: "flow",
    shot: "S4 / S5",
    label: "状态流转（待跟进 → 已闭环）",
    state: "待跟进" as VocState,
  },
  {
    key: "retry",
    shot: "S9",
    label: "打标失败重跑（分析失败 → 重试）",
    state: "分析失败" as VocState,
  },
] as const;

export type RehearsalRole = (typeof REHEARSAL_ROLES)[number]["key"];

export type RehearsalSlot = Readonly<{
  key: RehearsalRole;
  shot: string;
  label: string;
  recordId: string;
  recordNumber: string;
  // The state this record must be in for the shot to be filmable.
  wantState: VocState;
  // What it is in right now. Equal to wantState once prepare has run.
  haveState: VocState;
}>;

// The fields a rehearsal moves. Everything else on the record is left alone, which is why
// restore can be a plain overwrite of these and nothing more.
export type RehearsalFields = Readonly<{
  state: VocState;
  ownerOpenIds: readonly string[];
  ownerNames: readonly string[];
  ticketOpenedAt: string | null;
  closedAt: string | null;
  warRoomChatId: string;
  retryCount: number;
}>;

export type RehearsalSnapshot = Readonly<{
  recordId: string;
  recordNumber: string;
  role: RehearsalRole;
  before: RehearsalFields;
}>;

export function fieldsOf(record: VocRecord): RehearsalFields {
  return {
    state: record.state,
    ownerOpenIds: record.ownerOpenIds,
    ownerNames: record.ownerNames,
    ticketOpenedAt: record.ticketOpenedAt,
    closedAt: record.closedAt,
    warRoomChatId: record.warRoomChatId,
    retryCount: record.retryCount,
  };
}

// A row is eligible to be staged only if it is already the kind of record the shot needs,
// or close enough that moving it is a state change the pipeline itself could have made.
// Concretely: a 待分析 shot takes a row that is 待分析 or that finished its life untagged;
// a 待跟进 shot takes an open ticket. Nothing is dragged backwards from 已闭环, because a
// closed ticket reopening is not a state the product allows and staging must not invent
// one.
export function eligibleFor(role: RehearsalRole, record: VocRecord): boolean {
  // Never stage the rows carrying real model output.
  if (record.summary.trim().length > 0) return false;

  switch (role) {
    case "analyze":
      return record.state === "待分析";
    case "flow":
      return (
        record.state === "待跟进" &&
        record.ticketOpenedAt !== null &&
        record.ownerOpenIds.length > 0
      );
    case "retry":
      return record.state === "分析失败";
  }
}

// What prepare has to write to put a record back at the start of its shot. Returns null
// when the record is already there — a rehearsal that changes nothing should say so
// rather than issue a no-op write to two stores.
export function resetTo(
  role: RehearsalRole,
  before: RehearsalFields,
): RehearsalFields | null {
  switch (role) {
    case "analyze": {
      // Back to untagged and unrouted: the shot is the moment AI fills all of it in.
      const target: RehearsalFields = {
        state: "待分析",
        ownerOpenIds: [],
        ownerNames: [],
        ticketOpenedAt: null,
        closedAt: null,
        // The group is cleared so an escalation can be filmed again. The group itself
        // still exists in Feishu — clearing this only stops the record pointing at it.
        warRoomChatId: "",
        retryCount: 0,
      };
      return same(before, target) ? null : target;
    }
    case "flow": {
      // An open ticket with an owner, nothing followed up yet.
      const target: RehearsalFields = {
        ...before,
        state: "待跟进",
        closedAt: null,
        warRoomChatId: "",
      };
      return same(before, target) ? null : target;
    }
    case "retry": {
      // Failed, with retries left, so 立即分析 is offered rather than refused.
      const target: RehearsalFields = {
        ...before,
        state: "分析失败",
        retryCount: 0,
        ticketOpenedAt: null,
        closedAt: null,
      };
      return same(before, target) ? null : target;
    }
  }
}

function same(a: RehearsalFields, b: RehearsalFields): boolean {
  return (
    a.state === b.state &&
    a.ticketOpenedAt === b.ticketOpenedAt &&
    a.closedAt === b.closedAt &&
    a.warRoomChatId === b.warRoomChatId &&
    a.retryCount === b.retryCount &&
    a.ownerOpenIds.join() === b.ownerOpenIds.join() &&
    a.ownerNames.join() === b.ownerNames.join()
  );
}

// Picks one record per role out of the candidates, preferring rows that are already in the
// right state (so a rehearsal usually writes nothing at all) and otherwise the first
// eligible one. Deterministic in record number, so two people preparing the same demo get
// the same records.
export function assignSlots(
  candidates: readonly VocRecord[],
): readonly RehearsalSlot[] {
  const taken = new Set<string>();
  const slots: RehearsalSlot[] = [];

  for (const role of REHEARSAL_ROLES) {
    const eligible = candidates
      .filter((record) => !taken.has(record.recordId))
      .filter((record) => eligibleFor(role.key, record))
      .sort((a, b) => a.recordNumber.localeCompare(b.recordNumber));

    const picked = eligible[0];
    if (!picked) continue;
    taken.add(picked.recordId);
    slots.push({
      key: role.key,
      shot: role.shot,
      label: role.label,
      recordId: picked.recordId,
      recordNumber: picked.recordNumber,
      wantState: role.state,
      haveState: picked.state,
    });
  }

  return slots;
}
