# OneCare Button Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify OneCare homepage text-button hover behavior, remove all decorative arrows from text controls, and center every button label.

**Architecture:** Preserve the existing server components and authentication links. Lock the rendered contract in `LandingContent` tests, simplify the three CTA render trees to text-only content, and consolidate landing-scoped CSS so hover behavior changes only color, background, and border.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, CSS, Vitest, React Testing Library, Playwright CLI, Vercel Preview.

## Global Constraints

- Text buttons contain no `↗`, `↓`, `↑`, or `.action-arrow` decoration.
- Text labels use centered inline-flex layout with symmetric horizontal padding.
- The header CTA, primary Hero CTA, and secondary Hero CTA hover to white background and black text without transforms or content movement.
- The footer return-to-top control is a text pill labeled `返回顶部` with `href="#top"`.
- Authentication URLs, signed-in copy, navigation, dashboard behavior, and Production remain unchanged.
- Publish only a non-production Vercel Preview after verification.

---

### Task 1: Lock the text-only button contract

**Files:**
- Modify: `app/landing-content.test.tsx`

**Interfaces:**
- Consumes: `LandingContent({ user, authError })`.
- Produces: a failing contract for text-only CTA content and the return-to-top pill.

- [x] **Step 1: Write a failing test**

Add assertions that the rendered page contains no `.action-arrow` or arrow glyphs inside `.header-cta`, `.primary-action`, `.secondary-action`, and `.back-to-top`; assert that `返回顶部` links to `#top`.

```tsx
const textButtons = container.querySelectorAll(
  ".header-cta, .primary-action, .secondary-action, .back-to-top",
);
expect(container.querySelector(".action-arrow")).toBeNull();
textButtons.forEach((button) => {
  expect(button.textContent).not.toMatch(/[↗↓↑]/);
});
expect(screen.getByRole("link", { name: "返回顶部" })).toHaveAttribute(
  "href",
  "#top",
);
```

- [x] **Step 2: Run the targeted test and verify RED**

Run `npm test -- app/landing-content.test.tsx` and expect failure because the current controls render `↗`, `↓`, and `↑`.

- [x] **Step 3: Commit the failing contract**

Commit `app/landing-content.test.tsx` with message `test: define text-only button contract`.

### Task 2: Simplify CTA markup and unify CSS states

**Files:**
- Modify: `app/landing-content.tsx`
- Modify: `src/features/showcase/components/site-header.tsx`
- Modify: `src/features/showcase/components/site-footer.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: existing `workspaceHref`, `user`, `#perspectives`, and `#top` targets.
- Produces: text-only pill controls with color-only hover feedback.

- [x] **Step 1: Remove decorative arrow nodes**

Render only the existing CTA label in the header and Hero links. Replace the footer `↑` content with `返回顶部` while retaining `aria-label="返回顶部"` and `href="#top"`.

```tsx
<a className="primary-action" href="#perspectives">
  查看四个视角
</a>
<a className="secondary-action" href={workspaceHref}>
  {user ? "进入工作台" : "使用飞书登录"}
</a>
<a className="back-to-top" href="#top" aria-label="返回顶部">
  返回顶部
</a>
```

- [x] **Step 2: Apply the shared interaction contract**

Set `gap: 0`, `justify-content: center`, `text-align: center`, symmetric padding, and `transition: color 180ms ease, background-color 180ms ease, border-color 180ms ease`. Override inherited transforms with `transform: none` in base, hover, and active states. Set hover to white background and black text; set active background to `#E7E7E7`.

```css
.landing-shell .header-cta,
.landing-shell .primary-action,
.landing-shell .secondary-action,
.landing-shell .back-to-top {
  gap: 0;
  justify-content: center;
  text-align: center;
  transform: none;
  transition: color 180ms ease, background-color 180ms ease,
    border-color 180ms ease;
}

.landing-shell .header-cta:hover,
.landing-shell .primary-action:hover,
.landing-shell .secondary-action:hover,
.landing-shell .back-to-top:hover {
  color: #000000;
  background: #ffffff;
  transform: none;
}
```

- [x] **Step 3: Make return-to-top a pill**

Use `width: auto`, `min-width: 120px`, `height: 48px`, `padding: 0 22px`, `border-radius: 999px`, centered `15px` text, and `white-space: nowrap`. Keep the teal default and white hover state.

```css
.landing-shell .back-to-top {
  width: auto;
  min-width: 120px;
  height: 48px;
  padding: 0 22px;
  border-radius: 999px;
  font-size: 15px;
  white-space: nowrap;
}
```

- [x] **Step 4: Add reduced-motion coverage**

Under `prefers-reduced-motion: reduce`, set transition duration to `0.01ms` for the three CTA classes and `.back-to-top`.

```css
@media (prefers-reduced-motion: reduce) {
  .landing-shell .header-cta,
  .landing-shell .primary-action,
  .landing-shell .secondary-action,
  .landing-shell .back-to-top {
    transition-duration: 0.01ms;
  }
}
```

- [x] **Step 5: Run targeted verification and verify GREEN**

Run `npm test -- app/landing-content.test.tsx`, `npm run lint`, and `npm run typecheck`; expect all commands to pass.

### Task 3: Browser QA, documentation, and Preview

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-onecare-button-interaction-polish.md`

**Interfaces:**
- Produces: checked plan, verified browser evidence, and refreshed non-production Preview.

- [x] **Step 1: Run the full verification suite**

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:runtime`, `npm audit --omit=dev`, and `git diff --check`.

- [x] **Step 2: Perform browser QA**

At `1440 × 900` and `390 × 844`, verify no overflow. Inspect computed styles before and after hover for the header CTA, primary CTA, secondary CTA, and return-to-top pill; confirm centered text, white hover background, black hover text, `transform: none`, clean console, and reduced-motion transition suppression.

- [x] **Step 3: Commit implementation and completed plan**

Commit the implementation, tests, and checked plan with message `fix: unify OneCare button interactions`.

- [x] **Step 4: Deploy and verify Preview**

Run `vercel deploy --yes` without `--prod`, point `onecare-homepage-preview.vercel.app` to the Ready deployment, and verify HTTP 200 plus the strings `查看四个视角`, `使用飞书登录`, and `返回顶部` through the protected share link.
