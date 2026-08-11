import { describe, expect, it, vi } from "vitest";

import {
  createAilyTaggingProvider,
  unwrapSkillOutput,
  type AilyTaggingConfig,
} from "./aily-provider";
import type { TaggingRequestRecord } from "./provider-types";

const config: AilyTaggingConfig = {
  ailyAppId: "spring_demo__c",
  skillId: "skill_demo",
  tenantAccessToken: async () => "t-token",
};

const records: readonly TaggingRequestRecord[] = [
  {
    recordId: "rec1",
    content: "等了三天没人上门",
    channel: "电商评价",
    category: "冰箱",
    rating: 2,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const successOutput = JSON.stringify({
  results: [
    {
      id: "rec1",
      sentiment: ["失望"],
      polarity: "差评",
      dimensions: ["维修时间"],
      summary: "等待三天无人上门",
      replies: [{ tone: "致歉安抚", text: "非常抱歉" }],
    },
  ],
});

describe("createAilyTaggingProvider", () => {
  it("posts to the skill start endpoint with a bearer token", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, msg: "ok", data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    await provider.tag(records);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/aily/v1/apps/spring_demo__c/skills/skill_demo/start",
    );
    expect(init?.method).toBe("POST");
    expect(
      (init?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer t-token");
  });

  it("serialises input as a JSON string rather than a nested object", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    await provider.tag(records);

    const [, init] = fetcher.mock.calls[0];
    const body = JSON.parse(init?.body as string) as { input: unknown };

    expect(typeof body.input).toBe("string");
    const parsed = JSON.parse(body.input as string) as { records: unknown };

    // Doubly encoded on purpose. `input` is a JSON string whose keys are the
    // skill's declared custom parameters, and aily's parameter type picker
    // offers only String, Boolean, Float and Integer — there is no array type
    // (verified in the skill editor on 2026-08-11). So `records` is a String
    // parameter carrying the array as text, which the workflow parses. Handing
    // a real array to a String parameter is a type mismatch at the platform
    // boundary, and it would fail by arriving empty rather than by erroring.
    expect(typeof parsed.records).toBe("string");
    expect(JSON.parse(parsed.records as string)).toEqual([
      {
        id: "rec1",
        content: "等了三天没人上门",
        channel: "电商评价",
        category: "冰箱",
        rating: 2,
      },
    ]);
  });

  it("reports the provider name", () => {
    const provider = createAilyTaggingProvider(config);
    expect(provider.name).toBe("aily");
  });

  it("returns tagged outcomes on success", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]?.kind).toBe("tagged");
  });

  it("fails the batch on a non-zero business code", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 2700001, msg: "invalid param", data: {} }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
    if (outcomes[0]?.kind !== "failed") return;
    expect(outcomes[0].reason).toContain("2700001");
  });

  it("fails the batch when status is anything other than success", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "running" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("fails the batch on a transport error", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw new Error("socket hang up");
    });

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("fails the batch on a non-ok HTTP status", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}, 500));

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("does not throw on non-array inputs and returns empty array", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);

    expect(await provider.tag(null as unknown as readonly TaggingRequestRecord[])).toEqual([]);
    expect(await provider.tag(undefined as unknown as readonly TaggingRequestRecord[])).toEqual(
      [],
    );
    expect(
      await provider.tag("notanarray" as unknown as readonly TaggingRequestRecord[]),
    ).toEqual([]);
    expect(await provider.tag(42 as unknown as readonly TaggingRequestRecord[])).toEqual([]);
    expect(await provider.tag({} as unknown as readonly TaggingRequestRecord[])).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not throw on array with null element and returns outcome with valid recordId", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag([null as unknown as TaggingRequestRecord]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe("failed");
    if (outcomes[0]?.kind === "failed") {
      expect(typeof outcomes[0].recordId).toBe("string");
      expect(outcomes[0].recordId.length).toBeGreaterThan(0);
    }
  });

  it("does not throw when record lacks recordId and returns outcome with valid recordId", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag([{} as unknown as TaggingRequestRecord]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe("failed");
    if (outcomes[0]?.kind === "failed") {
      expect(typeof outcomes[0].recordId).toBe("string");
      expect(outcomes[0].recordId.length).toBeGreaterThan(0);
    }
  });

  it("does not throw when recordId is empty string and returns outcome with valid recordId", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag([{ recordId: "" } as unknown as TaggingRequestRecord]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe("failed");
    if (outcomes[0]?.kind === "failed") {
      expect(typeof outcomes[0].recordId).toBe("string");
      expect(outcomes[0].recordId.length).toBeGreaterThan(0);
    }
  });

  it("does not throw when recordId is non-string and returns outcome with valid recordId", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag([{ recordId: 123 } as unknown as TaggingRequestRecord]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe("failed");
    if (outcomes[0]?.kind === "failed") {
      expect(typeof outcomes[0].recordId).toBe("string");
      expect(outcomes[0].recordId.length).toBeGreaterThan(0);
    }
  });

  it("treats code as a number and fails the batch if code is a string", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: "0", data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("returns no outcomes for an empty batch and makes no call", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    expect(await provider.tag([])).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("unwrapSkillOutput", () => {
  it("unwraps the response-parameter envelope aily actually returns", () => {
    // Verbatim shape observed from the live API on 2026-08-11: the skill's one
    // response parameter is named `output`, and data.output is an envelope keyed
    // by that name whose value is the tag payload as a string.
    const envelope = JSON.stringify({
      output: JSON.stringify({ results: [{ id: "rec1" }] }),
    });

    expect(JSON.parse(unwrapSkillOutput(envelope))).toEqual({
      results: [{ id: "rec1" }],
    });
  });

  it("unwraps regardless of what the skill author named the parameter", () => {
    const envelope = JSON.stringify({
      taggingResult: JSON.stringify({ results: [{ id: "rec1" }] }),
    });

    expect(JSON.parse(unwrapSkillOutput(envelope))).toEqual({
      results: [{ id: "rec1" }],
    });
  });

  it("leaves a payload that already carries results untouched", () => {
    // A skill that emits the contract shape directly must keep working, and a
    // platform change that drops the envelope must not silently break this.
    const direct = JSON.stringify({ results: [{ id: "rec1" }] });

    expect(unwrapSkillOutput(direct)).toBe(direct);
  });

  it("passes through anything ambiguous or unparseable so the real text reaches the diagnostic", () => {
    expect(unwrapSkillOutput("not json")).toBe("not json");
    // Two string fields: guessing which is the payload would be worse than
    // letting parseTagPayload report what it actually received.
    const ambiguous = JSON.stringify({ a: "{}", b: "{}" });
    expect(unwrapSkillOutput(ambiguous)).toBe(ambiguous);
    const noStrings = JSON.stringify({ count: 1 });
    expect(unwrapSkillOutput(noStrings)).toBe(noStrings);
  });
});

describe("batching", () => {
  it("splits a shard into one call per record", async () => {
    // aily's gateway answered 504 for a five-record batch even though the same
    // batch succeeded in 36.5s when called directly — the batch is not reliably
    // deliverable at that size regardless of our own timeout. One record per
    // call is ~7s and the shard's total work is unchanged.
    const many: readonly TaggingRequestRecord[] = Array.from(
      { length: 5 },
      (_, i) => ({
        recordId: `rec${i}`,
        content: "等了三天没人上门",
        channel: "电商评价",
        category: "冰箱",
      }),
    );
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { input: string };
      const sent = JSON.parse(
        (JSON.parse(body.input) as { records: string }).records,
      ) as ReadonlyArray<{ id: string }>;
      return jsonResponse({
        code: 0,
        status: "success",
        data: {
          status: "success",
          output: JSON.stringify({
            results: sent.map((r) => ({
              id: r.id,
              sentiment: ["失望"],
              polarity: "差评",
              dimensions: ["维修时间"],
              summary: "摘要",
              replies: [],
            })),
          }),
        },
      });
    });

    const provider = createAilyTaggingProvider(
      config,
      fetcher as unknown as typeof fetch,
    );
    const outcomes = await provider.tag(many);

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(outcomes).toHaveLength(5);
    expect(outcomes.every((o) => o.kind === "tagged")).toBe(true);
    // Order and identity preserved across chunks, or a later write would put
    // one record's tags onto another record's row.
    expect(outcomes.map((o) => (o.kind === "tagged" ? o.result.recordId : ""))).toEqual([
      "rec0",
      "rec1",
      "rec2",
      "rec3",
      "rec4",
    ]);
  });

  it("keeps the surviving chunks when one fails", async () => {
    const many: readonly TaggingRequestRecord[] = Array.from(
      { length: 3 },
      (_, i) => ({
        recordId: `rec${i}`,
        content: "内容",
        channel: "电商评价",
        category: "冰箱",
      }),
    );
    let call = 0;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      if (call === 2) return jsonResponse({}, 504);
      const body = JSON.parse(init?.body as string) as { input: string };
      const sent = JSON.parse(
        (JSON.parse(body.input) as { records: string }).records,
      ) as ReadonlyArray<{ id: string }>;
      return jsonResponse({
        code: 0,
        data: {
          status: "success",
          output: JSON.stringify({
            results: sent.map((r) => ({
              id: r.id,
              sentiment: ["失望"],
              polarity: "差评",
              dimensions: [],
              summary: "摘要",
              replies: [],
            })),
          }),
        },
      });
    });

    const provider = createAilyTaggingProvider(
      config,
      fetcher as unknown as typeof fetch,
    );
    const outcomes = await provider.tag(many);

    // A gateway failure on one record must not discard the two that worked, and
    // the failed one must still come back as a failure so it keeps its retry.
    expect(outcomes.map((o) => o.kind)).toEqual(["tagged", "failed", "tagged"]);
  });
});
