import { describe, expect, it, vi } from "vitest";

import { createAnswerProvider, type AnswerProviderConfig } from "./answer-provider";

const config: AnswerProviderConfig = {
  ailyAppId: "spring_demo__c",
  skillId: "skill_demo",
  tenantAccessToken: async () => "t-token",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createAnswerProvider", () => {
  it("posts to the skill start endpoint with a bearer token", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        code: 0,
        data: { status: "success", output: JSON.stringify({ output: "答案" }) },
      }),
    );

    const provider = createAnswerProvider(config, fetcher as unknown as typeof fetch);
    await provider.answer("问题", "{}");

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/aily/v1/apps/spring_demo__c/skills/skill_demo/start",
    );
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer t-token",
    );
  });

  it("returns the skill's prose answer", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/skills/skill_answer/start");
      const body = JSON.parse(init?.body as string) as { input: string };
      const input = JSON.parse(body.input) as { question: string; facts: string };
      // Both are String parameters: aily's custom parameters are scalars only —
      // String, Boolean, Float, Integer, no arrays and no objects.
      expect(typeof input.question).toBe("string");
      expect(typeof input.facts).toBe("string");
      return jsonResponse({
        code: 0,
        data: {
          status: "success",
          output: JSON.stringify({ output: "这条投诉本周同维度还有 12 条。" }),
        },
      });
    });

    const provider = createAnswerProvider(
      { ailyAppId: "spring_x__c", skillId: "skill_answer", tenantAccessToken: async () => "t" },
      fetcher as unknown as typeof fetch,
    );

    expect(await provider.answer("同维度还有几条", "{}")).toBe(
      "这条投诉本周同维度还有 12 条。",
    );
  });

  it("returns null rather than a fabricated answer on any failure", async () => {
    for (const response of [
      jsonResponse({ code: 2320008, msg: "not found" }),
      jsonResponse({ code: 0, data: { status: "running", output: "x" } }),
      jsonResponse({
        code: 0,
        data: { status: "success", output: JSON.stringify({ output: "   " }) },
      }),
      jsonResponse({}, 500),
    ]) {
      const provider = createAnswerProvider(
        config,
        (async () => response) as unknown as typeof fetch,
      );
      expect(await provider.answer("q", "{}")).toBeNull();
    }
  });

  it("returns null instead of throwing when the fetch itself rejects", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw new Error("socket hang up");
    });

    const provider = createAnswerProvider(config, fetcher as unknown as typeof fetch);

    expect(await provider.answer("q", "{}")).toBeNull();
  });

  it("returns null when data.output is missing entirely", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { status: "success" } }),
    );

    const provider = createAnswerProvider(config, fetcher as unknown as typeof fetch);

    expect(await provider.answer("q", "{}")).toBeNull();
  });
});
