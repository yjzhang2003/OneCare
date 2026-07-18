# OneCare Linked Service Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户、客服、工程师和后台四个视角接入同一条确定性服务状态机，并演示“AI 知识库自助优先、失败后转人工建单、上门服务、后台改善”的完整闭环。

**Architecture:** `PerspectiveTabs` 使用 `useReducer` 持有唯一 `ServiceJourneyState`，通过显式 props 把状态和动作传给四个工作台。`service-journey.ts` 提供纯 reducer 与派生选择器；角色组件只渲染当前共享阶段并触发被允许的下一步。VOC 主题仍是后台本地 UI 状态，但共享重置会恢复默认主题。

**Tech Stack:** TypeScript、Next.js 16、React 19、CSS、Vitest、React Testing Library、Playwright CLI、Vercel Preview。

## Global Constraints

- TypeScript only；不得增加 Python 代码、Python 工具或第三方运行时依赖。
- 状态只在当前浏览器会话和当前页面组件树中存在；不得写入 URL、Cookie、LocalStorage 或数据库。
- 不得发起真实 AI、知识库、IoT、工单、配件、预约、回访或 VOC 网络请求。
- 所有演示内容固定、可重复，不读取当前时间，不生成随机值。
- 新增文字按钮只使用药丸形、文字居中且无箭头；卡片和知识建议保持圆角。
- 用户进度条只显示圆点与文字，不显示步骤文字下方的连接横线。
- 保持 MiSans、海信青、黑、白视觉体系及现有全屏 Tab 切换。
- `390 × 844` 下用户手机、场景和操作槽在所有可见共享阶段的位置变化不得超过 `1px`。
- 禁用流程必须使用原生 `disabled`；状态变化继续通过 `aria-live` 播报。
- 行为修改严格执行 RED → GREEN → REFACTOR。
- 完成本地验证后只发布非 Production Vercel Preview；不修改 Production 配置。
- 不推送、不创建 PR、不合并，除非用户另行要求。

---

## File Structure

- `src/features/showcase/service-journey.ts`：共享状态、动作、纯 reducer 和阶段选择器。
- `src/features/showcase/service-journey.test.ts`：合法路径、自助解决、非法跳步和重置测试。
- `src/features/showcase/components/perspective-tabs.tsx`：唯一 `useReducer` 所有者与四个角色动作编排。
- `src/features/showcase/components/customer-workspace.tsx`：用户诊断、知识库自助、转人工和共享进度。
- `src/features/showcase/components/agent-workspace.tsx`：转人工后建单及共享分配结果。
- `src/features/showcase/components/engineer-workspace.tsx`：工单创建后核验配件并完成服务。
- `src/features/showcase/components/operations-workspace.tsx`：服务完成后创建改善任务并响应全局重置。
- `src/features/showcase/perspective-demo-data.ts`：确定性知识步骤、服务文案和共享案例数据。
- `src/features/showcase/components/service-journey-integration.test.tsx`：跨四角色端到端组件测试。
- `src/features/showcase/components/perspective-workspaces.test.tsx`：各工作台局部渲染和禁用状态测试。
- `app/landing-content.tsx`、`src/features/showcase/content.ts`：移除产品主叙事中的“上下文”。
- `app/landing-content.test.tsx`：页面标题与说明回归测试。
- `app/globals.css`、`app/fullscreen-showcase-styles.test.ts`：知识卡、双按钮、用户进度无线条和稳定几何合约。
- `README.md`、本 spec、本 plan：静态串联边界、验证和 Preview 记录。

---

### Task 1: 建立纯共享服务状态机

**Files:**
- Create: `src/features/showcase/service-journey.ts`
- Create: `src/features/showcase/service-journey.test.ts`

**Interfaces:**
- Produces: `ServiceJourneyStage`、`ServiceJourneyState`、`ServiceJourneyAction`。
- Produces: `initialServiceJourneyState`、`serviceJourneyReducer(state, action)`。
- Produces: `journeyHasWorkOrder(state)`、`journeyHasConfirmedParts(state)`、`journeyHasCompletedService(state)`、`journeyHasImprovementTask(state)`。

- [x] **Step 1: 写完整合法路径的失败测试**

Create `src/features/showcase/service-journey.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  initialServiceJourneyState,
  serviceJourneyReducer,
} from "./service-journey";

describe("serviceJourneyReducer", () => {
  it("moves one shared case through the complete assisted-service journey", () => {
    let state = serviceJourneyReducer(initialServiceJourneyState, {
      type: "answerDiagnosis",
      reply: "饮料不够凉",
    });
    expect(state).toEqual({ stage: "selfHelp", customerReply: "饮料不够凉" });

    for (const action of [
      { type: "requestHumanService" },
      { type: "createWorkOrder" },
      { type: "confirmParts" },
      { type: "completeService" },
      { type: "createImprovementTask" },
    ] as const) {
      state = serviceJourneyReducer(state, action);
    }

    expect(state.stage).toBe("improvementCreated");
    expect(state.customerReply).toBe("饮料不够凉");
  });
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx vitest run src/features/showcase/service-journey.test.ts
```

Expected: FAIL，因为 `service-journey.ts` 不存在。

- [x] **Step 3: 实现类型、reducer 与选择器**

Create `src/features/showcase/service-journey.ts`:

```ts
export type ServiceJourneyStage =
  | "detected"
  | "selfHelp"
  | "selfResolved"
  | "serviceRequested"
  | "workOrderCreated"
  | "partsConfirmed"
  | "serviceCompleted"
  | "improvementCreated";

export type ServiceJourneyState = Readonly<{
  stage: ServiceJourneyStage;
  customerReply: string | null;
}>;

export type ServiceJourneyAction =
  | Readonly<{ type: "answerDiagnosis"; reply: string }>
  | Readonly<{ type: "markSelfResolved" }>
  | Readonly<{ type: "requestHumanService" }>
  | Readonly<{ type: "createWorkOrder" }>
  | Readonly<{ type: "confirmParts" }>
  | Readonly<{ type: "completeService" }>
  | Readonly<{ type: "createImprovementTask" }>
  | Readonly<{ type: "resetJourney" }>;

export const initialServiceJourneyState: ServiceJourneyState = {
  stage: "detected",
  customerReply: null,
};

const workOrderStages = new Set<ServiceJourneyStage>([
  "workOrderCreated",
  "partsConfirmed",
  "serviceCompleted",
  "improvementCreated",
]);
const confirmedPartStages = new Set<ServiceJourneyStage>([
  "partsConfirmed",
  "serviceCompleted",
  "improvementCreated",
]);
const completedServiceStages = new Set<ServiceJourneyStage>([
  "serviceCompleted",
  "improvementCreated",
]);

export function serviceJourneyReducer(
  state: ServiceJourneyState,
  action: ServiceJourneyAction,
): ServiceJourneyState {
  if (action.type === "resetJourney") return initialServiceJourneyState;
  if (action.type === "answerDiagnosis" && state.stage === "detected") {
    return { stage: "selfHelp", customerReply: action.reply };
  }
  if (action.type === "markSelfResolved" && state.stage === "selfHelp") {
    return { ...state, stage: "selfResolved" };
  }
  if (action.type === "requestHumanService" && state.stage === "selfHelp") {
    return { ...state, stage: "serviceRequested" };
  }
  if (action.type === "createWorkOrder" && state.stage === "serviceRequested") {
    return { ...state, stage: "workOrderCreated" };
  }
  if (action.type === "confirmParts" && state.stage === "workOrderCreated") {
    return { ...state, stage: "partsConfirmed" };
  }
  if (action.type === "completeService" && state.stage === "partsConfirmed") {
    return { ...state, stage: "serviceCompleted" };
  }
  if (
    action.type === "createImprovementTask" &&
    state.stage === "serviceCompleted"
  ) {
    return { ...state, stage: "improvementCreated" };
  }
  return state;
}

export const journeyHasWorkOrder = (state: ServiceJourneyState) =>
  workOrderStages.has(state.stage);
export const journeyHasConfirmedParts = (state: ServiceJourneyState) =>
  confirmedPartStages.has(state.stage);
export const journeyHasCompletedService = (state: ServiceJourneyState) =>
  completedServiceStages.has(state.stage);
export const journeyHasImprovementTask = (state: ServiceJourneyState) =>
  state.stage === "improvementCreated";
```

- [x] **Step 4: 增加分支、非法跳步与重置测试**

Append inside the same `describe`:

```ts
it("ends in selfResolved without opening an assisted-service path", () => {
  const selfHelp = serviceJourneyReducer(initialServiceJourneyState, {
    type: "answerDiagnosis",
    reply: "刚才开始",
  });
  const resolved = serviceJourneyReducer(selfHelp, { type: "markSelfResolved" });
  expect(resolved.stage).toBe("selfResolved");
  expect(
    serviceJourneyReducer(resolved, { type: "createWorkOrder" }),
  ).toBe(resolved);
});

it("rejects actions that skip required stages", () => {
  expect(
    serviceJourneyReducer(initialServiceJourneyState, {
      type: "createWorkOrder",
    }),
  ).toBe(initialServiceJourneyState);
});

it("resets every stage and clears the selected reply", () => {
  const selfHelp = serviceJourneyReducer(initialServiceJourneyState, {
    type: "answerDiagnosis",
    reply: "没有异响",
  });
  expect(serviceJourneyReducer(selfHelp, { type: "resetJourney" })).toEqual(
    initialServiceJourneyState,
  );
});
```

- [x] **Step 5: 确认 GREEN 并提交**

Run:

```bash
npx vitest run src/features/showcase/service-journey.test.ts
```

Expected: 4 个 reducer 测试全部通过。

```bash
git add src/features/showcase/service-journey.ts src/features/showcase/service-journey.test.ts
git commit -m "feat: add shared service journey state"
```

---

### Task 2: 接入父级状态与 AI 知识库自助流程

**Files:**
- Create: `src/features/showcase/components/service-journey-integration.test.tsx`
- Modify: `src/features/showcase/components/perspective-tabs.tsx`
- Modify: `src/features/showcase/components/customer-workspace.tsx`
- Modify: `src/features/showcase/perspective-demo-data.ts`
- Modify: `src/features/showcase/components/perspective-workspaces.test.tsx`

**Interfaces:**
- Consumes: `ServiceJourneyState` 与 `serviceJourneyReducer`。
- Produces: `CustomerWorkspace({ journey, onAnswerDiagnosis, onMarkSelfResolved, onRequestHumanService, onReset })`。
- Produces: `PerspectiveTabs` 中唯一的共享 reducer 和用户动作 dispatch。

- [x] **Step 1: 写用户自助与转人工失败测试**

Create `src/features/showcase/components/service-journey-integration.test.tsx` with the shared scroll cleanup used by the existing workspace test, then add:

```tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { perspectives } from "../content";
import { PerspectiveTabs } from "./perspective-tabs";

const scrollToDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  if (scrollToDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  }
});

describe("linked service journey", () => {
  it("offers knowledge help before the customer can request a human", () => {
    render(<PerspectiveTabs perspectives={perspectives} />);
    const customer = within(screen.getByTestId("workspace-customer"));

    fireEvent.click(customer.getByRole("button", { name: "饮料不够凉" }));

    expect(customer.getByText("知识库建议")).toBeInTheDocument();
    expect(customer.getByText("确认冰箱门体已完全闭合")).toBeInTheDocument();
    expect(
      customer.getByRole("button", { name: "问题已解决" }),
    ).toBeEnabled();
    expect(
      customer.getByRole("button", { name: "仍需人工服务" }),
    ).toBeEnabled();

    fireEvent.click(customer.getByRole("button", { name: "仍需人工服务" }));
    expect(customer.getByRole("status")).toHaveTextContent("等待客服建单");
  });
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx vitest run src/features/showcase/components/service-journey-integration.test.tsx
```

Expected: FAIL，因为知识库建议、共享父级状态和新按钮不存在。

- [x] **Step 3: 扩展确定性演示数据**

Modify `customerDemo` in `perspective-demo-data.ts`:

```ts
export const customerDemo = {
  caseId: serviceCase.id,
  prompt: "饮料不够凉",
  greeting: "检测到冷藏室温度持续偏高，需要我帮你一起确认吗？",
  reading: "正在读取设备运行数据…",
  diagnosis: "结合温度曲线，可能与冷藏温度传感器或风道密封有关。",
  knowledgeIntro: "先按知识库建议做一次快速排查：",
  knowledgeSteps: [
    "确认冰箱门体已完全闭合",
    "保持冷藏室出风口无遮挡",
    "减少开门并等待十分钟后复查",
  ],
  selfResolved: "本次问题已通过 AI 指引解决，我会继续关注设备状态。",
  serviceRequested: "自助排查仍未解决，已把设备数据和排查记录提交给客服。",
  workOrderConfirmation: `客服已创建 ${agentDemo.workOrderId}，${agentDemo.engineer} 将在 ${serviceCase.visitWindow} 上门。`,
  serviceCompleted: "本次服务已完成，设备状态将继续由万护关注。",
  progress: ["发现异常", "AI 自助", "客服建单", "服务完成"],
} as const;
```

Move `agentDemo` above `customerDemo`, or keep `customerDemo.workOrderConfirmation` as a standalone template declared after both objects, so TypeScript initialization order is valid.

- [x] **Step 4: 将共享 reducer 接入 `PerspectiveTabs`**

Replace local-only imports/state setup with:

```tsx
import { useReducer, useRef, useState } from "react";

import {
  initialServiceJourneyState,
  serviceJourneyReducer,
} from "../service-journey";

const [journey, dispatch] = useReducer(
  serviceJourneyReducer,
  initialServiceJourneyState,
);
```

Render the customer workspace with:

```tsx
<CustomerWorkspace
  journey={journey}
  onAnswerDiagnosis={(reply) =>
    dispatch({ type: "answerDiagnosis", reply })
  }
  onMarkSelfResolved={() => dispatch({ type: "markSelfResolved" })}
  onRequestHumanService={() => dispatch({ type: "requestHumanService" })}
  onReset={() => dispatch({ type: "resetJourney" })}
/>
```

- [x] **Step 5: 将 `CustomerWorkspace` 改为共享状态渲染**

Use this required prop contract:

```ts
type CustomerWorkspaceProps = Readonly<{
  journey: ServiceJourneyState;
  onAnswerDiagnosis: (reply: string) => void;
  onMarkSelfResolved: () => void;
  onRequestHumanService: () => void;
  onReset: () => void;
}>;
```

Remove local `useState<CustomerStage>`. Derive booleans from `journey.stage`, render `journey.customerReply` in the user bubble, and render this rounded knowledge block for every stage after `detected`:

```tsx
<section className="customer-knowledge" aria-label="知识库建议">
  <span>知识库建议</span>
  <p>{customerDemo.knowledgeIntro}</p>
  <ol>
    {customerDemo.knowledgeSteps.map((step) => (
      <li key={step}>{step}</li>
    ))}
  </ol>
</section>
```

For `selfHelp`, render exactly two controls:

```tsx
<div className="customer-resolution-actions">
  <button className="demo-secondary-button" onClick={onMarkSelfResolved} type="button">
    问题已解决
  </button>
  <button className="demo-primary-button" onClick={onRequestHumanService} type="button">
    仍需人工服务
  </button>
</div>
```

Map the footer status to `主动关怀中`、`AI 自助排查中`、`问题已解决`、`等待客服建单`、`客服已建单` and `服务已完成`. Keep the existing internal scroll effect keyed by `journey.stage`; use `onReset` for “重新演示”.

- [x] **Step 6: 更新工作台局部测试并确认 GREEN**

Update `perspective-workspaces.test.tsx` to render `CustomerWorkspace` with `initialServiceJourneyState` and `vi.fn()` callbacks, then verify the two self-help actions call their callbacks. Remove assertions for the deleted “继续安排服务” flow.

Run:

```bash
npx vitest run src/features/showcase/service-journey.test.ts src/features/showcase/components/service-journey-integration.test.tsx src/features/showcase/components/perspective-workspaces.test.tsx
```

Expected: reducer、用户自助和现有角色局部测试全部通过。

- [x] **Step 7: 提交 Task 2**

```bash
git add src/features/showcase/components/service-journey-integration.test.tsx src/features/showcase/components/perspective-tabs.tsx src/features/showcase/components/customer-workspace.tsx src/features/showcase/perspective-demo-data.ts src/features/showcase/components/perspective-workspaces.test.tsx
git commit -m "feat: add AI self-help customer journey"
```

---

### Task 3: 串联客服建单与工程师服务

**Files:**
- Modify: `src/features/showcase/components/service-journey-integration.test.tsx`
- Modify: `src/features/showcase/components/perspective-tabs.tsx`
- Modify: `src/features/showcase/components/agent-workspace.tsx`
- Modify: `src/features/showcase/components/engineer-workspace.tsx`
- Modify: `src/features/showcase/components/perspective-workspaces.test.tsx`

**Interfaces:**
- Produces: `AgentWorkspace({ journey, onCreateWorkOrder, onReset })`。
- Produces: `EngineerWorkspace({ journey, onConfirmParts, onCompleteService, onReset })`。
- Consumes: `journeyHasWorkOrder`、`journeyHasConfirmedParts`、`journeyHasCompletedService`。

- [x] **Step 1: 写跨客服和工程师的失败测试**

Append to `service-journey-integration.test.tsx`:

```tsx
it("updates customer and engineer views when the agent creates a work order", () => {
  render(<PerspectiveTabs perspectives={perspectives} />);
  const customer = within(screen.getByTestId("workspace-customer"));
  const agent = within(screen.getByTestId("workspace-agent"));
  const engineer = within(screen.getByTestId("workspace-engineer"));

  expect(agent.getByRole("button", { name: "生成服务工单" })).toBeDisabled();
  expect(engineer.getByRole("button", { name: "确认携件" })).toBeDisabled();

  fireEvent.click(customer.getByRole("button", { name: "饮料不够凉" }));
  fireEvent.click(customer.getByRole("button", { name: "仍需人工服务" }));
  expect(agent.getByText("用户自助未解决")).toBeInTheDocument();
  expect(agent.getByRole("button", { name: "生成服务工单" })).toBeEnabled();

  fireEvent.click(agent.getByRole("button", { name: "生成服务工单" }));
  expect(customer.getByText(/OC-WO-037/)).toBeInTheDocument();
  expect(engineer.getByRole("button", { name: "确认携件" })).toBeEnabled();

  fireEvent.click(engineer.getByRole("button", { name: "确认携件" }));
  expect(engineer.getByRole("button", { name: "完成本次服务" })).toBeEnabled();
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx vitest run src/features/showcase/components/service-journey-integration.test.tsx
```

Expected: FAIL，因为客服和工程师仍持有独立本地状态。

- [x] **Step 3: 将客服改为共享阶段**

Use:

```ts
type AgentWorkspaceProps = Readonly<{
  journey: ServiceJourneyState;
  onCreateWorkOrder: () => void;
  onReset: () => void;
}>;
```

Remove local `created`. Define:

```ts
const canCreate = journey.stage === "serviceRequested";
const created = journeyHasWorkOrder(journey);
const awaitingHuman = journey.stage === "serviceRequested";
```

Set `DemoStatusBar` status to `自助记录已同步`. The primary button is disabled unless `canCreate`, calls `onCreateWorkOrder`, and shows `工单已生成` after `created`. Before `serviceRequested`, keep the case visible but show `等待用户转人工`; at `serviceRequested`, show `用户自助未解决` and the selected `journey.customerReply`. Use `onReset` for reset.

- [x] **Step 4: 将工程师改为共享阶段**

Use:

```ts
type EngineerWorkspaceProps = Readonly<{
  journey: ServiceJourneyState;
  onConfirmParts: () => void;
  onCompleteService: () => void;
  onReset: () => void;
}>;
```

Remove local `EngineerStage`. Define:

```ts
const assigned = journeyHasWorkOrder(journey);
const ready = journeyHasConfirmedParts(journey);
const complete = journeyHasCompletedService(journey);
```

Before `assigned`, status is `等待客服建单` and both action buttons are disabled. After `assigned`, “确认携件” calls `onConfirmParts`; after `ready`, “完成本次服务” calls `onCompleteService`; after `complete`, both remain disabled and status is `服务已闭环`. Use `onReset` for reset.

- [x] **Step 5: 在父级编排客服和工程师动作**

Render:

```tsx
<AgentWorkspace
  journey={journey}
  onCreateWorkOrder={() => dispatch({ type: "createWorkOrder" })}
  onReset={() => dispatch({ type: "resetJourney" })}
/>
<EngineerWorkspace
  journey={journey}
  onConfirmParts={() => dispatch({ type: "confirmParts" })}
  onCompleteService={() => dispatch({ type: "completeService" })}
  onReset={() => dispatch({ type: "resetJourney" })}
/>
```

- [x] **Step 6: 更新局部测试并确认 GREEN**

Update workspace tests to pass explicit shared state and spy callbacks. Verify initial disabled controls, service-request enablement, work-order assignment and parts/service actions without recreating local state.

Run:

```bash
npx vitest run src/features/showcase/service-journey.test.ts src/features/showcase/components/service-journey-integration.test.tsx src/features/showcase/components/perspective-workspaces.test.tsx
```

Expected: 人工请求、客服建单、工程师核验三段串联测试全部通过。

- [x] **Step 7: 提交 Task 3**

```bash
git add src/features/showcase/components/service-journey-integration.test.tsx src/features/showcase/components/perspective-tabs.tsx src/features/showcase/components/agent-workspace.tsx src/features/showcase/components/engineer-workspace.tsx src/features/showcase/components/perspective-workspaces.test.tsx
git commit -m "feat: link agent and engineer workspaces"
```

---

### Task 4: 串联后台改善、全局重置与业务文案

**Files:**
- Modify: `src/features/showcase/components/service-journey-integration.test.tsx`
- Modify: `src/features/showcase/components/perspective-tabs.tsx`
- Modify: `src/features/showcase/components/operations-workspace.tsx`
- Modify: `src/features/showcase/components/perspective-workspaces.test.tsx`
- Modify: `app/landing-content.tsx`
- Modify: `app/landing-content.test.tsx`
- Modify: `src/features/showcase/content.ts`

**Interfaces:**
- Produces: `OperationsWorkspace({ journey, onCreateImprovementTask, onReset })`。
- Consumes: `journeyHasCompletedService` 与 `journeyHasImprovementTask`。
- Produces: 全角色共享重置，保留当前选中 Tab。

- [x] **Step 1: 写完整闭环与重置失败测试**

Append to the integration test:

```tsx
it("unlocks operations after service completion and resets every view", () => {
  render(<PerspectiveTabs perspectives={perspectives} />);
  const customer = within(screen.getByTestId("workspace-customer"));
  const agent = within(screen.getByTestId("workspace-agent"));
  const engineer = within(screen.getByTestId("workspace-engineer"));
  const operations = within(screen.getByTestId("workspace-operations"));

  expect(
    operations.getByRole("button", { name: "创建改善任务" }),
  ).toBeDisabled();
  fireEvent.click(customer.getByRole("button", { name: "饮料不够凉" }));
  fireEvent.click(customer.getByRole("button", { name: "仍需人工服务" }));
  fireEvent.click(agent.getByRole("button", { name: "生成服务工单" }));
  fireEvent.click(engineer.getByRole("button", { name: "确认携件" }));
  fireEvent.click(engineer.getByRole("button", { name: "完成本次服务" }));

  expect(customer.getByRole("status")).toHaveTextContent("服务已完成");
  expect(
    operations.getByRole("button", { name: "创建改善任务" }),
  ).toBeEnabled();
  fireEvent.click(operations.getByRole("button", { name: "创建改善任务" }));
  expect(operations.getByRole("status")).toHaveTextContent("已进入闭环");

  fireEvent.click(operations.getByRole("button", { name: "重新演示" }));
  expect(customer.getByRole("button", { name: "饮料不够凉" })).toBeEnabled();
  expect(agent.getByRole("button", { name: "生成服务工单" })).toBeDisabled();
  expect(engineer.getByRole("button", { name: "确认携件" })).toBeDisabled();
});
```

Also add a self-resolved branch test that clicks `问题已解决` and confirms the agent button stays disabled.

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx vitest run src/features/showcase/components/service-journey-integration.test.tsx
```

Expected: FAIL，因为后台仍持有独立改善任务状态，重置未覆盖四个视角。

- [x] **Step 3: 将后台改善任务接入共享阶段**

Use:

```ts
type OperationsWorkspaceProps = Readonly<{
  journey: ServiceJourneyState;
  onCreateImprovementTask: () => void;
  onReset: () => void;
}>;
```

Keep `selectedTopic`, remove `taskTopic`, and define:

```ts
const serviceCompleted = journeyHasCompletedService(journey);
const taskCreated = journeyHasImprovementTask(journey);

useEffect(() => {
  if (journey.stage === "detected") setSelectedTopic("temperature");
}, [journey.stage]);
```

Disable “创建改善任务” until `serviceCompleted`; call `onCreateImprovementTask` when enabled. Before completion, status is `等待服务结果`; after completion it is `等待创建改善任务`; after creation it is `${topic.label}已进入闭环`. Reset sets the topic to `temperature` and calls `onReset`.

- [x] **Step 4: 在父级编排后台动作**

Render:

```tsx
<OperationsWorkspace
  journey={journey}
  onCreateImprovementTask={() => dispatch({ type: "createImprovementTask" })}
  onReset={() => dispatch({ type: "resetJourney" })}
/>
```

- [x] **Step 5: 更新页面和角色文案测试**

Change `landing-content.test.tsx` to expect:

```tsx
expect(
  screen.getByRole("heading", {
    name: "一次问题，四种角色，一条完整服务链",
  }),
).toBeInTheDocument();
expect(
  screen.getByText(
    "从 AI 自助、客服建单到工程师服务和后台改善，点击查看同一个问题如何一步步闭环。",
  ),
).toBeInTheDocument();
```

Change visible copy:

```tsx
// landing-content.tsx
title="一次问题，四种角色，一条完整服务链"
intro="从 AI 自助、客服建单到工程师服务和后台改善，点击查看同一个问题如何一步步闭环。"

// customer-workspace.tsx ambient block
<span>AI 自助服务</span>
<strong>能自己解决的，不必等待上门。</strong>
<p>AI 结合设备数据与知识库先给出可执行建议；仍未解决时，再把已收集的信息交给客服建单。</p>
```

In `content.ts`, replace `用户声音 → 服务上下文` with `用户自助 → 人工服务`, and replace `带着上下文上门` with `带着诊断结果上门`.

- [x] **Step 6: 确认 GREEN 并提交**

Run:

```bash
npx vitest run src/features/showcase/components/service-journey-integration.test.tsx src/features/showcase/components/perspective-workspaces.test.tsx app/landing-content.test.tsx
```

Expected: 完整人工路径、自助解决分支、全局重置和业务文案测试全部通过。

```bash
git add src/features/showcase/components/service-journey-integration.test.tsx src/features/showcase/components/perspective-tabs.tsx src/features/showcase/components/operations-workspace.tsx src/features/showcase/components/perspective-workspaces.test.tsx app/landing-content.tsx app/landing-content.test.tsx src/features/showcase/content.ts src/features/showcase/components/customer-workspace.tsx
git commit -m "feat: complete linked service journey"
```

---

### Task 5: 去掉用户进度横线并稳定新增内容布局

**Files:**
- Modify: `app/fullscreen-showcase-styles.test.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `.customer-service-progress .demo-timeline li::after { content: none; }`。
- Produces: `.customer-knowledge` 与 `.customer-resolution-actions` 的圆角、双列药丸和移动端布局。
- Preserves: `.customer-scene`、`.customer-phone`、`.customer-chat-controls` 既有固定几何契约。

- [x] **Step 1: 写 CSS 合约失败测试**

Append to `fullscreen-showcase-styles.test.ts`:

```ts
expect(css).toMatch(
  /\.customer-service-progress \.demo-timeline li::after\s*\{[\s\S]*?content:\s*none;/,
);
expect(css).toMatch(
  /\.customer-resolution-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
);
expect(css).toMatch(
  /\.customer-knowledge\s*\{[\s\S]*?border-radius:/,
);
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx vitest run app/fullscreen-showcase-styles.test.ts
```

Expected: FAIL，因为用户专属进度覆盖、知识卡和双按钮样式不存在。

- [x] **Step 3: 实现无线条进度和知识卡样式**

Add to `app/globals.css`:

```css
.customer-service-progress .demo-timeline li::after {
  content: none;
}

.customer-knowledge {
  padding: 12px 14px;
  color: var(--onecare-ink);
  background: var(--onecare-white);
  border: 1px solid #dfe4e2;
  border-radius: 18px;
}

.customer-knowledge > span {
  color: var(--onecare-teal-dark);
  font-size: 10px;
  font-weight: 700;
}

.customer-knowledge p,
.customer-knowledge ol {
  margin: 7px 0 0;
}

.customer-knowledge ol {
  padding-left: 18px;
  font-size: 11px;
  line-height: 1.65;
}

.customer-resolution-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.customer-resolution-actions button {
  width: 100%;
  min-height: 42px;
}
```

Keep the knowledge card inside `.customer-chat`, never in the fixed controls row. If mobile text wraps, increase only internal chat scroll; do not change phone or controls heights.

- [x] **Step 4: 确认 GREEN 并提交**

Run:

```bash
npx vitest run app/fullscreen-showcase-styles.test.ts src/features/showcase/components/service-journey-integration.test.tsx
```

Expected: CSS 合约和串联交互测试全部通过。

```bash
git add app/fullscreen-showcase-styles.test.ts app/globals.css
git commit -m "style: refine linked customer journey"
```

---

### Task 6: 文档、完整验证、浏览器闭环验收与 Preview

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-18-onecare-linked-service-journey-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-onecare-linked-service-journey.md`

**Interfaces:**
- Consumes: Tasks 1–5 的完整共享流程。
- Produces: 验证记录、新的非 Production Vercel Preview 与固定预览别名。

- [x] **Step 1: 运行完整自动化验证**

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

Expected: 所有命令退出码为 0，Audit 为 `0 vulnerabilities`。

- [x] **Step 2: 本地真实浏览器验收**

Build and start the production server, then use Playwright CLI at `1440 × 900` and `390 × 844`:

```text
用户“饮料不够凉” → “仍需人工服务”
切换客服 → “生成服务工单”
切换工程师 → “确认携件” → “完成本次服务”
切换后台 → “创建改善任务”
切回用户确认“服务已完成”
从任意视角“重新演示”并检查四个视角均回到初始禁用状态
```

For every user-visible stage, record `.customer-scene`、`.customer-phone` and `.customer-chat-controls` bounding boxes. Their `y` and `height` ranges must be `<= 1px`; the latest message must be visible inside `.customer-chat`; console must show 0 errors and 0 warnings.

2026-07-18 本地验收结果：桌面端抽样的 `detected`、`selfHelp`、`serviceRequested` 与 `improvementCreated` 四阶段中，场景为 `y=193.765625px / height=706.234375px`、手机为 `y=213.765625px / height=666.234375px`、操作槽为 `y=759px / height=44px`，极差均为 `0px`。移动端场景与手机固定为 `y=244.140625px / height=575.859375px`，操作槽 `y` 为 `702 / 701 / 701 / 701px`、高度固定为 `44px`；手机底部 `820px < 844px`，三个初始按钮宽度均为 `118px`。两端完整跑通用户转人工、客服建单、工程师服务、后台改善和全局重置；最新内容均可见，页面无横向溢出，控制台 0 错误、0 警告。

- [x] **Step 3: 更新 README、spec 和 plan**

README must state that the four roles now share one browser-local deterministic case state, list the self-help-to-improvement flow, and keep the boundary that no real business system or AI is connected. Record exact test counts and browser geometry in the spec and this plan.

2026-07-18 自动化结果：`npm test` 通过 17 个测试文件、66 个测试；`npm run test:runtime` 通过 3 个生产运行时测试；Lint、TypeScript、独立生产构建与 `git diff --check` 退出码为 0；依赖审计为 `0 vulnerabilities`。首次 Lint 发现并推动移除 effect 内同步本地状态的实现，改用 React 组件身份作为后台重置边界后复验通过。

- [x] **Step 4: 提交本地验收记录**

```bash
git add README.md docs/superpowers/specs/2026-07-18-onecare-linked-service-journey-design.md docs/superpowers/plans/2026-07-18-onecare-linked-service-journey.md
git commit -m "docs: verify linked service journey"
```

- [ ] **Step 5: 发布并匿名验收 Preview**

Run:

```bash
DEPLOY_OUTPUT=$(npx vercel deploy --yes)
PREVIEW_URL=$(printf '%s\n' "$DEPLOY_OUTPUT" | rg -o 'https://onecare-[^ ]+\.vercel\.app' | tail -1)
npx vercel alias set "$PREVIEW_URL" onecare-homepage-preview.vercel.app
```

Do not use `--prod`. Reuse or regenerate an expiring Vercel Share Link without writing its secret to the repository. In a new anonymous Playwright session, repeat the complete four-role path at desktop and mobile sizes and confirm the title, controls, shared updates, reset, no horizontal overflow, and 0 console errors/warnings.

- [ ] **Step 6: 记录部署并最终检查**

Record only the deployment ID, Ready status and alias in the spec/plan; keep the Share secret only in the final delivery message.

Run:

```bash
git diff --check
git status --short --branch
git log -12 --oneline
```

Expected: working tree clean, branch remains `codex/onecare-perspective-workspaces`, and commits are limited to this spec, plan, shared state, four workspaces, tests, styles, docs and Preview records.
