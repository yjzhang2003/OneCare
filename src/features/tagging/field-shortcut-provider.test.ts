import { describe, expect, it, vi } from "vitest";

import { createFieldShortcutTaggingProvider } from "./field-shortcut-provider";
import type { TaggingRequestRecord } from "./provider-types";

const records: readonly TaggingRequestRecord[] = [
  { recordId: "rec1", content: "太慢了", channel: "APP", category: "空调" },
  { recordId: "rec2", content: "很好", channel: "APP", category: "空调" },
];

describe("createFieldShortcutTaggingProvider", () => {
  it("reads AI values already written by the Base and maps them to TagResult", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: ["着急"],
        polarity: "差评",
        dimensions: ["维修时间"],
        summary: "上门太慢",
        replies: [{ tone: "致歉安抚", text: "抱歉" }],
      },
      {
        recordId: "rec2",
        sentiment: ["开心"],
        polarity: "好评",
        dimensions: [],
        summary: "服务满意",
        replies: [],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag(records);

    expect(provider.name).toBe("field-shortcut");
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.kind).toBe("tagged");
    expect(outcomes[1]?.kind).toBe("tagged");
    expect(read).toHaveBeenCalledWith(["rec1", "rec2"]);
  });

  it("fails a record whose AI fields have not been filled yet", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: [],
        polarity: "",
        dimensions: [],
        summary: "",
        replies: [],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
  });

  it("fails ids the Base did not return", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => []);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag(records);

    expect(outcomes.every((o) => o.kind === "failed")).toBe(true);
  });

  it("fails the batch when the Base read throws", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => {
      throw new Error("bitable down");
    });

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag(records);

    expect(outcomes[0]).toMatchObject({ kind: "failed" });
  });

  it("returns no outcomes for an empty batch", async () => {
    const read = vi.fn();
    const provider = createFieldShortcutTaggingProvider({ read });

    expect(await provider.tag([])).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("normalizes sentiment by removing empty strings", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: ["失望", ""],
        polarity: "差评",
        dimensions: [],
        summary: "不满意",
        replies: [],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]?.kind).toBe("tagged");
    if (outcomes[0]?.kind === "tagged") {
      expect(outcomes[0].result.sentiment).toEqual(["失望"]);
    }
  });

  it("normalizes sentiment by removing whitespace-only strings", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: ["失望", "  "],
        polarity: "差评",
        dimensions: [],
        summary: "不满意",
        replies: [],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]?.kind).toBe("tagged");
    if (outcomes[0]?.kind === "tagged") {
      expect(outcomes[0].result.sentiment).toEqual(["失望"]);
    }
  });

  it("normalizes dimensions by removing empty strings", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: ["维修时间", ""],
        summary: "不满意",
        replies: [],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]?.kind).toBe("tagged");
    if (outcomes[0]?.kind === "tagged") {
      expect(outcomes[0].result.dimensions).toEqual(["维修时间"]);
    }
  });

  it("normalizes replies by removing entries with empty tone", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: [],
        summary: "不满意",
        replies: [
          { tone: "", text: "不行" },
          { tone: "致歉安抚", text: "抱歉" },
        ],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]?.kind).toBe("tagged");
    if (outcomes[0]?.kind === "tagged") {
      expect(outcomes[0].result.replies).toHaveLength(1);
      expect(outcomes[0].result.replies[0]).toEqual({
        tone: "致歉安抚",
        text: "抱歉",
      });
    }
  });

  it("normalizes replies by removing entries with empty text", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: [],
        summary: "不满意",
        replies: [
          { tone: "致歉安抚", text: "" },
          { tone: "致歉安抚", text: "抱歉" },
        ],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]?.kind).toBe("tagged");
    if (outcomes[0]?.kind === "tagged") {
      expect(outcomes[0].result.replies).toHaveLength(1);
      expect(outcomes[0].result.replies[0]).toEqual({
        tone: "致歉安抚",
        text: "抱歉",
      });
    }
  });

  it("normalizes replies by removing entries with whitespace-only tone", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: [],
        summary: "不满意",
        replies: [
          { tone: "  ", text: "不行" },
          { tone: "致歉安抚", text: "抱歉" },
        ],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]?.kind).toBe("tagged");
    if (outcomes[0]?.kind === "tagged") {
      expect(outcomes[0].result.replies).toHaveLength(1);
      expect(outcomes[0].result.replies[0]).toEqual({
        tone: "致歉安抚",
        text: "抱歉",
      });
    }
  });

  it("normalizes replies by removing entries with whitespace-only text", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: [],
        summary: "不满意",
        replies: [
          { tone: "致歉安抚", text: "  " },
          { tone: "致歉安抚", text: "抱歉" },
        ],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]?.kind).toBe("tagged");
    if (outcomes[0]?.kind === "tagged") {
      expect(outcomes[0].result.replies).toHaveLength(1);
      expect(outcomes[0].result.replies[0]).toEqual({
        tone: "致歉安抚",
        text: "抱歉",
      });
    }
  });

  it("passes when sentiment and dimensions contain only empty strings after normalization", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: [""],
        polarity: "差评",
        dimensions: [""],
        summary: "不满意",
        replies: [],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]?.kind).toBe("tagged");
    if (outcomes[0]?.kind === "tagged") {
      expect(outcomes[0].result.sentiment).toEqual([]);
      expect(outcomes[0].result.dimensions).toEqual([]);
    }
  });

  it("passes when replies are all filtered out due to empty tone or text", async () => {
    const read = vi.fn(async (_ids: readonly string[]) => [
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: [],
        summary: "不满意",
        replies: [{ tone: "", text: "" }],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]?.kind).toBe("tagged");
    if (outcomes[0]?.kind === "tagged") {
      expect(outcomes[0].result.replies).toEqual([]);
    }
  });

  describe("input robustness: malformed records", () => {
    const read = vi.fn(async (_ids: readonly string[]) => []);

    it("returns empty array when tag() receives null instead of array", async () => {
      const provider = createFieldShortcutTaggingProvider({ read });
      const outcomes = await provider.tag(null as unknown as readonly TaggingRequestRecord[]);

      expect(outcomes).toEqual([]);
    });

    it("returns empty array when tag() receives undefined instead of array", async () => {
      const provider = createFieldShortcutTaggingProvider({ read });
      const outcomes = await provider.tag(
        undefined as unknown as readonly TaggingRequestRecord[],
      );

      expect(outcomes).toEqual([]);
    });

    it("returns empty array when tag() receives a string instead of array", async () => {
      const provider = createFieldShortcutTaggingProvider({ read });
      const outcomes = await provider.tag("str" as unknown as readonly TaggingRequestRecord[]);

      expect(outcomes).toEqual([]);
    });

    it("returns empty array when tag() receives a number instead of array", async () => {
      const provider = createFieldShortcutTaggingProvider({ read });
      const outcomes = await provider.tag(42 as unknown as readonly TaggingRequestRecord[]);

      expect(outcomes).toEqual([]);
    });

    it("returns empty array when tag() receives an object instead of array", async () => {
      const provider = createFieldShortcutTaggingProvider({ read });
      const outcomes = await provider.tag({} as unknown as readonly TaggingRequestRecord[]);

      expect(outcomes).toEqual([]);
    });

    it("fails a record with null element and uses invalid_0 as recordId", async () => {
      const provider = createFieldShortcutTaggingProvider({ read });
      const outcomes = await provider.tag([null as unknown as TaggingRequestRecord]);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({
        kind: "failed",
        recordId: "invalid_0",
        reason: "Input record lacks valid recordId (must be non-empty string)",
      });
    });

    it("fails a record with empty object and uses invalid_0 as recordId", async () => {
      const provider = createFieldShortcutTaggingProvider({ read });
      const outcomes = await provider.tag([{} as unknown as TaggingRequestRecord]);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({
        kind: "failed",
        recordId: "invalid_0",
        reason: "Input record lacks valid recordId (must be non-empty string)",
      });
    });

    it("fails a record with empty string recordId and uses invalid_0 as placeholder", async () => {
      const provider = createFieldShortcutTaggingProvider({ read });
      const outcomes = await provider.tag([{ recordId: "" } as unknown as TaggingRequestRecord]);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({
        kind: "failed",
        recordId: "invalid_0",
        reason: "Input record lacks valid recordId (must be non-empty string)",
      });
    });

    it("fails a record with numeric recordId and uses invalid_0 as placeholder", async () => {
      const provider = createFieldShortcutTaggingProvider({ read });
      const outcomes = await provider.tag([{ recordId: 123 } as unknown as TaggingRequestRecord]);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({
        kind: "failed",
        recordId: "invalid_0",
        reason: "Input record lacks valid recordId (must be non-empty string)",
      });
    });

    it("fails all records when one has invalid recordId", async () => {
      const provider = createFieldShortcutTaggingProvider({ read });
      const outcomes = await provider.tag([
        { recordId: "rec1", content: "ok", channel: "APP", category: "空调" },
        null as unknown as TaggingRequestRecord,
      ]);

      expect(outcomes).toHaveLength(2);
      expect(outcomes[0]).toMatchObject({
        kind: "failed",
        recordId: "rec1",
        reason: "Batch fails because other records have invalid recordIds",
      });
      expect(outcomes[1]).toMatchObject({
        kind: "failed",
        recordId: "invalid_1",
        reason: "Input record lacks valid recordId (must be non-empty string)",
      });
    });
  });
});
