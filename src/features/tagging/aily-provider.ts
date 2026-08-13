import { parseTagPayload, type TagOutcome } from "./contracts";
import type { TaggingProvider } from "./provider-types";

const SKILL_START_URL =
  "https://open.feishu.cn/open-apis/aily/v1/apps/:app_id/skills/:skill_id/start";

// Measured against the live skill on 2026-08-11: a five-record batch takes
// 36.5s and returns all five results. The previous 25s ceiling aborted every
// call, and the symptom was five records marked 分析失败 with the reason "The
// operation was aborted due to timeout" — a repo-side limit misreporting itself
// as a model failure. 120s leaves room for a larger shard while staying well
// under Vercel's 300s function ceiling, so the abort still happens here, with a
// diagnosis, rather than as an opaque platform kill.
export const TAGGING_TIMEOUT_MS = 120_000;

export type AilyTaggingConfig = Readonly<{
  ailyAppId: string;
  skillId: string;
  tenantAccessToken: () => Promise<string>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `data.output` arrives wrapped in an envelope of the skill's declared response
 * parameters, not as the payload itself. Observed against the live API on
 * 2026-08-11, from a skill whose single response parameter is named `output`:
 *
 *   data.output === '{"output":"{\\"results\\":[...]}"}'
 *
 * So the tag payload is one level down, keyed by whatever the skill author named
 * that parameter. Unwrapping here rather than in parseTagPayload keeps the
 * envelope where it belongs: it is an aily transport detail, and the
 * field-shortcut track builds its payload directly with no envelope at all.
 *
 * Deliberately tolerant in both directions — a payload that already carries
 * `results` is returned untouched, so a skill that outputs the contract shape
 * directly keeps working and a future platform change cannot silently break
 * this. Anything else is passed through unchanged so the failure surfaces as
 * parseTagPayload's own diagnostic against the real text.
 */
export function unwrapSkillOutput(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  if (!isRecord(parsed) || Array.isArray(parsed.results)) {
    return raw;
  }

  const stringValues = Object.values(parsed).filter(
    (value): value is string => typeof value === "string",
  );
  // Exactly one string field, or the ambiguity is not ours to resolve by
  // guessing which of several is the payload.
  return stringValues.length === 1 ? stringValues[0] : raw;
}

// One record per skill call. Measured on 2026-08-11: a five-record batch takes
// 36.5s when it works, and the same batch through the route came back as
// `aily HTTP 504` — aily's own gateway gives up before the model finishes, so a
// batch that big is not reliably deliverable however long this side is willing
// to wait. A single record is roughly seven seconds, far inside any gateway
// limit, and the shard's total wall clock is unchanged because the work is the
// same either way. The rate limit is 100 calls/minute, which one-record calls
// stay well under at this shard size.
export const AILY_RECORDS_PER_CALL = 1;

function chunk<T>(items: readonly T[], size: number): readonly T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function createAilyTaggingProvider(
  config: AilyTaggingConfig,
  fetcher: typeof fetch = fetch,
): TaggingProvider {
  const single = createSingleBatchProvider(config, fetcher);
  return {
    name: "aily",
    async tag(records) {
      if (!Array.isArray(records) || records.length <= AILY_RECORDS_PER_CALL) {
        return single.tag(records);
      }

      // Sequential, not concurrent: a shard is five records, the gateway is the
      // scarce resource rather than our own throughput, and a failure in one
      // chunk must not take its neighbours down with it.
      const outcomes: TagOutcome[] = [];
      for (const part of chunk(records, AILY_RECORDS_PER_CALL)) {
        outcomes.push(...(await single.tag(part)));
      }
      return outcomes;
    },
  };
}

function createSingleBatchProvider(
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
          // `records` is typed as `readonly TaggingRequestRecord[]`, but the
          // tests deliberately pass runtime values that violate that type
          // (null, arrays with non-object elements, etc.), so we treat each
          // element as unknown rather than trusting the declared type.
          const fields: Record<string, unknown> = isRecord(record) ? record : {};
          const recordId = fields.recordId;
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
        // Its keys are the skill's declared custom parameters.
        //
        // `records` is itself a JSON string rather than an array. Verified in
        // the aily skill editor on 2026-08-11: the custom-parameter type picker
        // offers String, Boolean, Float and Integer — there is no array or
        // object type, so the skill declares `records` as String and parses the
        // text inside the workflow. Handing a real array to a String parameter
        // is a type mismatch at the platform boundary, and the failure mode
        // would be an empty or coerced input rather than an error.
        const input = JSON.stringify({
          records: JSON.stringify(
            records.map((record) => {
              const fields: Record<string, unknown> = isRecord(record)
                ? record
                : {};
              const rating = fields.rating;
              return {
                id: fields.recordId,
                content: fields.content,
                channel: fields.channel,
                category: fields.category,
                ...(rating === undefined ? {} : { rating }),
              };
            }),
          ),
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

        return parseTagPayload(unwrapSkillOutput(data.output), recordIds);
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
