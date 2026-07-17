# OneCare Multi-Page Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public OneCare homepage as the consistent entry point for a future four-perspective, multi-page MVP while preserving the existing Feishu login and protected dashboard.

**Architecture:** Keep `LandingContent` as the server-friendly page composition root, move reusable showcase data into a typed feature module, and split reusable public-site primitives into focused components. Scope the Hisense-inspired teal visual tokens to `.landing-shell` so the existing dashboard is unchanged, and use CSS-only motion and responsive behavior.

**Tech Stack:** Node.js 24 LTS, Next.js 16 App Router, React 19, TypeScript 5.9, CSS, Vitest, React Testing Library.

## Global Constraints

- Implement only `/`; do not create `/experience/*` routes in this phase.
- Do not render links to routes that do not exist.
- Preserve `/api/auth/feishu/start`, `/dashboard`, OAuth cookies, sessions, Route Handlers, and environment configuration.
- Keep all business states labeled as `方案演示`, `下一阶段开放`, or `原型边界`.
- Use TypeScript only and add no UI, animation, AI, analytics, or data dependency.
- Public pages use OneCare branding; `Hisense` does not appear in the wordmark, metadata title, repository name, or URL.
- Homepage colors use `#0B0D0C`, `#F5F7F5`, `#00A4A0`, `#DDF3F1`, and `#626A67`.
- Preserve existing orbit and reveal motion, add only CSS signal-flow motion, and honor `prefers-reduced-motion`.
- Team details remain explicit placeholders and contain no invented biography.

---

## File Map

- `app/landing-content.test.tsx`: public homepage behavior and content contract.
- `app/landing-content.tsx`: homepage section composition, auth notice, and hero.
- `app/globals.css`: landing-scoped design tokens, responsive layouts, and motion.
- `src/features/showcase/content.ts`: readonly role, architecture, scenario, and team content.
- `src/features/showcase/components/site-header.tsx`: reusable public header and anchor navigation.
- `src/features/showcase/components/site-footer.tsx`: reusable footer and prototype boundary.
- `src/features/showcase/components/section-frame.tsx`: consistent section heading and content wrapper.
- `src/features/showcase/components/status-tag.tsx`: consistent prototype/status label.
- `src/features/showcase/components/role-card.tsx`: non-interactive role preview card ready to become a link later.
- `src/features/showcase/components/signal-flow.tsx`: ordered five-layer architecture presentation.
- `README.md`: current homepage scope and deferred perspective pages.

### Task 1: Lock the homepage presentation contract

**Files:**
- Modify: `app/landing-content.test.tsx`

**Interfaces:**
- Consumes: `LandingContent({ user, authError })`.
- Produces: assertions for current anchors, four roles, five layers, scenario, team placeholders, prototype boundary, and absence of dead role links.

- [x] **Step 1: Write the failing homepage test**

Add this test while retaining the existing signed-in and authentication-error tests:

```tsx
it("presents the multi-page service story without dead perspective links", () => {
  const { container } = render(<LandingContent user={null} />);

  expect(screen.getByRole("link", { name: "角色视角" })).toHaveAttribute("href", "#perspectives");
  expect(screen.getByRole("link", { name: "五层架构" })).toHaveAttribute("href", "#architecture");
  expect(screen.getByRole("link", { name: "方案路径" })).toHaveAttribute("href", "#scenario");
  expect(screen.getByRole("link", { name: "团队" })).toHaveAttribute("href", "#team");

  ["用户视角", "客服视角", "工程师视角", "后台视角"].forEach((name) => {
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  });
  ["感知", "诊断", "编排", "服务", "学习"].forEach((name) => {
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  });

  expect(screen.getByRole("heading", { name: "冰箱温控异常" })).toBeInTheDocument();
  expect(screen.getByText("成员 01")).toBeInTheDocument();
  expect(screen.getByText("成员 02")).toBeInTheDocument();
  expect(screen.getByText("成员 03")).toBeInTheDocument();
  expect(screen.getAllByText("成员信息待补充")).toHaveLength(3);
  expect(screen.getByText(/尚未接入真实业务数据或 AI 服务/)).toBeInTheDocument();
  expect(container.querySelector('a[href^="/experience/"]')).toBeNull();
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `npm test -- app/landing-content.test.tsx`

Expected: FAIL because `角色视角`, the role headings, and five-layer content are not rendered.

- [x] **Step 3: Commit the verified failing contract**

Run:

```bash
git add app/landing-content.test.tsx
git commit -m "test: define OneCare homepage story"
```

### Task 2: Add typed showcase content and reusable components

**Files:**
- Create: `src/features/showcase/content.ts`
- Create: `src/features/showcase/components/site-header.tsx`
- Create: `src/features/showcase/components/site-footer.tsx`
- Create: `src/features/showcase/components/section-frame.tsx`
- Create: `src/features/showcase/components/status-tag.tsx`
- Create: `src/features/showcase/components/role-card.tsx`
- Create: `src/features/showcase/components/signal-flow.tsx`
- Modify: `app/landing-content.tsx`

**Interfaces:**
- Produces: `perspectives`, `serviceLayers`, `scenarioSteps`, `teamMembers`; `SiteHeader({ user })`; `SiteFooter()`; `SectionFrame({ id, index, eyebrow, title, intro, tone, children })`; `StatusTag({ children })`; `RoleCard({ role })`; `SignalFlow({ layers })`.
- Consumes: `AuthUser` from `src/features/auth/types` and the unchanged authentication URLs.

- [x] **Step 1: Define readonly showcase types and exact content**

Create `content.ts` with these public types and exports:

```ts
export type Perspective = Readonly<{
  index: string;
  title: string;
  value: string;
  capabilities: readonly string[];
}>;

export type ServiceLayer = Readonly<{
  index: string;
  title: string;
  english: string;
  input: string;
  action: string;
  output: string;
}>;

export type ScenarioStep = Readonly<{
  layer: string;
  title: string;
  description: string;
}>;

export type TeamMember = Readonly<{
  index: string;
  title: string;
  capabilities: readonly string[];
}>;

export const perspectives: readonly Perspective[] = [
  { index: "01", title: "用户视角", value: "少描述、少等待，随时知道服务走到哪一步。", capabilities: ["AI 对话", "主动提醒", "进度追踪"] },
  { index: "02", title: "客服视角", value: "一次理解用户，把复杂问题交给正确的人。", capabilities: ["诉求摘要", "知识建议", "智能路由"] },
  { index: "03", title: "工程师视角", value: "上门前获得诊断与配件线索，推动一次解决。", capabilities: ["设备预诊", "配件建议", "现场反馈"] },
  { index: "04", title: "后台视角", value: "看见全局服务质量，让每个问题沉淀为改善。", capabilities: ["VOC 趋势", "异常预警", "闭环治理"] },
] as const;
```

Continue the same file with the exact five layers, five scenario steps, and three team placeholders:

```ts
export const serviceLayers: readonly ServiceLayer[] = [
  { index: "01", title: "感知", english: "SENSE", input: "IoT 设备信号、用户声音、服务记录", action: "统一采集并识别异常与意图", output: "可处理的问题信号" },
  { index: "02", title: "诊断", english: "DIAGNOSE", input: "问题信号、历史案例、设备知识", action: "风险判断、原因推断、置信度评估", output: "诊断建议与信息缺口" },
  { index: "03", title: "编排", english: "ORCHESTRATE", input: "诊断建议、人员、配件、时效规则", action: "任务拆解、角色路由、资源匹配", output: "可执行的服务计划" },
  { index: "04", title: "服务", english: "SERVE", input: "服务计划、用户偏好、现场反馈", action: "智能客服辅助、工程师执行、进度同步", output: "解决结果与用户确认" },
  { index: "05", title: "学习", english: "LEARN", input: "处理结果、回访、满意度、VOC", action: "效果评估、知识沉淀、问题聚类", output: "下一轮预诊与产品改善" },
] as const;

export const scenarioSteps: readonly ScenarioStep[] = [
  { layer: "感知", title: "异常信号出现", description: "设备温度波动与用户历史反馈形成异常信号。" },
  { layer: "诊断", title: "形成预诊建议", description: "AI 给出传感器或风道相关建议，并标注待确认信息。" },
  { layer: "编排", title: "匹配服务资源", description: "系统匹配工程师、建议配件和可预约时间。" },
  { layer: "服务", title: "带着上下文上门", description: "用户收到连续进度，工程师完成服务并记录结果。" },
  { layer: "学习", title: "沉淀改善线索", description: "回访进入 VOC 聚类，更新案例知识与产品改善线索。" },
] as const;

export const teamMembers: readonly TeamMember[] = [
  { index: "01", title: "产品策略与业务洞察", capabilities: ["业务建模", "用户研究", "方案规划"] },
  { index: "02", title: "AI 工程与系统架构", capabilities: ["AI 应用", "系统设计", "工程实现"] },
  { index: "03", title: "体验设计与服务创新", capabilities: ["服务设计", "交互原型", "视觉表达"] },
] as const;
```

- [x] **Step 2: Implement focused shared components**

Use semantic elements and the following signatures:

```tsx
export function SiteHeader({ user }: { user: AuthUser | null }): React.ReactNode;
export function SiteFooter(): React.ReactNode;
export function StatusTag({ children }: { children: React.ReactNode }): React.ReactNode;
export function RoleCard({ role }: { role: Perspective }): React.ReactNode;
export function SignalFlow({ layers }: { layers: readonly ServiceLayer[] }): React.ReactNode;
```

`SiteHeader` renders only the four valid anchors and the existing session-aware auth CTA. `RoleCard` renders an `<article>`, not an anchor or button. `SignalFlow` uses an ordered list so layer order remains semantic without CSS.

- [x] **Step 3: Compose the new homepage**

Refactor `LandingContent` so it renders, in order:

```tsx
<SiteHeader user={user} />
<main>
  <section className="hero">...</section>
  <section id="perspectives">...</section>
  <section id="architecture">...</section>
  <section id="scenario">...</section>
  <section id="team">...</section>
</main>
<SiteFooter />
```

Keep `errorMessages`, the alert behavior, `让每一次服务，都比问题更早一步`, `/api/auth/feishu/start`, and `/dashboard`. The primary hero CTA is `href="#perspectives"`; the secondary CTA is the session-aware auth link.

- [x] **Step 4: Run the homepage test and verify GREEN**

Run: `npm test -- app/landing-content.test.tsx`

Expected: PASS for all tests in `app/landing-content.test.tsx`.

- [x] **Step 5: Commit the reusable homepage structure**

Run:

```bash
git add app/landing-content.tsx src/features/showcase
git commit -m "feat: build reusable OneCare homepage story"
```

### Task 3: Apply the OneCare teal visual system and motion

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: class names rendered by Task 2.
- Produces: landing-scoped tokens, four-role layouts, continuous five-layer signal flow, scenario timeline, team cards, responsive navigation, and reduced-motion behavior.

- [x] **Step 1: Scope the visual tokens to the public landing page**

Add the exact landing token override so dashboard colors remain unchanged:

```css
.landing-shell {
  --ink: #0b0d0c;
  --ink-soft: #111815;
  --paper: #f5f7f5;
  --paper-deep: #ddf3f1;
  --line: rgba(11, 13, 12, 0.16);
  --orange: #00a4a0;
  --acid: #ddf3f1;
  --muted: #626a67;
}
```

- [x] **Step 2: Implement layouts for all new sections**

Add the layout rules below, extending them with typography, borders, padding, and hover states that use only the scoped tokens:

```css
.public-nav { display: flex; align-items: center; gap: 24px; }
.section-frame { padding: clamp(72px, 9vw, 132px) clamp(22px, 4vw, 64px); }
.role-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.architecture-section { color: var(--paper); background: var(--ink); }
.signal-flow { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 0; padding: 0; list-style: none; }
.scenario-layout { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: clamp(42px, 7vw, 110px); }
.scenario-list { margin: 0; padding: 0; list-style: none; }
.team-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
```

`.role-card` and `.team-card` must share the same one-pixel grid border language. `.status-tag` is an inline-flex uppercase/narrow label. `.signal-layer` keeps its input, action, and output visible without hover so the architecture remains understandable on touch devices.

- [x] **Step 3: Implement motion and interaction states**

Add this signal animation, reuse `rise-in` and `orbit-pulse`, and keep decoration `pointer-events: none`:

```css
@keyframes signal-travel {
  from { transform: translateX(-110%); }
  to { transform: translateX(510%); }
}

.signal-flow::before {
  animation: signal-travel 7s linear infinite;
}
```

Use transform and color transitions only on hover. Retain the global `prefers-reduced-motion` override so this animation collapses to one negligible-duration iteration.

- [x] **Step 4: Implement responsive behavior**

Add these exact layout overrides, with the existing mobile spacing rules left intact:

```css
@media (max-width: 900px) {
  .role-grid, .team-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .signal-flow, .scenario-layout { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .site-header { flex-wrap: wrap; }
  .public-nav { order: 3; width: 100%; overflow-x: auto; }
  .role-grid, .team-grid { grid-template-columns: 1fr; }
}
```

- [x] **Step 5: Run targeted tests and static checks**

Run: `npm test -- app/landing-content.test.tsx && npm run lint && npm run typecheck`

Expected: all commands exit 0.

- [x] **Step 6: Commit the visual system**

Run:

```bash
git add app/globals.css
git commit -m "style: align OneCare homepage with Hisense palette"
```

### Task 4: Document the homepage phase

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-17-onecare-homepage.md`

**Interfaces:**
- Produces: accurate current-state documentation and completed plan checkboxes.

- [x] **Step 1: Update README current implementation**

Replace the current landing-page bullet with these facts:

```markdown
- 面向比赛评审的多页面方案主页；
- 用户、客服、工程师与后台四个角色入口预览；
- “感知—诊断—编排—服务—学习”五层架构与静态案例；
- 三位成员能力占位展示；
```

Add a boundary sentence stating that the four role pages and user-side AI chat demonstration are subsequent phases and are not implemented yet.

- [x] **Step 2: Check current-state language**

Run:

```bash
rg -n "下一阶段开放|尚未接入真实|AI 聊天" README.md app src/features/showcase
```

Expected: current prototype and deferred work are explicitly visible; no copy claims real AI or production data.

- [x] **Step 3: Mark completed plan steps and commit documentation**

Run:

```bash
git add README.md docs/superpowers/plans/2026-07-17-onecare-homepage.md
git commit -m "docs: record OneCare homepage phase"
```

### Task 5: Full verification and handoff

**Files:**
- Modify only if verification exposes a defect: files listed in Tasks 1–4.

**Interfaces:**
- Produces: evidence that presentation, authentication, type safety, production build, and repository hygiene remain valid.

- [x] **Step 1: Run the full local validation**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
```

Expected: every command exits 0; Vitest reports no failed files or tests; Next.js build completes.

- [x] **Step 2: Verify route and secret boundaries**

Run:

```bash
! find app/experience -type f 2>/dev/null | grep -q .
! rg -n 'href="/experience/' app src
git ls-files '.env*'
```

Expected: no role routes or dead links exist, and only `.env.example` is tracked.

- [x] **Step 3: Review the final diff and status**

Run:

```bash
git status --short --branch
git log --oneline --decorate -5
```

Expected: the branch is ahead of `origin/main`, the worktree is clean, and all commits are reported to the user. Do not push or open a pull request unless the user explicitly asks.
