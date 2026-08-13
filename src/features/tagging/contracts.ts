import {
  VOC_DIMENSIONS,
  VOC_POLARITIES,
  VOC_SENTIMENTS,
  type VocDimension,
  type VocPolarity,
} from "../voc/triage";

export type VocReply = Readonly<{ tone: string; text: string }>;

export type TagResult = Readonly<{
  recordId: string;
  sentiment: readonly string[];
  polarity: VocPolarity;
  dimensions: readonly VocDimension[];
  summary: string;
  replies: readonly VocReply[];
}>;

export type TagOutcome =
  | Readonly<{ kind: "tagged"; result: TagResult }>
  | Readonly<{
      kind: "failed";
      recordId: string;
      reason: string;
      rawOutput?: string;
    }>;

const MAX_RAW_OUTPUT = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

function parseReplies(value: unknown): readonly VocReply[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const replies: VocReply[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.tone !== "string" || typeof item.text !== "string") {
      return null;
    }
    if (item.tone.trim().length === 0 || item.text.trim().length === 0) {
      return null;
    }
    replies.push({ tone: item.tone, text: item.text });
  }
  return replies;
}

function validate(entry: Record<string, unknown>, recordId: string): TagOutcome {
  const polarity = entry.polarity;
  if (
    typeof polarity !== "string" ||
    !(VOC_POLARITIES as readonly string[]).includes(polarity)
  ) {
    return {
      kind: "failed",
      recordId,
      reason: `polarity 不在枚举内：${String(polarity)}`,
    };
  }

  const dimensions = stringList(entry.dimensions) ?? null;
  if (!dimensions) {
    return { kind: "failed", recordId, reason: "dimensions 必须是字符串数组" };
  }
  const unknownDimension = dimensions.find(
    (item) => !(VOC_DIMENSIONS as readonly string[]).includes(item),
  );
  if (unknownDimension !== undefined) {
    return {
      kind: "failed",
      recordId,
      reason: `dimensions 不在枚举内：${unknownDimension}`,
    };
  }

  const sentiment = stringList(entry.sentiment) ?? null;
  if (!sentiment) {
    return { kind: "failed", recordId, reason: "sentiment 必须是字符串数组" };
  }
  if (sentiment.some((item) => item.trim().length === 0)) {
    return { kind: "failed", recordId, reason: "sentiment 不能包含空字符串" };
  }
  // Checked against the enum for the same reason polarity and dimensions are,
  // plus one this field makes sharper: these values are written to a Bitable
  // multi-select, and Bitable auto-creates any option it receives. Deleting the
  // record does not remove the option, so a single loose model output
  // permanently alters the enterprise's field schema. Rejecting the record is
  // louder than filtering the stray value out — the offending word lands in
  // 失败原因 where it can be fixed in the prompt, instead of disappearing.
  const unknownSentiment = sentiment.find(
    (item) => !(VOC_SENTIMENTS as readonly string[]).includes(item),
  );
  if (unknownSentiment !== undefined) {
    return {
      kind: "failed",
      recordId,
      reason: `sentiment 不在枚举内：${unknownSentiment}`,
    };
  }

  if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
    return { kind: "failed", recordId, reason: "summary 不能为空" };
  }

  const replies = parseReplies(entry.replies);
  if (!replies) {
    return { kind: "failed", recordId, reason: "replies 结构不合法" };
  }

  return {
    kind: "tagged",
    result: {
      recordId,
      sentiment,
      polarity: polarity as VocPolarity,
      dimensions: dimensions as readonly VocDimension[],
      summary: entry.summary,
      replies,
    },
  };
}

export function parseTagPayload(
  rawOutput: string,
  requestedIds: readonly string[],
): readonly TagOutcome[] {
  const failAll = (reason: string): readonly TagOutcome[] =>
    requestedIds.map((recordId) => ({
      kind: "failed" as const,
      recordId,
      reason,
      rawOutput: rawOutput.slice(0, MAX_RAW_OUTPUT),
    }));

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return failAll("输出不是合法 JSON");
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    return failAll("输出缺少 results 数组");
  }

  // Left join on the requested ids. Anything the model invented is dropped and
  // anything it skipped is failed, because a short results array is a common
  // large-batch failure mode rather than an implicit success.
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of parsed.results) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }

  return requestedIds.map((recordId) => {
    const entry = byId.get(recordId);
    if (!entry) {
      return { kind: "failed" as const, recordId, reason: "模型未返回该 id" };
    }
    return validate(entry, recordId);
  });
}
