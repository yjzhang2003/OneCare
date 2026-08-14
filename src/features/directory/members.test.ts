import { describe, expect, it, vi } from "vitest";

import { listAssignableMembers } from "./members";

function respond(payloads: readonly unknown[]) {
  const calls: string[] = [];
  let index = 0;
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    const payload = payloads[Math.min(index, payloads.length - 1)];
    index += 1;
    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fetcher, calls };
}

function env(fetcher: ReturnType<typeof respond>["fetcher"]) {
  return { tenantToken: async () => "t0ken", fetcher: fetcher as unknown as typeof fetch };
}

describe("listAssignableMembers", () => {
  it("resolves visible members to names, sorted", async () => {
    const { fetcher, calls } = respond([
      { code: 0, data: { user_ids: ["ou_b", "ou_a"], has_more: false } },
      {
        code: 0,
        data: {
          items: [
            { open_id: "ou_b", name: "张睿哲" },
            { open_id: "ou_a", name: "黄齐" },
          ],
        },
      },
    ]);

    const members = await listAssignableMembers(env(fetcher));

    expect(members).toEqual([
      { openId: "ou_a", name: "黄齐" },
      { openId: "ou_b", name: "张睿哲" },
    ]);
    expect(calls[0]).toContain("/contact/v3/scopes");
    expect(calls[1]).toContain("/contact/v3/users/batch");
  });

  // Before the contacts permission was granted, users/batch answered `code: 0` with
  // every name undefined. Rendering those would fill a picker with raw open_ids, which
  // is not a list of colleagues — so an unnamed member is left out and the emptiness is
  // visible rather than disguised.
  it("omits members whose name cannot be read", async () => {
    const { fetcher } = respond([
      { code: 0, data: { user_ids: ["ou_a", "ou_b"], has_more: false } },
      {
        code: 0,
        data: {
          items: [{ open_id: "ou_a" }, { open_id: "ou_b", name: "黄齐" }],
        },
      },
    ]);

    expect(await listAssignableMembers(env(fetcher))).toEqual([
      { openId: "ou_b", name: "黄齐" },
    ]);
  });

  it("returns nothing when the app can see nobody", async () => {
    const { fetcher, calls } = respond([
      { code: 0, data: { user_ids: [], has_more: false } },
    ]);

    expect(await listAssignableMembers(env(fetcher))).toEqual([]);
    // No point asking for names of nobody.
    expect(calls).toHaveLength(1);
  });

  // A picker showing the first page of a paged tenant would silently hide colleagues.
  it("follows pagination across scope pages", async () => {
    const { fetcher } = respond([
      { code: 0, data: { user_ids: ["ou_a"], has_more: true, page_token: "p2" } },
      { code: 0, data: { user_ids: ["ou_b"], has_more: false } },
      {
        code: 0,
        data: {
          items: [
            { open_id: "ou_a", name: "黄齐" },
            { open_id: "ou_b", name: "张睿哲" },
          ],
        },
      },
    ]);

    const members = await listAssignableMembers(env(fetcher));
    expect(members.map((m) => m.openId)).toEqual(["ou_a", "ou_b"]);
  });

  it("surfaces a contacts failure rather than reporting an empty directory", async () => {
    const { fetcher } = respond([{ code: 99991672, msg: "not enabled" }]);

    await expect(listAssignableMembers(env(fetcher))).rejects.toThrow(
      /Contacts scopes failed \(code 99991672\)/,
    );
  });
});
