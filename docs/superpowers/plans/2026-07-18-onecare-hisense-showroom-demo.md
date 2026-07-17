# OneCare Hisense Showroom Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clickable homepage demo that applies the approved Hisense-showroom visual system: black header and footer, white main canvas, MiSans typography, large Hisense imagery, pill/circle controls, rounded white cards, and four accessible perspective tabs.

**Architecture:** Keep `LandingContent` as the server composition root and preserve the existing typed showcase data. Add one focused Client Component for tab state and keyboard behavior, one server-friendly media component for the hero, and landing-scoped CSS overrides so authentication and dashboard behavior stay intact. Vendor two optimized, user-authorized Hisense images with a source manifest; load MiSans through its documented subset CSS CDN so the font software is not separately redistributed from this repository.

**Tech Stack:** Node.js 24, Next.js 16 App Router, React 19, TypeScript 5.9, CSS, Next Image, Vitest, React Testing Library, Vercel Preview.

## Global Constraints

- All text controls are pill-shaped with `border-radius: 999px`; all icon-only controls are circular.
- All semantic cards use a white background and `16px`, `20px`, or `28px` radii.
- `SiteHeader` and `SiteFooter` are `#000000`; the main canvas is `#FFFFFF`.
- All visible typography uses MiSans; `/dashboard` keeps its structure, colors, and behavior but inherits MiSans.
- Desktop top navigation is at least `16px`; perspective tabs are at least `18px` desktop and `17px` mobile.
- Hero title is at most `68px` desktop and `44px` mobile.
- Keep `#00A4A0` as the only strong UI accent.
- Preserve `/api/auth/feishu/*`, `/dashboard`, cookies, sessions, environment variables, and production configuration.
- Do not add `/experience/*`, a UI framework, CSS-in-JS, WebGL, an animation dependency, a database, or a real AI/IoT integration.
- Keep all claims labeled as prototype behavior or scheme goals.
- After verification, create only a Vercel Preview; do not change Production, secrets, Feishu callbacks, GitHub PRs, or `main`.

---

## File Map

- `app/landing-content.test.tsx`: locks the showroom structure and tab behavior first.
- `app/landing-content.tsx`: composes hero, interactive perspectives, engine, outcomes, and team cards.
- `app/layout.tsx`: adds MiSans subset stylesheet links and applies the global font family marker.
- `app/globals.css`: owns landing-scoped showroom tokens, responsive layout, motion, and global MiSans inheritance.
- `src/features/showcase/components/hero-media.tsx`: renders the optimized Hisense hero image and overlays.
- `src/features/showcase/components/perspective-tabs.tsx`: owns accessible tab state and keyboard movement.
- `src/features/showcase/components/site-header.tsx`: renders the black shared header and larger navigation.
- `src/features/showcase/components/site-footer.tsx`: renders the black shared footer and circular return-to-top control.
- `src/features/showcase/components/journey-scene.tsx`: remove after `PerspectiveTabs` replaces its only caller.
- `public/images/hisense/onecare-home.jpg`: optimized hero image.
- `public/images/hisense/smart-refrigerator.webp`: role-panel product image.
- `public/images/hisense/SOURCES.md`: records image provenance and MiSans acknowledgement.
- `README.md`: records the new demo presentation and external font dependency.

### Task 1: Lock the interactive showroom contract

**Files:**
- Modify: `app/landing-content.test.tsx`

**Interfaces:**
- Consumes: `LandingContent({ user, authError })`.
- Produces: failing behavioral contracts for `PerspectiveTabs`, showroom anchors, authentication, five-layer order, and the absence of dead routes.

- [ ] **Step 1: Replace the homepage presentation test and add tab keyboard coverage**

Use `fireEvent` from React Testing Library and assert:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";

it("presents the Hisense showroom story with interactive perspectives", () => {
  const { container } = render(<LandingContent user={null} />);

  expect(screen.getByRole("heading", {
    name: "让每一次服务，都比问题更早一步",
  })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "四个视角" })).toHaveAttribute(
    "href",
    "#perspectives",
  );
  expect(screen.getByRole("tablist", { name: "OneCare 服务角色" })).toBeInTheDocument();

  const userTab = screen.getByRole("tab", { name: "用户" });
  expect(userTab).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("冰箱好像不太冷了");

  fireEvent.click(screen.getByRole("tab", { name: "客服" }));
  expect(screen.getByRole("tabpanel")).toHaveTextContent(
    "一次理解，不再重复描述",
  );

  expect(screen.getByRole("list", { name: "OneCare 五层服务蓝图" }))
    .toBeInTheDocument();
  expect(screen.getByRole("link", { name: "使用飞书登录" }))
    .toHaveAttribute("href", "/api/auth/feishu/start");
  expect(container.querySelector('a[href^="/experience/"]')).toBeNull();
});

it("moves between perspective tabs with the keyboard", () => {
  render(<LandingContent user={null} />);

  const customer = screen.getByRole("tab", { name: "客服" });
  customer.focus();
  fireEvent.keyDown(customer, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "工程师" }))
    .toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "工程师" })).toHaveFocus();

  fireEvent.keyDown(screen.getByRole("tab", { name: "工程师" }), { key: "End" });
  expect(screen.getByRole("tab", { name: "后台" }))
    .toHaveAttribute("aria-selected", "true");
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
npm test -- app/landing-content.test.tsx
```

Expected: FAIL because the homepage has no tablist, no interactive tabpanel, and the navigation still says `服务旅程`.

- [ ] **Step 3: Commit the verified failing contract**

```bash
git add app/landing-content.test.tsx
git commit -m "test: define OneCare showroom demo"
```

### Task 2: Add the hero and accessible perspective tabs

**Files:**
- Create: `src/features/showcase/components/hero-media.tsx`
- Create: `src/features/showcase/components/perspective-tabs.tsx`
- Modify: `src/features/showcase/components/site-header.tsx`
- Modify: `src/features/showcase/components/site-footer.tsx`
- Modify: `app/landing-content.tsx`
- Delete: `src/features/showcase/components/journey-scene.tsx`

**Interfaces:**
- Produces: `HeroMedia()` and `PerspectiveTabs({ perspectives })`.
- Consumes: existing `Perspective`, `perspectives`, `serviceLayers`, `scenarioSteps`, `outcomes`, and authentication URLs.

- [ ] **Step 1: Create the server-friendly Hero media component**

```tsx
import Image from "next/image";

export function HeroMedia() {
  return (
    <div className="showroom-hero__media" aria-hidden="true">
      <Image
        src="/images/hisense/onecare-home.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
      />
      <div className="showroom-hero__shade" />
      <div className="showroom-hero__pulse"><span /><i /><span /></div>
    </div>
  );
}
```

- [ ] **Step 2: Create `PerspectiveTabs` with click and keyboard behavior**

The component begins with `"use client"`, stores the selected index, uses one ref per tab, and handles `ArrowLeft`, `ArrowRight`, `Home`, and `End`. It renders exactly one tabpanel:

```tsx
<section className="perspective-showcase" id="perspectives">
  <div className="perspective-tabs" role="tablist" aria-label="OneCare 服务角色">
    {perspectives.map((perspective, index) => (
      <button
        aria-controls={`perspective-panel-${index}`}
        aria-selected={index === selectedIndex}
        id={`perspective-tab-${index}`}
        key={perspective.index}
        onClick={() => select(index)}
        onKeyDown={(event) => move(event, index)}
        ref={(node) => { tabs.current[index] = node; }}
        role="tab"
        tabIndex={index === selectedIndex ? 0 : -1}
        type="button"
      >
        {perspective.title.replace("视角", "")}
      </button>
    ))}
  </div>
  <article
    aria-labelledby={`perspective-tab-${selectedIndex}`}
    className="perspective-panel surface-card"
    id={`perspective-panel-${selectedIndex}`}
    role="tabpanel"
  >
    <div className="perspective-panel__media">
      <Image
        src="/images/hisense/smart-refrigerator.webp"
        alt="海信智能冰箱产品示意"
        fill
        sizes="(max-width: 768px) 100vw, 42vw"
      />
      <span>{active.handoff}</span>
    </div>
    <div className="perspective-panel__copy">
      <p>{active.title}</p>
      <h3>{active.sceneLine}</h3>
      <p>{active.value}</p>
      <ul aria-label={`${active.title}关键能力`}>
        {active.capabilities.map((capability) => (
          <li key={capability}>{capability}</li>
        ))}
      </ul>
    </div>
  </article>
</section>
```

Selecting from the keyboard must call `.focus()` on the destination tab after updating state.

- [ ] **Step 3: Recompose `LandingContent`**

- Render `HeroMedia` behind the existing hero headline.
- Change the primary CTA to `查看四个视角` and `href="#perspectives"`.
- Replace the entire `JourneyScene` map with `<PerspectiveTabs perspectives={perspectives} />`.
- Render the architecture `SectionFrame` without `tone="dark"`.
- Render team members as `className="team-card surface-card"`.
- Preserve signed-in copy, safe auth errors, service layers, scheme outcomes, and prototype boundary copy.

- [ ] **Step 4: Update the shared header and footer**

Header navigation becomes:

```ts
const navigation = [
  { href: "/", label: "首页" },
  { href: "#perspectives", label: "四个视角" },
  { href: "#architecture", label: "五层引擎" },
  { href: "#team", label: "团队" },
] as const;
```

Footer uses the same anchors, includes `Typeface: MiSans`, and adds a circular `返回顶部` link with `href="#top"` and an accessible name.

- [ ] **Step 5: Run the targeted test and verify GREEN**

```bash
npm test -- app/landing-content.test.tsx
```

Expected: all landing content tests PASS.

- [ ] **Step 6: Commit the semantic implementation**

```bash
git add app/landing-content.tsx app/landing-content.test.tsx \
  src/features/showcase/components/hero-media.tsx \
  src/features/showcase/components/perspective-tabs.tsx \
  src/features/showcase/components/site-header.tsx \
  src/features/showcase/components/site-footer.tsx \
  src/features/showcase/components/journey-scene.tsx
git commit -m "feat: add OneCare showroom perspectives"
```

### Task 3: Vendor media and apply the visual constitution

**Files:**
- Create: `public/images/hisense/onecare-home.jpg`
- Create: `public/images/hisense/smart-refrigerator.webp`
- Create: `public/images/hisense/SOURCES.md`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: optimized local image URLs and `.landing-shell` showroom styles.
- Consumes: the class names and markup from Task 2.

- [ ] **Step 1: Download and optimize the two approved Hisense images**

```bash
mkdir -p public/images/hisense
curl -L --compressed -sS 'https://static.wixstatic.com/media/991681_91fbfcac1b334c4faa6d555f3285c862~mv2.png/v1/fill/w_2816,h_1048,al_c,q_95,enc_avif,quality_auto/Landing%20Page-2%20extended%202.png' -o /tmp/onecare-home.png
sips -s format jpeg -s formatOptions 78 /tmp/onecare-home.png \
  --out public/images/hisense/onecare-home.jpg
curl -L --compressed -sS 'https://static.wixstatic.com/media/1d7134_174241b8acd54ba7a75c58c56cc33d55~mv2.webp/v1/fill/w_900,h_900,al_c,q_90,enc_avif,quality_auto/66613f54b41f71.webp' \
  -o public/images/hisense/smart-refrigerator.webp
```

Use the exact URLs already recorded in the spec research session:

- Hero: `https://static.wixstatic.com/media/991681_91fbfcac1b334c4faa6d555f3285c862~mv2.png/v1/fill/w_2816,h_1048,al_c,q_95,enc_avif,quality_auto/Landing%20Page-2%20extended%202.png`
- Refrigerator: `https://static.wixstatic.com/media/1d7134_174241b8acd54ba7a75c58c56cc33d55~mv2.webp/v1/fill/w_900,h_900,al_c,q_90,enc_avif,quality_auto/66613f54b41f71.webp`

Verify the hero is below `700KB` and the refrigerator is below `350KB`.

- [ ] **Step 2: Record sources and font acknowledgement**

`SOURCES.md` records both official page and direct asset URLs, capture date `2026-07-18`, intended crop, and this acknowledgement:

```markdown
Typography: This software uses MiSans. MiSans is provided by Xiaomi under the MiSans Font Intellectual Property License Agreement. The demo loads documented web subsets from `cdn.jsdelivr.net/npm/misans@4.1.0` and does not redistribute the font files from this repository.
```

- [ ] **Step 3: Load MiSans and set the global family**

Add stylesheet links for `MiSans-Regular.min.css` and `MiSans-Demibold.min.css` to the document head, with `preconnect` for jsDelivr. Apply `font-family: MiSans, "PingFang SC", "Microsoft YaHei", sans-serif` globally and override every landing heading, button, navigation, label, and number that currently sets Songti or Arial Narrow.

- [ ] **Step 4: Add landing-scoped showroom tokens and layout**

Implement these exact foundations:

```css
.landing-shell {
  --onecare-black: #000;
  --onecare-white: #fff;
  --onecare-teal: #00a4a0;
  --onecare-ink: #111312;
  --onecare-muted: #5f6663;
  --onecare-line: #e4e6e5;
  color: var(--onecare-ink);
  background: var(--onecare-white);
}

.landing-shell :is(.primary-action, .secondary-action, .header-cta, .perspective-tabs button) {
  min-height: 48px;
  border-radius: 999px;
}

.landing-shell .surface-card {
  overflow: hidden;
  border: 1px solid var(--onecare-line);
  border-radius: 28px;
  background: var(--onecare-white);
}
```

Then implement:

- sticky `64px` black header and black mobile menu row;
- white OneCare wordmark, `16px` navigation, pill auth CTA;
- media hero with image crop, local contrast gradient, `52–68px` title, and no status-card clutter;
- `18–20px`, `52px` perspective pills and a wide rounded split panel;
- white rounded five-layer engine with teal path and readable `16px` details;
- three rounded white team cards;
- deep black footer with links at least `15px` and a `48px` teal circular return control;
- mobile layout with `17px` horizontally scrollable tabs, `38–44px` hero, vertical panel/engine/team, and no page overflow;
- reduced-motion overrides.

- [ ] **Step 5: Run static verification and targeted tests**

```bash
npm test -- app/landing-content.test.tsx
npm run lint
npm run typecheck
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the visual system and assets**

```bash
git add app/layout.tsx app/globals.css public/images/hisense
git commit -m "style: apply OneCare showroom visual system"
```

### Task 4: Document, verify, and publish the demo Preview

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-18-onecare-hisense-showroom-demo.md`

**Interfaces:**
- Produces: verified documentation, completed plan state, and a non-production Preview URL.

- [ ] **Step 1: Update README presentation status**

Describe the black/white showroom shell, large Hisense image use, MiSans, four perspective tabs, rounded cards, static prototype boundary, and Preview-only authentication limitation.

- [ ] **Step 2: Run the full verification suite**

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:runtime
npm audit --omit=dev
git diff --check
```

Expected: 9 test files and 34 tests PASS; lint, typecheck, both builds, 3 runtime auth tests, audit, and diff check PASS.

- [ ] **Step 3: Perform browser QA**

Run the app locally and inspect `1440 × 900` and `390 × 844`. Verify computed styles for black header/footer, white main, MiSans, pill buttons, circular icon controls, card radii, tab sizes, no overflow, clean console, keyboard tabs, and reduced motion. Fix visual defects without changing product scope, then rerun targeted checks.

- [ ] **Step 4: Update all plan checkboxes and commit documentation**

```bash
git add README.md docs/superpowers/plans/2026-07-18-onecare-hisense-showroom-demo.md
git commit -m "docs: record OneCare showroom demo"
```

- [ ] **Step 5: Create and verify Vercel Preview**

Run `vercel deploy --yes` without `--prod`, inspect the deployment until `Ready`, assign `onecare-homepage-preview.vercel.app`, and reuse or create a time-limited shareable link. Verify HTTP 200 and the rendered strings `四个视角`, `一次理解，不再重复描述`, and `感知—诊断—编排—服务—学习`.

- [ ] **Step 6: Report Preview and known boundaries**

Return the direct Preview share URL, validation results, branch status, and the fact that Preview Feishu environment variables remain unconfigured. Do not push, open a PR, merge, or deploy Production.
