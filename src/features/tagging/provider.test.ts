import { describe, expect, it, vi } from "vitest";

import { createAilyTaggingProvider } from "./aily-provider";
import { createFieldShortcutTaggingProvider } from "./field-shortcut-provider";
import { selectTaggingProvider } from "./provider";
import type { TaggingRequestRecord } from "./provider-types";

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

describe("input robustness: both providers handle malformed input identically", () => {
  const noop = vi.fn(async () => []);
  const ailyProvider = createAilyTaggingProvider(
    {
      ailyAppId: "app",
      skillId: "skill",
      tenantAccessToken: async () => "token",
    },
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: { status: "success", output: '{"results":[]}' },
          }),
        ),
    ),
  );
  const fieldShortcutProvider = createFieldShortcutTaggingProvider({
    read: noop,
  });

  const testInputs = [
    { input: null as unknown as TaggingRequestRecord[], label: "null" },
    { input: undefined as unknown as TaggingRequestRecord[], label: "undefined" },
    { input: "str" as unknown as TaggingRequestRecord[], label: "string" },
    { input: 42 as unknown as TaggingRequestRecord[], label: "number" },
    { input: {} as unknown as TaggingRequestRecord[], label: "object" },
    { input: [null as unknown as TaggingRequestRecord], label: "[null]" },
    { input: [{}] as unknown as TaggingRequestRecord[], label: "[{}]" },
    {
      input: [{ recordId: "" }] as unknown as TaggingRequestRecord[],
      label: '[{recordId:""}]',
    },
    {
      input: [{ recordId: 123 }] as unknown as TaggingRequestRecord[],
      label: "[{recordId:123}]",
    },
  ];

  testInputs.forEach(({ input, label }) => {
    it(`both providers return array without throwing for input: ${label}`, async () => {
      const ailyOutcomes = await ailyProvider.tag(input);
      const fieldShortcutOutcomes = await fieldShortcutProvider.tag(input);

      expect(Array.isArray(ailyOutcomes)).toBe(true);
      expect(Array.isArray(fieldShortcutOutcomes)).toBe(true);
    });

    it(`both providers have matching structure for input: ${label}`, async () => {
      const ailyOutcomes = await ailyProvider.tag(input);
      const fieldShortcutOutcomes = await fieldShortcutProvider.tag(input);

      expect(ailyOutcomes.length).toBe(fieldShortcutOutcomes.length);

      ailyOutcomes.forEach((ailyOutcome, i) => {
        const fieldShortcutOutcome = fieldShortcutOutcomes[i];
        expect(fieldShortcutOutcome).toBeDefined();

        // Both should have the same kind (failed in all these cases)
        expect(ailyOutcome.kind).toBe(fieldShortcutOutcome.kind);

        // Both should have a non-empty string recordId
        if (ailyOutcome.kind === "failed") {
          expect(typeof ailyOutcome.recordId).toBe("string");
          expect(ailyOutcome.recordId.length).toBeGreaterThan(0);
        }
        if (fieldShortcutOutcome.kind === "failed") {
          expect(typeof fieldShortcutOutcome.recordId).toBe("string");
          expect(fieldShortcutOutcome.recordId.length).toBeGreaterThan(0);
        }
      });
    });
  });
});
