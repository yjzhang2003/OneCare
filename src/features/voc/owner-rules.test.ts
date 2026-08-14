import { describe, expect, it } from "vitest";

import { resolveOwner } from "./assignment";
import {
  composeScope,
  routingHealth,
  splitScope,
  toOwnerRules,
  validateOwnerRule,
  type OwnerRuleRecord,
} from "./owner-rules";

function rule(overrides: Partial<OwnerRuleRecord> = {}): OwnerRuleRecord {
  return {
    recordId: "rec1",
    scope: "400 客服",
    openId: "ou_a",
    ownerName: "黄齐",
    fallback: false,
    role: "客服",
    ...overrides,
  };
}

const CHANNELS = ["400 客服", "社媒", "电商评价"] as const;
const CATEGORIES = ["冰箱", "电视", "空调"] as const;

function validate(
  draft: Partial<Parameters<typeof validateOwnerRule>[0]["draft"]> = {},
  rest: Partial<Omit<Parameters<typeof validateOwnerRule>[0], "draft">> = {},
) {
  return validateOwnerRule({
    draft: {
      role: "客服",
      channel: "400 客服",
      category: "",
      openId: "ou_a",
      fallback: false,
      ...draft,
    },
    existing: [],
    editingRecordId: null,
    channels: [...CHANNELS],
    categories: [...CATEGORIES],
    assignableOpenIds: ["ou_a", "ou_b"],
    ...rest,
  });
}

describe("scope composition", () => {
  // The two candidates resolveOwner actually looks for, in its order.
  it("builds the two shapes the matcher looks for", () => {
    expect(composeScope("400 客服", "冰箱")).toBe("400 客服/冰箱");
    expect(composeScope("400 客服", "")).toBe("400 客服");
    expect(composeScope("", "冰箱")).toBe("");
  });

  it("round-trips a category that itself contains a slash", () => {
    const scope = composeScope("社媒", "空调/挂机");
    expect(splitScope(scope)).toEqual({ channel: "社媒", category: "空调/挂机" });
  });

  // The composed string has to be byte-identical to what resolveOwner builds from a
  // ticket, or the rule silently never fires.
  it("matches what resolveOwner builds from a ticket", () => {
    const rules = toOwnerRules([
      rule({ scope: composeScope("400 客服", "冰箱"), openId: "ou_exact" }),
      rule({ recordId: "r2", scope: composeScope("400 客服", ""), openId: "ou_channel" }),
    ]);

    expect(resolveOwner(rules, { channel: "400 客服", category: "冰箱" })).toEqual({
      openId: "ou_exact",
      viaFallback: false,
    });
    expect(resolveOwner(rules, { channel: "400 客服", category: "电视" })).toEqual({
      openId: "ou_channel",
      viaFallback: false,
    });
  });
});

describe("validateOwnerRule", () => {
  it("accepts a rule that can actually fire", () => {
    expect(validate()).toEqual([]);
    expect(validate({ category: "冰箱" })).toEqual([]);
  });

  it("requires a channel and an owner", () => {
    expect(validate({ channel: "" }).join()).toContain("渠道");
    expect(validate({ openId: "" }).join()).toContain("负责人");
  });

  // The failure this whole module exists to prevent: an exact-match rule on a value the
  // data does not contain is dead, and nothing downstream ever says so.
  it("refuses a scope no ticket can ever carry", () => {
    expect(validate({ channel: "400客服" }).join()).toContain("永远不会命中");
    expect(validate({ category: "冰柜" }).join()).toContain("永远不会命中");
  });

  it("refuses a duplicate scope, because the second one is dead on arrival", () => {
    const problems = validate(
      { channel: "社媒" },
      { existing: [rule({ scope: "社媒" })] },
    );
    expect(problems.join()).toContain("第二条不会生效");
  });

  it("refuses a second 兜底", () => {
    const problems = validate(
      { channel: "社媒", fallback: true },
      { existing: [rule({ scope: "电商评价", fallback: true })] },
    );
    expect(problems.join()).toContain("兜底只能有一个");
  });

  // Editing a rule must not report the rule against itself.
  it("does not fault a rule for conflicting with itself", () => {
    const existing = [rule({ recordId: "rec9", scope: "社媒", fallback: true })];
    expect(
      validate(
        { channel: "社媒", fallback: true },
        { existing, editingRecordId: "rec9" },
      ),
    ).toEqual([]);
  });

  it("refuses an owner the directory cannot see", () => {
    expect(validate({ openId: "ou_stranger" }).join()).toContain(
      "不在应用可见范围",
    );
  });

  // A directory read that failed must not block every edit — it disables that one check
  // rather than rejecting everything.
  it("skips the person check when the directory could not be read", () => {
    expect(validate({ openId: "ou_stranger" }, { assignableOpenIds: [] })).toEqual([]);
  });

  it("reports every problem at once rather than one per attempt", () => {
    const problems = validate(
      { channel: "", openId: "" },
      { existing: [] },
    );
    expect(problems).toHaveLength(2);
  });
});

describe("routingHealth", () => {
  it("says whether a ticket that matches nothing has anywhere to go", () => {
    expect(routingHealth([rule()], [...CHANNELS]).hasFallback).toBe(false);
    expect(
      routingHealth([rule({ fallback: true })], [...CHANNELS]).hasFallback,
    ).toBe(true);
  });

  it("names the channels with no rule of their own", () => {
    const health = routingHealth([rule({ scope: "400 客服" })], [...CHANNELS]);
    expect(health.uncovered).toEqual(["社媒", "电商评价"]);
  });

  it("names rules that a earlier rule already shadows", () => {
    const health = routingHealth(
      [rule({ scope: "社媒" }), rule({ recordId: "r2", scope: "社媒" })],
      [...CHANNELS],
    );
    expect(health.shadowed).toEqual(["社媒"]);
    expect(health.total).toBe(2);
  });

  it("counts a channel covered by a category-scoped rule as covered", () => {
    const health = routingHealth(
      [rule({ scope: "社媒/冰箱" })],
      ["社媒"],
    );
    expect(health.uncovered).toEqual([]);
  });
});
