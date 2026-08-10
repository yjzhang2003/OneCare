import { parseTagPayload, type TagOutcome } from "./contracts";
import type { TaggingProvider, TaggingRequestRecord } from "./provider-types";

const SKILL_START_URL =
  "https://open.feishu.cn/open-apis/aily/v1/apps/:app_id/skills/:skill_id/start";

export const TAGGING_TIMEOUT_MS = 25_000;

export type AilyTaggingConfig = Readonly<{
  ailyAppId: string;
  skillId: string;
  tenantAccessToken: () => Promise<string>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAilyTaggingProvider(
  config: AilyTaggingConfig,
  fetcher: typeof fetch = fetch,
): TaggingProvider {
  return {
    name: "aily",
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

        const url = SKILL_START_URL.replace(":app_id", config.ailyAppId).replace(
          ":skill_id",
          config.skillId,
        );

        // The official contract takes `input` as a JSON String, not a nested
        // object; sending an object silently produces an empty skill input.
        const input = JSON.stringify({
          records: records.map((record) => ({
            id: (record as any)?.recordId,
            content: (record as any)?.content,
            channel: (record as any)?.channel,
            category: (record as any)?.category,
            ...((record as any)?.rating === undefined ? {} : { rating: (record as any)?.rating }),
          })),
        });

        const token = await config.tenantAccessToken();
        const response = await fetcher(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({ input }),
          signal: AbortSignal.timeout(TAGGING_TIMEOUT_MS),
        });

        if (!response.ok) {
          return failAll(`aily HTTP ${response.status}`);
        }

        const payload: unknown = await response.json();
        if (!isRecord(payload) || payload.code !== 0) {
          const code = isRecord(payload) ? String(payload.code) : "unknown";
          return failAll(`aily 业务错误码 ${code}`);
        }

        const data = payload.data;
        if (!isRecord(data) || typeof data.output !== "string") {
          return failAll("aily 响应缺少 data.output");
        }

        // Only `success` is documented; every other value is treated as a
        // failure rather than guessed at.
        if (data.status !== "success") {
          return failAll(`aily status 非 success：${String(data.status)}`);
        }

        return parseTagPayload(data.output, recordIds);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "aily 调用失败";
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
