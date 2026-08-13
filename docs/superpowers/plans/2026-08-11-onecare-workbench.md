# 工作台落地 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/` 从方案展示厅改成按身份分流的落地页——外部访客看展示厅，租户成员看含真实工单明细的工作台。

**Architecture:** 纯展示层改动。`/` 已经是动态渲染（读 cookie 判会话），据此分流两个组件树。数据经 `use cache` 的单次 `listRecords` 同时产出聚合与列表。闭环逻辑、飞书侧、打标双轨一律不碰。

**Tech Stack:** TypeScript、Next.js 16 App Router（`cacheComponents: true`）、Vitest、飞书 OAuth（现有）、多维表格 OpenAPI（现有）

## Global Constraints

- 规格来源：`docs/superpowers/specs/2026-08-11-onecare-workbench-design.md`。任何与规格冲突之处以规格为准并回改规格。
- 仅 TypeScript。不得引入 Python 代码或工具链。**不得新增任何 npm 依赖。**
- **不得使用 `as any`**（触发 `no-explicit-any` error 让 lint 变红）。用 `as never` 或 `as unknown as X`。
- **假 mock 必须声明参数类型，不得对 `.mock.calls[n]` 做元组强转。** `vi.fn(async () => ...)` 推断成零参，`.mock.calls[0]` 是 `[]`，强转触发 `TS2352` 让 `npm run typecheck` 变红——而 `vitest run` 不做类型检查，测试全绿也发现不了。
- **`src/features/voc/`、`src/features/tagging/`、`src/features/feishu-bot/` 一律不动。** `src/features/bitable/field-map.ts` 只允许 Task 1 那一处增量。
- **`numberish` / `isoDate` / `openIds` 三个校准辅助函数一个字不能动**——它们是对真实 Base 实测出来的，改坏了是静默失败（数字字段读回字符串、日期读回 epoch 毫秒、人员键名是 `id`）。
- **路径重定向必须写在 `next.config.ts` 的 `redirects()` 里，不得写成页面级 `redirect()`。** `cacheComponents: true` 下只含一行 `redirect()` 的页面会被静态预渲染、跳转被烘成客户端 meta-refresh，非 JS 客户端拿到 200。`export const dynamic` 与 `export const runtime` 在 cacheComponents 下均被拒，逐页面逃生舱不存在。
- **`use cache` 函数内部抛出是构建级致命错误**，与调用方是否 catch 无关。所有网络读取必须在缓存函数**内部** try/catch，返回判别联合而不是抛。
- 渲染型测试文件依赖 `vitest.setup.ts` 的全局 `afterEach(cleanup)`，不要另起一套。
- 提交信息用英文，正文说明「为什么」而非「改了什么」。
- 完成判定：`npm test`、`npm run test:runtime`、`npm run lint`（0 problems）、`npm run typecheck`、`npm run build`，外加 `FEISHU_BITABLE_APP_TOKEN=bogusX npm run build` 与 `FEISHU_APP_SECRET=wrongX npm run build` 均须 exit 0。
- **不得碰真实 Base 做写入。** 只读可以。它现在两表 0 条、24 字段、选项 4/3/8，必须保持。
- **凭据从 gitignored 的 `.env.local` 读**（`set -a; . ./.env.local; set +a`），不得写进任何脚本、命令行字面量或报告；token 不得落盘。
- 基线：531 单测 + 5 runtime 测试，只增不减。

## 执行顺序与依赖

Task 1–3 无外部依赖。Task 4 需要真实飞书客户端才能最终确认 UA，但代码可先写、判据待回填。

| 阶段 | 任务 | 说明 |
| --- | --- | --- |
| 一 数据 | 1、2 | 负责人姓名、工作台数据读取 |
| 二 鉴权 | 3 | 接口门禁 + 回调落地点 |
| 三 界面 | 4、5 | 身份分流与无感验证、工作台 UI |
| 四 收尾 | 6 | 路由清理、文档一致性、全量验证 |

---

### Task 1: `VocRecord` 增加 `ownerNames`

**Files:**
- Modify: `src/features/bitable/field-map.ts`
- Test: `src/features/bitable/field-map.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `VocRecord.ownerNames: readonly string[]`，以及内部辅助 `personNames(value: unknown): readonly string[]`

规格 §7 的唯一例外。**纯增量**：不改 `openIds()`，不改任何现有字段的解包。卡片鉴权仍用 `ownerOpenIds` 比对身份；姓名只用于展示。

已校准的真实形状（2026-08-10 对真实 Base 实测）：人员字段读回 `[{ email, en_name, id, name }]`，键名是 `id` 不是 `open_id`。

- [ ] **Step 1: Write the failing test**

```ts
// 追加到 src/features/bitable/field-map.test.ts
describe("ownerNames", () => {
  it("reads the display name alongside the open id", () => {
    const record = toVocRecord(
      {
        [VOC_FIELD_NAMES.owner]: [
          { email: "", en_name: "A", id: "ou_a", name: "张三" },
          { email: "", en_name: "B", id: "ou_b", name: "李四" },
        ],
      },
      "rec1",
    );

    expect(record.ownerOpenIds).toEqual(["ou_a", "ou_b"]);
    expect(record.ownerNames).toEqual(["张三", "李四"]);
  });

  it("skips entries without a usable name but keeps their open id", () => {
    const record = toVocRecord(
      { [VOC_FIELD_NAMES.owner]: [{ id: "ou_a" }, { id: "ou_b", name: "李四" }] },
      "rec1",
    );

    expect(record.ownerOpenIds).toEqual(["ou_a", "ou_b"]);
    expect(record.ownerNames).toEqual(["李四"]);
  });

  it("returns an empty list when the field is unset", () => {
    expect(toVocRecord({}, "rec1").ownerNames).toEqual([]);
  });

  it("ignores a non-array people field", () => {
    expect(
      toVocRecord({ [VOC_FIELD_NAMES.owner]: "nope" }, "rec1").ownerNames,
    ).toEqual([]);
  });

  it("ignores a whitespace-only name", () => {
    expect(
      toVocRecord(
        { [VOC_FIELD_NAMES.owner]: [{ id: "ou_a", name: "   " }] },
        "rec1",
      ).ownerNames,
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/bitable/field-map.test.ts`
Expected: FAIL — `ownerNames` 不存在于 `VocRecord`

- [ ] **Step 3: Write minimal implementation**

在 `field-map.ts` 的 `openIds` 旁边新增（**不要修改 `openIds` 本身**）：

```ts
// The same calibrated people-field shape openIds() reads, taking `name` instead
// of `id`. Kept as a separate function rather than widening openIds() because
// card authorization compares open ids and must not start depending on display
// names — a renamed person must never change who can act on a ticket.
export function personNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "object" &&
    item !== null &&
    typeof (item as { name?: unknown }).name === "string" &&
    (item as { name: string }).name.trim().length > 0
      ? [(item as { name: string }).name]
      : [],
  );
}
```

`VocRecord` 类型加一行 `ownerNames: readonly string[];`，`toVocRecord` 的返回对象里加 `ownerNames: personNames(safeFields[VOC_FIELD_NAMES.owner]),`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/bitable/`
Expected: PASS，且既有用例全绿

- [ ] **Step 5: Commit**

```bash
git add src/features/bitable/field-map.ts src/features/bitable/field-map.test.ts
git commit -m "feat: read owner display names alongside their open ids

The workbench shows who owns a ticket, but card authorization compares open ids
and must keep doing so — a person being renamed must never change who is allowed
to act on a ticket. Two separate readers over the same calibrated people field
keeps those two concerns from drifting into one."
```

---

### Task 2: 工作台数据读取

**Files:**
- Create: `src/features/workbench/data.ts`
- Test: `src/features/workbench/data.test.ts`

**Interfaces:**
- Consumes: `VocRecord`（Task 1 起含 `ownerNames`）、`aggregateVocMetrics` / `VocMetrics` / `VocMetricsResult`（`src/features/voc/metrics.ts`）
- Produces: `WorkbenchTicket`、`WorkbenchData`、`BuildWorkbenchOptions`、`toWorkbenchTicket(record)`、`buildWorkbench(records, options)`

**不要引入第二层 ok/unavailable 判别。** `WorkbenchData.metrics` 已经是 `VocMetricsResult`（自带 `status`），读取失败由 Task 3 表达为 `{ metrics: { status: "unavailable" }, tickets: [] }`。再套一层 `WorkbenchResult` 会让 UI 要判两次状态，而 `app/dashboard/voc/page.tsx` 现有的渲染逻辑只判一层。

纯函数，零 IO。把 `VocRecord[]` 同时转成聚合与列表行。

- [ ] **Step 1: Write the failing test**

```ts
// src/features/workbench/data.test.ts
import { describe, expect, it } from "vitest";

import { buildWorkbench, toWorkbenchTicket } from "./data";
import type { VocRecord } from "../bitable/field-map";

function record(over: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec1",
    recordNumber: "R-001",
    channel: "电商评价",
    category: "冰箱",
    content: "报修后等了三天没人上门",
    rating: 2,
    feedbackAt: "2026-01-23T02:00:00.000Z",
    state: "待跟进",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "等待三天无人上门",
    replies: [],
    severity: "中",
    ownerOpenIds: ["ou_a"],
    ownerNames: ["张三"],
    retryCount: 0,
    ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    closedAt: null,
    ...over,
  } as VocRecord;
}

describe("toWorkbenchTicket", () => {
  it("carries the columns the workbench renders", () => {
    expect(toWorkbenchTicket(record())).toEqual({
      recordNumber: "R-001",
      feedbackAt: "2026-01-23T02:00:00.000Z",
      channel: "电商评价",
      category: "冰箱",
      content: "报修后等了三天没人上门",
      polarity: "差评",
      dimensions: ["维修时间"],
      severity: "中",
      state: "待跟进",
      ownerNames: ["张三"],
      ticketOpenedAt: "2026-01-23T02:00:00.000Z",
      closedAt: null,
      durationHours: null,
    });
  });

  it("computes duration only once both timestamps parse", () => {
    expect(
      toWorkbenchTicket(record({ closedAt: "2026-01-24T02:00:00.000Z" }))
        .durationHours,
    ).toBe(24);
  });

  it("leaves duration null when the close timestamp is unparseable", () => {
    expect(
      toWorkbenchTicket(record({ closedAt: "not a date" })).durationHours,
    ).toBeNull();
  });

  it("never exposes the record id or owner open ids", () => {
    const ticket = toWorkbenchTicket(record());

    expect(ticket).not.toHaveProperty("recordId");
    expect(ticket).not.toHaveProperty("ownerOpenIds");
  });
});

describe("buildWorkbench", () => {
  it("returns aggregates and tickets from one pass", () => {
    const result = buildWorkbench([record(), record({ polarity: "好评" })], {
      manualMinutesPerRecord: 5,
    });

    expect(result.metrics.status).toBe("ok");
    if (result.metrics.status !== "ok") return;
    expect(result.metrics.metrics.total).toBe(2);
    expect(result.tickets).toHaveLength(2);
  });

  it("sorts tickets newest first", () => {
    const result = buildWorkbench(
      [
        record({ recordNumber: "old", feedbackAt: "2026-01-01T00:00:00.000Z" }),
        record({ recordNumber: "new", feedbackAt: "2026-02-01T00:00:00.000Z" }),
      ],
      {},
    );

    expect(result.tickets.map((t) => t.recordNumber)).toEqual(["new", "old"]);
  });

  it("puts tickets without a feedback time last rather than dropping them", () => {
    const result = buildWorkbench(
      [record({ recordNumber: "none", feedbackAt: null }), record({ recordNumber: "dated" })],
      {},
    );

    expect(result.tickets.map((t) => t.recordNumber)).toEqual(["dated", "none"]);
  });

  it("handles an empty record set without dividing by zero", () => {
    const result = buildWorkbench([], {});

    expect(result.tickets).toEqual([]);
    expect(result.metrics.status).toBe("ok");
    if (result.metrics.status !== "ok") return;
    expect(result.metrics.metrics.closureRate).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/workbench/data.test.ts`
Expected: FAIL — `Failed to resolve import "./data"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/workbench/data.ts
import type { VocRecord } from "../bitable/field-map";
import {
  aggregateVocMetrics,
  type VocMetricsInput,
  type VocMetricsResult,
} from "../voc/metrics";
import type { VocDimension, VocPolarity, VocSeverity } from "../voc/triage";
import type { VocState } from "../voc/service-event";

// Deliberately omits recordId and ownerOpenIds. Both are identifiers rather
// than information an operator reads, and the row objects are serialized into
// the page payload — keeping them out means a stray console.log or a view-source
// never turns into an identifier leak.
export type WorkbenchTicket = Readonly<{
  recordNumber: string;
  feedbackAt: string | null;
  channel: string;
  category: string;
  content: string;
  polarity: VocPolarity | null;
  dimensions: readonly VocDimension[];
  severity: VocSeverity | null;
  state: VocState;
  ownerNames: readonly string[];
  ticketOpenedAt: string | null;
  closedAt: string | null;
  durationHours: number | null;
}>;

export type WorkbenchData = Readonly<{
  metrics: VocMetricsResult;
  tickets: readonly WorkbenchTicket[];
}>;

export type BuildWorkbenchOptions = Readonly<{
  manualMinutesPerRecord?: number;
}>;

function hours(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (end - start) / 3_600_000;
}

export function toWorkbenchTicket(record: VocRecord): WorkbenchTicket {
  return {
    recordNumber: record.recordNumber,
    feedbackAt: record.feedbackAt,
    channel: record.channel,
    category: record.category,
    content: record.content,
    polarity: record.polarity,
    dimensions: record.dimensions,
    severity: record.severity,
    state: record.state,
    ownerNames: record.ownerNames,
    ticketOpenedAt: record.ticketOpenedAt,
    closedAt: record.closedAt,
    durationHours: hours(record.ticketOpenedAt, record.closedAt),
  };
}

function toMetricsInput(record: VocRecord): VocMetricsInput {
  return {
    state: record.state,
    polarity: record.polarity,
    dimensions: record.dimensions,
    channel: record.channel,
    ...(record.ticketOpenedAt ? { ticketOpenedAt: record.ticketOpenedAt } : {}),
    ...(record.closedAt ? { closedAt: record.closedAt } : {}),
  };
}

// A record with no feedback time sorts last instead of being dropped: an
// operator who cannot see it also cannot fix it, and a silently shorter list is
// exactly the kind of number that stops reconciling against the Base.
function feedbackRank(ticket: WorkbenchTicket): number {
  if (!ticket.feedbackAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(ticket.feedbackAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function buildWorkbench(
  records: readonly VocRecord[],
  options: BuildWorkbenchOptions,
): WorkbenchData {
  const metrics = aggregateVocMetrics(
    records.map(toMetricsInput),
    options.manualMinutesPerRecord === undefined
      ? {}
      : { manualMinutesPerRecord: options.manualMinutesPerRecord },
  );

  const tickets = records
    .map(toWorkbenchTicket)
    .sort((a, b) => feedbackRank(b) - feedbackRank(a));

  return { metrics: { status: "ok", metrics }, tickets };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/workbench/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/workbench/data.ts src/features/workbench/data.test.ts
git commit -m "feat: derive workbench aggregates and rows from one record pass

Row objects deliberately drop recordId and ownerOpenIds: they are identifiers an
operator never reads, and these objects get serialized into the page payload.
A record missing its feedback time sorts last rather than disappearing — a list
that silently shortens stops reconciling against the Base."
```

---

### Task 3: 接口门禁与回调落地点

**Files:**
- Modify: `app/api/voc/dashboard/route.ts`
- Modify: `app/api/auth/feishu/callback/route.ts:37,69`
- Test: `app/api/voc/dashboard/route.test.ts`
- Test: `app/api/auth/feishu/callback/route.test.ts`

**Interfaces:**
- Consumes: `getCurrentSession()`（`src/features/auth/current-session.ts`，返回 `Promise<AuthUser | null>`）、`buildWorkbench`（Task 2）
- Produces: `createDashboardRoute` 的依赖新增 `session: () => Promise<AuthUser | null>`；`readWorkbenchCached(): Promise<WorkbenchData>`

读取失败时返回 `{ metrics: { status: "unavailable" }, tickets: [] }`——**不要新增第二层判别联合**，UI 只判 `metrics.status` 一层。

`/api/voc/dashboard` 现在完全公开。规格 §5 要求无会话返回 401 **且不触达 Bitable**。

回调现在固定跳 `/login`（`callback/route.ts:37` 与 `:69`），要改成 `/`。

- [ ] **Step 1: Write the failing test**

```ts
// 追加到 app/api/voc/dashboard/route.test.ts
describe("dashboard route session gate", () => {
  it("returns 401 without a session and never reads the Base", async () => {
    const listAll = vi.fn(async () => []);
    const route = createDashboardRoute({
      listAll,
      session: async () => null,
    });

    const response = await route();

    expect(response.status).toBe(401);
    expect(listAll).not.toHaveBeenCalled();
  });

  it("returns aggregates and tickets with a session", async () => {
    const route = createDashboardRoute({
      listAll: vi.fn(async () => []),
      session: async () => ({ openId: "ou_a", name: "张三" }),
    });

    const response = await route();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("tickets");
    expect(body).toHaveProperty("total");
  });
});
```

```ts
// 追加到 app/api/auth/feishu/callback/route.test.ts
it("sends a successful login back to the workbench, not the experience page", async () => {
  const response = await handlerWithValidState();

  expect(response.status).toBe(302);
  expect(new URL(response.headers.get("location")!, "https://x").pathname).toBe("/");
});

it("sends a failed login back to the workbench with an error and a tried marker", async () => {
  const response = await handlerWithMismatchedState();
  const location = new URL(response.headers.get("location")!, "https://x");

  expect(location.pathname).toBe("/");
  expect(location.searchParams.get("auth_error")).toBe("invalid_state");
  expect(location.searchParams.get("auth")).toBe("tried");
});
```

沿用该文件既有的构造方式命名两个辅助函数；若尚无，按现有 helper 的写法新增。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/voc/dashboard/route.test.ts app/api/auth/feishu/callback/route.test.ts`
Expected: FAIL — `session` 不是依赖；回调仍跳 `/login`

- [ ] **Step 3: Write minimal implementation**

`dashboard/route.ts`：依赖类型加 `session: () => Promise<AuthUser | null>`，`defaultDependencies` 里接 `getCurrentSession`。handler 的**第一件事**是取会话，为空立即返回 401，**在此之前不得调用 `listAll`**。有会话时用 `buildWorkbench` 产出 `{...metrics, tickets}`。

`readWorkbenchCached()` 沿用 `readVocRecordsCached()` 的形状：`"use cache"` + `cacheLife`，**try/catch 在缓存函数内部**，返回 `{status:"ok"|"unavailable"}` 判别联合，绝不抛。

`callback/route.ts`：`errorResponse` 的 `new URL("/login", request.url)` 改成 `"/"`，并加 `errorUrl.searchParams.set("auth", "tried")`；成功分支的 `new URL("/login", request.url)` 同样改成 `"/"`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/`
Expected: PASS，既有用例全绿

- [ ] **Step 5: Commit**

```bash
git add app/api/voc/dashboard app/api/auth/feishu/callback
git commit -m "feat: gate the VOC read behind a session and land logins on /

The response now carries per-record fields, so it stops being something an
anonymous caller may have. The session check runs before the Base read rather
than after, so an unauthenticated request costs nothing and reveals nothing.

A failed login carries an auth=tried marker back so the landing page can tell
'never attempted' from 'attempted and failed' — without it, a page that retries
on every session-less visit is an infinite redirect."
```

---

### Task 4: 身份分流与无感验证

**Files:**
- Create: `src/features/workbench/entry.ts`
- Modify: `app/page.tsx`
- Test: `src/features/workbench/entry.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `isFeishuClient(userAgent: string | null): boolean`、`shouldAttemptSilentAuth(input): boolean`

规格 §2.1。**防循环保护是本任务最关键的一条**——授权失败落回 `/`，若 `/` 因为仍无会话再次跳授权就是无限重定向，而这个故障在飞书客户端内比在浏览器里更难自查。

- [ ] **Step 1: 先取真实 UA，不要凭记忆写判据**

在 `app/page.tsx` 里临时加一行 `console.log("[ua]", (await headers()).get("user-agent"))`，部署到 Preview，在飞书客户端里打开一次，从 Vercel 运行日志读出真实 UA，记录到本任务下，然后删掉这行。

若拿不到（例如无法部署 Preview），**退化方案**：不做 UA 判断，改为展示厅上放显眼的「进入工作台」按钮，把无感验证降级为一次点击。**不要凭记忆硬编码 UA 子串**——这个项目已经因为未经核实的外部假设吃过五次亏。把你实际采用的方案与依据写进报告。

- [ ] **Step 2: Write the failing test**

```ts
// src/features/workbench/entry.test.ts
import { describe, expect, it } from "vitest";

import { isFeishuClient, shouldAttemptSilentAuth } from "./entry";

// Replace this fixture with the real UA captured in Step 1 before implementing.
const FEISHU_UA = "Mozilla/5.0 ... Lark/7.20.0 ...";
const BROWSER_UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131 Safari/537.36";

describe("isFeishuClient", () => {
  it("recognises the Feishu client", () => {
    expect(isFeishuClient(FEISHU_UA)).toBe(true);
  });

  it("does not mistake an ordinary browser for it", () => {
    expect(isFeishuClient(BROWSER_UA)).toBe(false);
  });

  it("treats a missing user agent as not the client", () => {
    expect(isFeishuClient(null)).toBe(false);
  });
});

describe("shouldAttemptSilentAuth", () => {
  it("attempts once inside the Feishu client with no session", () => {
    expect(
      shouldAttemptSilentAuth({ hasSession: false, userAgent: FEISHU_UA, alreadyTried: false }),
    ).toBe(true);
  });

  it("never attempts when a session already exists", () => {
    expect(
      shouldAttemptSilentAuth({ hasSession: true, userAgent: FEISHU_UA, alreadyTried: false }),
    ).toBe(false);
  });

  it("never attempts twice — this is the loop guard", () => {
    expect(
      shouldAttemptSilentAuth({ hasSession: false, userAgent: FEISHU_UA, alreadyTried: true }),
    ).toBe(false);
  });

  it("never pushes an external browser visitor into login", () => {
    expect(
      shouldAttemptSilentAuth({ hasSession: false, userAgent: BROWSER_UA, alreadyTried: false }),
    ).toBe(false);
  });

  it("does not attempt when the user agent is missing", () => {
    expect(
      shouldAttemptSilentAuth({ hasSession: false, userAgent: null, alreadyTried: false }),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/workbench/entry.test.ts`
Expected: FAIL — `Failed to resolve import "./entry"`

- [ ] **Step 4: Write minimal implementation**

```ts
// src/features/workbench/entry.ts

// Substring captured from a real Feishu client request — see the plan's Task 4
// Step 1. Not written from memory: five separate calibration findings on this
// project came from assumptions about external systems that looked obvious and
// were wrong.
const FEISHU_CLIENT_MARKERS = ["Lark", "Feishu"] as const;

export function isFeishuClient(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return FEISHU_CLIENT_MARKERS.some((marker) => userAgent.includes(marker));
}

export type SilentAuthInput = Readonly<{
  hasSession: boolean;
  userAgent: string | null;
  alreadyTried: boolean;
}>;

// The alreadyTried term is the loop guard and the reason this is a function
// rather than an inline condition. Without it, a failed authorization lands back
// on a session-less page that immediately re-attempts — an infinite redirect,
// and one that is markedly harder to diagnose inside the Feishu client than in
// a browser with a visible address bar.
export function shouldAttemptSilentAuth(input: SilentAuthInput): boolean {
  if (input.hasSession) return false;
  if (input.alreadyTried) return false;
  return isFeishuClient(input.userAgent);
}
```

`app/page.tsx`：读 `headers()` 取 UA、读 `searchParams` 取 `auth` 标记，`shouldAttemptSilentAuth` 为真则 `redirect("/api/auth/feishu/start")`；否则按有无会话渲染工作台或展示厅。

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/workbench/ && npm run build`
Expected: PASS，且构建成功

- [ ] **Step 6: Commit**

```bash
git add src/features/workbench/entry.ts src/features/workbench/entry.test.ts app/page.tsx
git commit -m "feat: attempt authorization once inside the Feishu client

A tenant member opening the app should land on the workbench, not on a page
asking them to click login. The single-attempt guard is the load-bearing half:
a failed authorization returns to a page that still has no session, so without
the marker the two would bounce off each other forever — and that failure is far
harder to see inside the Feishu client than in a browser."
```

---

### Task 5: 工作台界面

**Files:**
- Create: `app/workbench-content.tsx`
- Modify: `app/page.tsx`
- Test: `app/workbench-content.test.tsx`

**Interfaces:**
- Consumes: `WorkbenchData` / `WorkbenchTicket`（Task 2）、`AuthUser`
- Produces: `WorkbenchContent` 组件

指标条 + 分布 + 只读工单列表。**只读**——网页上没有任何改状态的控件。

> **2026-08-13 记：本任务已按原文交付，但「只读」这条已被用户在 2026-08-11 反转**（「网页可直接改状态和负责人」）。反转后的设计见规格 §4.1，由后续任务实现。此处保留原文，因为它如实记录了当时交付的东西。

- [ ] **Step 1: Write the failing test**

```tsx
// app/workbench-content.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkbenchContent } from "./workbench-content";
import type { WorkbenchTicket } from "../src/features/workbench/data";

const ticket: WorkbenchTicket = {
  recordNumber: "R-001",
  feedbackAt: "2026-01-23T02:00:00.000Z",
  channel: "电商评价",
  category: "冰箱",
  content: "报修后等了三天没人上门",
  polarity: "差评",
  dimensions: ["维修时间"],
  severity: "中",
  state: "待跟进",
  ownerNames: ["张三"],
  ticketOpenedAt: "2026-01-23T02:00:00.000Z",
  closedAt: null,
  durationHours: null,
};

const user = { openId: "ou_a", name: "张三" };

describe("WorkbenchContent", () => {
  it("renders the ticket's real content and owner", () => {
    render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [ticket] }}
        user={user}
      />,
    );

    expect(screen.getByText("报修后等了三天没人上门")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("待跟进")).toBeInTheDocument();
  });

  it("shows the unavailable state without any zero placeholders", () => {
    render(
      <WorkbenchContent data={{ metrics: { status: "unavailable" }, tickets: [] }} user={user} />,
    );

    expect(screen.getByText(/指标暂不可用/)).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("says so plainly when there are no tickets", () => {
    render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [] }}
        user={user}
      />,
    );

    expect(screen.getByText(/暂无工单/)).toBeInTheDocument();
  });

  it("offers no control that changes state — the loop runs in Feishu", () => {
    render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [ticket] }}
        user={user}
      />,
    );

    expect(screen.queryByRole("button", { name: /跟进|闭环|提交/ })).toBeNull();
  });
});
```

`emptyMetrics()` 在同文件内定义为返回一个全零的 `VocMetrics`，字段照 `src/features/voc/metrics.ts` 的 `VocMetrics` 类型逐个填 0 / 空数组。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/workbench-content.test.tsx`
Expected: FAIL — `Failed to resolve import "./workbench-content"`

- [ ] **Step 3: Write minimal implementation**

服务端组件，无 `"use client"`（列表只读、无交互）。结构：顶部身份与说明、指标条、三块分布、工单表格。

`metrics.status === "unavailable"` 时整块替换为文字提示，**不渲染任何 0 或 `—`**。`tickets` 为空时显示「暂无工单」。人效栏沿用看板既有措辞，显式打印假设基线，不给年化金额。

沿用仓库既有的 class 命名与视觉语言（参考 `app/dashboard/voc/page.tsx`）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/workbench-content.tsx app/workbench-content.test.tsx app/page.tsx
git commit -m "feat: render the gated workbench

Real content and real owner names, because the gate is what makes showing them
defensible — an operator triaging a complaint needs the complaint. No control
here changes state: the card path owns writes, its identity comes from a signed
event rather than a cookie, and Bitable has no compare-and-set to arbitrate two
writers."
```

---

### Task 6: 路由清理、文档一致性与全量验证

**Files:**
- Modify: `next.config.ts`
- Modify: `vercel-config.test.ts`
- Delete: `app/dashboard/voc/page.tsx`
- Modify: `README.md`、`AGENTS.md`
- Modify: `docs/superpowers/specs/2026-08-10-onecare-voc-mvp-design.md`

- [ ] **Step 1: `/dashboard/voc` 改为配置层重定向**

`next.config.ts` 的 `redirects()` 增加 `{ source: "/dashboard/voc", destination: "/", permanent: false }`，删除 `app/dashboard/voc/page.tsx`。

**必须写在 `redirects()` 里。** `cacheComponents: true` 下页面级 `redirect()` 会被烘成客户端 meta-refresh，非 JS 客户端拿到 200——`/dashboard` 已经踩过一次。

`vercel-config.test.ts` 用 `toEqual` 锁死整份 `vercel.json`，本步不改 `vercel.json` 所以它不受影响；但若你顺带改了，必须同步更新该测试。

- [ ] **Step 2: 反转前置规格 §1.4**

`docs/superpowers/specs/2026-08-10-onecare-voc-mvp-design.md` §1.4 写着「网站 OAuth 登录与角色：评委已在同一企业内，登录不再是访问前提」。标注该条已被 `2026-08-11-onecare-workbench-design.md` 反转，写明理由：当时没有承载记录级数据的页面，现在有了。

- [ ] **Step 3: 更新 README 与 AGENTS.md**

如实描述：`/` 按身份分流、工作台需登录、外部访客看展示厅、`/api/voc/dashboard` 已门禁、公开聚合看板已并入工作台。

**不得低报也不得高报。** 仍未实现的继续标注规划中（PostgreSQL、真实 IoT 与智能预诊、智能客服自由文本、自动回访、`voc-insight`、三视角仍是浏览器内演示、多租户隔离、xlsx 仍是运营手动导入）。`redactVocContent` 的表述维持现状——本设计没有接入它，理由是门禁消除了它要防的场景。

- [ ] **Step 4: 跑全部验证并如实报告**

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
FEISHU_BITABLE_APP_TOKEN=bogusX npm run build
FEISHU_APP_SECRET=wrongX npm run build
```

`npm audit --omit=dev` 预期仍非零（既有例外，README 已如实记录，不处置）。其余必须绿。

- [ ] **Step 5: Commit**

```bash
git add next.config.ts app/dashboard README.md AGENTS.md docs/superpowers/specs
git commit -m "docs: state the identity split and retire the public aggregate page

The aggregate dashboard existed so an anonymous judge could verify numbers; the
workbench supersedes it for anyone who can log in, and record-level data means
it should not stay open. Reversing the earlier 'login is out of scope' line in
the same commit keeps the two specs from disagreeing about what ships."
```

---

## 自查

**规格覆盖**：§2 路由分流 → Task 4、6；§2.1 无感验证与防循环 → Task 4；§3 租户证明 → 无需代码（自建应用属性），Task 6 文档写明；§4 工作台内容 → Task 2、5；§5 接口鉴权 → Task 3；§6 域名统一 → **无对应任务**，见下；§7 不改动范围 → 全局约束，Task 1 是唯一例外；§8 错误处理 → Task 3（缓存内 try/catch）、Task 5（不可用态）；§9 缓存 → Task 3；§10 测试 → 每个 Task 的测试步骤；§11 规格反转 → Task 6；§12 验收 → Task 6 Step 4。

**已知缺口一处**：§6 域名统一没有对应任务，因为它**已经完成**——`FEISHU_REDIRECT_URI` 已改为 `https://onecare.ohmyfeishu.top/api/auth/feishu/callback` 并重新部署，飞书后台重定向 URL 已由用户登记（登录实测可用）。仅剩网页应用主页两个框待用户改，属配置操作而非代码任务。Task 6 Step 3 的文档里应记录最终域名。

**占位符扫描**：无 TBD、无「适当处理错误」。Task 4 Step 1 是一条真实的取值步骤而非占位符——它存在的理由是 UA 字符串不能凭记忆写，且给出了明确的退化方案。

**类型一致性**：`VocRecord.ownerNames` 定义于 Task 1，被 Task 2 消费；`WorkbenchTicket` / `WorkbenchData` / `buildWorkbench` / `toWorkbenchTicket` 定义于 Task 2，被 Task 3、5 消费；`shouldAttemptSilentAuth` / `isFeishuClient` 定义于 Task 4，被 `app/page.tsx` 消费；`AuthUser` 与 `getCurrentSession` 来自既有的 `src/features/auth/`。命名全程一致。
