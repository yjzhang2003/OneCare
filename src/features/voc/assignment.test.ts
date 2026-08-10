import { describe, expect, it } from "vitest";

import { resolveOwner, type OwnerRule } from "./assignment";

const rules: readonly OwnerRule[] = [
  { scope: "电商评价/冰箱", openId: "ou_fridge", fallback: false },
  { scope: "电商评价", openId: "ou_ecom", fallback: false },
  { scope: "", openId: "ou_backstop", fallback: true },
];

describe("resolveOwner", () => {
  it("prefers the most specific channel and category match", () => {
    expect(
      resolveOwner(rules, { channel: "电商评价", category: "冰箱" }),
    ).toEqual({ openId: "ou_fridge", viaFallback: false });
  });

  it("falls back to a channel-only rule", () => {
    expect(
      resolveOwner(rules, { channel: "电商评价", category: "空调" }),
    ).toEqual({ openId: "ou_ecom", viaFallback: false });
  });

  it("uses the backstop when nothing matches", () => {
    expect(resolveOwner(rules, { channel: "400 客服", category: "电视" })).toEqual(
      { openId: "ou_backstop", viaFallback: true },
    );
  });

  it("returns null when there is no match and no backstop", () => {
    expect(
      resolveOwner([rules[0]], { channel: "APP", category: "电视" }),
    ).toBeNull();
  });

  it("ignores rules with a blank open id", () => {
    expect(
      resolveOwner([{ scope: "APP", openId: "", fallback: false }], {
        channel: "APP",
        category: "电视",
      }),
    ).toBeNull();
  });
});
