import { describe, expect, it, vi } from "vitest";

import { RULE_ENGINE_LABEL } from "../../../../../../../src/features/profiles/insight";
import type { IdentityProfile } from "../../../../../../../src/features/workbench/profiles";
import { createProfileAnalyzeRoute } from "./route";

function profile(): IdentityProfile {
  return {
    id: "U-1",
    records: 2,
    categories: ["冰箱"],
    models: ["BCD-525"],
    channels: ["400 客服"],
    dimensions: ["维修时间"],
    severityHigh: 0,
    open: 1,
    closed: 1,
    firstFeedbackAt: "2026-08-14T04:00:00.000Z",
    lastFeedbackAt: "2026-08-14T08:00:00.000Z",
  };
}

function route(
  overrides: Partial<Parameters<typeof createProfileAnalyzeRoute>[0]> = {},
) {
  const analyze = vi.fn(async () => ({
    kind: "user" as const,
    id: "U-1",
    labels: ["有保留"],
    headline: "两次反馈",
    signals: ["2 条反馈"],
    actions: ["先闭掉未闭环的那几条"],
    level: "中" as const,
    producedBy: RULE_ENGINE_LABEL,
  }));
  const getRecords = vi.fn(async () => []);
  const post = createProfileAnalyzeRoute({
    session: async () => ({ openId: "ou_operator", name: "运营" }),
    getProfile: async () => profile(),
    getRecords,
    provider: { name: RULE_ENGINE_LABEL, analyze },
    now: () => Date.parse("2026-08-15T12:00:00+08:00"),
    ...overrides,
  });
  return { post, analyze, getRecords };
}

function call(
  post: ReturnType<typeof createProfileAnalyzeRoute>,
  kind = "user",
  id = "U-1",
) {
  return post(new Request("https://example.com", { method: "POST" }), {
    params: Promise.resolve({ kind, id }),
  });
}

describe("profile analyze route", () => {
  it("returns the provider's insight for a known identity", async () => {
    const { post, analyze } = route();

    const response = await call(post);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      insight: { level: string; producedBy: string };
    };
    expect(body.ok).toBe(true);
    expect(body.insight.level).toBe("中");
    // Rendered on screen from this field, so a swapped provider changes what the page
    // claims produced the finding.
    expect(body.insight.producedBy).toBe(RULE_ENGINE_LABEL);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  // The provider is the point of the route: an aily skill implementing the same
  // interface replaces the rules without the handler or the page changing.
  it("uses whatever provider it was given", async () => {
    const analyze = vi.fn(async () => ({
      kind: "user" as const,
      id: "U-1",
      labels: [],
      headline: "来自 aily 的结论",
      signals: [],
      actions: [],
      level: "高" as const,
      producedBy: "aily:profile@42",
    }));
    const { post } = route({ provider: { name: "aily", analyze } });

    const body = (await (await call(post)).json()) as {
      insight: { headline: string; producedBy: string };
    };
    expect(body.insight.headline).toBe("来自 aily 的结论");
    expect(body.insight.producedBy).toBe("aily:profile@42");
  });

  it("refuses an anonymous caller before reading anything", async () => {
    const getProfile = vi.fn();
    const { post } = route({ session: async () => null, getProfile });

    expect((await call(post)).status).toBe(401);
    expect(getProfile).not.toHaveBeenCalled();
  });

  // Two identities exist. Anything else is a bad request rather than a lookup that
  // quietly finds nothing.
  it("rejects a kind that is not user or device", async () => {
    const getProfile = vi.fn();
    const { post } = route({ getProfile });

    const response = await call(post, "ticket");
    expect(response.status).toBe(400);
    expect(getProfile).not.toHaveBeenCalled();
  });

  it("answers 404 for an identity that does not exist", async () => {
    const { post, analyze } = route({ getProfile: async () => null });

    expect((await call(post)).status).toBe(404);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("decodes the identity out of the path", async () => {
    const getProfile = vi.fn(async () => profile());
    const { post } = route({ getProfile });

    await call(post, "device", encodeURIComponent("D-A/1"));
    expect(getProfile).toHaveBeenCalledWith("device", "D-A/1");
  });

  it("turns a thrown provider into a legible failure", async () => {
    const { post } = route({
      provider: {
        name: "broken",
        analyze: async () => {
          throw new Error("rule engine exploded");
        },
      },
    });

    const response = await call(post);
    expect(response.status).toBe(500);
    expect((await response.json()).message).toBe("分析暂时不可用，请稍后重试");
  });
});
