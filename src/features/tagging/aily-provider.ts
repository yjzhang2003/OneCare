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
      if (records.length === 0) return [];

      const requestedIds = records.map((record) => record.recordId);
      const failAll = (reason: string): readonly TagOutcome[] =>
        requestedIds.map((recordId) => ({ kind: "failed", recordId, reason }));

      const url = SKILL_START_URL.replace(":app_id", config.ailyAppId).replace(
        ":skill_id",
        config.skillId,
      );

      // The official contract takes `input` as a JSON String, not a nested
      // object; sending an object silently produces an empty skill input.
      const input = JSON.stringify({
        records: records.map((record) => ({
          id: record.recordId,
          content: record.content,
          channel: record.channel,
          category: record.category,
          ...(record.rating === undefined ? {} : { rating: record.rating }),
        })),
      });

      try {
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

        return parseTagPayload(data.output, requestedIds);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "aily 调用失败";
        return failAll(reason);
      }
    },
  };
}
