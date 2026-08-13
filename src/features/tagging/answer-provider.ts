import { TAGGING_TIMEOUT_MS, unwrapSkillOutput } from "./aily-provider";

const SKILL_START_URL =
  "https://open.feishu.cn/open-apis/aily/v1/apps/:app_id/skills/:skill_id/start";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type AnswerProviderConfig = Readonly<{
  ailyAppId: string;
  skillId: string;
  tenantAccessToken: () => Promise<string>;
}>;

export type AnswerProvider = Readonly<{
  answer(question: string, facts: string): Promise<string | null>;
}>;

// The war room's free-Q&A skill, called once per group question. Shaped like
// createAilyTaggingProvider in aily-provider.ts on purpose — same start URL,
// same doubly-encoded `input`, same timeout — but simpler in every way this
// skill actually is simpler: one call, no batching, no recordId bookkeeping,
// and a prose answer instead of a JSON tag payload to run through
// parseTagPayload.
//
// Every failure comes back as `null`, never a thrown error and never a
// guess: a technique that failed to reach the model, and a technique that
// reached it but got an empty or non-success answer, must look identical to
// the caller. Both mean the same thing — "cannot answer right now" — and the
// group is told exactly that. Answering with anything invented about a real
// customer complaint would be worse than not answering.
export function createAnswerProvider(
  config: AnswerProviderConfig,
  fetcher: typeof fetch = fetch,
): AnswerProvider {
  return {
    async answer(question, facts) {
      try {
        const url = SKILL_START_URL.replace(":app_id", config.ailyAppId).replace(
          ":skill_id",
          config.skillId,
        );

        // `input` is a JSON string whose keys are the skill's declared custom
        // parameters. aily's parameter type picker offers only String,
        // Boolean, Float and Integer — there is no object type — so both
        // `question` and `facts` travel as top-level String parameters rather
        // than as a nested object.
        const input = JSON.stringify({ question, facts });

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

        if (!response.ok) return null;

        const payload: unknown = await response.json();
        if (!isRecord(payload) || payload.code !== 0) return null;

        const data = payload.data;
        // Only `success` is documented; every other value (including a
        // never-finished `running`) is a failure rather than a guess at a
        // partial answer.
        if (
          !isRecord(data) ||
          data.status !== "success" ||
          typeof data.output !== "string"
        ) {
          return null;
        }

        // Unlike the tagging skill's output, this is prose meant for a human,
        // not a JSON payload for parseTagPayload — so once the response-
        // parameter envelope is peeled off, the string underneath is the
        // answer itself.
        const prose = unwrapSkillOutput(data.output).trim();
        return prose.length > 0 ? prose : null;
      } catch {
        return null;
      }
    },
  };
}
