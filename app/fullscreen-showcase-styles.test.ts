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

  it("defines fullscreen role workspaces and a phone-sized customer demo", () => {
    expect(css).not.toContain(".showroom-hero__pulse {");
    expect(css).toMatch(
      /\.perspectives-section\s*\{[\s\S]*?height:\s*100%/,
    );
    expect(css).toMatch(
      /\.perspective-workspace-viewport\s*\{[\s\S]*?overflow:\s*hidden/,
    );
    expect(css).toMatch(
      /\.perspective-workspace\[data-position="before"\][^{]*\{[\s\S]*?translateX\(-100%\)/,
    );
    expect(css).toMatch(
      /\.customer-phone\s*\{[\s\S]*?width:\s*min\(390px,\s*100%\)/,
    );
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*?\.perspective-workspace[\s\S]*?transition: none/,
    );
    expect(css).toMatch(
      /max-width:\s*640px[\s\S]*?\.perspective-tabs button\s*\{[\s\S]*?min-width:\s*84px/,
    );
  });

  it("distinguishes adaptive logos and both sides of the customer chat", () => {
    expect(css).toMatch(/\.onecare-logo\s*\{[\s\S]*?object-fit:\s*contain/);
    expect(css).toMatch(
      /\.customer-message\[data-sender="assistant"\][^{]*\{[\s\S]*?align-self:\s*flex-start/,
    );
    expect(css).toMatch(
      /\.customer-message\[data-sender="customer"\][^{]*\{[\s\S]*?align-self:\s*flex-end/,
    );
    expect(css).toMatch(/\.customer-message__body\s*\{[^}]*max-width:\s*78%/);
    expect(css).toMatch(
      /\.customer-message__meta\s*\{[^}]*align-self:\s*flex-end/,
    );
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*\.customer-message\s*\{[\s\S]*?animation:\s*none/,
    );
  });

  it("keeps the customer phone stable while messages scroll internally", () => {
    expect(css).toMatch(/\.customer-scene\s*\{[^}]*height:\s*100%/);
    expect(css).toMatch(/\.customer-scene\s*\{[^}]*min-height:\s*0/);
    expect(css).toMatch(
      /\.customer-phone\s*\{[^}]*max-height:\s*calc\(100% - 16px\)/,
    );
    expect(css).toMatch(
      /\.customer-phone__content\s*\{[^}]*overflow:\s*hidden/,
    );
    expect(css).toMatch(/\.customer-chat\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(
      /\.customer-prompts\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );

    const mobileStyles = css.slice(
      css.lastIndexOf("@media (max-width: 640px)"),
      css.lastIndexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(mobileStyles).toMatch(
      /\.customer-phone\s*\{[^}]*min-height:\s*0[^}]*max-height:\s*none/,
    );
    expect(mobileStyles).toMatch(
      /\.customer-phone__footer\s*\{[^}]*min-height:\s*62px/,
    );
    expect(mobileStyles).toMatch(
      /\.perspective-workspace-viewport\s*\{[^}]*min-height:\s*calc\(100dvh - 244px\)/,
    );
  });
});
