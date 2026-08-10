import { describe, expect, it, vi } from "vitest";

import { createAilyTaggingProvider, type AilyTaggingConfig } from "./aily-provider";
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
    expect(JSON.parse(body.input as string)).toEqual({
      records: [
        {
          id: "rec1",
          content: "等了三天没人上门",
          channel: "电商评价",
          category: "冰箱",
          rating: 2,
        },
      ],
    });
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

  it("does not throw when a record is null and returns failed outcomes", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag([null as any]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("does not throw when a record lacks recordId and returns failed outcomes", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag([{} as any]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe("failed");
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
