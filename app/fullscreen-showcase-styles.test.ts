import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("fullscreen showcase stylesheet", () => {
  // Two columns, not three: the leftmost used to be a strip of same-page anchors, and
  // is now the console's own sider, which sits outside this grid entirely. The mobile
  // rows kept their shape — the anchor strip became the one link it always should have
  // been, back to the list.
  it("lays out ticket detail across desktop, tablet and mobile", () => {
    expect(css).toMatch(/\.oc-ticket-detail__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+320px/);
    expect(css).toMatch(/@media\s*\(max-width:\s*1100px\)[\s\S]*?\.oc-ticket-detail__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+300px/);
    const mobileTicketStart = css.lastIndexOf("@media (max-width: 760px)");
    expect(mobileTicketStart).toBeGreaterThan(-1);
    const mobileTicketStyles = css.slice(mobileTicketStart);

    expect(mobileTicketStyles).toMatch(/\.oc-ticket-detail__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(mobileTicketStyles).toMatch(
      /grid-template-areas:\s*"back"\s*"overview"\s*"actions"\s*"body"\s*"key-fields"/,
    );
    expect(mobileTicketStyles).toMatch(
      /\.oc-ticket-detail__main,\s*\.oc-ticket-detail__aside\s*\{[^}]*display:\s*contents/,
    );
    // Every child of the two dissolved columns gets an area. One without would be
    // auto-placed after all five named rows, which for the back link means the bottom
    // of the page.
    for (const [className, area] of [
      ["back", "back"],
      ["overview", "overview"],
      ["actions", "actions"],
      ["body", "body"],
      ["key-fields", "key-fields"],
    ] as const) {
      expect(mobileTicketStyles).toMatch(
        new RegExp(`\\.oc-ticket-detail__${className}\\s*\\{[^}]*grid-area:\\s*${area}`),
      );
    }
  });

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

    const architectureStylesStart = css.indexOf(
      "/* OneCare closed-loop architecture */",
    );
    const mobileStyles = css.slice(
      css.lastIndexOf("@media (max-width: 640px)", architectureStylesStart),
      architectureStylesStart,
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

  it("lays out the closed-loop architecture across desktop and narrow screens", () => {
    expect(css).toMatch(
      /\.service-architecture-panel\s*\{[^}]*border-radius:\s*28px/,
    );
    expect(css).toMatch(
      /\.architecture-layers\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.decision-paths\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.closed-loop-steps\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.pilot-targets__grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /max-width:\s*1100px[\s\S]*?\.architecture-layers[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(
      /max-width:\s*640px[\s\S]*?\.pilot-targets__grid[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*?\.architecture-signal[\s\S]*?animation:\s*none/,
    );
  });

  it("uses open editorial groups and a continuous closed-loop rail", () => {
    expect(css).toMatch(
      /#architecture\.showcase-page\s*\{[^}]*overflow-y:\s*auto/,
    );
    expect(css).toMatch(
      /\.architecture-chapter-tabs\s*\{[^}]*position:\s*sticky[^}]*border-radius:\s*0/,
    );
    expect(css).toMatch(
      /\.architecture-chapter-section\s*\{[^}]*min-height:\s*calc\([^}]*scroll-margin-top:/,
    );
    expect(css).toMatch(
      /\.architecture-chapter-tabs\s*\{[^}]*display:\s*flex/,
    );
    expect(css).toMatch(
      /\.architecture-chapter-tabs button\s*\{[^}]*border-radius:\s*0/,
    );
    expect(css).not.toMatch(/\.architecture-chapter-panel\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(
      /\.service-identities\s*\{[^}]*gap:\s*clamp\([^}]*border:\s*0/,
    );
    expect(css).toMatch(
      /\.architecture-layers\s*\{[^}]*gap:\s*clamp\([^}]*border:\s*0/,
    );
    expect(css).toMatch(
      /\.decision-paths\s*\{[^}]*gap:\s*clamp\([^}]*border:\s*0/,
    );
    expect(css).toMatch(
      /\.pilot-targets__grid\s*\{[^}]*gap:\s*clamp\([^}]*border:\s*0/,
    );
    expect(css).toMatch(
      /\.pilot-targets__stretch\s*\{[^}]*display:\s*block[^}]*color:\s*var\(--onecare-ink\)/,
    );
    expect(css).toMatch(
      /\.pilot-targets__label\s*\{[^}]*min-height:\s*0/,
    );
    expect(css).toMatch(
      /\.pilot-targets__grid-label\s*\{[^}]*color:\s*var\(--onecare-teal-dark\)/,
    );
    expect(css).toMatch(
      /\.closed-loop-steps\s*\{[^}]*position:\s*relative/,
    );
    expect(css).toMatch(
      /\.closed-loop-steps::before\s*\{[^}]*left:\s*0[^}]*right:\s*0[^}]*height:\s*2px/,
    );
    expect(css).not.toMatch(/\.closed-loop-steps li:last-child > i/);
  });

  it("styles the self-help guide without customer progress connector lines", () => {
    expect(css).toMatch(
      /\.customer-service-progress \.demo-timeline li::after\s*\{[\s\S]*?content:\s*none;/,
    );
    expect(css).toMatch(
      /\.customer-resolution-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(css).toMatch(
      /\.customer-knowledge\s*\{[\s\S]*?border-radius:/,
    );
  });

  it("keeps the Feishu gateway scannable and its actions pill-shaped", () => {
    expect(css).toMatch(
      /\.feishu-login-shell\s*\{[^}]*min-height:\s*100svh/,
    );
    expect(css).toMatch(
      /\.feishu-invite-image\s*\{[^}]*object-fit:\s*contain/,
    );
    const inviteImageRule = css.match(/\.feishu-invite-image\s*\{[^}]*\}/)?.[0];
    expect(inviteImageRule).not.toContain("filter:");
    const feishuActionRule = css.match(
      /\.feishu-auth-action,[\s\S]*?\.feishu-experience-banner__action\s*\{[^}]*\}/,
    )?.[0];
    expect(feishuActionRule).toContain("border-radius: 999px");
    expect(feishuActionRule).toContain("justify-content: center");
    expect(css).toMatch(
      /\.feishu-experience-banner\s*\{[^}]*border-radius:\s*22px/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.feishu-login-main\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
    expect(css).not.toMatch(/\.feishu-[^{:]+::after\s*\{[^}]*content:/);
  });

  it("organizes detailed team cards and the responsive two-row footer", () => {
    expect(css).toMatch(/\.team-card__section\s+ul\s*\{/);
    expect(css).toMatch(
      /\.landing-shell \.public-footer\s*\{[^}]*align-items:\s*stretch/,
    );
    expect(css).toMatch(
      /\.landing-shell \.footer-top,\s*\.landing-shell \.footer-bottom\s*\{[\s\S]*?grid-template-columns:/,
    );
    expect(css).toMatch(/\.footer-bottom\s*\{[\s\S]*?border-top:/);
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.landing-shell \.footer-top[\s\S]*?grid-template-columns:\s*1fr/,
    );
  });
});
