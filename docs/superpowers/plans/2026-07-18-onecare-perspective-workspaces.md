# 万护 OneCare 四视角全屏模拟工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除首页温度脉冲，并把四视角页升级为用户手机 Demo、客服全屏坐席、工程师全屏任务台和后台全屏 VOC 驾驶舱。

**Architecture:** `PerspectiveTabs` 管理第二级角色导航，渲染四个长期挂载、非活动态 `inert` 的全屏工作台。统一案例数据集中在只读 TypeScript 模块；四个角色组件分别管理最小确定性演示状态，并复用状态栏、指标和时间线组件。

**Tech Stack:** TypeScript、Next.js 16、React 19、CSS、Vitest、React Testing Library、Playwright、Vercel Preview。

## Global Constraints

- 一级页面继续使用 `#home`、`#perspectives`、`#architecture`、`#team`，不得新增路由。
- 四个角色共享案例 `OC-240718-037`；数据不得随机、读取当前时间或发起网络请求。
- 用户交互界面桌面端约 `390 × 720px`；真实移动端取消装饰性手机外框。
- 客服、工程师和后台工作台填满四视角页面剩余可用空间。
- 所有文字按钮为药丸形、文字居中、不带箭头；图标按钮只能为圆形；卡片全部圆角。
- 页面明确标注 Demo 和静态模拟，不宣称真实业务集成。
- 行为修改严格按 RED → GREEN → REFACTOR。
- 不修改飞书认证、Dashboard、五层引擎、团队、Production 配置或环境变量。
- 完成本地验证后只发布非 Production Vercel Preview；不推送、不创建 PR、不合并。

---

## File Structure

- `src/features/showcase/perspective-demo-data.ts`：统一案例、对话、路由、任务和 VOC 只读数据。
- `src/features/showcase/components/perspective-workspace-ui.tsx`：共享状态栏、指标和时间线。
- `src/features/showcase/components/customer-workspace.tsx`：手机尺寸用户 AI 对话与服务进度。
- `src/features/showcase/components/agent-workspace.tsx`：客服上下文、AI 摘要、工单与路由。
- `src/features/showcase/components/engineer-workspace.tsx`：诊断、携件核验和服务完成。
- `src/features/showcase/components/operations-workspace.tsx`：VOC 主题、指标和改善任务。
- `src/features/showcase/components/perspective-workspaces.test.tsx`：四个角色交互测试。
- `src/features/showcase/components/perspective-tabs.tsx`：二级全屏切换与角色组合。
- `src/features/showcase/components/perspective-tabs.test.tsx`：方向、可访问性和状态保持测试。
- `src/features/showcase/components/hero-media.tsx`：删除温度脉冲。
- `app/landing-content.test.tsx`：首页清理和工作台集成断言。
- `app/fullscreen-showcase-styles.test.ts`：二级视口、手机尺寸和响应式 CSS 合约。
- `app/globals.css`：四视角全屏布局和视觉。
- `README.md`、本 spec 和本 plan：边界、验证与 Preview 记录。

---

### Task 1: 删除首页温度脉冲并建立统一案例数据

**Files:**
- Modify: `app/landing-content.test.tsx`
- Modify: `src/features/showcase/components/hero-media.tsx`
- Create: `src/features/showcase/perspective-demo-data.ts`
- Create: `src/features/showcase/perspective-demo-data.test.ts`

**Interfaces:**
- Produces: `serviceCase`, `customerDemo`, `agentDemo`, `engineerDemo`, `vocTopics`, `VocTopicId`。
- Consumes: no runtime dependencies。

- [x] **Step 1: 写失败测试**

```tsx
expect(screen.queryByText("−18°")).not.toBeInTheDocument();
expect(screen.queryByText("04°")).not.toBeInTheDocument();
expect(container.querySelector(".showroom-hero__pulse")).toBeNull();
```

```ts
expect(serviceCase.id).toBe("OC-240718-037");
expect(serviceCase.currentTemperature).toBe(9);
expect(serviceCase.targetTemperature).toBe(4);
expect(customerDemo.caseId).toBe(serviceCase.id);
expect(agentDemo.caseId).toBe(serviceCase.id);
expect(engineerDemo.caseId).toBe(serviceCase.id);
expect(vocTopics[0].relatedCaseId).toBe(serviceCase.id);
```

- [x] **Step 2: 确认 RED**

Run: `npx vitest run app/landing-content.test.tsx src/features/showcase/perspective-demo-data.test.ts`

Expected: pulse 仍存在且数据模块不存在。

- [x] **Step 3: 写最小实现**

`HeroMedia` 只保留 `Image` 与 shade。数据模块至少导出：

```ts
export const serviceCase = {
  id: "OC-240718-037",
  customer: "李女士",
  product: "BCD-510W 智能冰箱",
  currentTemperature: 9,
  targetTemperature: 4,
  anomalyMinutes: 26,
  visitWindow: "14:30–15:30",
} as const;

export const customerDemo = {
  caseId: serviceCase.id,
  prompt: "饮料不够凉",
  greeting: "检测到冷藏室温度持续偏高，需要我帮你一起确认吗？",
  diagnosis: "结合温度曲线，可能与冷藏温度传感器或风道密封有关。",
} as const;

export const agentDemo = {
  caseId: serviceCase.id,
  confidence: 87,
  route: "制冷服务",
  engineer: "周启明",
  suggestedPart: "冷藏温度传感器",
} as const;

export const engineerDemo = {
  caseId: serviceCase.id,
  confidence: 87,
  parts: ["冷藏温度传感器 ×1", "风道密封条 ×1"],
  contactPreference: "到达前 20 分钟联系",
} as const;

export const vocTopics = [
  { id: "temperature", label: "冷藏室温度偏高", voices: 128, change: "+18%", models: 3, relatedCaseId: serviceCase.id },
  { id: "installation", label: "安装等待时间", voices: 76, change: "+7%", models: 5, relatedCaseId: serviceCase.id },
  { id: "repetition", label: "客服重复询问", voices: 54, change: "−11%", models: 2, relatedCaseId: serviceCase.id },
] as const;

export type VocTopicId = (typeof vocTopics)[number]["id"];
```

- [x] **Step 4: 确认 GREEN 并提交**

Run: `npx vitest run app/landing-content.test.tsx src/features/showcase/perspective-demo-data.test.ts`

```bash
git add app/landing-content.test.tsx src/features/showcase/components/hero-media.tsx src/features/showcase/perspective-demo-data.ts src/features/showcase/perspective-demo-data.test.ts
git commit -m "feat: establish OneCare service demo case"
```

---

### Task 2: 建立二级全屏切换器和共享工作台组件

**Files:**
- Create: `src/features/showcase/components/perspective-tabs.test.tsx`
- Modify: `src/features/showcase/components/perspective-tabs.tsx`
- Create: `src/features/showcase/components/perspective-workspace-ui.tsx`

**Interfaces:**
- Produces: `PerspectiveTabs`, `DemoStatusBar`, `DemoMetric`, `DemoTimeline`。
- Consumes: existing `Perspective[]` and role components。

- [x] **Step 1: 写失败测试**

```tsx
const { container } = render(<PerspectiveTabs perspectives={perspectives} />);
expect(screen.getByTestId("workspace-customer")).toHaveAttribute("data-position", "active");
expect(screen.getByTestId("workspace-agent")).toHaveAttribute("data-position", "after");
fireEvent.click(screen.getByRole("tab", { name: "工程师" }));
expect(screen.getByTestId("workspace-customer")).toHaveAttribute("data-position", "before");
expect(screen.getByTestId("workspace-engineer")).toHaveAttribute("data-position", "active");
expect(screen.getByTestId("workspace-agent")).toHaveAttribute("aria-hidden", "true");
expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(4);
```

保留 `ArrowRight`、`ArrowLeft`、`Home`、`End` 与焦点断言。

- [x] **Step 2: 确认 RED**

Run: `npx vitest run src/features/showcase/components/perspective-tabs.test.tsx`

Expected: 现有组件只有一个 panel。

- [x] **Step 3: 写最小实现**

每个 panel 使用：

```tsx
<section
  aria-hidden={active ? undefined : true}
  aria-labelledby={`perspective-tab-${index}`}
  className="perspective-workspace"
  data-position={position}
  data-testid={`workspace-${workspace.id}`}
  id={`perspective-panel-${index}`}
  inert={active ? undefined : true}
  role="tabpanel"
>
  {workspace.content}
</section>
```

共享组件接口固定为：

```ts
type DemoStatusBarProps = Readonly<{ product: string; caseId: string; status: string }>;
type DemoMetricProps = Readonly<{ label: string; value: string; detail?: string }>;
type DemoTimelineProps = Readonly<{
  label: string;
  steps: readonly { label: string; state: "complete" | "active" | "pending" }[];
}>;
```

- [x] **Step 4: 确认 GREEN 并提交**

Run: `npx vitest run src/features/showcase/components/perspective-tabs.test.tsx app/landing-content.test.tsx`

```bash
git add src/features/showcase/components/perspective-tabs.tsx src/features/showcase/components/perspective-tabs.test.tsx src/features/showcase/components/perspective-workspace-ui.tsx
git commit -m "feat: add fullscreen perspective workspace switcher"
```

---

### Task 3: 实现用户手机 AI 对话 Demo

**Files:**
- Create: `src/features/showcase/components/customer-workspace.tsx`
- Create: `src/features/showcase/components/perspective-workspaces.test.tsx`
- Modify: `src/features/showcase/components/perspective-tabs.tsx`

**Interfaces:**
- Produces: `CustomerWorkspace()`。
- Consumes: unified data and shared UI components。

- [x] **Step 1: 写失败测试**

```tsx
render(<CustomerWorkspace />);
expect(screen.getByText("爱家服务助手")).toBeInTheDocument();
expect(screen.getByText("静态交互 Demo")).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "饮料不够凉" }));
expect(screen.getByText("结合温度曲线，可能与冷藏温度传感器或风道密封有关。")).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "继续安排服务" }));
expect(screen.getByRole("status")).toHaveTextContent("等待客服确认");
fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
expect(screen.queryByText("等待客服确认")).not.toBeInTheDocument();
```

- [x] **Step 2: 确认 RED**

Run: `npx vitest run src/features/showcase/components/perspective-workspaces.test.tsx`

Expected: `CustomerWorkspace` 不存在。

- [x] **Step 3: 写最小实现**

```ts
type CustomerStage = "invitation" | "diagnosed" | "scheduled";
```

点击预设问题进入 `diagnosed`，继续安排进入 `scheduled`，重新演示回到 `invitation`。根节点为 `customer-scene`，手机容器为 `customer-phone`；所有交互内容只能出现在手机容器内。

- [x] **Step 4: 确认 GREEN 并提交**

Run: `npx vitest run src/features/showcase/components/perspective-workspaces.test.tsx src/features/showcase/components/perspective-tabs.test.tsx`

```bash
git add src/features/showcase/components/customer-workspace.tsx src/features/showcase/components/perspective-workspaces.test.tsx src/features/showcase/components/perspective-tabs.tsx
git commit -m "feat: add customer phone service demo"
```

---

### Task 4: 实现客服与工程师工作台

**Files:**
- Create: `src/features/showcase/components/agent-workspace.tsx`
- Create: `src/features/showcase/components/engineer-workspace.tsx`
- Modify: `src/features/showcase/components/perspective-workspaces.test.tsx`
- Modify: `src/features/showcase/components/perspective-tabs.tsx`

**Interfaces:**
- Produces: `AgentWorkspace()`, `EngineerWorkspace()`。
- Consumes: unified data and shared UI components。

- [x] **Step 1: 写客服失败测试**

```tsx
render(<AgentWorkspace />);
expect(screen.getByText("预诊置信度 87%")).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "生成服务工单" }));
expect(screen.getByRole("button", { name: "工单已生成" })).toBeDisabled();
expect(screen.getByRole("status")).toHaveTextContent("已分配给周启明");
fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
expect(screen.getByRole("button", { name: "生成服务工单" })).toBeEnabled();
```

- [x] **Step 2: 确认客服 RED，写最小状态并确认 GREEN**

Run: `npx vitest run src/features/showcase/components/perspective-workspaces.test.tsx -t "客服"`

使用 `const [created, setCreated] = useState(false)`；生成后显示 `OC-WO-037`、周启明和“等待工程师接单”。重复运行上方命令，Expected: PASS。

- [x] **Step 3: 写工程师失败测试**

```tsx
render(<EngineerWorkspace />);
const complete = screen.getByRole("button", { name: "完成本次服务" });
expect(complete).toBeDisabled();
fireEvent.click(screen.getByRole("button", { name: "确认携件" }));
expect(complete).toBeEnabled();
expect(screen.getByRole("status")).toHaveTextContent("准备出发");
fireEvent.click(complete);
expect(screen.getByRole("status")).toHaveTextContent("首次上门完成");
```

- [x] **Step 4: 确认工程师 RED，写最小状态并确认 GREEN**

Run: `npx vitest run src/features/showcase/components/perspective-workspaces.test.tsx -t "工程师"`

使用 `type EngineerStage = "review" | "ready" | "complete"`；确认携件进入 `ready`，完成服务进入 `complete`，重置回 `review`。重复运行完整工作台测试，Expected: PASS。

- [x] **Step 5: 提交 Task 4**

```bash
git add src/features/showcase/components/agent-workspace.tsx src/features/showcase/components/engineer-workspace.tsx src/features/showcase/components/perspective-workspaces.test.tsx src/features/showcase/components/perspective-tabs.tsx
git commit -m "feat: add service agent and engineer demos"
```

---

### Task 5: 实现后台 VOC 闭环驾驶舱

**Files:**
- Create: `src/features/showcase/components/operations-workspace.tsx`
- Modify: `src/features/showcase/components/perspective-workspaces.test.tsx`
- Modify: `src/features/showcase/components/perspective-tabs.tsx`

**Interfaces:**
- Produces: `OperationsWorkspace()`。
- Consumes: `vocTopics`, `VocTopicId`, shared UI components。

- [x] **Step 1: 写失败测试**

```tsx
render(<OperationsWorkspace />);
expect(screen.getByText("128 条相关声音")).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "安装等待时间" }));
expect(screen.getByText("76 条相关声音")).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "创建改善任务" }));
expect(screen.getByRole("status")).toHaveTextContent("已进入闭环");
expect(screen.getByText("产品质量 × 服务运营")).toBeInTheDocument();
```

- [x] **Step 2: 确认 RED**

Run: `npx vitest run src/features/showcase/components/perspective-workspaces.test.tsx -t "后台"`

Expected: `OperationsWorkspace` 不存在。

- [x] **Step 3: 写最小实现**

```ts
const [selectedTopic, setSelectedTopic] = useState<VocTopicId>("temperature");
const [taskTopic, setTaskTopic] = useState<VocTopicId | null>(null);
```

主题按钮使用 `aria-pressed`；切换主题更新详情；创建任务记录当前主题；重新演示恢复 `temperature` 和 `null`。

- [x] **Step 4: 确认 GREEN 并提交**

Run: `npx vitest run src/features/showcase/components/perspective-workspaces.test.tsx src/features/showcase/components/perspective-tabs.test.tsx`

```bash
git add src/features/showcase/components/operations-workspace.tsx src/features/showcase/components/perspective-workspaces.test.tsx src/features/showcase/components/perspective-tabs.tsx
git commit -m "feat: add VOC operations workspace demo"
```

---

### Task 6: 重建全屏视觉与响应式行为

**Files:**
- Modify: `app/fullscreen-showcase-styles.test.ts`
- Modify: `app/globals.css`
- Modify: `app/landing-content.tsx`

**Interfaces:**
- Produces: `.perspectives-section`, `.perspective-workspace-viewport`, `.perspective-workspace`, `.customer-phone` and role grids。
- Consumes: Tasks 2–5 semantic class names。

- [x] **Step 1: 写 CSS 合约失败测试**

```ts
expect(styles).not.toContain(".showroom-hero__pulse {");
expect(styles).toMatch(/\.perspectives-section\s*\{[^}]*height:\s*100%/s);
expect(styles).toMatch(/\.perspective-workspace-viewport\s*\{[^}]*overflow:\s*hidden/s);
expect(styles).toMatch(/\.perspective-workspace\[data-position="before"\][^{]*\{[^}]*translateX\(-100%\)/s);
expect(styles).toMatch(/\.customer-phone\s*\{[^}]*width:\s*min\(390px,\s*100%\)/s);
```

- [x] **Step 2: 确认 RED**

Run: `npx vitest run app/fullscreen-showcase-styles.test.ts`

Expected: 旧 CSS 仍包含 pulse 和 `.perspective-panel`。

- [x] **Step 3: 写最小布局**

```css
.perspectives-section {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
  padding: 24px clamp(20px, 3vw, 48px) 0;
  overflow: hidden;
}
.perspective-workspace-viewport { position: relative; min-height: 0; overflow: hidden; }
.perspective-workspace {
  position: absolute;
  inset: 0;
  overflow: auto;
  transition: transform 480ms cubic-bezier(.22, 1, .36, 1), opacity 320ms ease;
}
.perspective-workspace[data-position="before"] { transform: translateX(-100%); }
.perspective-workspace[data-position="active"] { transform: translateX(0); }
.perspective-workspace[data-position="after"] { transform: translateX(100%); }
.customer-phone { width: min(390px, 100%); height: min(720px, 100%); border-radius: 38px; }
```

删除 `.perspective-panel*` 与 `.showroom-hero__pulse*`。桌面客服三栏、工程师主区加侧栏、后台指标带加双栏；`max-width: 900px` 改为单列；`max-width: 640px` 移除用户手机外壳。

- [x] **Step 4: 确认 GREEN 并提交**

Run: `npx vitest run app/fullscreen-showcase-styles.test.ts app/landing-content.test.tsx src/features/showcase/components/perspective-tabs.test.tsx src/features/showcase/components/perspective-workspaces.test.tsx`

```bash
git add app/globals.css app/fullscreen-showcase-styles.test.ts app/landing-content.tsx
git commit -m "style: build fullscreen role workspaces"
```

---

### Task 7: 文档、完整验证、浏览器验收与 Preview

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-18-onecare-perspective-workspaces-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-onecare-perspective-workspaces.md`

**Interfaces:**
- Produces: verified repository and non-Production Preview URL。
- Consumes: all completed tasks。

- [x] **Step 1: 更新文档**

README 明确用户视角是手机尺寸 AI 对话 Demo，其他三个是全屏模拟工作台；所有回复、设备、工单、配件和 VOC 数据均为静态模拟。同步勾选计划并把浏览器结果写回 spec。

- [x] **Step 2: 运行完整验证**

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
```

Expected: 全部退出码为 0，Audit 为 `0 vulnerabilities`。

- [x] **Step 3: 真实浏览器验收**

在 `1440 × 900`、`1024 × 768`、`390 × 844` 验证首页无温度脉冲；用户手机桌面不超过约 `390 × 720px` 且移动端无双重外框；四个工作台切换、状态保持、重置、独立滚动和全部核心交互正确；减少动效无横移；无横向溢出、控制台错误、hydration 警告或 404。

- [x] **Step 4: 提交文档**

```bash
git add README.md docs/superpowers/specs/2026-07-18-onecare-perspective-workspaces-design.md docs/superpowers/plans/2026-07-18-onecare-perspective-workspaces.md
git commit -m "docs: document perspective workspace demos"
```

- [x] **Step 5: 发布并验证 Preview**

运行 `vercel deploy --yes`，等待 Ready 后把 `onecare-homepage-preview.vercel.app` 指向新部署；若有 Deployment Protection，生成限时 Share Link。不得使用 `--prod`。验证 HTTP 200、四个工作台名称、全部核心交互和 pulse DOM 缺失。

结果：非 Production Deployment `dpl_ARARYHR36C3p66PkniWQbmiaDbTq` 为 `Ready`，稳定 Preview 域名已重新指向该部署；Share Link 在未登录访问下成功打开并验证四个工作台名称，且 `.showroom-hero__pulse` 不存在。Share token 不写入仓库。

- [x] **Step 6: 最终状态检查**

Run: `git status --short --branch && git log -8 --oneline`

Expected: 工作树干净，分支为 `codex/onecare-perspective-workspaces`，只包含本规格范围。

结果：最终文档提交后重新检查分支、工作树和最近提交；功能分支保持本地，不推送、不创建 PR、不合并。
