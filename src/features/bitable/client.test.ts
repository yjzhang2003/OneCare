import { describe, expect, it, vi } from "vitest";

import {
  BATCH_UPDATE_LIMIT,
  createBitableClient,
  createTenantTokenProvider,
} from "./client";
import { VOC_FIELD_NAMES } from "./field-map";

const env = {
  appToken: "bascn_demo",
  vocTableId: "tblvoc",
  ownerTableId: "tblowner",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createTenantTokenProvider", () => {
  it("fetches once and reuses the cached token", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ code: 0, tenant_access_token: "t1", expire: 7200 }),
    );

    const provider = createTenantTokenProvider(
      "cli_x",
      "secret",
      fetcher as unknown as typeof fetch,
    );

    expect(await provider()).toBe("t1");
    expect(await provider()).toBe("t1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("throws on a non-zero business code", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 99991663 }));

    const provider = createTenantTokenProvider(
      "cli_x",
      "secret",
      fetcher as unknown as typeof fetch,
    );

    await expect(provider()).rejects.toThrow(/tenant_access_token/);
  });

  it("still fetches only once across ten serial calls", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ code: 0, tenant_access_token: "t1", expire: 7200 }),
    );

    const provider = createTenantTokenProvider(
      "cli_x",
      "secret",
      fetcher as unknown as typeof fetch,
    );

    const results: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      // Sequential by design: this reproduces the "serial calls" half of the
      // coordinator's probe, where a single cached token must be reused.
      results.push(await provider());
    }

    expect(results).toEqual(Array(10).fill("t1"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shares a single in-flight exchange across five concurrent callers", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ code: 0, tenant_access_token: "t1", expire: 7200 }),
    );

    const provider = createTenantTokenProvider(
      "cli_x",
      "secret",
      fetcher as unknown as typeof fetch,
    );

    const results = await Promise.all([
      provider(),
      provider(),
      provider(),
      provider(),
      provider(),
    ]);

    expect(results).toEqual(["t1", "t1", "t1", "t1", "t1"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed exchange instead of caching the rejection", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 99991663 }));

    const provider = createTenantTokenProvider(
      "cli_x",
      "secret",
      fetcher as unknown as typeof fetch,
    );

    await expect(provider()).rejects.toThrow(/tenant_access_token/);
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockResolvedValueOnce(
      jsonResponse({ code: 0, tenant_access_token: "t1", expire: 7200 }),
    );

    await expect(provider()).resolves.toBe("t1");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries after the fetcher itself rejects, instead of caching the rejection", async () => {
    const fetcher = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new Error("network down"));

    const provider = createTenantTokenProvider(
      "cli_x",
      "secret",
      fetcher as unknown as typeof fetch,
    );

    await expect(provider()).rejects.toThrow(/network down/);
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockResolvedValueOnce(
      jsonResponse({ code: 0, tenant_access_token: "t1", expire: 7200 }),
    );

    await expect(provider()).resolves.toBe("t1");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects every concurrent caller on a first-call failure, then recovers", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 99991663 }));

    const provider = createTenantTokenProvider(
      "cli_x",
      "secret",
      fetcher as unknown as typeof fetch,
    );

    const settled = await Promise.allSettled([
      provider(),
      provider(),
      provider(),
      provider(),
      provider(),
    ]);

    expect(settled.every((result) => result.status === "rejected")).toBe(
      true,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockResolvedValueOnce(
      jsonResponse({ code: 0, tenant_access_token: "t1", expire: 7200 }),
    );

    await expect(provider()).resolves.toBe("t1");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("re-fetches once after expiry, even when requested concurrently", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ code: 0, tenant_access_token: "stale", expire: 0 }),
    );

    const provider = createTenantTokenProvider(
      "cli_x",
      "secret",
      fetcher as unknown as typeof fetch,
    );

    // expire: 0 combined with the token's built-in safety window means the
    // cached entry is already stale the instant it lands.
    await expect(provider()).resolves.toBe("stale");
    expect(fetcher).toHaveBeenCalledTimes(1);

    // mockImplementation (not mockResolvedValue) so a fresh Response — with
    // an unread body — is produced if this were ever invoked more than once.
    fetcher.mockImplementation(async () =>
      jsonResponse({ code: 0, tenant_access_token: "fresh", expire: 7200 }),
    );

    const results = await Promise.all([provider(), provider(), provider()]);

    expect(results).toEqual(["fresh", "fresh", "fresh"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("createBitableClient", () => {
  const token = async () => "t1";

  it("requests a single record with open_id typed people fields", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        code: 0,
        data: {
          record: {
            record_id: "rec1",
            fields: { [VOC_FIELD_NAMES.channel]: "APP" },
          },
        },
      }),
    );

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);
    const record = await client.getRecord("rec1");

    const [url] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/bitable/v1/apps/bascn_demo/tables/tblvoc/records/rec1?user_id_type=open_id",
    );
    expect(record?.recordId).toBe("rec1");
    expect(record?.channel).toBe("APP");
  });

  it("returns null when the record is gone", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 1254043, msg: "not found" }));

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);
    expect(await client.getRecord("recGone")).toBeNull();
  });

  it("pages through list results until the page token runs out", async () => {
    const fetcher = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            has_more: true,
            page_token: "p2",
            items: [{ record_id: "rec1", fields: {} }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: { has_more: false, items: [{ record_id: "rec2", fields: {} }] },
        }),
      );

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);
    const records = await client.listRecords({ pageSize: 1 });

    expect(records.map((r) => r.recordId)).toEqual(["rec1", "rec2"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain("page_token=p2");
  });

  it("stops paging at the configured limit", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          has_more: true,
          page_token: "next",
          items: [{ record_id: "rec1", fields: {} }],
        },
      }),
    );

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);
    await client.listRecords({ pageSize: 1, maxPages: 3 });

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("sends a PUT with open_id typing when updating", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: {} }),
    );

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);
    await client.updateRecord("rec1", { [VOC_FIELD_NAMES.state]: "跟进中" });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toContain("/records/rec1?user_id_type=open_id");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({
      fields: { [VOC_FIELD_NAMES.state]: "跟进中" },
    });
  });

  it("throws when an update is rejected", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 1254005, msg: "field error" }));

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);

    await expect(
      client.updateRecord("rec1", { bad: 1 }),
    ).rejects.toThrow(/1254005/);
  });

  // Only the demo re-seeding uses this, and only because it has to rewrite the whole
  // table: 3628 sequential PUTs is 3628 round trips against the app's write rate limit.
  describe("batchUpdateRecords", () => {
    it("chunks at Feishu's ceiling and sends record_id with fields", async () => {
      const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
        jsonResponse({ code: 0, data: {} }),
      );
      const client = createBitableClient(
        env,
        token,
        fetcher as unknown as typeof fetch,
      );

      const updates = Array.from({ length: BATCH_UPDATE_LIMIT + 3 }, (_, i) => ({
        recordId: `rec${i}`,
        fields: { [VOC_FIELD_NAMES.state]: "已闭环" },
      }));
      await client.batchUpdateRecords(updates);

      expect(fetcher).toHaveBeenCalledTimes(2);
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toContain("/records/batch_update?user_id_type=open_id");
      expect(init?.method).toBe("POST");
      const first = JSON.parse(init?.body as string) as {
        records: { record_id: string; fields: unknown }[];
      };
      expect(first.records).toHaveLength(BATCH_UPDATE_LIMIT);
      expect(first.records[0]).toEqual({
        record_id: "rec0",
        fields: { [VOC_FIELD_NAMES.state]: "已闭环" },
      });
      const second = JSON.parse(
        fetcher.mock.calls[1]![1]?.body as string,
      ) as { records: unknown[] };
      expect(second.records).toHaveLength(3);
    });

    it("sends nothing when there is nothing to update", async () => {
      const fetcher = vi.fn(async () => jsonResponse({ code: 0, data: {} }));
      const client = createBitableClient(
        env,
        token,
        fetcher as unknown as typeof fetch,
      );

      await client.batchUpdateRecords([]);
      expect(fetcher).not.toHaveBeenCalled();
    });

    // A partial failure across several requests can only be resumed if the caller is
    // told how far it got, so the position is in the message rather than just the code.
    it("names the position of the chunk that failed", async () => {
      let call = 0;
      const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
        call += 1;
        return jsonResponse(call === 1 ? { code: 0, data: {} } : { code: 1254005 });
      });
      const client = createBitableClient(
        env,
        token,
        fetcher as unknown as typeof fetch,
      );

      const updates = Array.from({ length: BATCH_UPDATE_LIMIT + 1 }, (_, i) => ({
        recordId: `rec${i}`,
        fields: {},
      }));

      await expect(client.batchUpdateRecords(updates)).rejects.toThrow(
        new RegExp(`record ${BATCH_UPDATE_LIMIT}.*1254005`),
      );
    });
  });

  it("finds a ticket by its war room chat id with a filtered search, not a full scan", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/records/search");
      const body = JSON.parse(init?.body as string) as {
        filter: { conditions: ReadonlyArray<{ field_name: string; value: string[] }> };
      };
      expect(body.filter.conditions[0]?.field_name).toBe("协同群 ID");
      expect(body.filter.conditions[0]?.value).toEqual(["oc_abc123"]);
      return new Response(
        JSON.stringify({
          code: 0,
          data: { items: [{ record_id: "rec1", fields: { 记录编号: "R-1" } }] },
        }),
        { status: 200 },
      );
    });

    const client = createBitableClient(env, async () => "t", fetcher as unknown as typeof fetch);

    expect((await client.findByWarRoomChatId("oc_abc123"))?.recordId).toBe("rec1");
  });

  it("returns null rather than throwing when no ticket carries that chat id", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 }),
    );
    const client = createBitableClient(env, async () => "t", fetcher as unknown as typeof fetch);

    expect(await client.findByWarRoomChatId("oc_missing")).toBeNull();
  });

  it("returns null for a blank chat id without calling the API", async () => {
    // Otherwise every non-group message would cost a cross-border request to look
    // up the empty string.
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createBitableClient(env, async () => "t", fetcher as unknown as typeof fetch);

    expect(await client.findByWarRoomChatId("")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  // Task 14: replaces the ~10.7s full-table scan the two bot-menu cards used
  // to do (readVocRecordsCached + in-memory filtering over 3628 records) with
  // a filtered records/search count that measured ~1.0s against the live
  // Base — records/search's own `total` is the count, so this never asks for
  // the matching rows themselves (page_size=1 is enough to read `total`).
  describe("countRecords", () => {
    it("counts with a filtered records/search request, not a full scan", async () => {
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toContain("/records/search");
        expect(url).toContain("page_size=1");
        expect(url).toContain("user_id_type=open_id");
        expect(init?.method).toBe("POST");
        return jsonResponse({ code: 0, data: { total: 3 } });
      });

      const client = createBitableClient(env, async () => "t", fetcher as unknown as typeof fetch);
      const count = await client.countRecords([
        { field_name: "负责人", value: ["ou_339b8012eda95556fc1efea551455bdb"] },
        { field_name: "流程状态", value: ["待跟进"] },
      ]);

      expect(count).toBe(3);
      const [, init] = fetcher.mock.calls[0];
      const body = JSON.parse(init?.body as string) as {
        filter: {
          conjunction: string;
          conditions: ReadonlyArray<{
            field_name: string;
            operator: string;
            value: readonly string[];
          }>;
        };
      };
      expect(body.filter.conjunction).toBe("and");
      expect(body.filter.conditions).toEqual([
        { field_name: "负责人", operator: "is", value: ["ou_339b8012eda95556fc1efea551455bdb"] },
        { field_name: "流程状态", operator: "is", value: ["待跟进"] },
      ]);
    });

    it("omits the filter entirely for an unconditional total count", async () => {
      const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(JSON.parse(init?.body as string)).toEqual({});
        return jsonResponse({ code: 0, data: { total: 3628 } });
      });

      const client = createBitableClient(env, async () => "t", fetcher as unknown as typeof fetch);
      expect(await client.countRecords([])).toBe(3628);
    });

    it("throws rather than returning 0 on a non-zero business code", async () => {
      const fetcher = vi.fn(async () => jsonResponse({ code: 99991400, msg: "bad filter" }));
      const client = createBitableClient(env, async () => "t", fetcher as unknown as typeof fetch);

      await expect(
        client.countRecords([{ field_name: "流程状态", value: ["待跟进"] }]),
      ).rejects.toThrow(/99991400/);
    });

    // A read that "succeeds" with a malformed shape must not be mistaken for
    // a real count of zero — the same rule this project applies to every
    // other failure mode of a VOC read (readVocRecordsCached's own comment
    // states it first).
    it("throws rather than returning 0 when data.total is missing or not a number", async () => {
      const fetcher = vi.fn(async () => jsonResponse({ code: 0, data: {} }));
      const client = createBitableClient(env, async () => "t", fetcher as unknown as typeof fetch);

      await expect(
        client.countRecords([{ field_name: "流程状态", value: ["待跟进"] }]),
      ).rejects.toThrow(/total/);
    });
  });
});
