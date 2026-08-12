import { VOC_FIELD_NAMES, type BitableFields } from "../bitable/field-map";
import type { VocState } from "./service-event";

// Which Bitable columns a successful state transition writes, in one place,
// because two call sites need the identical answer: the Feishu card callback
// (resolveVocCardAction) and the workbench route handler. Duplicating it would
// eventually diverge, and the way divergence shows up is not a test failure but
// "tickets closed from a card have a duration, tickets closed from the web do
// not" — a data inconsistency nobody notices until someone reads the metrics.
//
// Keyed on the target state rather than on the action that produced it: each of
// the two note-carrying actions is the only action reaching its target state
// (提交跟进结果 → 待闭环, 确认闭环 → 已闭环), so the two keys are equivalent, and
// the target state is the one this function can actually verify against
// VOC_STATES.
export function transitionFields(
  next: VocState,
  note: string | undefined,
  now: number,
): BitableFields {
  const fields: BitableFields = { [VOC_FIELD_NAMES.state]: next };

  // 待跟进 is the moment a VOC record becomes a ticket, so it is where 建单时间
  // belongs. The tagging pipeline already stamps it when it auto-creates a
  // ticket (app/api/voc/analyze/route.ts) — that write stays where it is,
  // because there the column is one entry in a merge with the tag columns
  // rather than a transition's own field set. This stamp exists so the
  // workbench's 需建单 produces the same columns the pipeline does; without it,
  // a ticket opened by hand would have no 建单时间 and so no 时长, while one
  // opened automatically would.
  if (next === "待跟进") {
    fields[VOC_FIELD_NAMES.ticketOpenedAt] = now;
  }

  if (next === "待闭环" && note !== undefined) {
    fields[VOC_FIELD_NAMES.followUpNote] = note;
  }

  if (next === "已闭环") {
    if (note !== undefined) {
      fields[VOC_FIELD_NAMES.closingNote] = note;
    }
    // Calibrated against the live Base: a Bitable DateTime field is epoch
    // milliseconds on the wire, not an ISO string. An ISO string is silently
    // rejected by the real API, which turns a legitimate closure into a
    // "写回失败" — caught originally by a real-Base round trip, never by a
    // mocked unit test.
    fields[VOC_FIELD_NAMES.closedAt] = now;
  }

  return fields;
}
