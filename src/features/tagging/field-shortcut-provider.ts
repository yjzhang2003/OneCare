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
      // Guard: records must be an array. If not, we don't know how many
      // records were requested, so we return empty array.
      if (!Array.isArray(records)) {
        return [];
      }

      if (records.length === 0) {
        return [];
      }

      // Extract recordIds outside try block so catch can access them.
      // If extraction itself fails, we return empty array.
      let recordIds: string[] = [];
      let recordIdsComputed = false;

      try {
        // Validate recordId on all elements upfront. This ensures:
        // 1. Every outcome has a recordId that is a non-empty string
        // 2. We can diagnose malformed inputs without throwing
        recordIds = records.map((record, index) => {
          const recordId = (record as any)?.recordId;
          if (typeof recordId === "string" && recordId.length > 0) {
            return recordId;
          }
          // Placeholder for malformed recordId; allows diagnosis without throwing
          return `invalid_${index}`;
        });
        recordIdsComputed = true;

        // If any recordId is invalid, fail the batch with diagnostic reasons
        const invalidIndices = recordIds
          .map((id, i) => (id.startsWith("invalid_") ? i : -1))
          .filter((i) => i !== -1);

        if (invalidIndices.length > 0) {
          return recordIds.map((recordId, index) => {
            const reason = invalidIndices.includes(index)
              ? `Input record lacks valid recordId (must be non-empty string)`
              : `Batch fails because other records have invalid recordIds`;
            return { kind: "failed" as const, recordId, reason };
          });
        }

        const failAll = (reason: string): readonly TagOutcome[] =>
          recordIds.map((recordId) => ({ kind: "failed", recordId, reason }));

        const rows = await source.read(recordIds);
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
        return parseTagPayload(normalizedPayload, recordIds);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "读取字段捷径结果失败";
        // If we successfully computed recordIds, return failures for them.
        // Otherwise, we don't know how many records were in the input, so
        // return empty array.
        if (recordIdsComputed && recordIds.length > 0) {
          return recordIds.map((recordId) => ({
            kind: "failed" as const,
            recordId,
            reason,
          }));
        }
        return [];
      }
    },
  };
}
