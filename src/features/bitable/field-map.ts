import { VOC_STATES, type VocState } from "../voc/service-event";
import {
  VOC_DIMENSIONS,
  VOC_POLARITIES,
  type VocDimension,
  type VocPolarity,
  type VocSeverity,
} from "../voc/triage";
import type { TagResult, VocReply } from "../tagging/contracts";

// Operations staff can rename Base columns at will, so every field name lives
// here and nowhere else. Renaming one column then means editing one file.
export const VOC_FIELD_NAMES = {
  recordNumber: "记录编号",
  feedbackAt: "反馈时间",
  channel: "渠道",
  category: "产品品类",
  model: "机型",
  content: "原始内容",
  rating: "原始评分",
  userRef: "用户标识",
  sentiment: "情绪标签",
  polarity: "情绪极性",
  dimensions: "问题维度",
  summary: "AI 摘要",
  replies: "AI 回复话术",
  severity: "严重度",
  tagSource: "打标来源",
  failureReason: "失败原因",
  rawOutput: "原始输出",
  retryCount: "重试次数",
  state: "流程状态",
  owner: "负责人",
  ticketOpenedAt: "建单时间",
  followUpNote: "跟进记录",
  closedAt: "闭环时间",
  closingNote: "闭环结论",
} as const;

export type BitableFields = Record<string, unknown>;

export type VocRecord = Readonly<{
  recordId: string;
  recordNumber: string;
  channel: string;
  category: string;
  content: string;
  rating: number | null;
  feedbackAt: string | null;
  state: VocState;
  polarity: VocPolarity | null;
  dimensions: readonly VocDimension[];
  // The two AI columns a card action has to re-render from. A card callback
  // gets exactly one getRecord (a three second budget, and a token that may
  // update the card at most twice), so anything the re-rendered card shows has
  // to come out of that single read. Without these, clicking a button would
  // silently strip the AI summary and the reply suggestions off the owner's
  // card — the very text they need in order to write the follow-up note.
  summary: string;
  replies: readonly VocReply[];
  severity: VocSeverity | null;
  ownerOpenIds: readonly string[];
  retryCount: number;
  ticketOpenedAt: string | null;
  closedAt: string | null;
}>;

// Card rendering (createVocTicketCard) and any other consumer that needs a
// plain string out of a Bitable field reach for this rather than re-deriving
// their own typeof check.
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The Bitable client can hand back a missing/malformed payload (a deleted
// record, a webhook retry with an empty body, a bad cast at the call site).
// Every other branch in this file already answers "I couldn't read this
// field" with a null/default instead of throwing; the whole-`fields` case
// must do the same, or one bad payload crashes the entire sync loop instead
// of just leaving one record un-decoded. Arrays are rejected too — a bare
// array is not a fields object even though `typeof [] === "object"`.
function isFieldsRecord(value: unknown): value is BitableFields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Calibrated against the live Base on 2026-08-10. A Bitable Number field is
// declared type 2 but reads back as a STRING ("2", "0"), so a typeof === number
// check silently yields null — and for 重试次数 that means the retry ceiling
// never trips and a failed record retries forever.
function numberish(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Calibrated: a DateTime field reads back as epoch MILLISECONDS (number), not
// an ISO string. Downstream metrics take ISO strings, so normalise here.
function isoDate(value: unknown): string | null {
  const ms = numberish(value);
  if (ms !== null) return new Date(ms).toISOString();
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

// Exported for the same reason as text(): the analyze route reads raw AI
// field-shortcut columns (multi-select 情绪标签/问题维度) directly off Bitable
// responses and must not re-derive this Array.isArray + typeof filter itself.
export function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

// 严重度 is a single-select written by triage.ts (never by the AI), but a
// hand-edited Base row could still hold a stray value — treat anything
// outside the enum as "not decided" rather than passing it through.
const VOC_SEVERITIES: readonly VocSeverity[] = ["高", "中", "低"];

// Calibrated: a User field reads back as [{ email, en_name, id, name }] — the
// key is `id`, NOT `open_id`. Reading open_id yields an empty owner list, which
// makes every card action fail the ownership check while unit tests built on
// hand-written {open_id} fixtures stay green. Exported so the analyze route's
// owner-table reader (a different table, same field shape) can reuse it
// instead of re-deriving the same calibration.
export function openIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "object" &&
    item !== null &&
    typeof (item as { id?: unknown }).id === "string"
      ? [(item as { id: string }).id]
      : [],
  );
}

// Reverses the "【语气】正文" \n\n-joined format toTagFieldUpdate writes into
// AI 回复话术, so whatever is in that cell — written by the aily track, by
// Bitable's own field shortcut, or by hand — reads back as replies. A segment
// that doesn't match the shape is dropped rather than thrown on: a
// hand-edited cell must degrade like every other malformed-input path in this
// file, not crash the caller. Lives here, next to the writer whose format it
// inverts, so the analyze route and toVocRecord share one implementation
// instead of drifting apart.
export function parseReplyText(raw: string): readonly VocReply[] {
  if (raw.trim().length === 0) return [];
  const segmentPattern = /^【([^】]*)】([\s\S]*)$/;
  return raw.split("\n\n").flatMap((segment) => {
    const match = segmentPattern.exec(segment);
    return match ? [{ tone: match[1], text: match[2] }] : [];
  });
}

export function toVocRecord(
  fields: BitableFields,
  recordId: string,
): VocRecord {
  const safeFields: BitableFields = isFieldsRecord(fields) ? fields : {};
  const rawState = text(safeFields[VOC_FIELD_NAMES.state]);
  const state = (VOC_STATES as readonly string[]).includes(rawState)
    ? (rawState as VocState)
    : "待分析";

  const rawPolarity = text(safeFields[VOC_FIELD_NAMES.polarity]);
  const polarity = (VOC_POLARITIES as readonly string[]).includes(rawPolarity)
    ? (rawPolarity as VocPolarity)
    : null;

  const rawSeverity = text(safeFields[VOC_FIELD_NAMES.severity]);
  const severity = (VOC_SEVERITIES as readonly string[]).includes(rawSeverity)
    ? (rawSeverity as VocSeverity)
    : null;

  const dimensions = stringArray(
    safeFields[VOC_FIELD_NAMES.dimensions],
  ).filter((item): item is VocDimension =>
    (VOC_DIMENSIONS as readonly string[]).includes(item),
  );

  return {
    recordId,
    recordNumber: text(safeFields[VOC_FIELD_NAMES.recordNumber]),
    channel: text(safeFields[VOC_FIELD_NAMES.channel]),
    category: text(safeFields[VOC_FIELD_NAMES.category]),
    content: text(safeFields[VOC_FIELD_NAMES.content]),
    rating: numberish(safeFields[VOC_FIELD_NAMES.rating]),
    feedbackAt: isoDate(safeFields[VOC_FIELD_NAMES.feedbackAt]),
    state,
    polarity,
    dimensions,
    summary: text(safeFields[VOC_FIELD_NAMES.summary]),
    replies: parseReplyText(text(safeFields[VOC_FIELD_NAMES.replies])),
    severity,
    ownerOpenIds: openIds(safeFields[VOC_FIELD_NAMES.owner]),
    retryCount: numberish(safeFields[VOC_FIELD_NAMES.retryCount]) ?? 0,
    ticketOpenedAt: isoDate(safeFields[VOC_FIELD_NAMES.ticketOpenedAt]),
    closedAt: isoDate(safeFields[VOC_FIELD_NAMES.closedAt]),
  };
}

export function toTagFieldUpdate(
  result: TagResult,
  severity: VocSeverity,
): BitableFields {
  return {
    [VOC_FIELD_NAMES.sentiment]: [...result.sentiment],
    [VOC_FIELD_NAMES.polarity]: result.polarity,
    [VOC_FIELD_NAMES.dimensions]: [...result.dimensions],
    [VOC_FIELD_NAMES.summary]: result.summary,
    [VOC_FIELD_NAMES.replies]: result.replies
      .map((reply) => `【${reply.tone}】${reply.text}`)
      .join("\n\n"),
    [VOC_FIELD_NAMES.severity]: severity,
  };
}
