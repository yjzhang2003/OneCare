# 万护 OneCare 整屏章节导航 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把万护 OneCare 当前纵向长首页改成首页、四个视角、五层引擎、团队四个可深链的整屏章节，并统一一级中文标题样式。

**Architecture:** 新增一个聚焦的 Client Component 管理 Hash、活动页面、页面方向和独立滚动容器；`LandingContent` 继续作为服务端友好的内容组合根，把现有角色、蓝图、结果和团队组件作为四个页面内容传入。一级标题通过共享 `ShowcasePageHeading` 渲染，Top Bar 只接收当前页和导航回调，不接管业务内容。

**Tech Stack:** TypeScript、Next.js 16 App Router、React 19、CSS、Vitest、React Testing Library、Vercel Preview。

## Global Constraints

- 一级页面固定为 `#home`、`#perspectives`、`#architecture`、`#team`，顺序不得改变。
- 一级小标题固定为 `00 · 首页`、`01 · 四个视角`、`02 · 五层引擎`、`03 · 团队`。
- Top Bar 固定；页面视口整屏横向切换；每个页面内部独立纵向滚动。
- “方案目标”归入五层引擎页；`SiteFooter` 归入团队页。
- 继续使用 MiSans、黑色页头/页尾、白色主体、药丸按钮和圆角白卡。
- 不修改飞书认证路径、Production 配置、环境变量、Dashboard 或真实业务集成。
- 行为修改必须按 RED → GREEN → REFACTOR 实施。
- 完成本地验证后只发布非 Production Vercel Preview；不推送、不创建 PR、不合并。

---

## File Structure

- `src/features/showcase/navigation.ts`：定义四个一级页面的唯一顺序、Hash 与类型。
- `src/features/showcase/components/showcase-navigator.tsx`：管理活动页、History、Hash、焦点、滚动复位和页面状态。
- `src/features/showcase/components/showcase-navigator.test.tsx`：锁定导航状态、方向、History 和非活动页行为。
- `src/features/showcase/components/showcase-page-heading.tsx`：统一一级小标题、标题和导语结构。
- `src/features/showcase/components/site-header.tsx`：从 props 接收当前页面和导航函数，渲染活动状态。
- `src/features/showcase/components/section-frame.tsx`：复用共享标题组件，不再接收英文 eyebrow。
- `src/features/showcase/components/site-footer.tsx`：页尾入口与新的四页模型保持一致。
- `app/landing-content.tsx`：把当前长页面重新组合为四个整屏页面。
- `app/landing-content.test.tsx`：锁定中文标题、内容归属和现有认证/四视角行为。
- `app/globals.css`：实现整屏视口、横向状态、独立滚动、统一标题和响应式规则。
- `README.md`：把首页描述更新为四个整屏章节和横向切换 Preview。
- `docs/superpowers/specs/2026-07-18-onecare-fullscreen-navigation-design.md`：保持最终实现约束与验证记录一致。
- `docs/superpowers/plans/2026-07-18-onecare-fullscreen-navigation.md`：勾选已完成步骤并记录最终验证。

---

### Task 1: 一级页面模型与导航状态

**Files:**
- Create: `src/features/showcase/navigation.ts`
- Create: `src/features/showcase/components/showcase-navigator.tsx`
- Create: `src/features/showcase/components/showcase-navigator.test.tsx`
- Modify: `src/features/showcase/components/site-header.tsx`

**Interfaces:**
- Produces: `showcasePages`, `ShowcasePageId`, `ShowcasePageContent`, `ShowcaseNavigator({ user, authError, pages })`。
- Consumes: `AuthUser` 与现有 `SiteHeader` 品牌、登录链接。

- [x] **Step 1: 写导航模型和交互失败测试**

测试用四个简单的页面节点渲染 `ShowcaseNavigator`，明确断言：

```tsx
expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("href", "#home");
expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("aria-current", "page");
fireEvent.click(screen.getByRole("link", { name: "四个视角" }));
expect(window.location.hash).toBe("#perspectives");
expect(screen.getByTestId("page-perspectives")).toHaveAttribute("data-position", "active");
expect(screen.getByTestId("page-home")).toHaveAttribute("data-position", "before");
expect(screen.getByTestId("page-home")).toHaveAttribute("aria-hidden", "true");
```

补充 `history.back()` 等价的 `popstate`/`hashchange` 测试、非法 Hash 回到首页测试，以及重复点击当前入口不调用滚动复位的测试。每个测试先用 `window.history.replaceState(null, "", "/")` 隔离 Hash。

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx vitest run src/features/showcase/components/showcase-navigator.test.tsx
```

Expected: FAIL，因为 `navigation.ts` 和 `ShowcaseNavigator` 尚不存在。

- [x] **Step 3: 实现最小页面模型**

`navigation.ts` 使用只读常量建立唯一来源：

```ts
export const showcasePages = [
  { id: "home", label: "首页", index: "00" },
  { id: "perspectives", label: "四个视角", index: "01" },
  { id: "architecture", label: "五层引擎", index: "02" },
  { id: "team", label: "团队", index: "03" },
] as const;

export type ShowcasePageId = (typeof showcasePages)[number]["id"];
export type ShowcasePageContent = Record<ShowcasePageId, React.ReactNode>;
```

增加 `parseShowcaseHash(hash: string): ShowcasePageId`，不支持的值返回 `home`。

- [x] **Step 4: 实现最小导航器和 Header 接口**

`ShowcaseNavigator` 必须：

- 首次服务端与客户端首帧都以 `home` 渲染，再在 `useEffect` 中无动画恢复合法 Hash；
- 点击不同入口时 `history.pushState` 写入 Hash、设置活动页并把目标滚动容器归零；
- 监听 `popstate` 和 `hashchange`；
- 给页面设置 `data-position="before|active|after"`、`aria-hidden` 和 `inert`；
- 活动页标题使用 `[data-showcase-title]`，切换后通过 `focus({ preventScroll: true })` 接收焦点；
- 重复点击活动入口直接返回，不改 History、不重置滚动；
- Header 入口保留 `<a href>`，当前入口带 `aria-current="page"`。

`SiteHeader` 新接口：

```ts
type SiteHeaderProps = {
  user: AuthUser | null;
  activePage: ShowcasePageId;
  onNavigate: (page: ShowcasePageId) => void;
};
```

- [x] **Step 5: 运行目标测试并确认 GREEN**

Run:

```bash
npx vitest run src/features/showcase/components/showcase-navigator.test.tsx
```

Expected: 新测试全部 PASS，无 React `act`、Hydration 或未知 DOM 属性警告。

- [x] **Step 6: 提交导航状态**

```bash
git add src/features/showcase/navigation.ts src/features/showcase/components/showcase-navigator.tsx src/features/showcase/components/showcase-navigator.test.tsx src/features/showcase/components/site-header.tsx
git commit -m "feat: add fullscreen showcase navigation"
```

---

### Task 2: 四页内容组合与一级标题统一

**Files:**
- Create: `src/features/showcase/components/showcase-page-heading.tsx`
- Modify: `src/features/showcase/components/section-frame.tsx`
- Modify: `src/features/showcase/components/site-footer.tsx`
- Modify: `app/landing-content.tsx`
- Modify: `app/landing-content.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `ShowcaseNavigator`、`ShowcasePageId` 和页面内容 Record。
- Produces: `ShowcasePageHeading({ index, label, title, intro, tone })` 与四个完整一级页面。

- [x] **Step 1: 先更新首页展示测试并确认新的内容归属**

把旧的单页锚点断言改成：

```tsx
expect(screen.getByText("00 · 首页")).toBeInTheDocument();
expect(screen.getByText("01 · 四个视角")).toBeInTheDocument();
expect(screen.getByText("02 · 五层引擎")).toBeInTheDocument();
expect(screen.getByText("03 · 团队")).toBeInTheDocument();
expect(screen.queryByText("FIVE-LAYER ENGINE")).not.toBeInTheDocument();
expect(screen.queryByText("TEAM CREDITS")).not.toBeInTheDocument();
expect(screen.queryByText("03 / OUTCOME")).not.toBeInTheDocument();
expect(container.querySelector("#architecture")).toContainElement(
  screen.getByText("更短服务周期"),
);
expect(container.querySelector("#team")).toContainElement(
  screen.getByText(/当前为万护 OneCare 方案原型/),
);
```

保留四视角键盘切换、飞书登录、已登录工作台、认证错误和无装饰箭头断言。

- [x] **Step 2: 运行首页测试并确认 RED**

Run:

```bash
npx vitest run app/landing-content.test.tsx
```

Expected: FAIL，因为当前仍显示英文 eyebrow、独立结果编号且未使用四页 Navigator。

- [x] **Step 3: 创建共享一级标题组件**

实现：

```tsx
type ShowcasePageHeadingProps = {
  index: string;
  label: string;
  title: string;
  intro: string;
  tone?: "light" | "dark";
};
```

输出 `.showcase-page-heading`、`.showcase-page-kicker`、带 `data-showcase-title` 与 `tabIndex={-1}` 的 `h2`，以及 `.showcase-page-intro`。`SectionFrame` 改为接收 `label` 并复用该组件。

- [x] **Step 4: 把 LandingContent 组合为四页**

页面 Record 必须按以下归属传给 `ShowcaseNavigator`：

- `home`：Hero，kicker 为 `00 · 首页`，保留两个 CTA；“查看四个视角”改为由导航器接管的页切换入口；
- `perspectives`：`ShowcasePageHeading` + `PerspectiveTabs`；
- `architecture`：五层 `SectionFrame` + 内部“方案目标”与 `OutcomeStatement`；
- `team`：团队 `SectionFrame` + `SiteFooter`。

结果区的小标题只显示“方案目标”。页尾导航使用四页 Hash，“返回顶部”改为语义准确的“返回首页”并指向 `#home`。

- [x] **Step 5: 运行目标测试并确认 GREEN**

Run:

```bash
npx vitest run app/landing-content.test.tsx src/features/showcase/components/showcase-navigator.test.tsx
```

Expected: 两组测试全部 PASS。

- [x] **Step 6: 提交内容组合**

```bash
git add app/landing-content.tsx app/landing-content.test.tsx src/features/showcase/components/showcase-page-heading.tsx src/features/showcase/components/section-frame.tsx src/features/showcase/components/site-footer.tsx
git commit -m "feat: compose four showcase pages"
```

---

### Task 3: 整屏横向视觉、响应式与减少动效

**Files:**
- Modify: `app/globals.css`
- Modify: `app/landing-content.test.tsx`

**Interfaces:**
- Consumes: `.showcase-viewport`、`.showcase-page`、`data-position`、共享标题类名。
- Produces: 固定视口、页面独立滚动和 `before|active|after` 横向过场。

- [x] **Step 1: 增加可测试的结构契约**

在首页测试中断言四个 `.showcase-page`、一个 `.showcase-viewport`、活动页 `data-position="active"`，并确认四个页面的 `aria-label` 和标题关系完整。

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx vitest run app/landing-content.test.tsx
```

Expected: FAIL，直到整屏结构类名落地。

- [x] **Step 3: 添加最终 CSS 覆盖层**

在 showroom 规则之后增加聚焦覆盖：

```css
.landing-shell {
  height: 100dvh;
  overflow: hidden;
}

.showcase-viewport {
  position: relative;
  height: calc(100dvh - 64px);
  overflow: hidden;
}

.showcase-page {
  position: absolute;
  inset: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--onecare-white);
  transition: transform 580ms cubic-bezier(0.22, 1, 0.36, 1), opacity 360ms ease;
}

.showcase-page[data-position="before"] { transform: translateX(-100%); opacity: 0; }
.showcase-page[data-position="active"] { z-index: 2; transform: translateX(0); opacity: 1; }
.showcase-page[data-position="after"] { transform: translateX(100%); opacity: 0; }
```

同时统一 `.showcase-page-kicker`、`.showcase-page-heading h2` 和 `.showcase-page-intro` 字阶；移动端把视口高度改为 `calc(100dvh - 118px)`；减少动效媒体查询取消页面 transition；活动 Top Bar 短线常驻显示。

- [x] **Step 4: 运行目标测试、Lint 和类型检查**

Run:

```bash
npx vitest run app/landing-content.test.tsx src/features/showcase/components/showcase-navigator.test.tsx
npm run lint
npm run typecheck
```

Expected: 全部退出码为 0。

- [x] **Step 5: 提交视觉实现**

```bash
git add app/globals.css app/landing-content.test.tsx
git commit -m "style: add fullscreen page transitions"
```

---

### Task 4: 文档、完整验证与 Preview

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-18-onecare-fullscreen-navigation-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-onecare-fullscreen-navigation.md`

**Interfaces:**
- Consumes: 完成的四页体验。
- Produces: 可复核文档、完整本地证据和非 Production Preview。

- [x] **Step 1: 更新文档与计划状态**

README 的“当前实现”改为四个整屏章节、固定 Top Bar、横向切换、各页独立滚动；保留静态原型和未接真实数据说明。Spec 只补充实现中确认的约束，不改变批准范围。逐项勾选本计划完成步骤。

- [x] **Step 2: 运行完整自动化验证**

Run:

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
```

Expected: 所有命令退出码为 0，测试无失败，Audit 为 0 vulnerabilities。

- [x] **Step 3: 运行真实浏览器验收**

在本地生产构建或 Preview 上检查 `1440 × 900` 和 `390 × 844`：

- 四个 Top Bar 入口全部可见、字号一致、活动短线准确；
- 首页到团队为向左切换，团队回首页为向右切换；
- 跳过中间页面时不显示中间内容；
- 每页独立滚动，切换目标重置到顶部，重复点击当前页保留位置；
- 浏览器前进后退与刷新深链正确；
- 非活动页无法 Tab 进入；
- `prefers-reduced-motion` 下无水平位移动画；
- 页面没有横向溢出、控制台错误或 hydration 警告。

- [x] **Step 4: 提交文档**

```bash
git add README.md docs/superpowers/specs/2026-07-18-onecare-fullscreen-navigation-design.md docs/superpowers/plans/2026-07-18-onecare-fullscreen-navigation.md
git commit -m "docs: document fullscreen showcase pages"
```

- [ ] **Step 5: 发布并验证非 Production Preview**

从当前分支运行 `vercel deploy --yes`，等待状态 `Ready`，把稳定 Preview alias 指向该部署；若 Deployment Protection 开启，生成限时分享链接。验证 HTTP 200，并在页面中确认四个中文 kicker。不得使用 `--prod`，不得修改环境变量或飞书回调。

- [ ] **Step 6: 最终状态检查**

Run:

```bash
git status --short --branch
git log -5 --oneline
```

Expected: 工作树干净，分支为 `codex/onecare-fullscreen-navigation`，提交只包含本规格范围内的实现与文档。
