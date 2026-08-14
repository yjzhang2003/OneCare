import { describe, expect, it, vi } from "vitest";

import type { OwnerRuleRecord } from "../../../../../src/features/voc/owner-rules";
import {
  createOwnerDeleteRoute,
  createOwnerUpdateRoute,
  type OwnerMutationDependencies,
} from "./route";

const RULES: readonly OwnerRuleRecord[] = [
  {
    recordId: "rec-1",
    scope: "400 客服/冰箱",
    openId: "ou_a",
    ownerName: "黄齐",
    fallback: false,
  },
  {
    recordId: "rec-2",
    scope: "电商评价",
    openId: "ou_b",
    ownerName: "张禹健",
    fallback: true,
  },
];

function deps(
  overrides: Partial<OwnerMutationDependencies> = {},
): OwnerMutationDependencies {
  return {
    session: async () => ({ openId: "ou_viewer", name: "张禹健" }),
    list: async () => RULES,
    create: async () => "rec-new",
    options: async () => ({
      channels: ["400 客服", "电商评价"],
      categories: ["冰箱", "洗衣机"],
    }),
    assignableOpenIds: async () => ["ou_a", "ou_b", "ou_c"],
    update: async () => {},
    remove: async () => {},
    ...overrides,
  };
}

function params(recordId: string) {
  return { params: Promise.resolve({ recordId }) };
}

function patch(body: unknown): Request {
  return new Request("https://example.test/api/voc/owners/rec-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(): Request {
  return new Request("https://example.test/api/voc/owners/rec-1", {
    method: "DELETE",
  });
}

describe("PATCH /api/voc/owners/[recordId]", () => {
  it("saves the edited rule with its recomposed scope", async () => {
    const update = vi.fn(async () => {});
    const response = await createOwnerUpdateRoute(deps({ update }))(
      patch({
        channel: "400 客服",
        category: "洗衣机",
        openId: "ou_c",
        fallback: false,
      }),
      params("rec-1"),
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith("rec-1", {
      scope: "400 客服/洗衣机",
      openId: "ou_c",
      fallback: false,
    });
  });

  // The check that made the edit route worth its own validation call: without excluding
  // the record being edited, saving a rule unchanged reports it as a duplicate of itself.
  it("lets a rule be saved unchanged instead of conflicting with itself", async () => {
    const update = vi.fn(async () => {});
    const response = await createOwnerUpdateRoute(deps({ update }))(
      patch({
        channel: "400 客服",
        category: "冰箱",
        openId: "ou_a",
        fallback: false,
      }),
      params("rec-1"),
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalled();
  });

  it("still refuses a scope another rule already owns", async () => {
    const update = vi.fn(async () => {});
    const response = await createOwnerUpdateRoute(deps({ update }))(
      patch({
        channel: "电商评价",
        category: "",
        openId: "ou_a",
        fallback: false,
      }),
      params("rec-1"),
    );

    expect(response.status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it("lets the 兜底 rule keep its own 兜底 flag while another edit cannot claim it", async () => {
    const update = vi.fn(async () => {});
    const keep = await createOwnerUpdateRoute(deps({ update }))(
      patch({
        channel: "电商评价",
        category: "",
        openId: "ou_b",
        fallback: true,
      }),
      params("rec-2"),
    );
    expect(keep.status).toBe(200);

    const steal = await createOwnerUpdateRoute(deps({ update }))(
      patch({
        channel: "400 客服",
        category: "冰箱",
        openId: "ou_a",
        fallback: true,
      }),
      params("rec-1"),
    );
    expect(steal.status).toBe(422);
  });

  it("answers 404 for a rule that is no longer there", async () => {
    const update = vi.fn(async () => {});
    const response = await createOwnerUpdateRoute(deps({ update }))(
      patch({
        channel: "400 客服",
        category: "冰箱",
        openId: "ou_a",
        fallback: false,
      }),
      params("rec-gone"),
    );

    expect(response.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses without a session", async () => {
    const response = await createOwnerUpdateRoute(deps({ session: async () => null }))(
      patch({ channel: "400 客服", category: "冰箱", openId: "ou_a" }),
      params("rec-1"),
    );
    expect(response.status).toBe(401);
  });
});

describe("DELETE /api/voc/owners/[recordId]", () => {
  it("deletes a rule that is not the last 兜底", async () => {
    const remove = vi.fn(async () => {});
    const response = await createOwnerDeleteRoute(deps({ remove }))(
      del(),
      params("rec-1"),
    );

    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith("rec-1");
  });

  // Deleting the only 兜底 leaves unmatched tickets with nowhere to go, and nothing
  // downstream reports it — the operator finds out when a ticket goes missing.
  it("refuses to delete the only 兜底, and says what would break", async () => {
    const remove = vi.fn(async () => {});
    const response = await createOwnerDeleteRoute(deps({ remove }))(
      del(),
      params("rec-2"),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("唯一的兜底");
    expect(remove).not.toHaveBeenCalled();
  });

  it("allows deleting a 兜底 once a second one exists", async () => {
    const remove = vi.fn(async () => {});
    const response = await createOwnerDeleteRoute(
      deps({
        remove,
        list: async () => [
          ...RULES,
          {
            recordId: "rec-3",
            scope: "小红书",
            openId: "ou_c",
            ownerName: "李四",
            fallback: true,
          },
        ],
      }),
    )(del(), params("rec-2"));

    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith("rec-2");
  });

  it("answers 404 for a rule that is already gone", async () => {
    const response = await createOwnerDeleteRoute(deps())(del(), params("rec-gone"));
    expect(response.status).toBe(404);
  });

  it("refuses without a session", async () => {
    const remove = vi.fn(async () => {});
    const response = await createOwnerDeleteRoute(
      deps({ session: async () => null, remove }),
    )(del(), params("rec-1"));

    expect(response.status).toBe(401);
    expect(remove).not.toHaveBeenCalled();
  });

  it("reports a failed delete rather than claiming the rule is gone", async () => {
    const response = await createOwnerDeleteRoute(
      deps({
        remove: async () => {
          throw new Error("bitable down");
        },
      }),
    )(del(), params("rec-1"));
    expect(response.status).toBe(500);
  });
});
