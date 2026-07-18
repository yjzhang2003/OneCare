# OneCare Fixed Top Bar and Hero Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the OneCare Top Bar visible and right-align all four section links while removing the Hero prototype line and fault card.

**Architecture:** Preserve the existing `SiteHeader` component and navigation data. Lock rendered content first, then use landing-scoped CSS to convert the header from sticky to fixed with responsive offset and anchor compensation; delete obsolete Hero markup and styles instead of hiding them.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, CSS, Vitest, React Testing Library, Playwright CLI, Vercel Preview.

## Global Constraints

- The Top Bar is `position: fixed` and remains visible at the viewport top.
- All four section links remain rendered and align to the right on desktop and mobile.
- Desktop and mobile content offsets equal the `64px` and `118px` Top Bar heights.
- Hero prototype copy and fault-card markup are removed, not visually hidden.
- Authentication links, button interactions, footer prototype disclosure, and Production remain unchanged.
- Publish only a non-production Vercel Preview after verification.

---

### Task 1: Lock the fixed-header content contract

**Files:**
- Modify: `app/landing-content.test.tsx`

**Interfaces:**
- Consumes: `LandingContent({ user, authError })`.
- Produces: a failing contract for removed Hero content and complete navigation.

- [x] **Step 1: Write the failing test**

Assert all four links exist in `navigation[aria-label="主页章节"]`; assert `.session-copy`, `.showroom-hero__case`, “方案原型 · 未接入真实业务数据”, and “冰箱温控异常” are absent. Update the signed-in test to retain `/dashboard` coverage without expecting a welcome line.

- [x] **Step 2: Run targeted tests and verify RED**

Run `npm test -- app/landing-content.test.tsx`. Expect failure because the Hero still renders both removed elements.

- [x] **Step 3: Commit the failing contract**

Commit the test with message `test: define fixed Top Bar Hero contract`.

### Task 2: Remove Hero clutter and fix Top Bar layout

**Files:**
- Modify: `app/landing-content.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: existing `SiteHeader`, `workspaceHref`, and section IDs.
- Produces: fixed Top Bar layout and simplified Hero markup.

- [x] **Step 1: Delete Hero status markup**

Remove the complete `session-copy` paragraph and `showroom-hero__case` element from `LandingContent`; do not replace either with empty wrappers.

- [x] **Step 2: Delete obsolete Hero styles**

Remove `.showroom-hero__copy .session-copy`, `.showroom-hero__case`, its child selectors, and its `820px`/`640px` responsive rules.

- [x] **Step 3: Make the Top Bar fixed and right aligned**

Set `.landing-shell` to `padding-top: 64px`; set `.public-header` to `position: fixed`, `inset: 0 0 auto`, and `grid-template-columns: auto minmax(0, 1fr) auto`; set `.public-nav` to `justify-content: flex-end` and `justify-self: end`. Remove the `1100px` rule hiding the first link.

- [x] **Step 4: Add responsive and anchor offsets**

At `640px`, set `.landing-shell { padding-top: 118px; }` and preserve the two-row header while right-aligning its navigation. Set `scroll-margin-top: 80px` on desktop section targets and `134px` on mobile targets.

- [x] **Step 5: Verify GREEN**

Run `npm test -- app/landing-content.test.tsx`, `npm run lint`, `npm run typecheck`, and `git diff --check`; all must pass.

### Task 3: Browser QA and Preview

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-onecare-fixed-topbar-hero-cleanup.md`

**Interfaces:**
- Produces: browser evidence, complete validation, refreshed Preview, and checked plan.

- [x] **Step 1: Run full verification**

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:runtime`, `npm audit --omit=dev`, and `git diff --check`.

- [x] **Step 2: Perform browser QA**

At `1440 × 900` and `390 × 844`, verify fixed position at the top before and after scrolling, four visible section links, right-aligned navigation, correct Hero start position, no removed Hero elements, anchor-title clearance, no overflow, and a clean console.

- [x] **Step 3: Commit implementation**

Commit implementation and the checked plan with message `fix: keep OneCare Top Bar visible`.

- [ ] **Step 4: Deploy and verify Preview**

Deploy without `--prod`, assign `onecare-homepage-preview.vercel.app`, and verify HTTP 200, all four navigation labels, absence of removed Hero strings, and the existing protected share link.
