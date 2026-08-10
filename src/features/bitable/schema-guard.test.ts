import { describe, expect, it, vi } from "vitest";

import { assertVocSchema } from "./schema-guard";
import { VOC_FIELD_NAMES } from "./field-map";

describe("assertVocSchema", () => {
  it("passes when every mapped field exists", async () => {
    const listFieldNames = vi.fn(async () => Object.values(VOC_FIELD_NAMES));

    await expect(assertVocSchema({ listFieldNames })).resolves.toBeUndefined();
  });

  it("names the missing fields instead of failing vaguely", async () => {
    const listFieldNames = vi.fn(async () =>
      Object.values(VOC_FIELD_NAMES).filter(
        (name) => name !== VOC_FIELD_NAMES.state,
      ),
    );

    await expect(assertVocSchema({ listFieldNames })).rejects.toThrow(
      new RegExp(VOC_FIELD_NAMES.state),
    );
  });
});
