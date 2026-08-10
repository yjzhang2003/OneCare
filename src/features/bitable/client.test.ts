import { describe, expect, it, vi } from "vitest";

import { createBitableClient, createTenantTokenProvider } from "./client";
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
});
