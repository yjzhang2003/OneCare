import { describe, expect, it, vi } from "vitest";

import type { OwnerRuleRecord } from "../../../../src/features/voc/owner-rules";
import {
  createOwnerCreateRoute,
  createOwnerListRoute,
  parseDraft,
  type OwnerRoutesDependencies,
} from "./route";

const RULES: readonly OwnerRuleRecord[] = [
  {
    recordId: "rec-1",
    scope: "400 客服/冰箱",
    openId: "ou_a",
    ownerName: "黄齐",
    fallback: false,
    role: "客服" as const,
  },
  {
    recordId: "rec-2",
    scope: "电商评价",
    openId: "ou_b",
    ownerName: "张禹健",
    fallback: true,
    role: "客服" as const,
  },
];

function deps(
  overrides: Partial<OwnerRoutesDependencies> = {},
): OwnerRoutesDependencies {
  return {
    session: async () => ({ openId: "ou_viewer", name: "张禹健" }),
    list: async () => RULES,
    create: async () => "rec-new",
    options: async () => ({
      channels: ["400 客服", "电商评价"],
      categories: ["冰箱", "洗衣机"],
    }),
    assignableOpenIds: async () => ["ou_a", "ou_b", "ou_c"],
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request("https://example.test/api/voc/owners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A valid draft, so each test below can say in one line what it changes about it.
const DRAFT = {
  channel: "400 客服",
  category: "洗衣机",
  openId: "ou_c",
  fallback: false,
  role: "客服" as const,
};

describe("parseDraft", () => {
  it("treats a missing category as 'every category on this channel'", () => {
    expect(parseDraft({ channel: "电商评价", openId: "ou_a" })).toEqual({
      channel: "电商评价",
      category: "",
      openId: "ou_a",
      fallback: false,
      role: "客服" as const,
    });
  });

  it("rejects a body missing the two fields a rule cannot exist without", () => {
    expect(parseDraft({ channel: "电商评价" })).toBeNull();
    expect(parseDraft({ openId: "ou_a" })).toBeNull();
    expect(parseDraft(null)).toBeNull();
  });

  it("reads 兜底 as strictly true, so a stray string cannot promote a rule", () => {
    const draft = parseDraft({ channel: "电商评价", openId: "ou_a", fallback: "yes" });
    expect(draft?.fallback).toBe(false);
  });
});

describe("GET /api/voc/owners", () => {
  it("returns the rules to a signed-in operator", async () => {
    const response = await createOwnerListRoute(deps())();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, rules: RULES });
  });

  it("refuses without a session, because the table names real colleagues", async () => {
    const response = await createOwnerListRoute(
      deps({ session: async () => null }),
    )();
    expect(response.status).toBe(401);
  });

  it("reports a failed read as a failure rather than as an empty table", async () => {
    const response = await createOwnerListRoute(
      deps({
        list: async () => {
          throw new Error("bitable down");
        },
      }),
    )();
    expect(response.status).toBe(500);
  });
});

describe("POST /api/voc/owners", () => {
  it("writes the composed 渠道/品类 scope, not the two fields", async () => {
    const create = vi.fn(async () => "rec-new");
    const response = await createOwnerCreateRoute(deps({ create }))(post(DRAFT));

    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith({
      scope: "400 客服/洗衣机",
      openId: "ou_c",
      fallback: false,
      role: "客服" as const,
    });
  });

  it("writes the channel alone when no category is chosen", async () => {
    const create = vi.fn(async () => "rec-new");
    await createOwnerCreateRoute(deps({ create }))(
      post({ ...DRAFT, category: "" }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "400 客服" }),
    );
  });

  // The browser builds the scope from real values, but it is not a trust boundary: the
  // refusals below are the ones that keep a dead rule out of the table.
  it("refuses a channel the data does not contain, which could never match", async () => {
    const create = vi.fn(async () => "rec-new");
    const response = await createOwnerCreateRoute(deps({ create }))(
      post({ ...DRAFT, channel: "400客服" }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { problems: string[] };
    expect(body.problems[0]).toContain("永远不会命中");
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a duplicate scope, because matching only ever takes the first", async () => {
    const response = await createOwnerCreateRoute(deps())(
      post({ ...DRAFT, category: "冰箱" }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("第二条不会生效");
  });

  it("refuses a second 兜底", async () => {
    const response = await createOwnerCreateRoute(deps())(
      post({ ...DRAFT, fallback: true }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("兜底只能有一个");
  });

  it("refuses a person outside the app's visible scope, whom Bitable would reject", async () => {
    const response = await createOwnerCreateRoute(deps())(
      post({ ...DRAFT, openId: "ou_stranger" }),
    );
    expect(response.status).toBe(422);
  });

  // An unreadable directory must not become "nobody can be assigned": the openId came
  // from a picker that was populated by the same directory when it was readable.
  it("skips the person check when the directory could not be read", async () => {
    const create = vi.fn(async () => "rec-new");
    const response = await createOwnerCreateRoute(
      deps({ create, assignableOpenIds: async () => [] }),
    )(post({ ...DRAFT, openId: "ou_stranger" }));

    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalled();
  });

  it("refuses without a session, before reading or writing anything", async () => {
    const list = vi.fn(async () => RULES);
    const create = vi.fn(async () => "rec-new");
    const response = await createOwnerCreateRoute(
      deps({ session: async () => null, list, create }),
    )(post(DRAFT));

    expect(response.status).toBe(401);
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("answers a malformed body with 400 rather than writing a broken rule", async () => {
    const create = vi.fn(async () => "rec-new");
    const response = await createOwnerCreateRoute(deps({ create }))(
      post({ channel: "电商评价" }),
    );
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of claiming the rule was saved", async () => {
    const response = await createOwnerCreateRoute(
      deps({
        create: async () => {
          throw new Error("bitable rejected");
        },
      }),
    )(post(DRAFT));
    expect(response.status).toBe(500);
  });
});
