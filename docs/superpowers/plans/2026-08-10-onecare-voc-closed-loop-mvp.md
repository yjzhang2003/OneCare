# VOC 闭环 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把万护 OneCare 从演示站改造为一条真实可运行的 VOC 闭环：真实数据入多维表格、AI 真实打标、中差评在飞书卡片内走完状态机、公开看板读真实聚合。

**Architecture:** IO 在边缘、逻辑在中心。`src/features/voc/` 为零 IO 纯函数（状态机、triage、指标、脱敏）；`src/features/tagging/` 用提供方抽象把 aily 与多维表格 AI 字段捷径两轨收敛成同一份 `TagResult`；`src/features/bitable/` 是注入 `fetcher` 的薄 IO 层。卡片鉴权在同步响应内出结论，写操作留给 `after()`。批量打标由 Vercel Cron 驱动可恢复分片，不写重试队列。

**Tech Stack:** TypeScript、Next.js 16 App Router、Vitest（jsdom）、`@larksuiteoapi/node-sdk`、飞书多维表格 OpenAPI、飞书 aily OpenAPI（可选轨）

## Global Constraints

- 规格来源：`docs/superpowers/specs/2026-08-10-onecare-voc-mvp-design.md`。本计划任何与规格冲突之处，以规格为准并回改规格。
- 语言边界：仅 TypeScript。不得引入 Python 代码或 Python 工具链。
- 不得引入 xlsx 解析依赖。导入由运营在多维表格用自带「导入 Excel」完成。
- 仓库是 public。企业 VOC 数据只能落在 `docs/data/`（已在 `.gitignore`），任何测试数据必须是自造的假数据。
- 密钥与 token 只在服务端，不得出现在日志或客户端 bundle。
- 每个任务走 RED → GREEN → REFACTOR，且以 commit 结束。
- 提交信息用英文，正文说明「为什么」而非「改了什么」。
- 外部调用显式超时：多维表格 10s，打标 25s。
- 枚举值逐字使用规格 §3.2 的中文字面量，不得改写或翻译。
- 完成判定命令：`npm test`、`npm run test:runtime`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm audit --omit=dev`。
- **假 mock 必须声明参数类型，不得对 `.mock.calls[n]` 做元组强转。** `vi.fn(async () => ...)` 推断出的调用签名是零参，`.mock.calls[0]` 类型是 `[]`，再 `as [string, RequestInit]` 会触发 `TS2352` 并让 `npm run typecheck` 变红——`vitest run` 不做类型检查，所以测试全绿也发现不了。正确写法是把参数类型写进 `vi.fn`：`vi.fn(async (_url: string, _init?: RequestInit) => ...)`，之后直接解构、无需强转。仓库既有先例见 `src/features/auth/feishu.test.ts:17` 的 `fetchReturning`。

## 阶段与外部依赖

Task 1–7 零外部依赖，**现在即可全部完成**，不必等 Base 或 aily。Task 8 起需要真实 Base。

| 阶段 | 任务 | 外部依赖 |
| --- | --- | --- |
| 一 纯逻辑 | 1–4 | 无 |
| 二 打标双轨 | 5–7 | 无（fake fetcher） |
| 三 纯逻辑（续） | 10、11 | 无。`resolveOwner` 零 IO；卡片载荷解析用签名夹具即可 |
| 四 Base IO | 8–9 | 需两张 Base 表已建、应用已加协作者 |
| 五 卡片鉴权 | 12 | 需 Base（要读记录校验负责人） |
| 六 分片作业 | 13 | 需 Base + 打标轨已定 |
| 七 看板 | 14 | 需 Base |
| 八 收尾 | 15 | 全部 |

执行顺序按上表，不按任务编号：**1–7 → 10 → 11 → 8 → 9 → 12 → 13 → 14 → 15**。Task 10 与 11 之前被误标为需要 Base，实际零外部依赖，提前执行可以在等外部资源时继续产出。

---

### Task 1: VOC 原文脱敏

**Files:**
- Create: `src/features/voc/redact.ts`
- Test: `src/features/voc/redact.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `redactVocContent(text: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/voc/redact.test.ts
import { describe, expect, it } from "vitest";

import { redactVocContent } from "./redact";

describe("redactVocContent", () => {
  it("masks mobile numbers", () => {
    expect(redactVocContent("请回电 13800138000 谢谢")).toBe(
      "请回电 [手机号] 谢谢",
    );
  });

  it("masks email addresses", () => {
    expect(redactVocContent("联系 zhang.san+voc@example.com.cn")).toBe(
      "联系 [邮箱]",
    );
  });

  it("masks id card numbers without also matching them as mobiles", () => {
    expect(redactVocContent("证件 11010519491231002X 已核")).toBe(
      "证件 [身份证] 已核",
    );
  });

  it("masks long order numbers", () => {
    expect(redactVocContent("订单 202601231234567 未处理")).toBe(
      "订单 [订单号] 未处理",
    );
  });

  it("leaves ordinary numbers alone", () => {
    expect(redactVocContent("等了 3 天，报修 2 次")).toBe("等了 3 天，报修 2 次");
  });

  it("masks several kinds in one sentence", () => {
    expect(
      redactVocContent("13800138000 和 a@b.cn 都联系不上，订单 202601231234567"),
    ).toBe("[手机号] 和 [邮箱] 都联系不上，订单 [订单号]");
  });

  it("returns empty string unchanged", () => {
    expect(redactVocContent("")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/voc/redact.test.ts`
Expected: FAIL — `Failed to resolve import "./redact"`

- [ ] **Step 3: Write minimal implementation**

顺序至关重要：18 位身份证必须先于 11 位手机号匹配，否则手机号规则会啃掉身份证中间一段。

```ts
// src/features/voc/redact.ts

type RedactionRule = Readonly<{ pattern: RegExp; mask: string }>;

// Order matters: the longest, most specific patterns run first so a shorter
// rule cannot consume part of a longer identifier.
const RULES: readonly RedactionRule[] = [
  { pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, mask: "[邮箱]" },
  { pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g, mask: "[身份证]" },
  { pattern: /(?<!\d)\d{12,}(?!\d)/g, mask: "[订单号]" },
  { pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g, mask: "[手机号]" },
];

export function redactVocContent(text: string): string {
  return RULES.reduce(
    (current, rule) => current.replace(rule.pattern, rule.mask),
    text,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/voc/redact.test.ts`
Expected: PASS，7 个用例全绿

- [ ] **Step 5: Commit**

```bash
git add src/features/voc/redact.ts src/features/voc/redact.test.ts
git commit -m "feat: redact personal identifiers from VOC content

The enterprise dataset carries raw user wording, so masking only a dedicated
identity column would leave phone numbers and order ids in the body text.
Longest patterns run first so the mobile rule cannot consume part of an id card."
```

---

### Task 2: 服务事件状态机

**Files:**
- Create: `src/features/voc/service-event.ts`
- Test: `src/features/voc/service-event.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `VOC_STATES`、`VocState`、`VOC_STATE_SEQUENCE`、`VocAction`、`TransitionContext`、`TransitionResult`、`transition(current, action, context)`

状态序号由 `VOC_STATE_SEQUENCE` 从状态名推导，**不在 Base 中单独存列**。

- [ ] **Step 1: Write the failing test**

```ts
// src/features/voc/service-event.test.ts
import { describe, expect, it } from "vitest";

import {
  VOC_STATE_SEQUENCE,
  transition,
  type TransitionContext,
  type VocAction,
  type VocState,
} from "./service-event";

const base: TransitionContext = {
  retryCount: 0,
  hasOwner: true,
  followUpNote: "已联系用户",
  closingNote: "已换配件并回访",
};

describe("transition", () => {
  it.each([
    ["待分析", "打标成功", "已分析"],
    ["待分析", "打标失败", "分析失败"],
    ["分析失败", "重试", "待分析"],
    ["已分析", "需建单", "待跟进"],
    ["已分析", "无需建单", "无需跟进"],
    ["待跟进", "开始跟进", "跟进中"],
    ["跟进中", "提交跟进结果", "待闭环"],
    ["待闭环", "确认闭环", "已闭环"],
  ] satisfies ReadonlyArray<readonly [VocState, VocAction, VocState]>)(
    "moves %s through %s to %s",
    (current, action, expected) => {
      const result = transition(current, action, base);

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.next).toBe(expected);
    },
  );

  it("treats a repeated action as a no-op instead of an error", () => {
    const result = transition("跟进中", "开始跟进", base);

    expect(result).toEqual({ kind: "noop", state: "跟进中" });
  });

  it.each([
    ["已闭环", "开始跟进"],
    ["无需跟进", "需建单"],
    ["待分析", "确认闭环"],
    ["待跟进", "提交跟进结果"],
  ] satisfies ReadonlyArray<readonly [VocState, VocAction]>)(
    "rejects %s + %s",
    (current, action) => {
      const result = transition(current, action, base);

      expect(result.kind).toBe("rejected");
    },
  );

  it("rejects retry once the retry ceiling is reached", () => {
    const result = transition("分析失败", "重试", { ...base, retryCount: 3 });

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("重试");
  });

  it("rejects ticket creation with no owner resolved", () => {
    const result = transition("已分析", "需建单", { ...base, hasOwner: false });

    expect(result.kind).toBe("rejected");
  });

  it("rejects follow-up submission with an empty note", () => {
    const result = transition("跟进中", "提交跟进结果", {
      ...base,
      followUpNote: "   ",
    });

    expect(result.kind).toBe("rejected");
  });

  it("rejects closing with an empty conclusion", () => {
    const result = transition("待闭环", "确认闭环", {
      ...base,
      closingNote: "",
    });

    expect(result.kind).toBe("rejected");
  });

  it("only allows the analysis-failure rollback to lower the sequence", () => {
    expect(VOC_STATE_SEQUENCE["待分析"]).toBeLessThan(
      VOC_STATE_SEQUENCE["分析失败"],
    );

    const rollback = transition("分析失败", "重试", base);
    expect(rollback.kind).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/voc/service-event.test.ts`
Expected: FAIL — `Failed to resolve import "./service-event"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/voc/service-event.ts

export const VOC_STATES = [
  "待分析",
  "分析失败",
  "已分析",
  "无需跟进",
  "待跟进",
  "跟进中",
  "待闭环",
  "已闭环",
] as const;

export type VocState = (typeof VOC_STATES)[number];

export const VOC_STATE_SEQUENCE: Readonly<Record<VocState, number>> = {
  待分析: 0,
  分析失败: 1,
  已分析: 2,
  无需跟进: 3,
  待跟进: 4,
  跟进中: 5,
  待闭环: 6,
  已闭环: 7,
};

export const VOC_ACTIONS = [
  "打标成功",
  "打标失败",
  "重试",
  "需建单",
  "无需建单",
  "开始跟进",
  "提交跟进结果",
  "确认闭环",
] as const;

export type VocAction = (typeof VOC_ACTIONS)[number];

export const RETRY_CEILING = 3;

export type TransitionContext = Readonly<{
  retryCount: number;
  hasOwner: boolean;
  followUpNote?: string;
  closingNote?: string;
}>;

export type TransitionResult =
  | Readonly<{ kind: "ok"; next: VocState }>
  | Readonly<{ kind: "noop"; state: VocState }>
  | Readonly<{ kind: "rejected"; reason: string }>;

type Rule = Readonly<{
  from: VocState;
  action: VocAction;
  to: VocState;
  guard?: (context: TransitionContext) => string | null;
}>;

function requireText(
  value: string | undefined,
  label: string,
): string | null {
  return value && value.trim().length > 0 ? null : `${label}不能为空`;
}

const RULES: readonly Rule[] = [
  { from: "待分析", action: "打标成功", to: "已分析" },
  { from: "待分析", action: "打标失败", to: "分析失败" },
  {
    from: "分析失败",
    action: "重试",
    to: "待分析",
    guard: (context) =>
      context.retryCount < RETRY_CEILING
        ? null
        : `重试次数已达上限 ${RETRY_CEILING}`,
  },
  {
    from: "已分析",
    action: "需建单",
    to: "待跟进",
    guard: (context) => (context.hasOwner ? null : "未解析到负责人或兜底人"),
  },
  { from: "已分析", action: "无需建单", to: "无需跟进" },
  { from: "待跟进", action: "开始跟进", to: "跟进中" },
  {
    from: "跟进中",
    action: "提交跟进结果",
    to: "待闭环",
    guard: (context) => requireText(context.followUpNote, "跟进记录"),
  },
  {
    from: "待闭环",
    action: "确认闭环",
    to: "已闭环",
    guard: (context) => requireText(context.closingNote, "闭环结论"),
  },
];

export function transition(
  current: VocState,
  action: VocAction,
  context: TransitionContext,
): TransitionResult {
  // Feishu card buttons get double-clicked and retried on the wire, so landing
  // on the action's target state again is success, not an error.
  const alreadyThere = RULES.find(
    (rule) => rule.action === action && rule.to === current,
  );
  if (alreadyThere) {
    return { kind: "noop", state: current };
  }

  const rule = RULES.find((r) => r.from === current && r.action === action);
  if (!rule) {
    return { kind: "rejected", reason: `${current} 不支持动作 ${action}` };
  }

  const violation = rule.guard?.(context) ?? null;
  if (violation) {
    return { kind: "rejected", reason: violation };
  }

  return { kind: "ok", next: rule.to };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/voc/service-event.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/voc/service-event.ts src/features/voc/service-event.test.ts
git commit -m "feat: add VOC service event state machine

Idempotence is a requirement rather than an optimisation: Feishu delivers card
callbacks more than once, so replaying an action that already landed must
report success without touching timestamps. Sequence numbers are derived from
the state name so the Base needs no extra column to keep in sync."
```

---

### Task 3: triage 判定

**Files:**
- Create: `src/features/voc/triage.ts`
- Test: `src/features/voc/triage.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `VOC_POLARITIES`、`VocPolarity`、`VOC_DIMENSIONS`、`VocDimension`、`VocSeverity`、`TriageDecision`、`triage(input)`

业务策略留在仓库侧而非提示词里——需要版本化、可测试、可在评审时讲清。

- [ ] **Step 1: Write the failing test**

```ts
// src/features/voc/triage.test.ts
import { describe, expect, it } from "vitest";

import { triage, type VocDimension, type VocPolarity } from "./triage";

describe("triage", () => {
  it("raises a ticket for every negative review", () => {
    expect(triage({ polarity: "差评", dimensions: [] })).toEqual({
      createTicket: true,
      severity: "中",
    });
  });

  it("escalates a negative review touching two or more dimensions", () => {
    expect(
      triage({ polarity: "差评", dimensions: ["维修时间", "服务态度"] }),
    ).toEqual({ createTicket: true, severity: "高" });
  });

  it("raises a ticket for a neutral review that names a dimension", () => {
    expect(triage({ polarity: "中评", dimensions: ["维修价格"] })).toEqual({
      createTicket: true,
      severity: "中",
    });
  });

  it("does not raise a ticket for a neutral review with no dimension", () => {
    expect(triage({ polarity: "中评", dimensions: [] })).toEqual({
      createTicket: false,
      severity: "低",
    });
  });

  it.each([[[]], [["服务态度"] as VocDimension[]]])(
    "never raises a ticket for a positive review (dimensions %j)",
    (dimensions) => {
      expect(
        triage({ polarity: "好评", dimensions }).createTicket,
      ).toBe(false);
    },
  );

  it("is exhaustive over the polarity enum", () => {
    const polarities: readonly VocPolarity[] = ["好评", "中评", "差评"];

    for (const polarity of polarities) {
      expect(() => triage({ polarity, dimensions: [] })).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/voc/triage.test.ts`
Expected: FAIL — `Failed to resolve import "./triage"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/voc/triage.ts

export const VOC_POLARITIES = ["好评", "中评", "差评"] as const;
export type VocPolarity = (typeof VOC_POLARITIES)[number];

export const VOC_DIMENSIONS = [
  "服务态度",
  "维修技术",
  "维修价格",
  "维修时间",
  "售后服务",
  "环境设施",
  "产品质量",
] as const;
export type VocDimension = (typeof VOC_DIMENSIONS)[number];

export type VocSeverity = "高" | "中" | "低";

export type TriageDecision = Readonly<{
  createTicket: boolean;
  severity: VocSeverity;
}>;

export function triage(
  input: Readonly<{
    polarity: VocPolarity;
    dimensions: readonly VocDimension[];
  }>,
): TriageDecision {
  if (input.polarity === "差评") {
    return {
      createTicket: true,
      severity: input.dimensions.length >= 2 ? "高" : "中",
    };
  }

  if (input.polarity === "中评" && input.dimensions.length > 0) {
    return { createTicket: true, severity: "中" };
  }

  return { createTicket: false, severity: "低" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/voc/triage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/voc/triage.ts src/features/voc/triage.test.ts
git commit -m "feat: decide ticket creation and severity in code, not in prompts

Whether a review deserves a ticket is business policy: it needs versioning,
tests, and a straight answer when a reviewer asks why. The model is left to
read language; it is not left to decide what the company does about it."
```

---

### Task 4: 指标聚合

**Files:**
- Create: `src/features/voc/metrics.ts`
- Test: `src/features/voc/metrics.test.ts`

**Interfaces:**
- Consumes: `VocState`（Task 2）、`VocPolarity` / `VocDimension`（Task 3）
- Produces: `VocMetricsInput`、`VocMetrics`、`aggregateVocMetrics(records, options)`

已砍：首次响应时长（缺可靠时间源）、环比与按日趋势（源数据只有一个周期）。人效只给「实测条数 × 显式假设基线」，不给年化金额。

- [ ] **Step 1: Write the failing test**

```ts
// src/features/voc/metrics.test.ts
import { describe, expect, it } from "vitest";

import { aggregateVocMetrics, type VocMetricsInput } from "./metrics";

const records: readonly VocMetricsInput[] = [
  {
    state: "已闭环",
    polarity: "差评",
    dimensions: ["维修时间", "服务态度"],
    channel: "电商评价",
    ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    closedAt: "2026-01-24T02:00:00.000Z",
  },
  {
    state: "跟进中",
    polarity: "差评",
    dimensions: ["维修时间"],
    channel: "400 客服",
    ticketOpenedAt: "2026-01-24T02:00:00.000Z",
  },
  {
    state: "无需跟进",
    polarity: "好评",
    dimensions: [],
    channel: "电商评价",
  },
  { state: "待分析", polarity: null, dimensions: [], channel: "APP" },
  { state: "分析失败", polarity: null, dimensions: [], channel: "APP" },
];

describe("aggregateVocMetrics", () => {
  it("counts every record in the total", () => {
    expect(aggregateVocMetrics(records).total).toBe(5);
  });

  it("splits records by polarity and leaves untagged ones out", () => {
    expect(aggregateVocMetrics(records).byPolarity).toEqual({
      好评: 1,
      中评: 0,
      差评: 2,
    });
  });

  it("ranks dimensions by frequency", () => {
    expect(aggregateVocMetrics(records).dimensionTop).toEqual([
      { dimension: "维修时间", count: 2 },
      { dimension: "服务态度", count: 1 },
    ]);
  });

  it("counts records per channel", () => {
    expect(aggregateVocMetrics(records).byChannel).toEqual([
      { channel: "电商评价", count: 2 },
      { channel: "APP", count: 2 },
      { channel: "400 客服", count: 1 },
    ]);
  });

  it("reports the negative-and-neutral share of tagged records", () => {
    expect(aggregateVocMetrics(records).negativeShare).toBeCloseTo(2 / 3, 5);
  });

  it("counts closure against tickets actually opened", () => {
    const metrics = aggregateVocMetrics(records);

    expect(metrics.ticketsOpened).toBe(2);
    expect(metrics.ticketsClosed).toBe(1);
    expect(metrics.closureRate).toBeCloseTo(0.5, 5);
  });

  it("averages closure duration in hours over closed tickets only", () => {
    expect(aggregateVocMetrics(records).averageClosureHours).toBeCloseTo(24, 5);
  });

  it("reports tagging coverage and success separately", () => {
    const metrics = aggregateVocMetrics(records);

    expect(metrics.taggingAttempted).toBe(5);
    expect(metrics.taggingSucceeded).toBe(3);
    expect(metrics.taggingFailed).toBe(1);
    expect(metrics.taggingPending).toBe(1);
  });

  it("derives saved hours from a caller-supplied baseline", () => {
    const metrics = aggregateVocMetrics(records, {
      manualMinutesPerRecord: 4,
    });

    expect(metrics.effort).toEqual({
      taggedRecords: 3,
      manualMinutesPerRecord: 4,
      savedHours: 0.2,
    });
  });

  it("omits the effort block when no baseline is supplied", () => {
    expect(aggregateVocMetrics(records).effort).toBeUndefined();
  });

  it("returns zeroed rates for an empty input instead of dividing by zero", () => {
    const metrics = aggregateVocMetrics([]);

    expect(metrics.total).toBe(0);
    expect(metrics.negativeShare).toBe(0);
    expect(metrics.closureRate).toBe(0);
    expect(metrics.averageClosureHours).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/voc/metrics.test.ts`
Expected: FAIL — `Failed to resolve import "./metrics"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/voc/metrics.ts
import type { VocState } from "./service-event";
import type { VocDimension, VocPolarity } from "./triage";

export type VocMetricsInput = Readonly<{
  state: VocState;
  polarity: VocPolarity | null;
  dimensions: readonly VocDimension[];
  channel: string;
  ticketOpenedAt?: string;
  closedAt?: string;
}>;

export type VocMetrics = Readonly<{
  total: number;
  byPolarity: Readonly<Record<VocPolarity, number>>;
  dimensionTop: ReadonlyArray<{ dimension: VocDimension; count: number }>;
  byChannel: ReadonlyArray<{ channel: string; count: number }>;
  negativeShare: number;
  ticketsOpened: number;
  ticketsClosed: number;
  closureRate: number;
  averageClosureHours: number;
  taggingAttempted: number;
  taggingSucceeded: number;
  taggingFailed: number;
  taggingPending: number;
  effort?: Readonly<{
    taggedRecords: number;
    manualMinutesPerRecord: number;
    savedHours: number;
  }>;
}>;

export type VocMetricsOptions = Readonly<{
  manualMinutesPerRecord?: number;
}>;

const TAGGED_STATES: ReadonlySet<VocState> = new Set<VocState>([
  "已分析",
  "无需跟进",
  "待跟进",
  "跟进中",
  "待闭环",
  "已闭环",
]);

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function countBy<T extends string>(
  values: readonly T[],
): ReadonlyArray<{ key: T; count: number }> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export function aggregateVocMetrics(
  records: readonly VocMetricsInput[],
  options: VocMetricsOptions = {},
): VocMetrics {
  const byPolarity: Record<VocPolarity, number> = {
    好评: 0,
    中评: 0,
    差评: 0,
  };
  for (const record of records) {
    if (record.polarity) byPolarity[record.polarity] += 1;
  }

  const taggedCount = records.filter((r) => TAGGED_STATES.has(r.state)).length;
  const opened = records.filter((r) => r.ticketOpenedAt);
  const closed = opened.filter((r) => r.closedAt);

  const closureHours = closed.map((record) => {
    const from = new Date(record.ticketOpenedAt as string).getTime();
    const to = new Date(record.closedAt as string).getTime();
    return (to - from) / 3_600_000;
  });

  const dimensionTop = countBy(
    records.flatMap((record) => [...record.dimensions]),
  ).map(({ key, count }) => ({ dimension: key, count }));

  const byChannel = countBy(records.map((record) => record.channel)).map(
    ({ key, count }) => ({ channel: key, count }),
  );

  const taggedTotal = byPolarity.好评 + byPolarity.中评 + byPolarity.差评;

  const metrics: VocMetrics = {
    total: records.length,
    byPolarity,
    dimensionTop,
    byChannel,
    negativeShare: ratio(byPolarity.差评 + byPolarity.中评, taggedTotal),
    ticketsOpened: opened.length,
    ticketsClosed: closed.length,
    closureRate: ratio(closed.length, opened.length),
    averageClosureHours: ratio(
      closureHours.reduce((sum, hours) => sum + hours, 0),
      closureHours.length,
    ),
    taggingAttempted: records.length,
    taggingSucceeded: taggedCount,
    taggingFailed: records.filter((r) => r.state === "分析失败").length,
    taggingPending: records.filter((r) => r.state === "待分析").length,
  };

  if (options.manualMinutesPerRecord === undefined) {
    return metrics;
  }

  return {
    ...metrics,
    effort: {
      taggedRecords: taggedCount,
      manualMinutesPerRecord: options.manualMinutesPerRecord,
      savedHours: (taggedCount * options.manualMinutesPerRecord) / 60,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/voc/metrics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/voc/metrics.ts src/features/voc/metrics.test.ts
git commit -m "feat: aggregate VOC metrics as a pure function

Every number a reviewer sees has to be reproducible from the records, so
aggregation takes plain input and returns plain output with no IO. The effort
block only appears when the caller supplies a baseline, which keeps an assumed
number from silently presenting itself as measured."
```

---

### Task 5: 打标结果契约

**Files:**
- Create: `src/features/tagging/contracts.ts`
- Test: `src/features/tagging/contracts.test.ts`

**Interfaces:**
- Consumes: `VOC_DIMENSIONS`、`VOC_POLARITIES`、`VocDimension`、`VocPolarity`（Task 3）
- Produces: `VocReply`、`TagResult`、`TagOutcome`、`parseTagPayload(rawOutput: string, requestedIds: readonly string[]): readonly TagOutcome[]`

这是双轨共用的接缝。三条硬规则：**以输入 id 左连接**、**未返回的 id 一律置失败**、**单条失败不污染整批**。大模型在 20 条一批时漏条是常见失败模式，不能默认返回完整。

- [ ] **Step 1: Write the failing test**

```ts
// src/features/tagging/contracts.test.ts
import { describe, expect, it } from "vitest";

import { parseTagPayload } from "./contracts";

function payload(results: unknown): string {
  return JSON.stringify({ results });
}

describe("parseTagPayload", () => {
  const good = {
    id: "rec1",
    sentiment: ["失望"],
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "等待三天无人上门",
    replies: [{ tone: "致歉安抚", text: "非常抱歉" }],
  };

  it("accepts a well formed result", () => {
    const [outcome] = parseTagPayload(payload([good]), ["rec1"]);

    expect(outcome).toEqual({
      kind: "tagged",
      result: {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: ["维修时间"],
        summary: "等待三天无人上门",
        replies: [{ tone: "致歉安抚", text: "非常抱歉" }],
      },
    });
  });

  it("fails every requested id when the payload is not JSON", () => {
    const outcomes = parseTagPayload("not json at all", ["rec1", "rec2"]);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.kind === "failed")).toBe(true);
    expect(outcomes[0]).toMatchObject({
      kind: "failed",
      recordId: "rec1",
      rawOutput: "not json at all",
    });
  });

  it("fails ids the model never returned", () => {
    const outcomes = parseTagPayload(payload([good]), ["rec1", "rec2"]);

    expect(outcomes[0]?.kind).toBe("tagged");
    expect(outcomes[1]).toMatchObject({ kind: "failed", recordId: "rec2" });
    if (outcomes[1]?.kind !== "failed") return;
    expect(outcomes[1].reason).toContain("未返回");
  });

  it("ignores ids that were never requested", () => {
    const outcomes = parseTagPayload(
      payload([good, { ...good, id: "recX" }]),
      ["rec1"],
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe("tagged");
  });

  it("keeps the first entry when an id repeats", () => {
    const outcomes = parseTagPayload(
      payload([good, { ...good, summary: "第二次" }]),
      ["rec1"],
    );

    expect(outcomes).toHaveLength(1);
    if (outcomes[0]?.kind !== "tagged") return;
    expect(outcomes[0].result.summary).toBe("等待三天无人上门");
  });

  it("fails a record whose polarity is outside the enum", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, polarity: "negative" }]),
      ["rec1"],
    );

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
    if (outcomes[0]?.kind !== "failed") return;
    expect(outcomes[0].reason).toContain("polarity");
  });

  it("fails a record whose dimension is outside the enum", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, dimensions: ["物流速度"] }]),
      ["rec1"],
    );

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
  });

  it("fails a record missing its summary", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, summary: "" }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("lets one bad record through without poisoning the batch", () => {
    const outcomes = parseTagPayload(
      payload([good, { ...good, id: "rec2", polarity: "??" }]),
      ["rec1", "rec2"],
    );

    expect(outcomes[0]?.kind).toBe("tagged");
    expect(outcomes[1]?.kind).toBe("failed");
  });

  it("accepts an empty reply list", () => {
    const outcomes = parseTagPayload(
      payload([{ ...good, replies: [] }]),
      ["rec1"],
    );

    expect(outcomes[0]?.kind).toBe("tagged");
  });

  it("fails when results is not an array", () => {
    const outcomes = parseTagPayload(payload("nope"), ["rec1"]);

    expect(outcomes[0]?.kind).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tagging/contracts.test.ts`
Expected: FAIL — `Failed to resolve import "./contracts"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/tagging/contracts.ts
import {
  VOC_DIMENSIONS,
  VOC_POLARITIES,
  type VocDimension,
  type VocPolarity,
} from "../voc/triage";

export type VocReply = Readonly<{ tone: string; text: string }>;

export type TagResult = Readonly<{
  recordId: string;
  sentiment: readonly string[];
  polarity: VocPolarity;
  dimensions: readonly VocDimension[];
  summary: string;
  replies: readonly VocReply[];
}>;

export type TagOutcome =
  | Readonly<{ kind: "tagged"; result: TagResult }>
  | Readonly<{
      kind: "failed";
      recordId: string;
      reason: string;
      rawOutput?: string;
    }>;

const MAX_RAW_OUTPUT = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

function parseReplies(value: unknown): readonly VocReply[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const replies: VocReply[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.tone !== "string" || typeof item.text !== "string") {
      return null;
    }
    replies.push({ tone: item.tone, text: item.text });
  }
  return replies;
}

function validate(entry: Record<string, unknown>, recordId: string): TagOutcome {
  const polarity = entry.polarity;
  if (
    typeof polarity !== "string" ||
    !(VOC_POLARITIES as readonly string[]).includes(polarity)
  ) {
    return {
      kind: "failed",
      recordId,
      reason: `polarity 不在枚举内：${String(polarity)}`,
    };
  }

  const dimensions = stringList(entry.dimensions) ?? null;
  if (!dimensions) {
    return { kind: "failed", recordId, reason: "dimensions 必须是字符串数组" };
  }
  const unknownDimension = dimensions.find(
    (item) => !(VOC_DIMENSIONS as readonly string[]).includes(item),
  );
  if (unknownDimension) {
    return {
      kind: "failed",
      recordId,
      reason: `dimensions 不在枚举内：${unknownDimension}`,
    };
  }

  const sentiment = stringList(entry.sentiment) ?? null;
  if (!sentiment) {
    return { kind: "failed", recordId, reason: "sentiment 必须是字符串数组" };
  }

  if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
    return { kind: "failed", recordId, reason: "summary 不能为空" };
  }

  const replies = parseReplies(entry.replies);
  if (!replies) {
    return { kind: "failed", recordId, reason: "replies 结构不合法" };
  }

  return {
    kind: "tagged",
    result: {
      recordId,
      sentiment,
      polarity: polarity as VocPolarity,
      dimensions: dimensions as readonly VocDimension[],
      summary: entry.summary,
      replies,
    },
  };
}

export function parseTagPayload(
  rawOutput: string,
  requestedIds: readonly string[],
): readonly TagOutcome[] {
  const failAll = (reason: string): readonly TagOutcome[] =>
    requestedIds.map((recordId) => ({
      kind: "failed" as const,
      recordId,
      reason,
      rawOutput: rawOutput.slice(0, MAX_RAW_OUTPUT),
    }));

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return failAll("输出不是合法 JSON");
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    return failAll("输出缺少 results 数组");
  }

  // Left join on the requested ids. Anything the model invented is dropped and
  // anything it skipped is failed, because a short results array is a common
  // large-batch failure mode rather than an implicit success.
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of parsed.results) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }

  return requestedIds.map((recordId) => {
    const entry = byId.get(recordId);
    if (!entry) {
      return { kind: "failed" as const, recordId, reason: "模型未返回该 id" };
    }
    return validate(entry, recordId);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/tagging/contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/tagging/contracts.ts src/features/tagging/contracts.test.ts
git commit -m "feat: validate tagging output against the requested ids

A short results array is a normal large-batch model failure, not an implicit
success, so the parser left joins on the ids it asked for and fails the rest.
One malformed record is isolated instead of discarding the whole batch, and the
raw output is kept on failure so the cause stays diagnosable."
```

---

### Task 6: aily 打标提供方（A 轨）

**Files:**
- Create: `src/features/tagging/aily-provider.ts`
- Test: `src/features/tagging/aily-provider.test.ts`

**Interfaces:**
- Consumes: `parseTagPayload`、`TagOutcome`（Task 5）
- Produces: `AilyTaggingConfig`、`TaggingRequestRecord`、`createAilyTaggingProvider(config, fetcher?)`

官方硬约束，逐条落在代码里：`input` 是 **JSON String** 而非对象；`output` 亦为 JSON String；`data.status` 官方只给出 `success` 一个示例值，**非 `success` 一律按失败处理**，不得假设 status 只有两种取值。

- [ ] **Step 1: Write the failing test**

```ts
// src/features/tagging/aily-provider.test.ts
import { describe, expect, it, vi } from "vitest";

import { createAilyTaggingProvider, type AilyTaggingConfig } from "./aily-provider";
import type { TaggingRequestRecord } from "./provider-types";

const config: AilyTaggingConfig = {
  ailyAppId: "spring_demo__c",
  skillId: "skill_demo",
  tenantAccessToken: async () => "t-token",
};

const records: readonly TaggingRequestRecord[] = [
  {
    recordId: "rec1",
    content: "等了三天没人上门",
    channel: "电商评价",
    category: "冰箱",
    rating: 2,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const successOutput = JSON.stringify({
  results: [
    {
      id: "rec1",
      sentiment: ["失望"],
      polarity: "差评",
      dimensions: ["维修时间"],
      summary: "等待三天无人上门",
      replies: [{ tone: "致歉安抚", text: "非常抱歉" }],
    },
  ],
});

describe("createAilyTaggingProvider", () => {
  it("posts to the skill start endpoint with a bearer token", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, msg: "ok", data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    await provider.tag(records);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/aily/v1/apps/spring_demo__c/skills/skill_demo/start",
    );
    expect(init?.method).toBe("POST");
    expect(
      (init?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer t-token");
  });

  it("serialises input as a JSON string rather than a nested object", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    await provider.tag(records);

    const [, init] = fetcher.mock.calls[0];
    const body = JSON.parse(init?.body as string) as { input: unknown };

    expect(typeof body.input).toBe("string");
    expect(JSON.parse(body.input as string)).toEqual({
      records: [
        {
          id: "rec1",
          content: "等了三天没人上门",
          channel: "电商评价",
          category: "冰箱",
          rating: 2,
        },
      ],
    });
  });

  it("reports the provider name", () => {
    const provider = createAilyTaggingProvider(config);
    expect(provider.name).toBe("aily");
  });

  it("returns tagged outcomes on success", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "success" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]?.kind).toBe("tagged");
  });

  it("fails the batch on a non-zero business code", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ code: 2700001, msg: "invalid param", data: {} }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
    if (outcomes[0]?.kind !== "failed") return;
    expect(outcomes[0].reason).toContain("2700001");
  });

  it("fails the batch when status is anything other than success", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ code: 0, data: { output: successOutput, status: "running" } }),
    );

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("fails the batch on a transport error", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("fails the batch on a non-ok HTTP status", async () => {
    const fetcher = vi.fn(async () => jsonResponse({}, 500));

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    const outcomes = await provider.tag(records);

    expect(outcomes[0]?.kind).toBe("failed");
  });

  it("returns no outcomes for an empty batch and makes no call", async () => {
    const fetcher = vi.fn();

    const provider = createAilyTaggingProvider(config, fetcher as unknown as typeof fetch);
    expect(await provider.tag([])).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tagging/aily-provider.test.ts`
Expected: FAIL — 无法解析 `./aily-provider` 与 `./provider-types`

- [ ] **Step 3: Write minimal implementation**

先建共享类型，再建提供方。

```ts
// src/features/tagging/provider-types.ts
import type { TagOutcome } from "./contracts";

export type TaggingRequestRecord = Readonly<{
  recordId: string;
  content: string;
  channel: string;
  category: string;
  rating?: number;
}>;

export type TaggingProvider = Readonly<{
  name: "aily" | "field-shortcut";
  tag(records: readonly TaggingRequestRecord[]): Promise<readonly TagOutcome[]>;
}>;
```

```ts
// src/features/tagging/aily-provider.ts
import { parseTagPayload, type TagOutcome } from "./contracts";
import type { TaggingProvider, TaggingRequestRecord } from "./provider-types";

const SKILL_START_URL =
  "https://open.feishu.cn/open-apis/aily/v1/apps/:app_id/skills/:skill_id/start";

export const TAGGING_TIMEOUT_MS = 25_000;

export type AilyTaggingConfig = Readonly<{
  ailyAppId: string;
  skillId: string;
  tenantAccessToken: () => Promise<string>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAilyTaggingProvider(
  config: AilyTaggingConfig,
  fetcher: typeof fetch = fetch,
): TaggingProvider {
  return {
    name: "aily",
    async tag(records) {
      if (records.length === 0) return [];

      const requestedIds = records.map((record) => record.recordId);
      const failAll = (reason: string): readonly TagOutcome[] =>
        requestedIds.map((recordId) => ({ kind: "failed", recordId, reason }));

      const url = SKILL_START_URL.replace(":app_id", config.ailyAppId).replace(
        ":skill_id",
        config.skillId,
      );

      // The official contract takes `input` as a JSON String, not a nested
      // object; sending an object silently produces an empty skill input.
      const input = JSON.stringify({
        records: records.map((record) => ({
          id: record.recordId,
          content: record.content,
          channel: record.channel,
          category: record.category,
          ...(record.rating === undefined ? {} : { rating: record.rating }),
        })),
      });

      try {
        const token = await config.tenantAccessToken();
        const response = await fetcher(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({ input }),
          signal: AbortSignal.timeout(TAGGING_TIMEOUT_MS),
        });

        if (!response.ok) {
          return failAll(`aily HTTP ${response.status}`);
        }

        const payload: unknown = await response.json();
        if (!isRecord(payload) || payload.code !== 0) {
          const code = isRecord(payload) ? String(payload.code) : "unknown";
          return failAll(`aily 业务错误码 ${code}`);
        }

        const data = payload.data;
        if (!isRecord(data) || typeof data.output !== "string") {
          return failAll("aily 响应缺少 data.output");
        }

        // Only `success` is documented; every other value is treated as a
        // failure rather than guessed at.
        if (data.status !== "success") {
          return failAll(`aily status 非 success：${String(data.status)}`);
        }

        return parseTagPayload(data.output, requestedIds);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "aily 调用失败";
        return failAll(reason);
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/tagging/aily-provider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/tagging/provider-types.ts src/features/tagging/aily-provider.ts src/features/tagging/aily-provider.test.ts
git commit -m "feat: call aily skills for VOC tagging

Two details in the official contract are easy to get wrong and silent when you
do: input is a JSON String rather than a nested object, and success is the only
documented status value. Anything else is treated as a failed batch instead of
being guessed at, and the batch fails as a unit so the shard can be retaken."
```

---

### Task 7: 字段捷径提供方（B 轨）与提供方选择

**Files:**
- Create: `src/features/tagging/field-shortcut-provider.ts`
- Create: `src/features/tagging/provider.ts`
- Test: `src/features/tagging/field-shortcut-provider.test.ts`
- Test: `src/features/tagging/provider.test.ts`

**Interfaces:**
- Consumes: `TagOutcome`（Task 5）、`TaggingProvider` / `TaggingRequestRecord`（Task 6）
- Produces: `FieldShortcutSource`、`createFieldShortcutTaggingProvider(source)`、`selectTaggingProvider(options)`

B 轨里 AI 结果已经是普通字段值，仓库侧只**读**。两轨必须填满同一份 `TagResult`（含 `replies`），否则 triage 与卡片渲染会出现轨道差异——这正是抽象要防的事。

- [ ] **Step 1: Write the failing test**

```ts
// src/features/tagging/field-shortcut-provider.test.ts
import { describe, expect, it, vi } from "vitest";

import { createFieldShortcutTaggingProvider } from "./field-shortcut-provider";
import type { TaggingRequestRecord } from "./provider-types";

const records: readonly TaggingRequestRecord[] = [
  { recordId: "rec1", content: "太慢了", channel: "APP", category: "空调" },
  { recordId: "rec2", content: "很好", channel: "APP", category: "空调" },
];

describe("createFieldShortcutTaggingProvider", () => {
  it("reads AI values already written by the Base and maps them to TagResult", async () => {
    const read = vi.fn(async () => [
      {
        recordId: "rec1",
        sentiment: ["着急"],
        polarity: "差评",
        dimensions: ["维修时间"],
        summary: "上门太慢",
        replies: [{ tone: "致歉安抚", text: "抱歉" }],
      },
      {
        recordId: "rec2",
        sentiment: ["开心"],
        polarity: "好评",
        dimensions: [],
        summary: "服务满意",
        replies: [],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag(records);

    expect(provider.name).toBe("field-shortcut");
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.kind).toBe("tagged");
    expect(outcomes[1]?.kind).toBe("tagged");
    expect(read).toHaveBeenCalledWith(["rec1", "rec2"]);
  });

  it("fails a record whose AI fields have not been filled yet", async () => {
    const read = vi.fn(async () => [
      {
        recordId: "rec1",
        sentiment: [],
        polarity: "",
        dimensions: [],
        summary: "",
        replies: [],
      },
    ]);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag([records[0]]);

    expect(outcomes[0]).toMatchObject({ kind: "failed", recordId: "rec1" });
  });

  it("fails ids the Base did not return", async () => {
    const read = vi.fn(async () => []);

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag(records);

    expect(outcomes.every((o) => o.kind === "failed")).toBe(true);
  });

  it("fails the batch when the Base read throws", async () => {
    const read = vi.fn(async () => {
      throw new Error("bitable down");
    });

    const provider = createFieldShortcutTaggingProvider({ read });
    const outcomes = await provider.tag(records);

    expect(outcomes[0]).toMatchObject({ kind: "failed" });
  });

  it("returns no outcomes for an empty batch", async () => {
    const read = vi.fn();
    const provider = createFieldShortcutTaggingProvider({ read });

    expect(await provider.tag([])).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
```

```ts
// src/features/tagging/provider.test.ts
import { describe, expect, it, vi } from "vitest";

import { selectTaggingProvider } from "./provider";

describe("selectTaggingProvider", () => {
  const deps = {
    createAily: vi.fn(() => ({ name: "aily" as const, tag: async () => [] })),
    createFieldShortcut: vi.fn(() => ({
      name: "field-shortcut" as const,
      tag: async () => [],
    })),
  };

  it("returns the aily provider when configured for aily", () => {
    const provider = selectTaggingProvider("aily", deps);
    expect(provider.name).toBe("aily");
  });

  it("returns the field shortcut provider when configured for it", () => {
    const provider = selectTaggingProvider("field-shortcut", deps);
    expect(provider.name).toBe("field-shortcut");
  });

  it("rejects an unknown provider name instead of defaulting", () => {
    expect(() =>
      selectTaggingProvider("magic" as unknown as "aily", deps),
    ).toThrow(/TAGGING_PROVIDER/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tagging/field-shortcut-provider.test.ts src/features/tagging/provider.test.ts`
Expected: FAIL — 两个模块都无法解析

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/tagging/field-shortcut-provider.ts
import { parseTagPayload, type TagOutcome } from "./contracts";
import type { TaggingProvider } from "./provider-types";

export type FieldShortcutRow = Readonly<{
  recordId: string;
  sentiment: readonly string[];
  polarity: string;
  dimensions: readonly string[];
  summary: string;
  replies: ReadonlyArray<{ tone: string; text: string }>;
}>;

export type FieldShortcutSource = Readonly<{
  read(recordIds: readonly string[]): Promise<readonly FieldShortcutRow[]>;
}>;

export function createFieldShortcutTaggingProvider(
  source: FieldShortcutSource,
): TaggingProvider {
  return {
    name: "field-shortcut",
    async tag(records) {
      if (records.length === 0) return [];

      const requestedIds = records.map((record) => record.recordId);

      try {
        const rows = await source.read(requestedIds);
        // Reuse the same validator as the aily track so both tracks are held to
        // one contract; a half-filled shortcut column must fail here rather
        // than reach triage as a blank polarity.
        return parseTagPayload(
          JSON.stringify({
            results: rows.map((row) => ({
              id: row.recordId,
              sentiment: row.sentiment,
              polarity: row.polarity,
              dimensions: row.dimensions,
              summary: row.summary,
              replies: row.replies,
            })),
          }),
          requestedIds,
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "读取字段捷径结果失败";
        return requestedIds.map(
          (recordId): TagOutcome => ({ kind: "failed", recordId, reason }),
        );
      }
    },
  };
}
```

```ts
// src/features/tagging/provider.ts
import type { TaggingProvider } from "./provider-types";

export type TaggingProviderName = TaggingProvider["name"];

export type TaggingProviderFactories = Readonly<{
  createAily: () => TaggingProvider;
  createFieldShortcut: () => TaggingProvider;
}>;

export function selectTaggingProvider(
  name: TaggingProviderName,
  factories: TaggingProviderFactories,
): TaggingProvider {
  switch (name) {
    case "aily":
      return factories.createAily();
    case "field-shortcut":
      return factories.createFieldShortcut();
    default: {
      const unreachable: never = name;
      throw new Error(
        `Unsupported TAGGING_PROVIDER: ${String(unreachable)}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/tagging/`
Expected: PASS，三个测试文件全绿

- [ ] **Step 5: Commit**

```bash
git add src/features/tagging/field-shortcut-provider.ts src/features/tagging/provider.ts src/features/tagging/field-shortcut-provider.test.ts src/features/tagging/provider.test.ts
git commit -m "feat: add field shortcut tagging track behind the same contract

aily's custom model sits behind a paid tier, so the Base AI field shortcut is
kept as an equal track rather than a rewrite. Both run through one validator,
which is what stops a half-filled shortcut column from reaching triage as a
blank polarity. An unknown provider name throws instead of defaulting, because
silently tagging with the wrong track is worse than failing to start."
```

---

### Task 8: 环境变量与字段映射

**Files:**
- Modify: `src/lib/env.ts`
- Create: `src/features/bitable/field-map.ts`
- Test: `src/lib/env.test.ts`（若不存在则创建）
- Test: `src/features/bitable/field-map.test.ts`

**Interfaces:**
- Consumes: `VocState`（Task 2）、`VocPolarity` / `VocDimension` / `VocSeverity`（Task 3）、`TagResult`（Task 5）
- Produces: `BitableEnv`、`readBitableEnv(source?)`、`TaggingEnv`、`readTaggingEnv(source?)`、`VOC_FIELD_NAMES`、`toVocRecord(fields, recordId)`、`toTagFieldUpdate(result, severity)`

**先决条件**：两张 Base 表已建好、应用已加为协作者、`app_token` 与 `table_id` 已拿到。

- [ ] **Step 1: 用真实 Base 确认响应结构**

在写映射前，先拿真实响应对齐字段类型。多选字段返回数组、单选返回字符串、人员字段返回对象数组——这三者猜错会导致静默写空。

```bash
TOKEN=$(curl -s -X POST 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
  -H 'Content-Type: application/json' \
  -d '{"app_id":"'"$FEISHU_APP_ID"'","app_secret":"'"$FEISHU_APP_SECRET"'"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["tenant_access_token"])')

curl -s "https://open.feishu.cn/open-apis/bitable/v1/apps/$FEISHU_BITABLE_APP_TOKEN/tables/$FEISHU_BITABLE_TABLE_VOC/records?page_size=1&user_id_type=open_id" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

把真实的 `fields` 结构记录到本任务下，并据此确定 `toVocRecord` 的解包方式。若某字段类型与本计划假设不符，改 `field-map.ts` 与其测试即可，不影响 Task 1–7。

- [ ] **Step 2: Write the failing test**

```ts
// src/features/bitable/field-map.test.ts
import { describe, expect, it } from "vitest";

import { VOC_FIELD_NAMES, toTagFieldUpdate, toVocRecord } from "./field-map";

describe("toVocRecord", () => {
  it("unpacks single select, multi select and person fields", () => {
    const record = toVocRecord(
      {
        [VOC_FIELD_NAMES.channel]: "电商评价",
        [VOC_FIELD_NAMES.category]: "冰箱",
        [VOC_FIELD_NAMES.content]: "等了三天",
        [VOC_FIELD_NAMES.state]: "待跟进",
        [VOC_FIELD_NAMES.polarity]: "差评",
        [VOC_FIELD_NAMES.dimensions]: ["维修时间", "服务态度"],
        [VOC_FIELD_NAMES.owner]: [{ open_id: "ou_owner" }],
        [VOC_FIELD_NAMES.retryCount]: 1,
      },
      "rec1",
    );

    expect(record).toMatchObject({
      recordId: "rec1",
      channel: "电商评价",
      category: "冰箱",
      content: "等了三天",
      state: "待跟进",
      polarity: "差评",
      dimensions: ["维修时间", "服务态度"],
      ownerOpenIds: ["ou_owner"],
      retryCount: 1,
    });
  });

  it("defaults an unset state to 待分析 so untouched rows are pickable", () => {
    expect(toVocRecord({}, "rec1").state).toBe("待分析");
  });

  it("treats an unrecognised state as 待分析 rather than crashing", () => {
    expect(
      toVocRecord({ [VOC_FIELD_NAMES.state]: "手工乱填" }, "rec1").state,
    ).toBe("待分析");
  });

  it("nulls a polarity that is not in the enum", () => {
    expect(
      toVocRecord({ [VOC_FIELD_NAMES.polarity]: "negative" }, "rec1").polarity,
    ).toBeNull();
  });

  it("drops dimensions outside the enum instead of passing them through", () => {
    expect(
      toVocRecord(
        { [VOC_FIELD_NAMES.dimensions]: ["维修时间", "物流速度"] },
        "rec1",
      ).dimensions,
    ).toEqual(["维修时间"]);
  });

  it("defaults retry count to zero", () => {
    expect(toVocRecord({}, "rec1").retryCount).toBe(0);
  });
});

describe("toTagFieldUpdate", () => {
  it("writes AI columns plus the repo-computed severity", () => {
    const update = toTagFieldUpdate(
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: ["维修时间"],
        summary: "等待三天",
        replies: [{ tone: "致歉安抚", text: "抱歉" }],
      },
      "高",
    );

    expect(update[VOC_FIELD_NAMES.polarity]).toBe("差评");
    expect(update[VOC_FIELD_NAMES.dimensions]).toEqual(["维修时间"]);
    expect(update[VOC_FIELD_NAMES.sentiment]).toEqual(["失望"]);
    expect(update[VOC_FIELD_NAMES.summary]).toBe("等待三天");
    expect(update[VOC_FIELD_NAMES.severity]).toBe("高");
    expect(update[VOC_FIELD_NAMES.replies]).toContain("致歉安抚");
  });
});
```

```ts
// src/lib/env.test.ts （追加，若文件已存在则并入）
import { describe, expect, it } from "vitest";

import { readBitableEnv, readTaggingEnv } from "./env";

const bitable = {
  FEISHU_BITABLE_APP_TOKEN: "bascn_demo",
  FEISHU_BITABLE_TABLE_VOC: "tblvoc",
  FEISHU_BITABLE_TABLE_OWNER: "tblowner",
};

describe("readBitableEnv", () => {
  it("reads all three identifiers", () => {
    expect(readBitableEnv(bitable)).toEqual({
      appToken: "bascn_demo",
      vocTableId: "tblvoc",
      ownerTableId: "tblowner",
    });
  });

  it.each(Object.keys(bitable))("throws when %s is missing", (key) => {
    const source = { ...bitable, [key]: "" };
    expect(() => readBitableEnv(source)).toThrow(new RegExp(key));
  });
});

describe("readTaggingEnv", () => {
  it("reads the field shortcut track without aily identifiers", () => {
    expect(readTaggingEnv({ TAGGING_PROVIDER: "field-shortcut" })).toEqual({
      provider: "field-shortcut",
    });
  });

  it("requires aily identifiers on the aily track", () => {
    expect(() => readTaggingEnv({ TAGGING_PROVIDER: "aily" })).toThrow(
      /FEISHU_AILY_APP_ID/,
    );
  });

  it("reads the aily track when fully configured", () => {
    expect(
      readTaggingEnv({
        TAGGING_PROVIDER: "aily",
        FEISHU_AILY_APP_ID: "spring_demo__c",
        FEISHU_AILY_SKILL_TAGGING: "skill_demo",
      }),
    ).toEqual({
      provider: "aily",
      ailyAppId: "spring_demo__c",
      taggingSkillId: "skill_demo",
    });
  });

  it("rejects an unknown provider name", () => {
    expect(() => readTaggingEnv({ TAGGING_PROVIDER: "magic" })).toThrow(
      /TAGGING_PROVIDER/,
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/features/bitable/field-map.test.ts src/lib/env.test.ts`
Expected: FAIL — 缺少 `readBitableEnv`、`readTaggingEnv`、`./field-map`

- [ ] **Step 4: Write minimal implementation**

`src/lib/env.ts` 追加（保留现有 `readAuthEnv` / `readBotEnv` 不变，并把新变量名加入 `ServerEnvironmentName` 联合类型）：

```ts
export type BitableEnv = {
  appToken: string;
  vocTableId: string;
  ownerTableId: string;
};

export type TaggingEnv =
  | { provider: "field-shortcut" }
  | { provider: "aily"; ailyAppId: string; taggingSkillId: string };

export function readBitableEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): BitableEnv {
  return {
    appToken: readRequired(source, "FEISHU_BITABLE_APP_TOKEN"),
    vocTableId: readRequired(source, "FEISHU_BITABLE_TABLE_VOC"),
    ownerTableId: readRequired(source, "FEISHU_BITABLE_TABLE_OWNER"),
  };
}

export function readTaggingEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): TaggingEnv {
  const provider = source.TAGGING_PROVIDER?.trim();

  if (provider === "field-shortcut") {
    return { provider: "field-shortcut" };
  }

  if (provider === "aily") {
    return {
      provider: "aily",
      ailyAppId: readRequired(source, "FEISHU_AILY_APP_ID"),
      taggingSkillId: readRequired(source, "FEISHU_AILY_SKILL_TAGGING"),
    };
  }

  throw new Error(
    `Invalid server environment variable: TAGGING_PROVIDER (${String(provider)})`,
  );
}
```

```ts
// src/features/bitable/field-map.ts
import { VOC_STATES, type VocState } from "../voc/service-event";
import {
  VOC_DIMENSIONS,
  VOC_POLARITIES,
  type VocDimension,
  type VocPolarity,
  type VocSeverity,
} from "../voc/triage";
import type { TagResult } from "../tagging/contracts";

// Operations staff can rename Base columns at will, so every field name lives
// here and nowhere else. Renaming one column then means editing one file.
export const VOC_FIELD_NAMES = {
  feedbackAt: "反馈时间",
  channel: "渠道",
  category: "产品品类",
  model: "机型",
  content: "原始内容",
  rating: "原始评分",
  userRef: "用户标识",
  sentiment: "情绪标签",
  polarity: "情绪极性",
  dimensions: "问题维度",
  summary: "AI 摘要",
  replies: "AI 回复话术",
  severity: "严重度",
  tagSource: "打标来源",
  failureReason: "失败原因",
  rawOutput: "原始输出",
  retryCount: "重试次数",
  state: "流程状态",
  owner: "负责人",
  ticketOpenedAt: "建单时间",
  followUpNote: "跟进记录",
  closedAt: "闭环时间",
  closingNote: "闭环结论",
} as const;

export type BitableFields = Record<string, unknown>;

export type VocRecord = Readonly<{
  recordId: string;
  channel: string;
  category: string;
  content: string;
  rating: number | null;
  state: VocState;
  polarity: VocPolarity | null;
  dimensions: readonly VocDimension[];
  ownerOpenIds: readonly string[];
  retryCount: number;
  ticketOpenedAt: string | null;
  closedAt: string | null;
}>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function openIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "object" &&
    item !== null &&
    typeof (item as { open_id?: unknown }).open_id === "string"
      ? [(item as { open_id: string }).open_id]
      : [],
  );
}

export function toVocRecord(
  fields: BitableFields,
  recordId: string,
): VocRecord {
  const rawState = text(fields[VOC_FIELD_NAMES.state]);
  const state = (VOC_STATES as readonly string[]).includes(rawState)
    ? (rawState as VocState)
    : "待分析";

  const rawPolarity = text(fields[VOC_FIELD_NAMES.polarity]);
  const polarity = (VOC_POLARITIES as readonly string[]).includes(rawPolarity)
    ? (rawPolarity as VocPolarity)
    : null;

  const dimensions = stringArray(fields[VOC_FIELD_NAMES.dimensions]).filter(
    (item): item is VocDimension =>
      (VOC_DIMENSIONS as readonly string[]).includes(item),
  );

  return {
    recordId,
    channel: text(fields[VOC_FIELD_NAMES.channel]),
    category: text(fields[VOC_FIELD_NAMES.category]),
    content: text(fields[VOC_FIELD_NAMES.content]),
    rating: numberOrNull(fields[VOC_FIELD_NAMES.rating]),
    state,
    polarity,
    dimensions,
    ownerOpenIds: openIds(fields[VOC_FIELD_NAMES.owner]),
    retryCount: numberOrNull(fields[VOC_FIELD_NAMES.retryCount]) ?? 0,
    ticketOpenedAt: text(fields[VOC_FIELD_NAMES.ticketOpenedAt]) || null,
    closedAt: text(fields[VOC_FIELD_NAMES.closedAt]) || null,
  };
}

export function toTagFieldUpdate(
  result: TagResult,
  severity: VocSeverity,
): BitableFields {
  return {
    [VOC_FIELD_NAMES.sentiment]: [...result.sentiment],
    [VOC_FIELD_NAMES.polarity]: result.polarity,
    [VOC_FIELD_NAMES.dimensions]: [...result.dimensions],
    [VOC_FIELD_NAMES.summary]: result.summary,
    [VOC_FIELD_NAMES.replies]: result.replies
      .map((reply) => `【${reply.tone}】${reply.text}`)
      .join("\n\n"),
    [VOC_FIELD_NAMES.severity]: severity,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/bitable/field-map.test.ts src/lib/env.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/env.ts src/lib/env.test.ts src/features/bitable/field-map.ts src/features/bitable/field-map.test.ts
git commit -m "feat: map Base columns in one place and read new config

Column names are operations-owned and can change without warning, so the
mapping is deliberately confined to a single file. Unknown states fall back to
待分析 and out-of-enum values are dropped rather than propagated, because a
stray hand-typed cell should not be able to drive the state machine."
```

---

### Task 9: 多维表格客户端与字段自检

**Files:**
- Create: `src/features/bitable/client.ts`
- Create: `src/features/bitable/schema-guard.ts`
- Test: `src/features/bitable/client.test.ts`
- Test: `src/features/bitable/schema-guard.test.ts`

**Interfaces:**
- Consumes: `BitableEnv`（Task 8）、`VOC_FIELD_NAMES` / `BitableFields` / `VocRecord` / `toVocRecord`（Task 8）
- Produces: `createTenantTokenProvider(appId, appSecret, fetcher?)`、`BitableClient`、`createBitableClient(env, token, fetcher?)`（含 `getRecord`、`listRecords`、`updateRecord`）、`assertVocSchema(client)`

三条不可省的细节：**显式 `user_id_type=open_id`**（否则返回的 id 类型可能与 `event.operator.open_id` 不同型，表现为永远匹配不上）、**token 模块级缓存**（3 秒回调预算内不能每次换 token）、**10s 超时**。

- [ ] **Step 1: Write the failing test**

```ts
// src/features/bitable/client.test.ts
import { describe, expect, it, vi } from "vitest";

import { createBitableClient, createTenantTokenProvider } from "./client";
import { VOC_FIELD_NAMES } from "./field-map";

const env = {
  appToken: "bascn_demo",
  vocTableId: "tblvoc",
  ownerTableId: "tblowner",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createTenantTokenProvider", () => {
  it("fetches once and reuses the cached token", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ code: 0, tenant_access_token: "t1", expire: 7200 }),
    );

    const provider = createTenantTokenProvider(
      "cli_x",
      "secret",
      fetcher as unknown as typeof fetch,
    );

    expect(await provider()).toBe("t1");
    expect(await provider()).toBe("t1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("throws on a non-zero business code", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 99991663 }));

    const provider = createTenantTokenProvider(
      "cli_x",
      "secret",
      fetcher as unknown as typeof fetch,
    );

    await expect(provider()).rejects.toThrow(/tenant_access_token/);
  });
});

describe("createBitableClient", () => {
  const token = async () => "t1";

  it("requests a single record with open_id typed people fields", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        code: 0,
        data: {
          record: {
            record_id: "rec1",
            fields: { [VOC_FIELD_NAMES.channel]: "APP" },
          },
        },
      }),
    );

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);
    const record = await client.getRecord("rec1");

    const [url] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/bitable/v1/apps/bascn_demo/tables/tblvoc/records/rec1?user_id_type=open_id",
    );
    expect(record?.recordId).toBe("rec1");
    expect(record?.channel).toBe("APP");
  });

  it("returns null when the record is gone", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 1254043, msg: "not found" }));

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);
    expect(await client.getRecord("recGone")).toBeNull();
  });

  it("pages through list results until the page token runs out", async () => {
    const fetcher = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            has_more: true,
            page_token: "p2",
            items: [{ record_id: "rec1", fields: {} }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: { has_more: false, items: [{ record_id: "rec2", fields: {} }] },
        }),
      );

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);
    const records = await client.listRecords({ pageSize: 1 });

    expect(records.map((r) => r.recordId)).toEqual(["rec1", "rec2"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain("page_token=p2");
  });

  it("stops paging at the configured limit", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          has_more: true,
          page_token: "next",
          items: [{ record_id: "rec1", fields: {} }],
        },
      }),
    );

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);
    await client.listRecords({ pageSize: 1, maxPages: 3 });

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("sends a PUT with open_id typing when updating", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: {} }),
    );

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);
    await client.updateRecord("rec1", { [VOC_FIELD_NAMES.state]: "跟进中" });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toContain("/records/rec1?user_id_type=open_id");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({
      fields: { [VOC_FIELD_NAMES.state]: "跟进中" },
    });
  });

  it("throws when an update is rejected", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 1254005, msg: "field error" }));

    const client = createBitableClient(env, token, fetcher as unknown as typeof fetch);

    await expect(
      client.updateRecord("rec1", { bad: 1 }),
    ).rejects.toThrow(/1254005/);
  });
});
```

```ts
// src/features/bitable/schema-guard.test.ts
import { describe, expect, it, vi } from "vitest";

import { assertVocSchema } from "./schema-guard";
import { VOC_FIELD_NAMES } from "./field-map";

describe("assertVocSchema", () => {
  it("passes when every mapped field exists", async () => {
    const listFieldNames = vi.fn(async () => Object.values(VOC_FIELD_NAMES));

    await expect(assertVocSchema({ listFieldNames })).resolves.toBeUndefined();
  });

  it("names the missing fields instead of failing vaguely", async () => {
    const listFieldNames = vi.fn(async () =>
      Object.values(VOC_FIELD_NAMES).filter(
        (name) => name !== VOC_FIELD_NAMES.state,
      ),
    );

    await expect(assertVocSchema({ listFieldNames })).rejects.toThrow(
      new RegExp(VOC_FIELD_NAMES.state),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/bitable/`
Expected: FAIL — 无法解析 `./client` 与 `./schema-guard`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/bitable/client.ts
import type { BitableEnv } from "../../lib/env";
import { toVocRecord, type BitableFields, type VocRecord } from "./field-map";

const BASE_URL = "https://open.feishu.cn/open-apis";
const TOKEN_URL = `${BASE_URL}/auth/v3/tenant_access_token/internal`;
export const BITABLE_TIMEOUT_MS = 10_000;
const TOKEN_SAFETY_WINDOW_MS = 60_000;
const DEFAULT_MAX_PAGES = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type TenantTokenProvider = () => Promise<string>;

export function createTenantTokenProvider(
  appId: string,
  appSecret: string,
  fetcher: typeof fetch = fetch,
): TenantTokenProvider {
  // Cached at module scope by the caller: a card callback has a three second
  // budget and cannot afford a token exchange on every click.
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(BITABLE_TIMEOUT_MS),
    });

    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      payload.code !== 0 ||
      typeof payload.tenant_access_token !== "string"
    ) {
      const code = isRecord(payload) ? String(payload.code) : "unknown";
      throw new Error(`Failed to obtain tenant_access_token (code ${code})`);
    }

    const expire = typeof payload.expire === "number" ? payload.expire : 7200;
    cached = {
      token: payload.tenant_access_token,
      expiresAt: Date.now() + expire * 1000 - TOKEN_SAFETY_WINDOW_MS,
    };
    return cached.token;
  };
}

export type ListRecordsOptions = Readonly<{
  pageSize?: number;
  filter?: string;
  maxPages?: number;
}>;

export type BitableClient = Readonly<{
  getRecord(recordId: string): Promise<VocRecord | null>;
  listRecords(options?: ListRecordsOptions): Promise<readonly VocRecord[]>;
  updateRecord(recordId: string, fields: BitableFields): Promise<void>;
  listFieldNames(): Promise<readonly string[]>;
}>;

export function createBitableClient(
  env: BitableEnv,
  token: TenantTokenProvider,
  fetcher: typeof fetch = fetch,
): BitableClient {
  const recordsUrl = `${BASE_URL}/bitable/v1/apps/${env.appToken}/tables/${env.vocTableId}/records`;

  async function call(
    url: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const response = await fetcher(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json; charset=utf-8",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(BITABLE_TIMEOUT_MS),
    });

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      throw new Error("Bitable returned a non-object payload");
    }
    return payload;
  }

  function itemsToRecords(items: unknown): readonly VocRecord[] {
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      if (!isRecord(item) || typeof item.record_id !== "string") return [];
      const fields = isRecord(item.fields) ? item.fields : {};
      return [toVocRecord(fields, item.record_id)];
    });
  }

  return {
    async getRecord(recordId) {
      // user_id_type is explicit on purpose: without it, people fields may come
      // back in an id type that never matches event.operator.open_id, which
      // shows up as "authorized owner is always rejected".
      const payload = await call(
        `${recordsUrl}/${recordId}?user_id_type=open_id`,
      );

      if (payload.code !== 0) return null;

      const data = isRecord(payload.data) ? payload.data : {};
      const record = isRecord(data.record) ? data.record : null;
      if (!record || typeof record.record_id !== "string") return null;

      const fields = isRecord(record.fields) ? record.fields : {};
      return toVocRecord(fields, record.record_id);
    },

    async listRecords(options = {}) {
      const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
      const collected: VocRecord[] = [];
      let pageToken: string | undefined;

      for (let page = 0; page < maxPages; page += 1) {
        const params = new URLSearchParams({ user_id_type: "open_id" });
        if (options.pageSize) params.set("page_size", String(options.pageSize));
        if (options.filter) params.set("filter", options.filter);
        if (pageToken) params.set("page_token", pageToken);

        const payload = await call(`${recordsUrl}?${params.toString()}`);
        if (payload.code !== 0) {
          throw new Error(`Bitable list failed (code ${String(payload.code)})`);
        }

        const data = isRecord(payload.data) ? payload.data : {};
        collected.push(...itemsToRecords(data.items));

        if (data.has_more !== true || typeof data.page_token !== "string") {
          break;
        }
        pageToken = data.page_token;
      }

      return collected;
    },

    async updateRecord(recordId, fields) {
      const payload = await call(
        `${recordsUrl}/${recordId}?user_id_type=open_id`,
        { method: "PUT", body: JSON.stringify({ fields }) },
      );

      if (payload.code !== 0) {
        throw new Error(
          `Bitable update failed (code ${String(payload.code)})`,
        );
      }
    },

    async listFieldNames() {
      const payload = await call(
        `${BASE_URL}/bitable/v1/apps/${env.appToken}/tables/${env.vocTableId}/fields?page_size=200`,
      );

      if (payload.code !== 0) {
        throw new Error(`Bitable fields failed (code ${String(payload.code)})`);
      }

      const data = isRecord(payload.data) ? payload.data : {};
      if (!Array.isArray(data.items)) return [];
      return data.items.flatMap((item) =>
        isRecord(item) && typeof item.field_name === "string"
          ? [item.field_name]
          : [],
      );
    },
  };
}
```

```ts
// src/features/bitable/schema-guard.ts
import { VOC_FIELD_NAMES } from "./field-map";

export type SchemaSource = Readonly<{
  listFieldNames(): Promise<readonly string[]>;
}>;

export async function assertVocSchema(source: SchemaSource): Promise<void> {
  const present = new Set(await source.listFieldNames());
  const missing = Object.values(VOC_FIELD_NAMES).filter(
    (name) => !present.has(name),
  );

  if (missing.length > 0) {
    // A renamed column otherwise fails silently by writing into nothing, which
    // is far worse than refusing to start.
    throw new Error(`多维表格缺少字段：${missing.join("、")}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/bitable/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/bitable/client.ts src/features/bitable/client.test.ts src/features/bitable/schema-guard.ts src/features/bitable/schema-guard.test.ts
git commit -m "feat: add Bitable client with explicit open_id typing and token cache

Leaving user_id_type unset returns people fields in an id type that never
matches event.operator.open_id, so an authorized owner looks unauthorized. The
token is cached because a card callback has three seconds and cannot spend them
exchanging credentials. Schema drift refuses to start rather than writing into
a column that no longer exists."
```

---

### Task 10: 工单路由与负责人解析

**Files:**
- Create: `src/features/voc/assignment.ts`
- Test: `src/features/voc/assignment.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `OwnerRule`、`resolveOwner(rules, input)`

兜底是必需项而非可选：路由未命中若静默丢弃，工单会消失，闭环率随之失真。

- [ ] **Step 1: Write the failing test**

```ts
// src/features/voc/assignment.test.ts
import { describe, expect, it } from "vitest";

import { resolveOwner, type OwnerRule } from "./assignment";

const rules: readonly OwnerRule[] = [
  { scope: "电商评价/冰箱", openId: "ou_fridge", fallback: false },
  { scope: "电商评价", openId: "ou_ecom", fallback: false },
  { scope: "", openId: "ou_backstop", fallback: true },
];

describe("resolveOwner", () => {
  it("prefers the most specific channel and category match", () => {
    expect(
      resolveOwner(rules, { channel: "电商评价", category: "冰箱" }),
    ).toEqual({ openId: "ou_fridge", viaFallback: false });
  });

  it("falls back to a channel-only rule", () => {
    expect(
      resolveOwner(rules, { channel: "电商评价", category: "空调" }),
    ).toEqual({ openId: "ou_ecom", viaFallback: false });
  });

  it("uses the backstop when nothing matches", () => {
    expect(resolveOwner(rules, { channel: "400 客服", category: "电视" })).toEqual(
      { openId: "ou_backstop", viaFallback: true },
    );
  });

  it("returns null when there is no match and no backstop", () => {
    expect(
      resolveOwner([rules[0]], { channel: "APP", category: "电视" }),
    ).toBeNull();
  });

  it("ignores rules with a blank open id", () => {
    expect(
      resolveOwner([{ scope: "APP", openId: "", fallback: false }], {
        channel: "APP",
        category: "电视",
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/voc/assignment.test.ts`
Expected: FAIL — `Failed to resolve import "./assignment"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/voc/assignment.ts

export type OwnerRule = Readonly<{
  scope: string;
  openId: string;
  fallback: boolean;
}>;

export type OwnerAssignment = Readonly<{
  openId: string;
  viaFallback: boolean;
}>;

export function resolveOwner(
  rules: readonly OwnerRule[],
  input: Readonly<{ channel: string; category: string }>,
): OwnerAssignment | null {
  const usable = rules.filter((rule) => rule.openId.trim().length > 0);

  const candidates = [`${input.channel}/${input.category}`, input.channel];
  for (const scope of candidates) {
    const match = usable.find((rule) => rule.scope === scope);
    if (match) return { openId: match.openId, viaFallback: false };
  }

  // Dropping an unmatched ticket would make it vanish and quietly inflate the
  // closure rate, so an explicit backstop is part of the contract.
  const backstop = usable.find((rule) => rule.fallback);
  return backstop ? { openId: backstop.openId, viaFallback: true } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/voc/assignment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/voc/assignment.ts src/features/voc/assignment.test.ts
git commit -m "feat: route tickets to an owner with an explicit backstop

An unmatched ticket that silently disappears also inflates the closure rate,
so routing either resolves an owner or reports that it could not."
```

---

### Task 11: 卡片载荷与操作者身份

**Files:**
- Modify: `src/features/feishu-bot/card-types.ts`
- Modify: `src/features/feishu-bot/event-handler.ts:17-29,121-151`
- Test: `src/features/feishu-bot/event-handler.test.ts`（追加用例）

**Interfaces:**
- Consumes: 无
- Produces: `VOC_CARD_ACTIONS`、`VocCardAction`、`FeishuEventOutcome` 的 `card_action` 分支新增 `recordId`、`operatorOpenId`

操作者身份取 `event.operator.open_id`——它由现有签名校验保证可信。

> **校验必须按动作类型分流，不得一刀切。** `ONECARE_CASE_ID` 在 `cards.ts` 有 8 处引用，既是八类演示卡的展示文案，也是它们按钮的载荷（`cards.ts:66` 的 `value: { action, case_id: ONECARE_CASE_ID }`）。这八类卡按规格 §1.4 是**保留**的。若把 `event-handler.ts:141` 改成对所有动作都要求 `record_id`，演示卡的按钮会全部失效。
>
> 因此：
> - `ONECARE_CARD_ACTIONS`（九个演示动作，注意是 9 个动作对应 8 个视图，两者数量不同）→ **保持**现有的 `case_id === ONECARE_CASE_ID` 校验，行为不变，`ONECARE_CASE_ID` 常量保留
> - `VOC_CARD_ACTIONS`（四个新增真实动作）→ 要求 `record_id` 匹配 `/^rec[A-Za-z0-9]+$/` **且** `event.operator.open_id` 非空
>
> 两类动作的 outcome 都走 `card_action` 分支，但 `recordId` 与 `operatorOpenId` 只在 VOC 动作上有意义；演示动作的这两个字段填空串，由 Task 12 按动作类型分派到不同的处理函数。

- [ ] **Step 1: Write the failing test**

追加到 `src/features/feishu-bot/event-handler.test.ts`。沿用该文件现有的构造签名请求的辅助函数；若尚无 `card.action.trigger` 的辅助，按现有 helper 的写法新增一个，并复用 `env` 常量。

```ts
describe("parseFeishuEvent card actions", () => {
  it("carries the record id and the operator open id", async () => {
    const outcome = await parseSignedCardAction({
      action: "voc_start_follow_up",
      recordId: "rec12345",
      operatorOpenId: "ou_owner",
    });

    expect(outcome).toMatchObject({
      kind: "card_action",
      action: "voc_start_follow_up",
      recordId: "rec12345",
      operatorOpenId: "ou_owner",
    });
  });

  it("rejects a card action with no record id", async () => {
    const outcome = await parseSignedCardAction({
      action: "voc_start_follow_up",
      recordId: "",
      operatorOpenId: "ou_owner",
    });

    expect(outcome).toEqual({ kind: "invalid_card_action" });
  });

  it("rejects a record id that is not a Bitable record id", async () => {
    const outcome = await parseSignedCardAction({
      action: "voc_start_follow_up",
      recordId: "OC-240718-037",
      operatorOpenId: "ou_owner",
    });

    expect(outcome).toEqual({ kind: "invalid_card_action" });
  });

  it("rejects a card action with no operator open id", async () => {
    const outcome = await parseSignedCardAction({
      action: "voc_start_follow_up",
      recordId: "rec12345",
      operatorOpenId: "",
    });

    expect(outcome).toEqual({ kind: "invalid_card_action" });
  });

  it("rejects an action outside the whitelist", async () => {
    const outcome = await parseSignedCardAction({
      action: "drop_table",
      recordId: "rec12345",
      operatorOpenId: "ou_owner",
    });

    expect(outcome).toEqual({ kind: "invalid_card_action" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/feishu-bot/event-handler.test.ts`
Expected: FAIL — 返回的 outcome 缺少 `recordId` 与 `operatorOpenId`

- [ ] **Step 3: Write minimal implementation**

`card-types.ts`：**保留** `ONECARE_CASE_ID`（`cards.ts` 8 处在用），新增 VOC 动作白名单。

```ts
export const VOC_CARD_ACTIONS = [
  "voc_start_follow_up",
  "voc_submit_follow_up",
  "voc_confirm_closure",
  "voc_mark_no_action",
] as const;

export type VocCardAction = (typeof VOC_CARD_ACTIONS)[number];
```

`event-handler.ts`：`card_action` 分支加两个字段，`parseCardAction` 换掉案例号校验。

```ts
  | Readonly<{
      kind: "card_action";
      action: OneCareCardAction | VocCardAction;
      recordId: string;
      operatorOpenId: string;
      chatId: string;
      messageId: string;
    }>
```

```ts
const RECORD_ID_PATTERN = /^rec[A-Za-z0-9]+$/;

function operatorOpenId(payload: JsonObject): string {
  if (!isJsonObject(payload.event)) return "";
  const operator = payload.event.operator;
  if (!isJsonObject(operator)) return "";
  return typeof operator.open_id === "string" ? operator.open_id : "";
}
```

在 `parseCardAction` 中把原先的

```ts
  const caseId = normalized.action.value.case_id;
  if (!isOneCareCardAction(action) || caseId !== ONECARE_CASE_ID) {
```

替换为：

```ts
  const recordId = normalized.action.value.record_id;
  const openId = operatorOpenId(payload);

  if (!isSupportedCardAction(action)) {
    return { kind: "invalid_card_action" };
  }
  // A real Bitable record id replaces the fixed demo case number; the operator
  // identity comes from the signed event payload, never from the button value.
  if (typeof recordId !== "string" || !RECORD_ID_PATTERN.test(recordId)) {
    return { kind: "invalid_card_action" };
  }
  if (openId.length === 0) {
    return { kind: "invalid_card_action" };
  }
```

并把返回值补上 `recordId` 与 `operatorOpenId`。`isSupportedCardAction` 同时接受 `ONECARE_CARD_ACTIONS` 与 `VOC_CARD_ACTIONS`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/feishu-bot/event-handler.test.ts`
Expected: PASS，且原有用例仍全绿

- [ ] **Step 5: Commit**

```bash
git add src/features/feishu-bot/card-types.ts src/features/feishu-bot/event-handler.ts src/features/feishu-bot/event-handler.test.ts
git commit -m "feat: carry real record ids and operator identity on card actions

The fixed demo case number was the only thing gating card actions, which meant
any member could drive any button. The record id now addresses a real row and
the operator comes from the signed event payload rather than the button value,
so identity cannot be forged by editing what the card sends back."
```

---

### Task 12: 卡片动作三重校验与 VOC 工单卡

**Files:**
- Modify: `src/features/feishu-bot/card-actions.ts`
- Modify: `src/features/feishu-bot/cards.ts`
- Modify: `app/api/feishu/events/route.ts:36-66,110-135`
- Test: `src/features/feishu-bot/card-actions.test.ts`（追加）
- Test: `app/api/feishu/events/route.test.ts`（更新依赖签名）

**Interfaces:**
- Consumes: `transition` / `VocState`（Task 2）、`BitableClient`（Task 9）、`VocCardAction`（Task 11）
- Produces: `resolveVocCardAction(input): Promise<CardActionResult>`、`createVocTicketCard(record, tag)`

**鉴权结论必须在同步响应内产出并直接返回 toast**，不走 `after()`：先确认时还不知道有没有权限，而卡片更新次数上限只有 2。写操作可以留在 `after()`。

- [ ] **Step 1: Write the failing test**

```ts
// 追加到 src/features/feishu-bot/card-actions.test.ts
import { resolveVocCardAction } from "./card-actions";

const record = {
  recordId: "rec1",
  channel: "电商评价",
  category: "冰箱",
  content: "等了三天",
  rating: 2,
  state: "待跟进" as const,
  polarity: "差评" as const,
  dimensions: ["维修时间"] as const,
  ownerOpenIds: ["ou_owner"],
  retryCount: 0,
  ticketOpenedAt: "2026-01-23T02:00:00.000Z",
  closedAt: null,
};

function client(overrides: Partial<{ record: typeof record | null }> = {}) {
  const updateRecord = vi.fn(async () => undefined);
  return {
    updateRecord,
    getRecord: vi.fn(async () =>
      overrides.record === undefined ? record : overrides.record,
    ),
  };
}

describe("resolveVocCardAction", () => {
  it("advances the state for the assigned owner", async () => {
    const bitable = client();

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      bitable,
    });

    expect(result.kind).toBe("update");
    expect(bitable.updateRecord).toHaveBeenCalledWith("rec1", {
      流程状态: "跟进中",
    });
  });

  it("rejects an operator who is not the owner and writes nothing", async () => {
    const bitable = client();

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_stranger",
      bitable,
    });

    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.response.toast?.type).toBe("error");
    expect(result.response.toast?.content).toContain("负责人");
    expect(result.response.card).toBeUndefined();
    expect(bitable.updateRecord).not.toHaveBeenCalled();
  });

  it("rejects a missing record", async () => {
    const bitable = client({ record: null });

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "recGone",
      operatorOpenId: "ou_owner",
      bitable,
    });

    if (result.kind !== "update") throw new Error("expected update");
    expect(result.response.toast?.type).toBe("error");
    expect(bitable.updateRecord).not.toHaveBeenCalled();
  });

  it("rejects an illegal transition and writes nothing", async () => {
    const bitable = client();

    const result = await resolveVocCardAction({
      action: "voc_confirm_closure",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      closingNote: "已处理",
      bitable,
    });

    if (result.kind !== "update") throw new Error("expected update");
    expect(result.response.toast?.type).toBe("error");
    expect(bitable.updateRecord).not.toHaveBeenCalled();
  });

  it("reports success without writing when the action already landed", async () => {
    const bitable = client();
    bitable.getRecord = vi.fn(async () => ({ ...record, state: "跟进中" as const }));

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      bitable,
    });

    if (result.kind !== "update") throw new Error("expected update");
    expect(result.response.toast?.type).toBe("info");
    expect(bitable.updateRecord).not.toHaveBeenCalled();
  });

  it("surfaces an error toast when the Base write fails", async () => {
    const bitable = client();
    bitable.updateRecord = vi.fn(async () => {
      throw new Error("bitable down");
    });

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      bitable,
    });

    if (result.kind !== "update") throw new Error("expected update");
    expect(result.response.toast?.type).toBe("error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/feishu-bot/card-actions.test.ts`
Expected: FAIL — `resolveVocCardAction` 不存在

- [ ] **Step 3: Write minimal implementation**

`card-actions.ts` 新增（保留现有 `resolveCardAction` 供八类演示卡使用）：

```ts
import { VOC_FIELD_NAMES } from "../bitable/field-map";
import { transition, type VocAction } from "../voc/service-event";
import type { VocCardAction } from "./card-types";

const ACTION_TO_TRANSITION: Readonly<Record<VocCardAction, VocAction>> = {
  voc_start_follow_up: "开始跟进",
  voc_submit_follow_up: "提交跟进结果",
  voc_confirm_closure: "确认闭环",
  voc_mark_no_action: "无需建单",
};

function errorToast(content: string): CardActionResult {
  return { kind: "update", response: { toast: { type: "error", content } } };
}

export async function resolveVocCardAction(input: {
  action: VocCardAction;
  recordId: string;
  operatorOpenId: string;
  followUpNote?: string;
  closingNote?: string;
  bitable: {
    getRecord(recordId: string): Promise<{
      state: VocState;
      ownerOpenIds: readonly string[];
      retryCount: number;
    } | null>;
    updateRecord(recordId: string, fields: Record<string, unknown>): Promise<void>;
  };
}): Promise<CardActionResult> {
  // Authorization has to resolve inside the synchronous response: deferring it
  // to after() would mean answering before knowing the verdict, and a card can
  // only be updated twice.
  let record: Awaited<ReturnType<typeof input.bitable.getRecord>>;
  try {
    record = await input.bitable.getRecord(input.recordId);
  } catch {
    return errorToast("读取记录失败，请稍后重试");
  }

  if (!record) {
    return errorToast("记录不存在或已被删除");
  }

  if (!record.ownerOpenIds.includes(input.operatorOpenId)) {
    return errorToast("只有该记录的负责人可以操作");
  }

  const outcome = transition(record.state, ACTION_TO_TRANSITION[input.action], {
    retryCount: record.retryCount,
    hasOwner: record.ownerOpenIds.length > 0,
    followUpNote: input.followUpNote,
    closingNote: input.closingNote,
  });

  if (outcome.kind === "rejected") {
    return errorToast(outcome.reason);
  }

  if (outcome.kind === "noop") {
    return {
      kind: "update",
      response: {
        toast: { type: "info", content: `当前已是${outcome.state}` },
      },
    };
  }

  const fields: Record<string, unknown> = {
    [VOC_FIELD_NAMES.state]: outcome.next,
  };
  if (input.followUpNote) {
    fields[VOC_FIELD_NAMES.followUpNote] = input.followUpNote;
  }
  if (input.closingNote) {
    fields[VOC_FIELD_NAMES.closingNote] = input.closingNote;
  }
  if (outcome.next === "已闭环") {
    fields[VOC_FIELD_NAMES.closedAt] = new Date().toISOString();
  }

  try {
    await input.bitable.updateRecord(input.recordId, fields);
  } catch {
    return errorToast("状态写回失败，请稍后重试");
  }

  return {
    kind: "update",
    response: {
      toast: { type: "success", content: `已更新为${outcome.next}` },
    },
  };
}
```

`cards.ts` 新增 `createVocTicketCard(record, tag)`，沿用文件内现有 Card 2.0 构造惯例；按钮 `value` 带 `{ action, record_id }`。

`app/api/feishu/events/route.ts`：把 `resolveAction` 的依赖签名从

```ts
  resolveAction: (action: OneCareCardAction) => CardActionResult;
```

改为

```ts
  resolveAction: (input: {
    action: OneCareCardAction | VocCardAction;
    recordId: string;
    operatorOpenId: string;
  }) => Promise<CardActionResult>;
```

`card_action` 分支改为 `await`，并把 `outcome.recordId` 与 `outcome.operatorOpenId` 传入。同步更新 `route.test.ts` 的假依赖。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/feishu-bot/ app/api/feishu/events/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/feishu-bot/card-actions.ts src/features/feishu-bot/card-actions.test.ts src/features/feishu-bot/cards.ts app/api/feishu/events/route.ts app/api/feishu/events/route.test.ts
git commit -m "feat: authorize VOC card actions before touching any state

Authorization resolves inside the synchronous response rather than in after():
answering first would mean replying before the verdict is known, and a card can
only be updated twice. A rejected operator, a missing record, and an illegal
transition all write nothing at all."
```

---

### Task 13: 分片打标作业

**Files:**
- Create: `app/api/voc/analyze/route.ts`
- Create: `app/api/voc/analyze/route.test.ts`
- Modify: `vercel.json`
- Modify: `vercel-config.test.ts`

**Interfaces:**
- Consumes: `selectTaggingProvider`（Task 7）、`triage`（Task 3）、`transition`（Task 2）、`BitableClient` / `toTagFieldUpdate`（Task 8、9）、`resolveOwner`（Task 10）
- Produces: `createAnalyzeRoute(dependencies)`、`POST`

`after()` 不是队列——它只延长同一次调用的生命周期，仍受 `maxDuration` 约束。改为 Cron 驱动的可恢复分片：每次只取 N 条 `待分析`，处理完即返回。天然幂等（按状态过滤）、天然限流、天然可恢复。

- [ ] **Step 1: Write the failing test**

```ts
// app/api/voc/analyze/route.test.ts
import { describe, expect, it, vi } from "vitest";

import { createAnalyzeRoute } from "./route";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    cronSecret: "s3cret",
    shardSize: 2,
    listPending: vi.fn(async () => [
      {
        recordId: "rec1",
        channel: "电商评价",
        category: "冰箱",
        content: "等了三天",
        rating: 2,
        state: "待分析" as const,
        polarity: null,
        dimensions: [],
        ownerOpenIds: [],
        retryCount: 0,
        ticketOpenedAt: null,
        closedAt: null,
      },
    ]),
    tag: vi.fn(async () => [
      {
        kind: "tagged" as const,
        result: {
          recordId: "rec1",
          sentiment: ["失望"],
          polarity: "差评" as const,
          dimensions: ["维修时间"] as const,
          summary: "等待三天",
          replies: [],
        },
      },
    ]),
    ownerRules: vi.fn(async () => [
      { scope: "", openId: "ou_backstop", fallback: true },
    ]),
    updateRecord: vi.fn(
      async (_recordId: string, _fields: Record<string, unknown>) => undefined,
    ),
    ...overrides,
  };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/voc/analyze", {
    method: "POST",
    headers,
  });
}

describe("createAnalyzeRoute", () => {
  it("rejects a request with no cron secret", async () => {
    const dependencies = deps();
    const response = await createAnalyzeRoute(dependencies)(request());

    expect(response.status).toBe(401);
    expect(dependencies.listPending).not.toHaveBeenCalled();
  });

  it("rejects a wrong cron secret", async () => {
    const dependencies = deps();
    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer wrong" }),
    );

    expect(response.status).toBe(401);
  });

  it("tags a shard and writes the AI columns plus the ticket state", async () => {
    const dependencies = deps();
    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processed: 1,
      tagged: 1,
      failed: 0,
    });

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields["情绪极性"]).toBe("差评");
    expect(fields["严重度"]).toBe("中");
    expect(fields["流程状态"]).toBe("待跟进");
    expect(fields["负责人"]).toEqual([{ id: "ou_backstop" }]);
  });

  it("marks a failed record so the next shard can retake it", async () => {
    const dependencies = deps({
      tag: vi.fn(async () => [
        {
          kind: "failed" as const,
          recordId: "rec1",
          reason: "模型未返回该 id",
          rawOutput: "{}",
        },
      ]),
    });

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(await response.json()).toMatchObject({ failed: 1, tagged: 0 });

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields["流程状态"]).toBe("分析失败");
    expect(fields["失败原因"]).toBe("模型未返回该 id");
    expect(fields["重试次数"]).toBe(1);
  });

  it("returns early when the shard is empty", async () => {
    const dependencies = deps({ listPending: vi.fn(async () => []) });

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(await response.json()).toMatchObject({ processed: 0 });
    expect(dependencies.tag).not.toHaveBeenCalled();
  });

  it("keeps going when one record fails to write", async () => {
    const dependencies = deps({
      updateRecord: vi.fn(async () => {
        throw new Error("bitable down");
      }),
    });

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ writeErrors: 1 });
  });
});
```

`vercel-config.test.ts` 的期望同步更新为包含 VOC 路由区域与 cron。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/voc/analyze/route.test.ts vercel-config.test.ts`
Expected: FAIL — 无法解析 `./route`；`vercel.json` 断言不匹配

- [ ] **Step 3: Write minimal implementation**

`app/api/voc/analyze/route.ts` 按 `app/api/feishu/events/route.ts` 的依赖注入惯例编写：`createAnalyzeRoute(dependencies)` 返回 `POST`，模块底部导出 `export const POST = createAnalyzeRoute(defaultDependencies)`，并设 `export const runtime = "nodejs"` 与 `export const maxDuration = 60`。

流程：校验 `Authorization: Bearer <CRON_SECRET>`（否则 401）→ `listPending(shardSize)` → 空则返回 `{processed:0}` → `tag(records)` → 逐条按 `outcome.kind` 分支：

- `tagged`：`triage` 算严重度 → `toTagFieldUpdate` → `transition("待分析","打标成功")` 得 `已分析` → 再按 `createTicket` 走 `需建单` 或 `无需建单`，需建单时 `resolveOwner` 填负责人与建单时间 → 一次 `updateRecord` 写完
- `failed`：写 `流程状态=分析失败`、`失败原因`、`原始输出`、`重试次数 = retryCount + 1`

每条 `updateRecord` 用 try/catch 包住并计入 `writeErrors`，单条失败不打断整片。响应返回 `{ processed, tagged, failed, writeErrors }`。

`vercel.json` 增加：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "app/api/feishu/events/route.ts": { "regions": ["hkg1"] },
    "app/api/voc/analyze/route.ts": { "regions": ["hkg1"] },
    "app/api/voc/dashboard/route.ts": { "regions": ["hkg1"] }
  },
  "crons": [{ "path": "/api/voc/analyze", "schedule": "* * * * *" }]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/voc/analyze/route.test.ts vercel-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/voc/analyze app/api/voc/dashboard vercel.json vercel-config.test.ts
git commit -m "feat: tag pending VOC records in cron-driven shards

after() only extends the current invocation and still answers to maxDuration,
so a long batch cannot hide behind it. Filtering on 待分析 makes each shard
idempotent, recoverable, and naturally inside the rate limit, which removes the
need for a queue, a token bucket, and a backoff schedule. Requests without the
cron secret are refused because this route both writes the Base and spends AI
quota."
```

---

### Task 14: 公开看板

**Files:**
- Create: `app/api/voc/dashboard/route.ts`
- Create: `app/api/voc/dashboard/route.test.ts`
- Create: `app/dashboard/voc/page.tsx`
- Modify: `src/features/showcase/perspective-demo-data.ts`
- Modify: `src/features/showcase/perspective-demo-data.test.ts:19`
- Modify: `src/features/showcase/components/operations-workspace.tsx`
- Modify: `src/features/showcase/components/perspective-tabs.tsx`
- Modify: `app/landing-content.tsx`
- Modify: `src/features/showcase/components/perspective-workspaces.test.tsx`

**Interfaces:**
- Consumes: `aggregateVocMetrics` / `VocMetrics`（Task 4）、`BitableClient`（Task 9）
- Produces: `createDashboardRoute(dependencies)`、`GET`、`VocDashboard` 组件

**响应绝不包含 `原始内容`。** 仓库是 public 且此页无需登录；泄露 VOC 原文是不可接受的。

- [ ] **Step 1: Write the failing test**

```ts
// app/api/voc/dashboard/route.test.ts
import { describe, expect, it, vi } from "vitest";

import { createDashboardRoute } from "./route";

const records = [
  {
    recordId: "rec1",
    channel: "电商评价",
    category: "冰箱",
    content: "我的手机号是保密的，等了三天",
    rating: 2,
    state: "已闭环" as const,
    polarity: "差评" as const,
    dimensions: ["维修时间"] as const,
    ownerOpenIds: ["ou_owner"],
    retryCount: 0,
    ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    closedAt: "2026-01-24T02:00:00.000Z",
  },
];

describe("createDashboardRoute", () => {
  it("returns aggregate numbers", async () => {
    const route = createDashboardRoute({
      listAll: vi.fn(async () => records),
      manualMinutesPerRecord: 4,
    });

    const body = (await (await route()).json()) as Record<string, unknown>;

    expect(body).toMatchObject({ total: 1, ticketsClosed: 1 });
    expect(body.effort).toEqual({
      taggedRecords: 1,
      manualMinutesPerRecord: 4,
      savedHours: expect.any(Number),
    });
  });

  it("never leaks raw VOC content", async () => {
    const route = createDashboardRoute({
      listAll: vi.fn(async () => records),
    });

    const raw = await (await route()).text();

    expect(raw).not.toContain("等了三天");
    expect(raw).not.toContain("原始内容");
    expect(raw).not.toContain("rec1");
  });

  it("returns 503 when the Base cannot be read", async () => {
    const route = createDashboardRoute({
      listAll: vi.fn(async () => {
        throw new Error("bitable down");
      }),
    });

    expect((await route()).status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/voc/dashboard/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`

- [ ] **Step 3: Write minimal implementation**

`route.ts`：`createDashboardRoute({ listAll, manualMinutesPerRecord? })` 返回 `GET`。读全量 → 映射成 `VocMetricsInput`（**只取 `state`、`polarity`、`dimensions`、`channel`、`ticketOpenedAt`、`closedAt`，不取 `content` 与 `recordId`**）→ `aggregateVocMetrics` → `Response.json(metrics)`。读失败返回 503。用 `use cache` 与 `cacheLife("minutes")` 包住取数，避免每个访客都打一次跨境接口。

`app/dashboard/voc/page.tsx`：服务端组件，渲染总量、极性分布、维度 Top N、渠道分布、闭环率、平均闭环时长、打标覆盖与成功率、人效。人效一栏必须显式打印基线取值与「假设值」字样。

`perspective-demo-data.ts`：删除 `vocTopics` 与 `VocTopicId`；`perspective-demo-data.test.ts:19` 删掉那条断言。`operations-workspace.tsx` 改为接收 `metrics: VocMetrics` props 并删掉硬编码趋势条；`perspective-tabs.tsx` 增加 props 透传；`app/landing-content.tsx` 服务端取数后传入。`perspective-workspaces.test.tsx` 按新 props 更新。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS，全仓库测试绿

- [ ] **Step 5: Commit**

```bash
git add app/api/voc/dashboard app/dashboard/voc src/features/showcase app/landing-content.tsx
git commit -m "feat: publish an auditable VOC dashboard without leaking content

This page is the only evidence a judge can verify unaided, so it reads real
records and every number reconciles against the Base. It is public and this
repository is public, so the response carries aggregates only and no raw user
wording. The effort figure prints its assumed baseline instead of implying a
measurement."
```

---

### Task 15: 文档一致性与完成校验

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/TECH_STACK.md:5`
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-08-10-onecare-voc-mvp-design.md`

三处现在都写着「VOC / AI 未接入」。不同步修改会出现 README 说没接、提交文档说接了的自相矛盾——这正是 `AGENTS.md` 的 Completion 一节要防的事。

- [ ] **Step 1: 更新 `.env.example`**

新增 7 个变量占位，不含真实值：`FEISHU_BITABLE_APP_TOKEN`、`FEISHU_BITABLE_TABLE_VOC`、`FEISHU_BITABLE_TABLE_OWNER`、`TAGGING_PROVIDER`、`FEISHU_AILY_APP_ID`、`FEISHU_AILY_SKILL_TAGGING`、`CRON_SECRET`。

- [ ] **Step 2: 更新三处「当前实现」措辞**

按实际落地情况改写，逐条对照，只写真实成立的。仍未实现的（IoT 预诊、智能客服、自动回访、三视角）必须保留为规划中。

- [ ] **Step 3: 回填规格**

把 §3.2 的「状态序号」从 Base 存储字段中删除（由 `VOC_STATE_SEQUENCE` 从状态名推导，不需要单独列）。若 Task 8 Step 1 发现真实列结构与 §3.1 假设不符，一并回填。

- [ ] **Step 4: 跑完整验证**

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
```

Expected: 六条全绿，`git diff --check` 无输出。任何一条红都不得声称完成。

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md docs/TECH_STACK.md .env.example docs/superpowers/specs/2026-08-10-onecare-voc-mvp-design.md
git commit -m "docs: align stated capability with what actually ships

README, AGENTS.md and TECH_STACK all still claimed VOC and AI were absent.
Leaving them would have contradicted the submission document, which is exactly
the overstatement the completion rules exist to prevent."
```

---

## 自查

**规格覆盖**：§2.1 → Task 1–10 的纯函数与注入约定；§2.3 模块清单 → Task 1–14 逐一对应；§2.4 改动面 → Task 11、12、14、15；§3.1 脱敏与不入库 → Task 1、15；§3.2 字段 → Task 8；§3.3 单一状态源 → Task 2、8；§3.4 负责人表 → Task 10；§3.6 导入幂等 → **未覆盖**，见下；§4 状态机 → Task 2；§4.4 并发 → Task 2 的序号 + Task 12 的读后判定；§4.5 triage → Task 3；§5 双轨 → Task 5–7；§5.5 契约 → Task 5；§5.6 分片 → Task 13；§6 卡片 → Task 11、12；§6.4 信任边界 → Task 15 文档；§7 指标 → Task 4、14；§8.1 路由鉴权 → Task 13、14；§8.2 错误处理 → 分散于 Task 5、6、9、12、13、14；§9 测试 → 每个 Task 的 Step 1；§10 配置 → Task 8、15；§13 文档 → Task 15；§14 验收 → Task 15 Step 4。

**已知缺口一处**：§3.6 的导入幂等（`渠道 + 反馈时间 + 内容哈希` 去重）没有对应任务。原因是导入改由运营在多维表格里手动完成（§1.4），去重无处挂载。**处置**：Task 15 回填规格时把 §3.6 改为运营侧操作约定——导入前确认 Base 为空或先清空，并在验收 1 中核对条数。若后续要程序化导入，另开规格。

**占位符扫描**：无 TBD、无「适当处理错误」、无「参考 Task N」。Task 8 Step 1 是一条真实的 curl 验证步骤而非占位符——它存在的原因是多选/单选/人员三种字段的解包方式猜错会静默写空，必须拿真实响应对齐。

**类型一致性**：`TagResult`、`TagOutcome` 定义于 Task 5，被 Task 6、7、8 引用；`TaggingProvider`、`TaggingRequestRecord` 定义于 Task 6 的 `provider-types.ts`，被 Task 7 引用；`VocState`、`transition`、`TransitionContext` 定义于 Task 2，被 Task 4、8、12 引用；`VocPolarity`、`VocDimension`、`VocSeverity` 定义于 Task 3，被 Task 4、5、8 引用；`BitableFields`、`VocRecord`、`VOC_FIELD_NAMES` 定义于 Task 8，被 Task 9、12、13 引用；`BitableClient` 定义于 Task 9，被 Task 12、13、14 引用；`VocCardAction` 定义于 Task 11，被 Task 12 引用；`VocMetrics` 定义于 Task 4，被 Task 14 引用。命名全程一致。
