import { describe, expect, it, vi } from "vitest";

import { createAnalyzeRoute, GET, POST } from "./route";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    cronSecret: "s3cret",
    shardSize: 2,
    listPending: vi.fn(async () => [
      {
        recordId: "rec1",
        channel: "电商评价",
        category: "冰箱",
        content: "等了三天",
        rating: 2,
        state: "待分析" as const,
        polarity: null,
        dimensions: [],
        ownerOpenIds: [],
        retryCount: 0,
        ticketOpenedAt: null,
        closedAt: null,
      },
    ]),
    tag: vi.fn(async () => [
      {
        kind: "tagged" as const,
        result: {
          recordId: "rec1",
          sentiment: ["失望"],
          polarity: "差评" as const,
          dimensions: ["维修时间"] as const,
          summary: "等待三天",
          replies: [],
        },
      },
    ]),
    ownerRules: vi.fn(async () => [
      { scope: "", openId: "ou_backstop", fallback: true },
    ]),
    updateRecord: vi.fn(
      async (_recordId: string, _fields: Record<string, unknown>) => undefined,
    ),
    ...overrides,
  };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/voc/analyze", {
    method: "POST",
    headers,
  });
}

describe("createAnalyzeRoute", () => {
  it("rejects a request with no cron secret", async () => {
    const dependencies = deps();
    const response = await createAnalyzeRoute(dependencies)(request());

    expect(response.status).toBe(401);
    expect(dependencies.listPending).not.toHaveBeenCalled();
  });

  it("rejects a wrong cron secret", async () => {
    const dependencies = deps();
    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer wrong" }),
    );

    expect(response.status).toBe(401);
  });

  it("tags a shard and writes the AI columns plus the ticket state", async () => {
    const dependencies = deps();
    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processed: 1,
      tagged: 1,
      failed: 0,
    });

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields["情绪极性"]).toBe("差评");
    expect(fields["严重度"]).toBe("中");
    expect(fields["流程状态"]).toBe("待跟进");
    expect(fields["负责人"]).toEqual([{ id: "ou_backstop" }]);
  });

  it("marks a failed record so the next shard can retake it", async () => {
    const dependencies = deps({
      tag: vi.fn(async () => [
        {
          kind: "failed" as const,
          recordId: "rec1",
          reason: "模型未返回该 id",
          rawOutput: "{}",
        },
      ]),
    });

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(await response.json()).toMatchObject({ failed: 1, tagged: 0 });

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields["流程状态"]).toBe("分析失败");
    expect(fields["失败原因"]).toBe("模型未返回该 id");
    expect(fields["重试次数"]).toBe(1);
  });

  it("returns early when the shard is empty", async () => {
    const dependencies = deps({ listPending: vi.fn(async () => []) });

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(await response.json()).toMatchObject({ processed: 0 });
    expect(dependencies.tag).not.toHaveBeenCalled();
  });

  it("keeps going when one record fails to write", async () => {
    const dependencies = deps({
      updateRecord: vi.fn(async () => {
        throw new Error("bitable down");
      }),
    });

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ writeErrors: 1 });
  });
});

describe("route exports", () => {
  // Vercel Cron Jobs always invoke their target with an HTTP GET, never a
  // POST (per vercel.com/docs/cron-jobs), and vercel.json's crons entry has
  // no field to change that. A POST-only export would pass every test above
  // — none of them send a GET — and still 405 the moment the real Cron
  // fires. Both verbs must resolve to the exact same handler.
  it("wires GET to the same handler as POST", () => {
    expect(GET).toBe(POST);
  });
});
