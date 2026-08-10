import { VOC_STATES, type VocState } from "../voc/service-event";
import {
  VOC_DIMENSIONS,
  VOC_POLARITIES,
  type VocDimension,
  type VocPolarity,
  type VocSeverity,
} from "../voc/triage";
import type { TagResult } from "../tagging/contracts";

// Operations staff can rename Base columns at will, so every field name lives
// here and nowhere else. Renaming one column then means editing one file.
export const VOC_FIELD_NAMES = {
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
  channel: string;
  category: string;
  content: string;
  rating: number | null;
  state: VocState;
  polarity: VocPolarity | null;
  dimensions: readonly VocDimension[];
  ownerOpenIds: readonly string[];
  retryCount: number;
  ticketOpenedAt: string | null;
  closedAt: string | null;
}>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
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

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

// Calibrated: a User field reads back as [{ email, en_name, id, name }] — the
// key is `id`, NOT `open_id`. Reading open_id yields an empty owner list, which
// makes every card action fail the ownership check while unit tests built on
// hand-written {open_id} fixtures stay green.
function openIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "object" &&
    item !== null &&
    typeof (item as { id?: unknown }).id === "string"
      ? [(item as { id: string }).id]
      : [],
  );
}

export function toVocRecord(
  fields: BitableFields,
  recordId: string,
): VocRecord {
  const rawState = text(fields[VOC_FIELD_NAMES.state]);
  const state = (VOC_STATES as readonly string[]).includes(rawState)
    ? (rawState as VocState)
    : "待分析";

  const rawPolarity = text(fields[VOC_FIELD_NAMES.polarity]);
  const polarity = (VOC_POLARITIES as readonly string[]).includes(rawPolarity)
    ? (rawPolarity as VocPolarity)
    : null;

  const dimensions = stringArray(fields[VOC_FIELD_NAMES.dimensions]).filter(
    (item): item is VocDimension =>
      (VOC_DIMENSIONS as readonly string[]).includes(item),
  );

  return {
    recordId,
    channel: text(fields[VOC_FIELD_NAMES.channel]),
    category: text(fields[VOC_FIELD_NAMES.category]),
    content: text(fields[VOC_FIELD_NAMES.content]),
    rating: numberish(fields[VOC_FIELD_NAMES.rating]),
    state,
    polarity,
    dimensions,
    ownerOpenIds: openIds(fields[VOC_FIELD_NAMES.owner]),
    retryCount: numberish(fields[VOC_FIELD_NAMES.retryCount]) ?? 0,
    ticketOpenedAt: isoDate(fields[VOC_FIELD_NAMES.ticketOpenedAt]),
    closedAt: isoDate(fields[VOC_FIELD_NAMES.closedAt]),
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
