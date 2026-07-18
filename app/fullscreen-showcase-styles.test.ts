import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("fullscreen showcase stylesheet", () => {
  it("defines an isolated viewport and all three horizontal page states", () => {
    expect(css).toContain(".showcase-viewport {");
    expect(css).toContain("height: calc(100dvh - 64px);");
    expect(css).toContain('.showcase-page[data-position="before"]');
    expect(css).toContain("transform: translateX(-100%);");
    expect(css).toContain('.showcase-page[data-position="active"]');
    expect(css).toContain("transform: translateX(0);");
    expect(css).toContain('.showcase-page[data-position="after"]');
    expect(css).toContain("transform: translateX(100%);");
  });

  it("accounts for the mobile top bar and reduced-motion preference", () => {
    expect(css).toContain("height: calc(100dvh - 118px);");
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*?\.showcase-page[\s\S]*?transition: none/,
    );
  });
});
