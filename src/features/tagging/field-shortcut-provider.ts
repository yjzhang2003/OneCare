import { parseTagPayload, type TagOutcome } from "./contracts";
import type { TaggingProvider } from "./provider-types";

export type FieldShortcutRow = Readonly<{
  recordId: string;
  sentiment: readonly string[];
  polarity: string;
  dimensions: readonly string[];
  summary: string;
  replies: ReadonlyArray<{ tone: string; text: string }>;
}>;

export type FieldShortcutSource = Readonly<{
  read(recordIds: readonly string[]): Promise<readonly FieldShortcutRow[]>;
}>;

/**
 * Normalize sentiment array by removing empty and whitespace-only strings.
 */
function normalizeSentiment(
  sentiment: readonly string[],
): readonly string[] {
  return sentiment.filter((item) => item.trim().length > 0);
}

/**
 * Normalize dimensions array by removing empty and whitespace-only strings.
 */
function normalizeDimensions(
  dimensions: readonly string[],
): readonly string[] {
  return dimensions.filter((item) => item.trim().length > 0);
}

/**
 * Normalize replies array by removing entries where tone or text is empty or whitespace-only.
 */
function normalizeReplies(
  replies: ReadonlyArray<{ tone: string; text: string }>,
): ReadonlyArray<{ tone: string; text: string }> {
  return replies.filter(
    (reply) =>
      reply.tone.trim().length > 0 && reply.text.trim().length > 0,
  );
}

export function createFieldShortcutTaggingProvider(
  source: FieldShortcutSource,
): TaggingProvider {
  return {
    name: "field-shortcut",
    async tag(records) {
      if (records.length === 0) return [];

      const requestedIds = records.map((record) => record.recordId);

      try {
        const rows = await source.read(requestedIds);
        // Normalize the data before passing to parseTagPayload to ensure empty
        // strings don't cause failures. This is necessary because multidimensional
        // tables may return [""] instead of [] for empty cells.
        const normalizedPayload = JSON.stringify({
          results: rows.map((row) => ({
            id: row.recordId,
            sentiment: normalizeSentiment(row.sentiment),
            polarity: row.polarity,
            dimensions: normalizeDimensions(row.dimensions),
            summary: row.summary,
            replies: normalizeReplies(row.replies),
          })),
        });

        // Reuse the same validator as the aily track so both tracks are held to
        // one contract; a half-filled shortcut column must fail here rather
        // than reach triage as a blank polarity.
        return parseTagPayload(normalizedPayload, requestedIds);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "读取字段捷径结果失败";
        return requestedIds.map(
          (recordId): TagOutcome => ({ kind: "failed", recordId, reason }),
        );
      }
    },
  };
}
