import { describe, expect, it, vi } from "vitest";

import { selectTaggingProvider } from "./provider";

describe("selectTaggingProvider", () => {
  const deps = {
    createAily: vi.fn(() => ({ name: "aily" as const, tag: async () => [] })),
    createFieldShortcut: vi.fn(() => ({
      name: "field-shortcut" as const,
      tag: async () => [],
    })),
  };

  it("returns the aily provider when configured for aily", () => {
    const provider = selectTaggingProvider("aily", deps);
    expect(provider.name).toBe("aily");
  });

  it("returns the field shortcut provider when configured for it", () => {
    const provider = selectTaggingProvider("field-shortcut", deps);
    expect(provider.name).toBe("field-shortcut");
  });

  it("rejects an unknown provider name instead of defaulting", () => {
    expect(() =>
      selectTaggingProvider("magic" as unknown as "aily", deps),
    ).toThrow(/TAGGING_PROVIDER/);
  });
});
