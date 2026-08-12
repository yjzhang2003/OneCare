import { VOC_FIELD_NAMES, type BitableFields, type VocRecord } from "../bitable/field-map";
import { transition, type VocState } from "../voc/service-event";
import { transitionFields } from "../voc/transition-fields";

// The subset of VOC_ACTIONS that belongs to a person. 打标成功/打标失败 are the
// tagging pipeline's own transitions — a human clicking either would be
// asserting the model produced a result it never produced.
export const WORKBENCH_ACTIONS = [
  "需建单",
  "无需建单",
  "开始跟进",
  "提交跟进结果",
  "确认闭环",
  "重试",
] as const;

export type WorkbenchAction = (typeof WORKBENCH_ACTIONS)[number];

// The two actions the state machine guards on a non-empty note, and the label
// the UI should put on the field it collects. The guard itself lives in
// service-event.ts and is not repeated here: this map only decides whether to
// render a text box, never whether the write is allowed.
export const NOTE_LABELS: Readonly<Partial<Record<WorkbenchAction, string>>> = {
  提交跟进结果: "跟进记录",
  确认闭环: "闭环结论",
};

export type WorkbenchWriteRequest =
  | Readonly<{
      kind: "transition";
      action: WorkbenchAction;
      seenState: VocState;
      note?: string;
    }>
  | Readonly<{ kind: "claim"; seenState: VocState }>;

export type WorkbenchWriteOutcome =
  | Readonly<{
      kind: "write";
      fields: BitableFields;
      nextState: VocState;
      message: string;
    }>
  | Readonly<{ kind: "noop"; message: string }>
  | Readonly<{ kind: "conflict"; actual: VocState; message: string }>
  | Readonly<{ kind: "forbidden"; message: string }>
  | Readonly<{ kind: "rejected"; message: string }>;

// Probe the real state machine rather than restate its rule table. A second
// copy of "which action is legal from which state" would be a second thing to
// keep in sync, and the failure mode is a button that exists only to produce an
// error message. The note passed here is a placeholder purely to get past the
// non-empty guard — the UI collects the real one, and resolveWorkbenchWrite
// re-runs the same guard against it before anything is written.
export function availableActions(
  record: VocRecord,
): readonly WorkbenchAction[] {
  return WORKBENCH_ACTIONS.filter((action) => {
    const outcome = transition(record.state, action, {
      retryCount: record.retryCount,
      hasOwner: record.ownerOpenIds.length > 0,
      followUpNote: "probe",
      closingNote: "probe",
    });
    return outcome.kind === "ok";
  });
}

export function resolveWorkbenchWrite(
  record: VocRecord,
  operatorOpenId: string,
  request: WorkbenchWriteRequest,
  now: number,
): WorkbenchWriteOutcome {
  // First, before authorization and before any action-specific reasoning: the
  // operator picked this action against the state the page showed them, and
  // availableActions decided which buttons to show from that same state. If the
  // record has moved since, the action answers a question they did not ask.
  //
  // This is not a compare-and-swap and must not be described as one — Bitable
  // has no CAS, so a change landing between this check and the write below is
  // still possible. It converts silent overwrites into a conflict the operator
  // sees in the overwhelmingly common case, which for a surface driven by
  // human clicks is the proportionate strength. The UI says so in as many
  // words rather than implying a guarantee we cannot make.
  if (record.state !== request.seenState) {
    return {
      kind: "conflict",
      actual: record.state,
      message: `这条工单已被改成「${record.state}」，请刷新后再操作`,
    };
  }

  if (request.kind === "claim") {
    if (record.ownerOpenIds.includes(operatorOpenId)) {
      return { kind: "noop", message: "你已经是这条工单的负责人" };
    }
    // Claiming can only ever fill an empty owner, never replace someone. The
    // permission to reassign lives in the Bitable UI, where the person picker
    // resolves names for us and the per-user edit permission still applies.
    if (record.ownerOpenIds.length > 0) {
      return {
        kind: "forbidden",
        message: "该工单已有负责人，改派请在多维表格里操作",
      };
    }
    // [{id}] is the write shape verified against the live Base while seeding
    // owners; Bitable reads people back keyed by `id`, not `open_id`.
    return {
      kind: "write",
      nextState: record.state,
      fields: { [VOC_FIELD_NAMES.owner]: [{ id: operatorOpenId }] },
      message: "已认领，你是这条工单的负责人",
    };
  }

  // Verbatim the predicate resolveVocCardAction applies, wording included. A
  // web path that also accepted the fallback owner would make the same
  // transition mean two different things depending on where it was clicked.
  if (!record.ownerOpenIds.includes(operatorOpenId)) {
    return { kind: "forbidden", message: "只有该记录的负责人可以操作" };
  }

  const outcome = transition(record.state, request.action, {
    retryCount: record.retryCount,
    hasOwner: record.ownerOpenIds.length > 0,
    ...(request.action === "提交跟进结果" ? { followUpNote: request.note } : {}),
    ...(request.action === "确认闭环" ? { closingNote: request.note } : {}),
  });

  if (outcome.kind === "rejected") {
    return { kind: "rejected", message: outcome.reason };
  }
  if (outcome.kind === "noop") {
    return { kind: "noop", message: `当前已是${outcome.state}` };
  }

  return {
    kind: "write",
    nextState: outcome.next,
    fields: transitionFields(outcome.next, request.note, now),
    message: `已流转到「${outcome.next}」`,
  };
}
