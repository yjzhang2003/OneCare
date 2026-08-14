import { describe, expect, it, vi } from "vitest";

import {
  createOwnerRule,
  deleteOwnerRule,
  listOwnerRuleRecords,
  OWNER_FIELDS,
  updateOwnerRule,
} from "./owner-directory";

const env = (fetcher: ReturnType<typeof vi.fn>) => ({
  bitable: {
    appToken: "bascn_demo",
    vocTableId: "tblvoc",
    ownerTableId: "tblowner",
  },
  token: async () => "t1",
  fetcher: fetcher as unknown as typeof fetch,
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("listOwnerRuleRecords", () => {
  it("keeps the record id, and reads the owner's name off the people field", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        code: 0,
        data: {
          items: [
            {
              record_id: "recA",
              fields: {
                [OWNER_FIELDS.scope]: "400 客服/冰箱",
                [OWNER_FIELDS.owner]: [{ id: "ou_a", name: "黄齐" }],
                [OWNER_FIELDS.fallback]: true,
              },
            },
          ],
        },
      }),
    );

    const rules = await listOwnerRuleRecords(env(fetcher));

    expect(rules).toEqual([
      {
        recordId: "recA",
        scope: "400 客服/冰箱",
        openId: "ou_a",
        ownerName: "黄齐",
        fallback: true,
      },
    ]);
    // The record id is what makes edit and delete possible at all — the pipeline's own
    // reader drops it.
    expect(rules[0]!.recordId).toBe("recA");
    // Without open_id typing the ids come back in a type that never matches an operator.
    expect(fetcher.mock.calls[0]![0]).toContain("user_id_type=open_id");
    expect(fetcher.mock.calls[0]![0]).toContain("/tables/tblowner/records");
  });

  // A rule whose person cannot be read is shown with an empty name rather than a raw
  // open_id: the page should display the gap, not disguise it as a colleague.
  it("leaves an unreadable owner name empty", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          items: [
            {
              record_id: "recB",
              fields: { [OWNER_FIELDS.scope]: "社媒", [OWNER_FIELDS.owner]: [{ id: "ou_b" }] },
            },
          ],
        },
      }),
    );

    const [rule] = await listOwnerRuleRecords(env(fetcher));
    expect(rule).toMatchObject({ openId: "ou_b", ownerName: "", fallback: false });
  });

  it("throws rather than reporting an empty routing table", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 91402, msg: "NOTEXIST" }));
    await expect(listOwnerRuleRecords(env(fetcher))).rejects.toThrow(/91402/);
  });
});

describe("createOwnerRule", () => {
  it("posts the people field as objects and returns the new record id", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { record: { record_id: "recNew" } } }),
    );

    const id = await createOwnerRule(env(fetcher), {
      scope: "社媒",
      openId: "ou_a",
      fallback: false,
    });

    expect(id).toBe("recNew");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toContain("/tables/tblowner/records?user_id_type=open_id");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      fields: {
        [OWNER_FIELDS.scope]: "社媒",
        [OWNER_FIELDS.owner]: [{ id: "ou_a" }],
        [OWNER_FIELDS.fallback]: false,
      },
    });
  });

  it("sends an empty people field rather than a null when nobody is named", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { record: { record_id: "recNew" } } }),
    );

    await createOwnerRule(env(fetcher), { scope: "社媒", openId: "", fallback: false });
    const body = JSON.parse(fetcher.mock.calls[0]![1]?.body as string) as {
      fields: Record<string, unknown>;
    };
    expect(body.fields[OWNER_FIELDS.owner]).toEqual([]);
  });

  it("throws when the create is rejected", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 1254005 }));
    await expect(
      createOwnerRule(env(fetcher), { scope: "社媒", openId: "ou_a", fallback: false }),
    ).rejects.toThrow(/1254005/);
  });

  // A create that answers 0 but names no record leaves the caller with nothing to edit
  // or delete later; that is a failure, not a success.
  it("throws when the response carries no record id", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 0, data: {} }));
    await expect(
      createOwnerRule(env(fetcher), { scope: "社媒", openId: "ou_a", fallback: false }),
    ).rejects.toThrow(/record_id/);
  });
});

describe("updateOwnerRule / deleteOwnerRule", () => {
  it("PUTs the whole rule to its own record", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: {} }),
    );

    await updateOwnerRule(env(fetcher), "recA", {
      scope: "电商评价",
      openId: "ou_b",
      fallback: true,
    });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toContain("/records/recA?user_id_type=open_id");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string).fields[OWNER_FIELDS.fallback]).toBe(true);
  });

  it("DELETEs by record id", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { deleted: true } }),
    );

    await deleteOwnerRule(env(fetcher), "recA");

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toContain("/records/recA");
    expect(init?.method).toBe("DELETE");
  });

  it("throws on a rejected update or delete", async () => {
    const rejecting = vi.fn(async () => jsonResponse({ code: 1254043 }));
    await expect(
      updateOwnerRule(env(rejecting), "recA", { scope: "x", openId: "", fallback: false }),
    ).rejects.toThrow(/1254043/);
    await expect(deleteOwnerRule(env(rejecting), "recA")).rejects.toThrow(/1254043/);
  });
});
