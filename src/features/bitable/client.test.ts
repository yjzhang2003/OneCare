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
