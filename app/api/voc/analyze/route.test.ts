import { describe, expect, it, vi } from "vitest";

import {
  buildPendingShard,
  createAnalyzeRoute,
  GET,
  listOwnerRules,
  parseOwnerRules,
  POST,
  resolveTagSource,
} from "./route";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    cronSecret: "s3cret",
    shardSize: 2,
    tagSource: "field-shortcut",
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

// tagSource is a plain string on the dependency type but a *getter* in
// production (a fresh aily batch number per Cron tick, via readTaggingEnv(),
// which throws when TAGGING_PROVIDER is misconfigured). These tests therefore
// have to control and observe the act of *reading* the property, not just its
// value — which is exactly the read that slipped between the previous
// per-read try blocks.
function defineTagSource(dependencies: object, read: () => string): void {
  Object.defineProperty(dependencies, "tagSource", {
    get: read,
    configurable: true,
  });
}

function taggedOutcome(recordId: string) {
  return {
    kind: "tagged" as const,
    result: {
      recordId,
      sentiment: ["失望"],
      polarity: "差评" as const,
      dimensions: ["维修时间"] as const,
      summary: "等待三天",
      replies: [],
    },
  };
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

  // Spec §3.2: 打标来源 must be written on every AI result, success or
  // failure, so a row is explainable and traceable to whichever track
  // produced it. The route only forwards dependencies.tagSource verbatim —
  // the "aily:<skill_id>@<批次号>" vs "field-shortcut" formatting itself is
  // resolveTagSource's job and is locked separately below.
  it("writes 打标来源 from dependencies onto a tagged record", async () => {
    const dependencies = deps({ tagSource: "aily:skill_x@1700000000000" });
    await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields["打标来源"]).toBe("aily:skill_x@1700000000000");
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
    expect(fields["打标来源"]).toBe("field-shortcut");
  });

  // brief's given 6 tests all supply a backstop rule, so resolveOwner never
  // actually returns null anywhere in the suite — the hasOwner guard that
  // keeps a ticket-worthy record at 已分析 was correct but unlocked by any
  // test.
  it("keeps a ticket-worthy record at 已分析 when no owner or backstop resolves", async () => {
    const dependencies = deps({ ownerRules: vi.fn(async () => []) });
    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(await response.json()).toMatchObject({ tagged: 1, failed: 0 });

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields["流程状态"]).toBe("已分析");
    expect(fields["负责人"]).toBeUndefined();
    expect(fields["建单时间"]).toBeUndefined();
  });

  it("returns early when the shard is empty", async () => {
    const dependencies = deps({ listPending: vi.fn(async () => []) });
    const readTagSource = vi.fn(() => "field-shortcut");
    defineTagSource(dependencies, readTagSource);

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    // Exactly the four contracted keys — the fail-closed work must not have
    // leaked a diagnostic field into the success body.
    expect(await response.json()).toEqual({
      processed: 0,
      tagged: 0,
      failed: 0,
      writeErrors: 0,
    });
    expect(dependencies.tag).toHaveBeenCalledTimes(0);
    // Nothing to route means no reason to read the owner table, and no reason
    // to mint a batch number for a shard that tags nothing.
    expect(dependencies.ownerRules).toHaveBeenCalledTimes(0);
    expect(readTagSource).toHaveBeenCalledTimes(0);
  });

  it("reads ownerRules and tagSource exactly once each on the normal path", async () => {
    const dependencies = deps();
    const readTagSource = vi.fn(() => "field-shortcut");
    defineTagSource(dependencies, readTagSource);

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed: 1,
      tagged: 1,
      failed: 0,
      writeErrors: 0,
    });
    expect(dependencies.ownerRules).toHaveBeenCalledTimes(1);
    expect(readTagSource).toHaveBeenCalledTimes(1);
    expect(dependencies.tag).toHaveBeenCalledTimes(1);
    expect(dependencies.updateRecord).toHaveBeenCalledTimes(1);
  });

  // A batch number identifies one shard run, so it must be minted once per
  // request and shared by every record in that request — a per-record read
  // would stamp two rows of the same run with two different batches.
  it("stamps every record in a shard with the same batch number", async () => {
    let reads = 0;
    const dependencies = deps({
      listPending: vi.fn(async () => [
        pendingRecord({ recordId: "rec1", state: "待分析" }),
        pendingRecord({ recordId: "rec2", state: "待分析" }),
      ]),
      tag: vi.fn(async () => [taggedOutcome("rec1"), taggedOutcome("rec2")]),
    });
    defineTagSource(dependencies, () => `aily:skill_x@${(reads += 1)}`);

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(await response.json()).toEqual({
      processed: 2,
      tagged: 2,
      failed: 0,
      writeErrors: 0,
    });
    expect(reads).toBe(1);
    expect(dependencies.updateRecord).toHaveBeenCalledTimes(2);
    const [, first] = dependencies.updateRecord.mock.calls[0];
    const [, second] = dependencies.updateRecord.mock.calls[1];
    expect(first["打标来源"]).toBe("aily:skill_x@1");
    expect(second["打标来源"]).toBe("aily:skill_x@1");
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

  // Read-before-acting: listPending and ownerRules are both read-and-decide
  // dependencies this route needs before it can safely spend AI budget or
  // write anything. 已分析 is a dead end (nothing ever re-fetches it), so a
  // record tagged but then strandable for lack of a routable owner table
  // read is worse than refusing the whole shard up front. A transient
  // Bitable failure here must surface as an explicit 503, not an uncaught
  // exception Next.js turns into an opaque 500, and must not touch tag() or
  // updateRecord() at all.
  describe("fails closed when a read dependency errors", () => {
    it("returns 503 when ownerRules() throws, without tagging or writing anything", async () => {
      const dependencies = deps({
        ownerRules: vi.fn(async () => {
          throw new Error("owner table rate limited");
        }),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "service_unavailable",
        source: "ownerRules",
      });
      expect(dependencies.tag).not.toHaveBeenCalled();
      expect(dependencies.updateRecord).not.toHaveBeenCalled();
    });

    it("returns 503 when ownerRules() returns a rejected promise, without tagging or writing anything", async () => {
      const dependencies = deps({
        ownerRules: vi.fn(() => Promise.reject(new Error("network down"))),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "service_unavailable",
        source: "ownerRules",
      });
      expect(dependencies.tag).not.toHaveBeenCalled();
      expect(dependencies.updateRecord).not.toHaveBeenCalled();
    });

    it("returns 503 when listPending() throws, without tagging or writing anything", async () => {
      const dependencies = deps({
        listPending: vi.fn(async () => {
          throw new Error("voc table rate limited");
        }),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "service_unavailable",
        source: "listPending",
      });
      expect(dependencies.tag).not.toHaveBeenCalled();
      expect(dependencies.updateRecord).not.toHaveBeenCalled();
    });

    it("still returns 401 when unauthorized, even though ownerRules() would throw", async () => {
      const dependencies = deps({
        ownerRules: vi.fn(async () => {
          throw new Error("owner table rate limited");
        }),
      });

      // No Authorization header at all — proves the auth check was not
      // pushed later by this fix's reordering of the read dependencies.
      const response = await createAnalyzeRoute(dependencies)(request());

      expect(response.status).toBe(401);
      expect(dependencies.listPending).not.toHaveBeenCalled();
      expect(dependencies.ownerRules).not.toHaveBeenCalled();
    });
  });

  // The two named sources above cover the reads whose failure was *predicted*.
  // Three rounds of this task each found one more read that had not been
  // predicted (ownerRules inside the loop, then listPending, then the
  // tagSource getter, which landed in the gap between the two try blocks added
  // for the first two). These tests lock the property that replaces the
  // enumeration: no matter where the throw comes from, the handler answers 503
  // — never an uncaught exception Next.js renders as a 500 — and the 401 path
  // is unaffected by the guard that makes that true.
  describe("fails closed on any unexpected error", () => {
    it("returns 503 when the tagSource getter throws", async () => {
      const dependencies = deps();
      defineTagSource(dependencies, () => {
        throw new Error("TAGGING_PROVIDER must be aily or field-shortcut");
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "service_unavailable",
        source: "unexpected",
        reason: "TAGGING_PROVIDER must be aily or field-shortcut",
      });
      expect(dependencies.tag).toHaveBeenCalledTimes(0);
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });

    it("still returns 401 when unauthorized, even though the tagSource getter would throw", async () => {
      const dependencies = deps();
      defineTagSource(dependencies, () => {
        throw new Error("TAGGING_PROVIDER must be aily or field-shortcut");
      });

      // No Authorization header at all. The catch-all now wraps the auth check
      // too (dependencies.cronSecret is itself a throwing getter in
      // production), so this asserts the wrapping did not turn a 401 into a
      // 503 or let anything downstream run first.
      const response = await createAnalyzeRoute(dependencies)(request());

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(dependencies.listPending).toHaveBeenCalledTimes(0);
      expect(dependencies.tag).toHaveBeenCalledTimes(0);
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });

    // tag() gets no try of its own on purpose: the providers hold a
    // never-throw contract (Tasks 6/7) and a dedicated catch would absorb a
    // break in it silently. The catch-all covers it as a backstop only.
    it("returns 503 when tag() breaks its never-throw contract", async () => {
      const dependencies = deps({
        tag: vi.fn(async () => {
          throw new Error("provider contract broken");
        }),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "service_unavailable",
        source: "unexpected",
        reason: "provider contract broken",
      });
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });

    it("returns 503 when listPending resolves to something that is not a shard", async () => {
      const dependencies = deps({
        // A resolved-but-wrong value throws on records.map, well past every
        // read a per-read try block would have been placed around.
        listPending: vi.fn(async () => "not-a-shard" as never),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "service_unavailable",
        source: "unexpected",
      });
      expect(dependencies.tag).toHaveBeenCalledTimes(0);
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });

    it("returns 503 when a field of a listed record cannot be read", async () => {
      const poisoned = pendingRecord({ recordId: "rec1", state: "待分析" });
      Object.defineProperty(poisoned, "content", {
        get() {
          throw new Error("content decode failed");
        },
        configurable: true,
      });
      const dependencies = deps({
        listPending: vi.fn(async () => [poisoned]),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "service_unavailable",
        source: "unexpected",
        reason: "content decode failed",
      });
      expect(dependencies.tag).toHaveBeenCalledTimes(0);
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });

    it("returns 503 rather than 500 when the thrown value cannot be stringified", async () => {
      const dependencies = deps({
        tag: vi.fn(async () => {
          // A prototype-less value: String(value) raises TypeError of its
          // own, so a catch-all that formatted the error naively would throw
          // from inside its own catch block and 500 anyway.
          const opaque: unknown = Object.create(null);
          throw opaque;
        }),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "service_unavailable",
        source: "unexpected",
        reason: "unreadable error",
      });
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });
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

function pendingRecord(overrides: Record<string, unknown> = {}) {
  return {
    recordId: "rec1",
    channel: "电商评价",
    category: "冰箱",
    content: "内容",
    rating: 2,
    state: "分析失败" as const,
    retryCount: 0,
    ...overrides,
  };
}

describe("buildPendingShard", () => {
  // Before this fix, 分析失败 -> 重试 -> 待分析 (and its retryCount < 3 guard)
  // was dead code: nothing in the repo ever called it. These tests exercise
  // the real transition(), not a re-implemented numeric comparison.
  it("returns pending unchanged once it already fills the shard", () => {
    const pending = [pendingRecord({ recordId: "p1", state: "待分析" })];
    const failedCandidates = [pendingRecord({ recordId: "f1", retryCount: 1 })];

    expect(buildPendingShard(pending, failedCandidates, 1)).toEqual(pending);
  });

  it("resets a retry-eligible 分析失败 record to 待分析 to fill a remaining slot", () => {
    const pending = [pendingRecord({ recordId: "p1", state: "待分析" })];
    const failedCandidates = [
      pendingRecord({ recordId: "f1", state: "分析失败", retryCount: 1 }),
    ];

    const shard = buildPendingShard(pending, failedCandidates, 2);

    expect(shard).toHaveLength(2);
    expect(shard[1]).toMatchObject({ recordId: "f1", state: "待分析" });
  });

  it("leaves a record at the retry ceiling out of the shard entirely", () => {
    const failedCandidates = [
      pendingRecord({ recordId: "f1", state: "分析失败", retryCount: 3 }),
    ];

    expect(buildPendingShard([], failedCandidates, 5)).toEqual([]);
  });

  it("stops filling once the shard is full even with more eligible candidates", () => {
    const failedCandidates = [
      pendingRecord({ recordId: "f1", state: "分析失败", retryCount: 0 }),
      pendingRecord({ recordId: "f2", state: "分析失败", retryCount: 0 }),
    ];

    const shard = buildPendingShard([], failedCandidates, 1);

    expect(shard).toHaveLength(1);
    expect(shard[0]).toMatchObject({ recordId: "f1", state: "待分析" });
  });
});

describe("parseOwnerRules", () => {
  // listOwnerRules' raw fetch was previously exercised only by the live Base
  // round-trip. This is the mapping that fetch feeds, tested in isolation.
  it("maps scope/openId/fallback from raw Bitable items", () => {
    expect(
      parseOwnerRules([
        { fields: { 负责范围: "电商评价/冰箱", 负责人: [{ id: "ou_a" }], 兜底: false } },
        { fields: { 负责范围: "", 负责人: [{ id: "ou_b" }], 兜底: true } },
      ]),
    ).toEqual([
      { scope: "电商评价/冰箱", openId: "ou_a", fallback: false },
      { scope: "", openId: "ou_b", fallback: true },
    ]);
  });

  it("defaults openId to an empty string when nobody is assigned", () => {
    expect(
      parseOwnerRules([{ fields: { 负责范围: "APP", 负责人: [], 兜底: false } }]),
    ).toEqual([{ scope: "APP", openId: "", fallback: false }]);
  });

  it("drops malformed items instead of throwing", () => {
    expect(parseOwnerRules([null, "x", 42, {}, { fields: null }])).toEqual([]);
  });
});

const ownerBitableEnv = {
  appToken: "bascn_demo",
  vocTableId: "tblvoc",
  ownerTableId: "tblowner",
};
const ownerToken = async () => "t1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Fetch-level coverage for listOwnerRules, mirroring the fetcher-injection
// pattern client.test.ts already uses for createBitableClient — bitableEnv
// and token are passed in directly (not read from process.env or a module
// singleton), so this needs no real env vars and no live Base call. Behavior
// asserted here is exactly what the function already did; nothing here
// changes what a non-zero code, a malformed response, or a rejecting
// fetcher does.
describe("listOwnerRules", () => {
  it("builds the URL from app_token and the owner table id with an Authorization header and a timeout signal", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { items: [] } }),
    );

    await listOwnerRules(
      ownerBitableEnv,
      ownerToken,
      fetcher as unknown as typeof fetch,
    );

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/bitable/v1/apps/bascn_demo/tables/tblowner/records?user_id_type=open_id&page_size=100",
    );
    expect(init?.headers).toMatchObject({ Authorization: "Bearer t1" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the parsed rules from a successful response", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        code: 0,
        data: {
          items: [
            { fields: { 负责范围: "APP", 负责人: [{ id: "ou_a" }], 兜底: false } },
          ],
        },
      }),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).resolves.toEqual([{ scope: "APP", openId: "ou_a", fallback: false }]);
  });

  it("drops a non-object item in the response instead of throwing", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        code: 0,
        data: {
          items: [
            null,
            { fields: { 负责范围: "门店", 负责人: [{ id: "ou_b" }], 兜底: true } },
          ],
        },
      }),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).resolves.toEqual([{ scope: "门店", openId: "ou_b", fallback: true }]);
  });

  it("throws when the business code is non-zero", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 99991663, msg: "forbidden" }),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).rejects.toThrow(/99991663/);
  });

  it("throws with an unknown code when the payload is not an object", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse([]),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).rejects.toThrow(/unknown/);
  });

  it("treats a response with no data as an empty list instead of throwing", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0 }),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).resolves.toEqual([]);
  });

  it("treats a non-array items field as an empty list instead of throwing", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { items: "not-an-array" } }),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).resolves.toEqual([]);
  });

  it("propagates a rejection when the fetcher itself throws", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw new Error("network down");
    });

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).rejects.toThrow("network down");
  });
});

describe("resolveTagSource", () => {
  it("returns the literal field-shortcut for the B track", () => {
    expect(resolveTagSource({ provider: "field-shortcut" })).toBe(
      "field-shortcut",
    );
  });

  it("formats aily:<skill_id>@<batch> for the A track", () => {
    expect(
      resolveTagSource(
        { provider: "aily", ailyAppId: "spring_x", taggingSkillId: "skill_x" },
        () => 1700000000000,
      ),
    ).toBe("aily:skill_x@1700000000000");
  });
});
