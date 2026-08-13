# 万护 OneCare 工单详情整页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把运营工作台的工单详情从侧拉抽屉迁移到受登录门禁保护的独立三栏整页，并完整保留列表现场、既有字段、写操作和权限边界。

**Architecture:** 列表和详情继续共享 `readWorkbenchCached()` 与 `WorkbenchTicket`，详情路由在服务端完成会话校验、缓存读取和记录编号精确匹配。URL 构造与列表查询解析保持纯函数；详情展示是复用 `WorkbenchActions` 的 Arco 客户端组件，列表不再持有任何选中工单状态。

**Tech Stack:** TypeScript 5.9、Next.js 16 App Router / Cache Components、React 19、Arco Design 2、Vitest 4、React Testing Library、Vercel Preview。

## Global Constraints

- 严格遵守仓库根目录 `AGENTS.md`；实现前运行 `git status --short --branch` 并重读规格与计划。
- TypeScript only；不得添加 Python 代码、Python 工具或新的运行时依赖。
- 当前工作树中的 `next-env.d.ts` 不属于本任务；不得修改、暂存或提交它。
- 当前 `main` 的 `e2bceec` 是用户指定的功能回滚基线；规格提交 `4af692f` 只增加文档。
- 所有行为变更严格执行 RED → GREEN → REFACTOR。
- 不新增 Bitable 字段或查询接口，不改变状态机、认领、权限、动作 API、aily、Cron、飞书事件或作战室。
- 不向浏览器发送负责人 `open_id` 或真实协同群 ID；现有 `recordId` 只用于受服务端鉴权的动作请求。
- 不接受任意 `returnTo`；返回地址只能由白名单 `WorkbenchQuery` 构造为站内 `/`。
- 未登录时不调用 `readWorkbenchCached()`，也不泄露记录是否存在。
- 不 push、不开 PR、不 merge、不部署 Production；完成后按 `AGENTS.md` 创建非 Production Preview。
- 完成前运行 `npm test`、`npm run test:runtime`、`npm run lint`、`npm run typecheck`、`npm run build` 和 `git diff --check`。

## File Structure

**Create:**

- `src/features/workbench/presentation.ts` / `.test.ts`：列表与详情共享展示规则。
- `app/workbench-ticket-detail.tsx` / `.test.tsx`：三栏详情、章节导航、错误状态和动作岛。
- `app/workbench/tickets/[recordNumber]/page.tsx` / `.test.tsx`：门禁、读取、精确定位和页面编排。

**Modify:**

- `src/features/workbench/href.ts` / `.test.ts`：独立详情 URL 和安全返回 URL。
- `src/features/workbench/query.ts` / `.test.ts`：删除 `ticket` / `selected` 状态。
- `src/features/workbench/data.ts` / `.test.ts`：增加 `hasWarRoom` 布尔值。
- `app/workbench-console.tsx`、`app/workbench-content.tsx` / `.test.tsx`：列表迁移并删除 Drawer。
- `app/globals.css`、`app/fullscreen-showcase-styles.test.ts`：三档响应式布局。
- `README.md`、`docs/TECH_STACK.md`、本规格和计划：最终一致性与验证记录。

---

### Task 1: 建立独立详情 URL 与纯列表查询契约

**Files:**
- Modify: `src/features/workbench/href.ts`
- Modify: `src/features/workbench/href.test.ts`
- Modify: `src/features/workbench/query.ts`
- Modify: `src/features/workbench/query.test.ts`

**Interfaces:**
- Consumes: `WorkbenchQuery`、`parseWorkbenchQuery()`。
- Produces: `listHref(query): string`、`ticketDetailHref(query, recordNumber): string`，以及不含 `ticket` / `selected` 的查询类型。

- [ ] **Step 1: 写 URL 失败测试**

```ts
it("opens a ticket on an independent route and preserves list state", () => {
  const query = workbenchQuery({
    queue: "overdue", severity: "高", search: "冰箱",
    sort: "dwell_desc", page: 2,
  });
  expect(ticketDetailHref(query, "VOC # 001")).toBe(
    "/workbench/tickets/VOC%20%23%20001?queue=overdue&severity=%E9%AB%98&search=%E5%86%B0%E7%AE%B1&sort=dwell_desc&page=2",
  );
});

it("builds only an internal return link", () => {
  expect(listHref(workbenchQuery({ queue: "failed", owner: "张敏", page: 3 })))
    .toBe("/?queue=failed&owner=%E5%BC%A0%E6%95%8F&sort=feedback_desc&page=3");
});

it("never emits the retired ticket parameter", () => {
  expect(ticketDetailHref(workbenchQuery({}), "R-1")).not.toContain("ticket=");
});
```

- [ ] **Step 2: 写查询层失败测试**

```ts
it("ignores the retired ticket parameter", () => {
  const query = parseWorkbenchQuery({ queue: "all", ticket: "R-2", page: "2" });
  expect(query).not.toHaveProperty("ticket");
  expect(query.page).toBe(2);
});

it("returns no selected ticket", () => {
  const result = applyWorkbenchQuery(
    [ticket({ recordNumber: "R-1" })],
    parseWorkbenchQuery({ queue: "all" }), NOW,
  );
  expect(result).not.toHaveProperty("selected");
});
```

- [ ] **Step 3: 确认 RED**

Run: `npx vitest run src/features/workbench/href.test.ts src/features/workbench/query.test.ts`

Expected: FAIL，两个 href 函数未导出，查询仍含旧状态。

- [ ] **Step 4: 写 URL 最小实现**

`baseParams()` 只保留列表字段；删除 `ticketHref()`，新增：

```ts
export function listHref(query: WorkbenchQuery): string {
  return toHref(baseParams(query));
}

export function ticketDetailHref(
  query: WorkbenchQuery,
  recordNumber: string,
): string {
  const list = new URL(listHref(query), "https://onecare.invalid");
  const search = list.searchParams.toString();
  const path = `/workbench/tickets/${encodeURIComponent(recordNumber)}`;
  return search ? `${path}?${search}` : path;
}
```

- [ ] **Step 5: 删除查询详情状态**

从 `WorkbenchQuery`、`parseWorkbenchQuery()` 删除 `ticket`；从 `WorkbenchPage`、`applyWorkbenchQuery()` 删除 `selected`。其余过滤、排序、计数和分页代码不变。

- [ ] **Step 6: 确认 GREEN**

Run: `npx vitest run src/features/workbench/href.test.ts src/features/workbench/query.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/features/workbench/href.ts src/features/workbench/href.test.ts src/features/workbench/query.ts src/features/workbench/query.test.ts
git diff --cached --check
git commit -m "refactor: separate ticket routes from list state"
```

确认 `next-env.d.ts` 未暂存。

---

### Task 2: 提取共享展示规则并补充安全的协同群事实

**Files:**
- Create: `src/features/workbench/presentation.ts`
- Create: `src/features/workbench/presentation.test.ts`
- Modify: `src/features/workbench/data.ts`
- Modify: `src/features/workbench/data.test.ts`
- Modify: `app/workbench-console.tsx`

**Interfaces:**
- Produces: `ABSENT`、`shortRecordNumber()`、`formatShanghaiTime()`、`formatHours()`、`ticketTitle()`、颜色映射、`WorkbenchTicket.hasWarRoom`。

- [ ] **Step 1: 写展示失败测试**

```ts
it("formats shared ticket presentation", () => {
  expect(shortRecordNumber("VOC-123456789")).toBe("456789");
  expect(formatShanghaiTime("2026-08-13T01:30:00.000Z")).toBe("2026-08-13 09:30");
  expect(formatShanghaiTime("bad")).toBeNull();
  expect(formatHours(6.24)).toBe("6.2");
  expect(formatHours(12.6)).toBe("13");
});

it("builds a deterministic 60-character title", () => {
  expect(ticketTitle({ summary: " AI 摘要 ", content: "原文" })).toBe("AI 摘要");
  expect(ticketTitle({ summary: "", content: " 原文 " })).toBe("原文");
  expect(ticketTitle({ summary: " ", content: " " })).toBe("未提供反馈内容");
  expect(ticketTitle({ summary: "冰".repeat(61), content: "" }))
    .toBe(`${"冰".repeat(60)}…`);
});
```

- [ ] **Step 2: 写数据边界失败测试**

```ts
it("exposes only whether a war room exists", () => {
  const ticket = toWorkbenchTicket(record({ warRoomChatId: "oc_secret" }));
  expect(ticket.hasWarRoom).toBe(true);
  expect(ticket).not.toHaveProperty("warRoomChatId");
  expect(JSON.stringify(ticket)).not.toContain("oc_secret");
});
```

所有 `WorkbenchTicket` 测试夹具补 `hasWarRoom: false`。

- [ ] **Step 3: 确认 RED**

Run: `npx vitest run src/features/workbench/presentation.test.ts src/features/workbench/data.test.ts`

Expected: FAIL，模块和字段不存在。

- [ ] **Step 4: 写共享展示实现**

创建 `presentation.ts`，把当前 console 内的 `ABSENT`、短编号、固定 +08:00 时间、时长格式和两套颜色映射原样提取。标题实现：

```ts
export function ticketTitle(
  ticket: Pick<WorkbenchTicket, "summary" | "content">,
): string {
  const source = ticket.summary.trim() || ticket.content.trim() || "未提供反馈内容";
  const chars = Array.from(source);
  return chars.length > 60 ? `${chars.slice(0, 60).join("")}…` : source;
}
```

- [ ] **Step 5: 写安全群事实实现**

`WorkbenchTicket` 增加 `hasWarRoom: boolean`；映射为：

```ts
hasWarRoom: record.warRoomChatId.trim().length > 0,
```

不得加入真实 `warRoomChatId`。

- [ ] **Step 6: 列表改用共享函数**

删除 console 内重复实现并导入共享函数。只机械替换名称，不改变列表 DOM 或行为。

- [ ] **Step 7: 确认 GREEN**

Run: `npx vitest run src/features/workbench/presentation.test.ts src/features/workbench/data.test.ts app/workbench-content.test.tsx`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/features/workbench/presentation.ts src/features/workbench/presentation.test.ts src/features/workbench/data.ts src/features/workbench/data.test.ts app/workbench-console.tsx
git commit -m "refactor: share ticket presentation rules"
```

---

### Task 3: 构建三栏详情组件与响应式合同

**Files:**
- Create: `app/workbench-ticket-detail.tsx`
- Create: `app/workbench-ticket-detail.test.tsx`
- Modify: `app/globals.css`
- Modify: `app/fullscreen-showcase-styles.test.ts`

**Interfaces:**
- Consumes: `AuthUser`、`WorkbenchTicket`、`WorkbenchActions`、`availableActions()`、`dwellHours()` 和 Task 2 展示函数。
- Produces: `TicketDetailPageView`、`TicketDetailState` 和 `.oc-ticket-detail*` CSS。

- [ ] **Step 1: 写信息架构失败测试**

```tsx
it("renders the five anchored sections without the queue sider", () => {
  const { container } = renderDetail();
  for (const name of ["工单概览", "用户反馈", "AI 分析", "回复话术", "处理信息"]) {
    expect(screen.getByRole("link", { name })).toBeInTheDocument();
  }
  for (const id of ["overview", "feedback", "analysis", "replies", "handling"]) {
    expect(container.querySelector(`#${id}`)).not.toBeNull();
  }
  expect(container.querySelector(".oc-ticket-detail__grid")).not.toBeNull();
  expect(container.querySelector(".oc-console__sider")).toBeNull();
});

it("shows facts but not a group id", () => {
  renderDetail({
    content: "冷藏室温度持续偏高", summary: "疑似传感器异常",
    replies: [{ tone: "安抚", text: "已记录问题。" }], hasWarRoom: true,
  });
  expect(screen.getByText("冷藏室温度持续偏高")).toBeInTheDocument();
  expect(screen.getByText("疑似传感器异常")).toBeInTheDocument();
  expect(screen.getByText("已记录问题。")).toBeInTheDocument();
  expect(screen.getByText("已建立")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("oc_");
});
```

- [ ] **Step 2: 写动作和错误状态失败测试**

```tsx
it("reuses current action rules", () => {
  renderDetail({ state: "待跟进", hasOwner: true });
  expect(screen.getByRole("button", { name: "开始跟进" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认闭环" })).not.toBeInTheDocument();
  expect(screen.getByText(/只有负责人本人能做/)).toBeInTheDocument();
});

it("offers claiming only with no owner", () => {
  renderDetail({ hasOwner: false, ownerNames: [] });
  expect(screen.getByRole("button", { name: "我来跟进" })).toBeInTheDocument();
});

it("distinguishes missing from unavailable", () => {
  const { rerender } = render(
    <TicketDetailState user={{ openId: "ou_operator", name: "运营" }}
      kind="not-found" recordNumber="VOC-404"
      backHref="/?queue=all&sort=feedback_desc"
      retryHref="/workbench/tickets/VOC-404?queue=all&sort=feedback_desc" />,
  );
  expect(screen.getByText("工单不存在或已被移除")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "重试" })).not.toBeInTheDocument();
  rerender(<TicketDetailState user={{ openId: "ou_operator", name: "运营" }}
    kind="unavailable" recordNumber="VOC-404"
    backHref="/?queue=all&sort=feedback_desc"
    retryHref="/workbench/tickets/VOC-404?queue=all&sort=feedback_desc" />);
  expect(screen.getByText("工单暂时无法加载")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "重试" })).toBeInTheDocument();
});
```

- [ ] **Step 3: 写 CSS 失败合同**

```ts
expect(styles).toMatch(/\.oc-ticket-detail__grid\s*\{[^}]*grid-template-columns:\s*180px\s+minmax\(0,\s*1fr\)\s+320px/s);
expect(styles).toMatch(/@media\s*\(max-width:\s*1100px\)[\s\S]*?\.oc-ticket-detail__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+300px/s);
expect(styles).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*?\.oc-ticket-detail__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
```

- [ ] **Step 4: 确认 RED**

Run: `npx vitest run app/workbench-ticket-detail.test.tsx app/fullscreen-showcase-styles.test.ts`

Expected: FAIL，组件与 CSS 不存在。

- [ ] **Step 5: 写详情组件最小实现**

文件必须以 React 19 adapter 开始，再导入 Arco CSS。固定章节：

```ts
const DETAIL_SECTIONS = [
  { id: "overview", label: "工单概览" },
  { id: "feedback", label: "用户反馈" },
  { id: "analysis", label: "AI 分析" },
  { id: "replies", label: "回复话术" },
  { id: "handling", label: "处理信息" },
] as const;
```

实现：

```ts
export type TicketDetailPageViewProps = Readonly<{
  user: AuthUser;
  ticket: WorkbenchTicket;
  now: number;
  backHref: string;
}>;

export type TicketDetailStateProps = Readonly<{
  user: AuthUser;
  kind: "unavailable" | "not-found";
  recordNumber: string;
  backHref: string;
  retryHref: string;
}>;
```

`TicketDetailPageView` 使用 `.oc-console.oc-ticket-detail`，不渲染 `Layout.Sider`；左栏是返回链接和锚点，中栏五个 section，右栏状态/负责人/时效/关键字段/动作。动作只能通过：

```tsx
const actions = availableActions(ticket);
const canClaim = !ticket.hasOwner;
<WorkbenchActions recordId={ticket.recordId} seenState={ticket.state}
  actions={actions} canClaim={canClaim} />
```

保留原抽屉终态文案和权限提示。AI 区标题必须明确“AI 摘要”“AI 回复话术”。`TicketDetailState` 使用 `user` 渲染相同品牌栏与登录成员信息；unavailable 有重试和返回，not-found 只有记录编号和返回，无动作。

- [ ] **Step 6: 写响应式 CSS**

```css
.oc-ticket-detail__content { width: 100%; max-width: 1600px; margin: 0 auto; padding: 20px 24px 40px; }
.oc-ticket-detail__grid { display: grid; grid-template-columns: 180px minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
.oc-ticket-detail__nav, .oc-ticket-detail__aside { position: sticky; top: 76px; }
.oc-ticket-detail__nav, .oc-ticket-detail__main, .oc-ticket-detail__aside { min-width: 0; }
.oc-ticket-detail__section { scroll-margin-top: 76px; overflow-wrap: anywhere; }
@media (max-width: 1100px) {
  .oc-ticket-detail__grid { grid-template-columns: minmax(0, 1fr) 300px; }
  .oc-ticket-detail__nav { position: static; grid-column: 1 / -1; }
}
@media (max-width: 760px) {
  .oc-ticket-detail__content { padding: 12px 12px 28px; }
  .oc-ticket-detail__grid { grid-template-columns: minmax(0, 1fr); }
  .oc-ticket-detail__aside { position: static; grid-row: 2; }
}
```

不得引入固定底栏；补充换行规则确保无横向溢出。

- [ ] **Step 7: 确认 GREEN**

Run: `npx vitest run app/workbench-ticket-detail.test.tsx app/fullscreen-showcase-styles.test.ts app/workbench-actions.test.tsx`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add app/workbench-ticket-detail.tsx app/workbench-ticket-detail.test.tsx app/globals.css app/fullscreen-showcase-styles.test.ts
git commit -m "feat: build the full-page ticket workspace"
```

---

### Task 4: 接入受保护详情路由

**Files:**
- Create: `app/workbench/tickets/[recordNumber]/page.tsx`
- Create: `app/workbench/tickets/[recordNumber]/page.test.tsx`

**Interfaces:**
- Consumes: `getCurrentSession()`、`readWorkbenchCached()`、Task 1 href、Task 3 组件。
- Produces: `/workbench/tickets/[recordNumber]`。

- [ ] **Step 1: 写门禁失败测试**

mock `getCurrentSession`、`readWorkbenchCached` 和 `next/navigation.redirect`：

```tsx
it("redirects before reading VOC data", async () => {
  getCurrentSession.mockResolvedValue(null);
  await expect(TicketDetailPage({
    params: Promise.resolve({ recordNumber: "VOC-SECRET" }),
    searchParams: Promise.resolve({ queue: "all" }),
  })).rejects.toThrow("NEXT_REDIRECT:/enter");
  expect(readWorkbenchCached).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 写成功与错误失败测试**

```tsx
it("renders a ticket with a validated back link", async () => {
  getCurrentSession.mockResolvedValue({ openId: "ou_operator", name: "运营" });
  readWorkbenchCached.mockResolvedValue(workbenchData({
    tickets: [ticket({ recordNumber: "VOC-001" })],
  }));
  render(await TicketDetailPage({
    params: Promise.resolve({ recordNumber: "VOC-001" }),
    searchParams: Promise.resolve({ queue: "overdue", severity: "高", page: "2",
      returnTo: "https://evil.example" }),
  }));
  expect(screen.getByRole("link", { name: "返回工单列表" }))
    .toHaveAttribute("href", "/?queue=overdue&severity=%E9%AB%98&sort=feedback_desc&page=2");
  expect(document.body.textContent).not.toContain("evil.example");
});

it("renders unavailable separately from not-found", async () => {
  readWorkbenchCached.mockResolvedValue({ metrics: { status: "unavailable" }, tickets: [] });
  render(await renderPage("VOC-001"));
  expect(screen.getByText("工单暂时无法加载")).toBeInTheDocument();
  expect(screen.queryByText("工单不存在或已被移除")).not.toBeInTheDocument();
});
```

成功读取但无匹配记录的测试写为：

```tsx
it("renders not-found only after a successful read", async () => {
  getCurrentSession.mockResolvedValue({ openId: "ou_operator", name: "运营" });
  readWorkbenchCached.mockResolvedValue(workbenchData({ tickets: [] }));
  render(await renderPage("VOC-404"));
  expect(screen.getByText("工单不存在或已被移除")).toBeInTheDocument();
  expect(screen.queryByText("工单暂时无法加载")).not.toBeInTheDocument();
});
```

- [ ] **Step 3: 确认 RED**

Run: `npx vitest run --dir app/workbench/tickets`

Expected: FAIL，路由不存在。

- [ ] **Step 4: 写路由最小实现**

```tsx
export default async function TicketDetailPage({ params, searchParams }: Props) {
  const user = await getCurrentSession();
  if (!user) redirect("/enter");

  const [{ recordNumber }, rawQuery] = await Promise.all([params, searchParams]);
  const query = parseWorkbenchQuery(rawQuery);
  const backHref = listHref(query);
  const retryHref = ticketDetailHref(query, recordNumber);
  const data = await readWorkbenchCached();

  if (data.metrics.status === "unavailable") {
    return <TicketDetailState user={user} kind="unavailable" recordNumber={recordNumber}
      backHref={backHref} retryHref={retryHref} />;
  }
  const ticket = data.tickets.find((item) => item.recordNumber === recordNumber);
  if (!ticket) {
    return <TicketDetailState user={user} kind="not-found" recordNumber={recordNumber}
      backHref={backHref} retryHref={retryHref} />;
  }
  return <TicketDetailPageView user={user} ticket={ticket}
    now={currentTimestamp()} backHref={backHref} />;
}
```

Next 已解码动态参数；不得二次 `decodeURIComponent()`。会话确认前不得调用数据源。

- [ ] **Step 5: 确认 GREEN 和认证回归**

Run: `npx vitest run --dir app/workbench/tickets app/page.test.tsx app/enter/route.test.ts app/workbench-ticket-detail.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add "app/workbench/tickets/[recordNumber]/page.tsx" "app/workbench/tickets/[recordNumber]/page.test.tsx"
git commit -m "feat: add the protected ticket detail route"
```

---

### Task 5: 列表迁移并删除抽屉

**Files:**
- Modify: `app/workbench-console.tsx`
- Modify: `app/workbench-content.tsx`
- Modify: `app/workbench-content.test.tsx`

**Interfaces:**
- Consumes: `ticketDetailHref()`。
- Produces: 无抽屉、无 selected 状态的列表。

- [ ] **Step 1: 改写列表失败测试**

```tsx
it("links the record to the independent detail route", () => {
  renderWorkbench({ tickets: [ticket({ recordNumber: "R # 001" })],
    searchParams: { queue: "overdue", severity: "高", page: "2" } });
  expect(screen.getByRole("link", { name: "R # 001" })).toHaveAttribute(
    "href", "/workbench/tickets/R%20%23%20001?queue=overdue&severity=%E9%AB%98&sort=feedback_desc&page=2",
  );
});

it("opens that route from the whole row", () => {
  renderWorkbench({ tickets: [ticket({ recordNumber: "R-001" })],
    searchParams: { queue: "all", sort: "severity_desc" } });
  fireEvent.click(screen.getByRole("link", { name: "R-001" }).closest("tr")!);
  expect(push).toHaveBeenCalledWith(
    "/workbench/tickets/R-001?queue=all&sort=severity_desc",
  );
});

it("ignores old ticket state and renders no drawer", () => {
  const { container } = renderWorkbench({ tickets: [ticket({ recordNumber: "R-777" })],
    searchParams: { queue: "all", ticket: "R-777" } });
  expect(container.querySelector(".arco-drawer")).toBeNull();
  expect(screen.queryByText(/工单详情 ·/)).not.toBeInTheDocument();
});
```

源码合同增加：

```ts
expect(console).not.toContain("Drawer");
expect(console).not.toContain("TicketDrawer");
expect(console).not.toContain("selected");
```

- [ ] **Step 2: 确认 RED**

Run: `npx vitest run app/workbench-content.test.tsx`

Expected: FAIL，仍使用 Drawer。

- [ ] **Step 3: 写最小迁移**

- 从 Arco import 删除 `Drawer`；删除 `selected`、Drawer JSX 和 `TicketDrawer()`。
- 删除因此闲置的 `Descriptions`、`availableActions`、`WorkbenchActions` import，但保留 `MetricsPane` 所需 import。
- 记录编号与整行统一使用：

```tsx
href={ticketDetailHref(query, row.recordNumber)}
onClick: () => go(ticketDetailHref(query, row.recordNumber))
```

- 更新注释为 full ticket page；`workbench-content.tsx` 不再声称 URL 管理详情状态。

- [ ] **Step 4: 确认 GREEN**

Run: `npx vitest run app/workbench-content.test.tsx src/features/workbench/href.test.ts src/features/workbench/query.test.ts`

Expected: PASS。

- [ ] **Step 5: 工作台回归**

Run: `npx vitest run app/workbench-content.test.tsx app/workbench-ticket-detail.test.tsx app/workbench-actions.test.tsx src/features/workbench`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add app/workbench-console.tsx app/workbench-content.tsx app/workbench-content.test.tsx
git commit -m "refactor: open tickets as full pages"
```

---

### Task 6: 文档、全量验证、浏览器验收与 Preview

**Files:**
- Modify: `README.md`
- Modify: `docs/TECH_STACK.md`
- Modify: `docs/superpowers/specs/2026-08-13-onecare-ticket-detail-page-design.md`
- Modify: `docs/superpowers/plans/2026-08-13-onecare-ticket-detail-page.md`
- Inspect only: `AGENTS.md`

**Interfaces:**
- Consumes: Tasks 1–5。
- Produces: 一致文档、验证证据、非 Production Preview URL。

- [ ] **Step 1: 更新文档**

README 准确写明：“点行进入独立工单详情页；详情页隐藏队列侧栏，以章节导航、主要内容和处理上下文组成三栏，返回时恢复列表现场。”保留动作 API、负责人权限、认领填空和无 CAS 限制。

TECH_STACK 写明：详情路由、共享缓存、安全返回参数、未登录不读 VOC、只暴露 `hasWarRoom` 而非群 ID。

- [ ] **Step 2: 更新规格与计划状态**

规格增加实施结果；计划勾选实际完成步骤并记录实际文件、断点、浏览器结果和 Preview。不得把未执行检查写成通过。

- [ ] **Step 3: 全量自动验证**

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
```

Expected: 除 README 已记录的既有 audit 例外外均退出 0；audit 非零则如实报告，不擅自升级依赖。构建若改写 `next-env.d.ts`，只报告，不暂存、不提交、不重置。

- [ ] **Step 4: 浏览器验收**

- `1440×900`：独立 URL、三栏、无全局队列侧栏、右栏 sticky；
- `1024×768`：顶部章节导航 + 正文/右栏双栏；
- `390×844`：单栏、动作不遮挡、长文本换行、无横向溢出；
- 返回恢复 queue、七个筛选、search、sort、page；
- 动作成功写后刷新；拒绝、冲突、非法状态仍显示既有错误；
- 不存在与 unavailable 不混淆；
- 无 hydration、ReactDOM.render、404 或未处理异常。

缺少真实会话时，只能确认匿名门禁和静态视觉，真实数据与写操作标为待 Preview/真实租户验证。

- [ ] **Step 5: 非 Production Preview**

自动验证完成后运行：

```bash
vercel deploy --yes
```

不得使用 `--prod`。项目未链接时只在用户授权后链接既有项目，不修改 Production 环境变量。Protection 开启时创建限时 Share Link，不保存 bypass。验证 HTTP 200 和独立详情构建；若 Preview 无认证变量，明确其限制。

- [ ] **Step 6: 提交文档与记录**

```bash
git add README.md docs/TECH_STACK.md docs/superpowers/specs/2026-08-13-onecare-ticket-detail-page-design.md docs/superpowers/plans/2026-08-13-onecare-ticket-detail-page.md
git diff --cached --check
git commit -m "docs: verify the full-page ticket workflow"
```

确认暂存区仅含这四个文档，`next-env.d.ts` 未暂存。

- [ ] **Step 7: 最终状态与 Harness Reflection**

```bash
git status --short --branch
git log --oneline -8
git diff --check
```

当前没有证据需要修改 Harness，因此不改 `AGENTS.md` 或 `docs/HARNESS_REFLECTIONS.md`。只有发现耐久且仓库特定的问题时，才先写 reflection，再报告规则变化。

最终交付报告：文件与提交、每条验证结果、Preview URL/限制、未验证假设、`next-env.d.ts` 状态，以及未执行 push/PR/merge/Production deploy。

---

## 计划自查

**规格覆盖：** §3 → Task 4；§4 → Tasks 1/4/5；§5–6 → Tasks 2/3；§7 → Tasks 3–5；§8 → Tasks 3/4；§9 → Tasks 2–4；§10 → 每项 RED/GREEN + Task 6；§11–12 → Global Constraints 与 Task 6；§13 → Tasks 3–6。

**占位符扫描：** 无待填内容、模糊错误处理或未定义后续实现；代码步骤均有确切接口、文件、命令和预期结果。

**类型一致性：** Task 1 产出 href 和纯列表类型供 Tasks 4/5 使用；Task 2 产出 `hasWarRoom` 和展示函数供 Task 3 使用，真实群 ID 不进入浏览器；Task 3 产出两个组件供 Task 4 使用；动作始终复用 `WorkbenchActions` 与 `availableActions()`。
