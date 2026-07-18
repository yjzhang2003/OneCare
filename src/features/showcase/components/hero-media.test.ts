import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const heroAssetPath = resolve(
  process.cwd(),
  "public/images/hisense/onecare-home.png",
);
const heroComponent = readFileSync(
  resolve(process.cwd(), "src/features/showcase/components/hero-media.tsx"),
  "utf8",
);
const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("homepage hero media", () => {
  it("uses the exact user-provided PNG asset", () => {
    expect(existsSync(heroAssetPath)).toBe(true);
    if (!existsSync(heroAssetPath)) return;

    const digest = createHash("sha256")
      .update(readFileSync(heroAssetPath))
      .digest("hex");

    expect(digest).toBe(
      "a4b5fe7e45717f34fbb0ea46aae615d8b6acb6e4b369dfd0e6163153f65195d4",
    );
    expect(heroComponent).toContain(
      'src="/images/hisense/onecare-home.png"',
    );
  });

  it("keeps any responsive crop anchored to the left edge", () => {
    const heroImageRules = Array.from(
      css.matchAll(/\.showroom-hero__media img\s*\{[^}]*\}/g),
      ([rule]) => rule,
    );

    expect(heroImageRules).toHaveLength(2);
    expect(
      heroImageRules.every((rule) =>
        rule.includes("object-position: left center;"),
      ),
    ).toBe(true);
  });
});
