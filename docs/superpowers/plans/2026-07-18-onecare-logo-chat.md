# OneCare Logo and Customer Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户提供的明暗反色 Logo 接入公共品牌位，并把用户手机 Demo 重做为可明确分辨 AI 与用户双方的确定性服务对话。

**Architecture:** `OneCareLogo` 统一封装两枚用户提供的 PNG 数据源和明暗选择；公共顶栏、页脚、手机标题栏与 AI 头像只消费该组件。`CustomerChatMessage` 负责单条消息语义，`CustomerWorkspace` 继续持有三阶段状态并按阶段组合确定性消息，现有四视角切换与其他三个工作台不变。

**Tech Stack:** TypeScript、Next.js 16、React 19、CSS、Vitest、React Testing Library、Playwright、Vercel Preview。

## Global Constraints

- TypeScript only；不得增加 Python 代码、Python 工具或第三方运行时依赖。
- Logo 使用用户提供的两枚 PNG 原始字节，不调用网络图片，不改变图形造型或比例。
- 深色背景使用白色图形版本，浅色背景使用黑色图形版本。
- 用户手机状态固定为 `"invitation" | "diagnosed" | "scheduled"`，不得发起网络请求、读取当前时间或生成随机回复。
- 不提供自由文本输入框、发送按钮、流式回复、语音、图片或附件。
- 所有文字按钮为药丸形、文字居中、无箭头；图标按钮只能为圆形；消息气泡与卡片保持圆角。
- 桌面手机宽度继续约 `390px`；真实移动端取消装饰性手机外框；页面不得出现横向溢出。
- 保持 MiSans、海信青、黑、白视觉体系和现有一级/二级整屏导航。
- 不修改 Dashboard、飞书认证、五层引擎、其他三个角色业务逻辑、Production 配置或环境变量。
- 行为修改严格按 RED → GREEN → REFACTOR。
- 完成本地验证后只发布非 Production Vercel Preview；不推送、不创建 PR、不合并。

---

## File Structure

- `src/features/showcase/brand-assets.ts`：导出两枚用户 PNG 的本地 data URI，避免外部请求。
- `src/features/showcase/components/onecare-logo.tsx`：统一 Logo 明暗、尺寸、装饰/品牌语义。
- `src/features/showcase/components/onecare-logo.test.tsx`：验证 tone、可访问名称和原始比例契约。
- `src/features/showcase/components/site-header.tsx`：在固定黑色顶栏复用白色 Logo。
- `src/features/showcase/components/site-footer.tsx`：在黑色页脚复用白色 Logo。
- `src/features/showcase/components/customer-chat-message.tsx`：渲染发送方、Logo 头像、气泡和消息元信息。
- `src/features/showcase/components/customer-workspace.tsx`：按三阶段组合双向消息和服务进度。
- `src/features/showcase/perspective-demo-data.ts`：保存确定性的过渡、预诊和预约确认文案。
- `src/features/showcase/components/perspective-workspaces.test.tsx`：覆盖双向会话流程。
- `app/landing-content.test.tsx`：验证公共品牌位仍可访问。
- `app/fullscreen-showcase-styles.test.ts`：验证气泡方向、最大宽度、响应式与减少动效 CSS 合约。
- `app/globals.css`：公共品牌位、手机标题栏、头像、消息气泡、消息过场和响应式视觉。
- `README.md`、本 spec、本 plan：记录静态 Demo 边界、验证和 Preview。

---

### Task 1: 建立反色 Logo 组件并接入公共品牌位

**Files:**
- Create: `src/features/showcase/brand-assets.ts`
- Create: `src/features/showcase/components/onecare-logo.tsx`
- Create: `src/features/showcase/components/onecare-logo.test.tsx`
- Modify: `src/features/showcase/components/site-header.tsx`
- Modify: `src/features/showcase/components/site-footer.tsx`
- Modify: `app/landing-content.test.tsx`

**Interfaces:**
- Produces: `OneCareLogo({ tone, size?, decorative? })`。
- Consumes: `ONECARE_LOGO_LIGHT_SRC` 与 `ONECARE_LOGO_DARK_SRC`，分别对应深色背景白图形、浅色背景黑图形。

- [x] **Step 1: 写 Logo 与公共品牌位失败测试**

```tsx
render(<OneCareLogo tone="light" />);
expect(screen.getByRole("img", { name: "万护 OneCare" })).toHaveAttribute(
  "data-tone",
  "light",
);

render(<OneCareLogo decorative tone="dark" />);
expect(screen.getByTestId("onecare-logo")).toHaveAttribute("aria-hidden", "true");
```

在 `app/landing-content.test.tsx` 的顶栏断言中增加：

```tsx
expect(
  screen.getByLabelText("万护 OneCare 首页").querySelector('[data-tone="light"]'),
).not.toBeNull();
expect(screen.getAllByTestId("onecare-logo").length).toBeGreaterThanOrEqual(2);
```

- [x] **Step 2: 确认 RED**

Run:

```bash
npx vitest run src/features/showcase/components/onecare-logo.test.tsx app/landing-content.test.tsx
```

Expected: FAIL，因为 `OneCareLogo` 和两枚本地资产尚不存在，顶栏仍显示 `1C`。

- [x] **Step 3: 写最小 Logo 实现**

`brand-assets.ts` 将以下两个用户文件逐字节编码为 `data:image/png;base64,...` 常量：

- `/var/folders/8_/jycgwqr93f94nb4687kpw1880000gn/T/codex-clipboard-577fed54-1ce4-45fb-8f1b-bbc82f48b690.png` → `ONECARE_LOGO_LIGHT_SRC`；
- `/var/folders/8_/jycgwqr93f94nb4687kpw1880000gn/T/codex-clipboard-9f68ba25-50ec-4513-af39-4d322943e460.png` → `ONECARE_LOGO_DARK_SRC`。

组件接口固定为：

```tsx
type OneCareLogoProps = Readonly<{
  tone: "light" | "dark";
  size?: number;
  decorative?: boolean;
  className?: string;
}>;

export function OneCareLogo({
  tone,
  size = 40,
  decorative = false,
  className = "",
}: OneCareLogoProps) {
  return (
    <img
      alt={decorative ? "" : "万护 OneCare"}
      aria-hidden={decorative || undefined}
      className={`onecare-logo ${className}`.trim()}
      data-testid="onecare-logo"
      data-tone={tone}
      height={size}
      src={tone === "light" ? ONECARE_LOGO_LIGHT_SRC : ONECARE_LOGO_DARK_SRC}
      width={size}
    />
  );
}
```

公共顶栏将 `wordmark-mark` 的 `1C` 替换为 `<OneCareLogo decorative size={42} tone="light" />`；页脚品牌标题前加入同一白色版本。保留“万护 ONECARE”和现有链接可访问名称。

- [x] **Step 4: 确认 GREEN**

Run:

```bash
npx vitest run src/features/showcase/components/onecare-logo.test.tsx app/landing-content.test.tsx
```

Expected: 两个测试文件全部通过。

- [x] **Step 5: 提交 Task 1**

```bash
git add src/features/showcase/brand-assets.ts src/features/showcase/components/onecare-logo.tsx src/features/showcase/components/onecare-logo.test.tsx src/features/showcase/components/site-header.tsx src/features/showcase/components/site-footer.tsx app/landing-content.test.tsx
git commit -m "feat: add adaptive OneCare logo"
```

---

### Task 2: 将用户手机改造成双向服务对话

**Files:**
- Create: `src/features/showcase/components/customer-chat-message.tsx`
- Modify: `src/features/showcase/components/customer-workspace.tsx`
- Modify: `src/features/showcase/perspective-demo-data.ts`
- Modify: `src/features/showcase/components/perspective-workspaces.test.tsx`

**Interfaces:**
- Produces: `CustomerChatMessage({ sender, children, meta })`。
- Consumes: `OneCareLogo`、`customerDemo`、`serviceCase.visitWindow`。

- [x] **Step 1: 写双向会话失败测试**

将用户测试扩展为：

```tsx
render(<CustomerWorkspace />);

expect(screen.getByText("万护助手")).toBeInTheDocument();
expect(screen.getByText("刚刚")).toBeInTheDocument();
expect(screen.getByLabelText("AI 服务对话")).toHaveAttribute(
  "aria-live",
  "polite",
);

fireEvent.click(screen.getByRole("button", { name: "饮料不够凉" }));

const customerMessage = screen.getByText("饮料不够凉").closest("article");
const assistantDiagnosis = screen
  .getByText("结合温度曲线，可能与冷藏温度传感器或风道密封有关。")
  .closest("article");
expect(customerMessage).toHaveAttribute("data-sender", "customer");
expect(assistantDiagnosis).toHaveAttribute("data-sender", "assistant");
expect(screen.getByText("已送达")).toBeInTheDocument();

fireEvent.click(screen.getByRole("button", { name: "继续安排服务" }));
expect(
  screen.getByText(/已为你提交 14:30–15:30 上门服务/),
).toBeInTheDocument();
```

- [x] **Step 2: 确认 RED**

Run:

```bash
npx vitest run src/features/showcase/components/perspective-workspaces.test.tsx -t "customer"
```

Expected: FAIL，因为现有消息没有发送方容器、AI 身份、时间/状态和预约确认消息。

- [x] **Step 3: 增加确定性文案和消息组件**

在 `customerDemo` 增加：

```ts
reading: "正在读取设备运行数据…",
confirmation: `已为你提交 ${serviceCase.visitWindow} 上门服务，客服确认后我会第一时间通知你。`,
```

`CustomerChatMessage` 接口固定为：

```tsx
type CustomerChatMessageProps = Readonly<{
  sender: "assistant" | "customer";
  meta: string;
  children: ReactNode;
}>;
```

根元素为 `<article className="customer-message" data-sender={sender}>`；AI 消息渲染 `OneCareLogo decorative size={24} tone="light"` 和“万护助手”，用户消息显示“我”。气泡使用 `.customer-message__bubble`，元信息使用 `.customer-message__meta`。

- [x] **Step 4: 重组三阶段消息流**

`CustomerWorkspace` 保留现有状态类型，消息顺序固定为：

```tsx
<CustomerChatMessage meta="刚刚" sender="assistant">
  {customerDemo.greeting}
</CustomerChatMessage>

{stage !== "invitation" ? (
  <>
    <CustomerChatMessage meta="已送达" sender="customer">
      {customerDemo.prompt}
    </CustomerChatMessage>
    <CustomerChatMessage meta="设备数据已同步" sender="assistant">
      <span>{customerDemo.reading}</span>
      <strong>{customerDemo.diagnosis}</strong>
    </CustomerChatMessage>
  </>
) : null}

{stage === "scheduled" ? (
  <CustomerChatMessage meta="等待客服确认" sender="assistant">
    {customerDemo.confirmation}
  </CustomerChatMessage>
) : null}
```

消息区增加 `aria-live="polite"`。快捷回复仅在 `invitation` 显示；“继续安排服务”作为诊断消息后的独立药丸按钮；服务进度保持在对话区之后。

- [x] **Step 5: 确认 GREEN 并提交**

Run:

```bash
npx vitest run src/features/showcase/components/perspective-workspaces.test.tsx src/features/showcase/perspective-demo-data.test.ts
```

Expected: 用户三阶段流程与数据测试全部通过。

```bash
git add src/features/showcase/components/customer-chat-message.tsx src/features/showcase/components/customer-workspace.tsx src/features/showcase/perspective-demo-data.ts src/features/showcase/components/perspective-workspaces.test.tsx
git commit -m "feat: build customer service conversation"
```

---

### Task 3: 完成品牌位与聊天视觉、响应式和减少动效

**Files:**
- Modify: `app/fullscreen-showcase-styles.test.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `.onecare-logo`、`.wordmark-brand`、`.customer-message*` 与其响应式视觉。
- Consumes: Tasks 1–2 的语义类名和 `data-sender`。

- [x] **Step 1: 写 CSS 合约失败测试**

```ts
expect(styles).toMatch(/\.onecare-logo\s*\{[^}]*object-fit:\s*contain/s);
expect(styles).toMatch(/\.customer-message\[data-sender="assistant"\][^{]*\{[^}]*align-self:\s*flex-start/s);
expect(styles).toMatch(/\.customer-message\[data-sender="customer"\][^{]*\{[^}]*align-self:\s*flex-end/s);
expect(styles).toMatch(/\.customer-message__bubble\s*\{[^}]*max-width:\s*78%/s);
expect(styles).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.customer-message[^{]*\{[^}]*animation:\s*none/s);
```

- [x] **Step 2: 确认 RED**

Run:

```bash
npx vitest run app/fullscreen-showcase-styles.test.ts
```

Expected: FAIL，因为新 Logo 和消息类尚无视觉契约。

- [x] **Step 3: 写最小视觉实现**

关键规则：

```css
.onecare-logo { display: block; flex: 0 0 auto; object-fit: contain; }
.customer-chat { display: flex; flex-direction: column; gap: 14px; }
.customer-message { display: grid; width: 100%; animation: customer-message-in 280ms ease both; }
.customer-message[data-sender="assistant"] { align-self: flex-start; justify-items: start; }
.customer-message[data-sender="customer"] { align-self: flex-end; justify-items: end; }
.customer-message__bubble { max-width: 78%; padding: 11px 13px; border-radius: 18px; }
.customer-message[data-sender="assistant"] .customer-message__bubble { background: #fff; border-bottom-left-radius: 6px; }
.customer-message[data-sender="customer"] .customer-message__bubble { color: #071311; background: var(--onecare-teal); border-bottom-right-radius: 6px; }
```

AI 身份行使用 24px 黑底白色 Logo 头像；用户身份与元信息右对齐。手机标题栏加入黑色 Logo，公共顶栏和页脚品牌位保持白色 Logo。快捷回复窄屏换行且最小触控高度不低于 `38px`。

在现有 reduced-motion 媒体查询中增加：

```css
.customer-message { animation: none; }
```

- [x] **Step 4: 确认 GREEN 并提交**

Run:

```bash
npx vitest run app/fullscreen-showcase-styles.test.ts app/landing-content.test.tsx src/features/showcase/components/onecare-logo.test.tsx src/features/showcase/components/perspective-workspaces.test.tsx
```

Expected: CSS、品牌位和聊天交互测试全部通过。

```bash
git add app/fullscreen-showcase-styles.test.ts app/globals.css
git commit -m "style: refine OneCare customer conversation"
```

---

### Task 4: 文档、完整验证、浏览器验收与 Preview

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-18-onecare-logo-chat-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-onecare-logo-chat.md`

**Interfaces:**
- Produces: verified repository and new non-Production Preview URL。
- Consumes: Tasks 1–3。

- [x] **Step 1: 更新文档**

README 明确公共品牌位使用用户提供的反色 Logo，用户手机 Demo 为左右双方消息气泡；所有回复和预约仍为静态确定性模拟。Spec 记录浏览器验收，Plan 勾选已完成步骤。

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

Expected: 所有命令退出码为 0，Audit 为 `0 vulnerabilities`。

2026-07-18 验证结果：`npm test` 通过 15 个测试文件、56 个测试；`npm run test:runtime` 通过 3 个生产运行时测试；`npm run lint`、`npm run typecheck`、`npm run build` 与 `git diff --check` 均退出码为 0；`npm audit --omit=dev` 返回 `0 vulnerabilities`。首次 `typecheck` 暴露 CSS 合约测试的 `/s` 正则标志与仓库 ES2017 编译目标不兼容，已改为等价的 `[\s\S]` 写法，并重新验证通过。

- [x] **Step 3: 真实浏览器验收**

在 `1440 × 900` 与 `390 × 844` 验证：顶栏、页脚、手机标题栏与 AI 头像使用正确 Logo 反色；AI 左气泡、用户右气泡、身份、时间/状态和预约确认一眼可辨；手机内容可滚动且无页面级横向溢出；减少动效下消息动画为 `none`；控制台无错误、hydration 警告或资源 404。

- [x] **Step 4: 提交文档**

```bash
git add README.md docs/superpowers/specs/2026-07-18-onecare-logo-chat-design.md docs/superpowers/plans/2026-07-18-onecare-logo-chat.md
git commit -m "docs: document OneCare logo chat preview"
```

- [x] **Step 5: 发布并验证 Preview**

运行 `vercel deploy --yes`，等待 Ready 后把 `onecare-homepage-preview.vercel.app` 指向新部署；不得使用 `--prod`。若有 Deployment Protection，创建限时 Share Link。通过未登录 Share Link 验证页面标题、Logo、双方消息、预约确认和无 `.showroom-hero__pulse`。

2026-07-18 已发布非 Production 部署 `dpl_Qt7BFWTie98Vh3UNqf74NtzNgEbJ`，状态为 Ready；固定域名已重新指向该部署。匿名 Share Link 已重建并验证：页面标题正确，Logo tone 序列包含深浅两种版本，线上可完成“饮料不够凉 → 继续安排服务”，预约确认出现，`.showroom-hero__pulse` 不存在，页面无横向溢出，控制台为 0 错误、0 警告。Share secret 不写入仓库，仅在交付消息中提供。

- [x] **Step 6: 最终状态检查**

Run:

```bash
git status --short --branch
git log -8 --oneline
```

Expected: 工作树干净，分支为 `codex/onecare-perspective-workspaces`，本批次只包含 Logo、用户对话、测试、文档与 Preview 记录。

---

### Task 5: 固定消息元信息与对话操作槽

**Files:**
- Modify: `src/features/showcase/components/customer-chat-message.tsx`
- Modify: `src/features/showcase/components/customer-workspace.tsx`
- Modify: `src/features/showcase/components/perspective-workspaces.test.tsx`

**Interfaces:**
- Produces: `.customer-message__body`，统一包裹消息气泡与元信息。
- Produces: 始终存在的 `aria-label="对话快捷操作"` 操作槽。
- Consumes: 现有 `CustomerStage` 与 `customerPrompts`，不增加新状态或网络行为。

- [ ] **Step 1: 写消息正文与固定操作槽失败测试**

在用户视角测试中增加：

```tsx
const meta = screen.getByText("刚刚");
expect(meta.parentElement).toHaveClass("customer-message__body");
expect(
  meta.parentElement?.querySelector(".customer-message__bubble"),
).not.toBeNull();

const controls = screen.getByLabelText("对话快捷操作");
expect(within(controls).getAllByRole("button")).toHaveLength(3);

fireEvent.click(screen.getByRole("button", { name: "饮料不够凉" }));
expect(screen.getByLabelText("对话快捷操作")).toBe(controls);
expect(
  within(controls).getByRole("button", { name: "继续安排服务" }),
).toBeInTheDocument();

fireEvent.click(screen.getByRole("button", { name: "继续安排服务" }));
expect(screen.getByLabelText("对话快捷操作")).toBe(controls);
expect(within(controls).getByText("服务已提交")).toBeInTheDocument();
```

同时从 `@testing-library/react` 导入 `within`。

- [ ] **Step 2: 确认 RED**

Run:

```bash
npx vitest run src/features/showcase/components/perspective-workspaces.test.tsx -t "customer"
```

Expected: FAIL，因为元信息仍是气泡的兄弟节点，且快捷回复没有持久操作槽。

- [ ] **Step 3: 写最小结构实现**

`CustomerChatMessage` 将气泡与元信息包装为：

```tsx
<div className="customer-message__body">
  <div className="customer-message__bubble">{children}</div>
  <small className="customer-message__meta">{meta}</small>
</div>
```

`CustomerWorkspace` 在设备摘要之后增加 `.customer-conversation`，内部固定为可滚动 `.customer-chat` 和始终存在的 `.customer-chat-controls`。快捷回复和“继续安排服务”从消息流移入操作槽；预约阶段渲染：

```tsx
<div className="customer-chat__completion">服务已提交</div>
```

`customer-service-progress` 保留原有条件，但移动到 `.customer-chat` 内部，使其只参与内部滚动。

- [ ] **Step 4: 确认 GREEN 并提交**

Run:

```bash
npx vitest run src/features/showcase/components/perspective-workspaces.test.tsx
```

Expected: 4 个角色工作台测试全部通过。

```bash
git add src/features/showcase/components/customer-chat-message.tsx src/features/showcase/components/customer-workspace.tsx src/features/showcase/components/perspective-workspaces.test.tsx
git commit -m "fix: stabilize customer chat controls"
```

---

### Task 6: 锁定手机几何尺寸与底部三列按钮

**Files:**
- Modify: `app/fullscreen-showcase-styles.test.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Task 5 的 `.customer-message__body`、`.customer-conversation` 与 `.customer-chat-controls`。
- Produces: 固定场景/手机几何、内部消息滚动和三列等宽药丸布局。

- [ ] **Step 1: 写稳定几何与操作槽 CSS 失败测试**

增加以下合约：

```ts
expect(css).toMatch(/\.customer-scene\s*\{[\s\S]*?height:\s*100%/);
expect(css).toMatch(/\.customer-scene\s*\{[\s\S]*?min-height:\s*0/);
expect(css).toMatch(/\.customer-phone\s*\{[\s\S]*?max-height:\s*calc\(100% - 16px\)/);
expect(css).toMatch(/\.customer-phone__content\s*\{[\s\S]*?overflow:\s*hidden/);
expect(css).toMatch(/\.customer-chat\s*\{[\s\S]*?overflow-y:\s*auto/);
expect(css).toMatch(/\.customer-message__body\s*\{[\s\S]*?max-width:\s*78%/);
expect(css).toMatch(/\.customer-message__meta\s*\{[\s\S]*?align-self:\s*flex-end/);
expect(css).toMatch(/\.customer-prompts\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
```

- [ ] **Step 2: 确认 RED**

Run:

```bash
npx vitest run app/fullscreen-showcase-styles.test.ts
```

Expected: FAIL，因为场景会被内容撑高，消息区不独立滚动，快捷回复仍使用 flex 与左缩进。

- [ ] **Step 3: 写最小 CSS 实现**

关键规则：

```css
.customer-scene { height: 100%; min-height: 0; max-height: 100%; }
.customer-phone { min-height: 0; max-height: calc(100% - 16px); }
.customer-phone__content { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 14px; overflow: hidden; }
.customer-conversation { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 12px; min-height: 0; }
.customer-chat { min-height: 0; margin-top: 0; overflow-y: auto; }
.customer-message__body { display: flex; width: fit-content; max-width: 78%; flex-direction: column; }
.customer-message__bubble { max-width: none; }
.customer-message__meta { align-self: flex-end; }
.customer-chat-controls { display: grid; min-height: 44px; align-items: center; }
.customer-prompts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 0; }
.customer-prompts button { width: 100%; padding: 0 8px; }
.customer-chat__action { width: 100%; }
```

移动端覆盖 `.customer-phone { max-height: none; }`，继续让手机占满角色工作台；所有变量内容必须留在 `.customer-chat` 内部滚动。

- [ ] **Step 4: 确认 GREEN 并提交**

Run:

```bash
npx vitest run app/fullscreen-showcase-styles.test.ts src/features/showcase/components/perspective-workspaces.test.tsx
```

Expected: CSS 合约和四角色交互测试全部通过。

```bash
git add app/fullscreen-showcase-styles.test.ts app/globals.css
git commit -m "style: lock customer phone geometry"
```

---

### Task 7: 浏览器几何验收、完整验证与 Preview 更新

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-18-onecare-logo-chat-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-onecare-logo-chat.md`

**Interfaces:**
- Consumes: Tasks 5–6 的稳定聊天布局。
- Produces: 通过验证的新非 Production Preview 与同一固定别名。

- [ ] **Step 1: 本地真实浏览器验收**

在 `1440 × 900` 与 `390 × 844` 逐次进入 `invitation`、`diagnosed`、`scheduled`，读取 `.customer-scene` 与 `.customer-phone` 的 `getBoundingClientRect()`。每个元素的 `y`、`height` 三态极差必须 `<= 1px`；初始三个按钮同一行、等宽，消息区 `scrollHeight >= clientHeight` 时仅内部滚动；控制台 0 错误、0 警告。

- [ ] **Step 2: 运行完整验证**

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
```

Expected: 所有命令退出码为 0，Audit 为 `0 vulnerabilities`。

- [ ] **Step 3: 更新文档并提交**

README 记录固定底部操作槽与稳定手机高度；Spec 和 Plan 写入实际几何验收结果与命令结果。

```bash
git add README.md docs/superpowers/specs/2026-07-18-onecare-logo-chat-design.md docs/superpowers/plans/2026-07-18-onecare-logo-chat.md
git commit -m "docs: record stable customer chat verification"
```

- [ ] **Step 4: 更新同一 Preview**

运行 `vercel deploy --yes`，等待 Ready 后将 `onecare-homepage-preview.vercel.app` 重新指向新部署；不得使用 `--prod`。复用或重建限时 Share Link，并用未登录浏览器重复三态几何与控制台检查。Share secret 只出现在交付消息，不写入仓库。

- [ ] **Step 5: 最终状态检查**

```bash
git status --short --branch
git log -10 --oneline
git diff --check
```

Expected: 工作树干净，仍在 `codex/onecare-perspective-workspaces`，本次只增加布局稳定性相关规格、测试、实现、文档和 Preview 记录。
