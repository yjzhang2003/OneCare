# 万护 OneCare 四视角串联服务旅程设计

## 背景

当前用户、客服、工程师和后台四个工作台虽然展示同一案例 `OC-240718-037`，但各自维护独立的本地状态。用户提交服务后，客服不会收到新请求；客服生成工单后，用户和工程师也不会更新。这使四个视角只有内容关联，没有可演示的业务流转。

用户视角的说明文案还过度强调“上下文”，没有讲清 AI 的首要价值：先结合设备数据和知识库帮助用户自行解决，无法解决时再把完整信息交给客服建单。用户进度条文字下方的连接横线也造成了多余的视觉噪声。

## 目标

1. 四个工作台共同消费并推进同一条浏览器内服务案例状态。
2. 明确展示“AI 自助优先，无法解决再转人工”的服务策略。
3. 客服建单后立即更新用户和工程师视角；工程师完成服务后立即更新用户和后台视角。
4. 保留确定性静态 Demo 边界，不接入真实 AI、知识库、工单、IoT、配件或 VOC 系统。
5. 去掉用户进度条步骤文字下方的小横线，保留圆点和状态文字。
6. 将页面和角色工作台中的“上下文”主叙事替换为更业务化的服务表达。

## 方案选择

### 采用：父级共享状态机

`PerspectiveTabs` 使用 `useReducer` 持有一份 `ServiceJourneyState`，四个角色工作台通过显式 props 读取状态并触发动作。纯 reducer、状态类型和派生判断独立放在 `service-journey.ts`。

选择理由：四个工作台都由 `PerspectiveTabs` 直接渲染，状态无需跨路由或跨应用共享；父级 reducer 能清晰表达顺序约束，也便于测试一次操作对多个视角的影响。

### 未采用：React Context

Context 适合更深层或跨页面消费，但当前组件只有一层直接传递。引入 Provider 会隐藏依赖并增加测试包装，当前阶段没有收益。

### 未采用：URL 或 LocalStorage 持久化

持久化可以在刷新后恢复，但会引入版本迁移、旧状态和分享链接语义。本轮只要求同一次浏览器会话内串联，刷新后回到初始演示状态更可控。

## 共享服务状态

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
```

允许的动作与转换：

| 动作 | 前置阶段 | 下一阶段 | 业务含义 |
| --- | --- | --- | --- |
| `answerDiagnosis(reply)` | `detected` | `selfHelp` | 用户回答，AI 完成预诊并给出知识库自助方案 |
| `markSelfResolved()` | `selfHelp` | `selfResolved` | 用户确认自助方案已解决问题，流程在用户侧结束 |
| `requestHumanService()` | `selfHelp` | `serviceRequested` | 自助失败，服务请求进入客服队列 |
| `createWorkOrder()` | `serviceRequested` | `workOrderCreated` | 客服创建工单并分配工程师 |
| `confirmParts()` | `workOrderCreated` | `partsConfirmed` | 工程师核验建议携件 |
| `completeService()` | `partsConfirmed` | `serviceCompleted` | 工程师完成首次上门服务 |
| `createImprovementTask()` | `serviceCompleted` | `improvementCreated` | 后台把服务结果转为改善任务 |
| `resetJourney()` | 任意阶段 | `detected` | 重置整条案例，`customerReply` 恢复为 `null` |

Reducer 对不满足前置阶段的动作返回原状态，避免通过单个角色跳过服务步骤。

## 角色体验

### 用户视角

左侧环境文案改为：

- 小标题：`AI 自助服务`
- 标题：`能自己解决的，不必等待上门。`
- 正文：`AI 结合设备数据与知识库先给出可执行建议；仍未解决时，再把已收集的信息交给客服建单。`

用户流程：

1. `detected`：显示主动异常提醒和三个快捷回答。
2. 点击任一回答进入 `selfHelp`，右侧用户气泡显示实际点击的回答；AI 展示设备预诊，并给出知识库自助建议：确认门体闭合、保持出风口无遮挡、减少开门后等待十分钟。
3. 固定底部操作槽显示两个药丸按钮：`问题已解决` 和 `仍需人工服务`。
4. `selfResolved`：显示“本次问题已通过 AI 指引解决”，不创建客服请求。
5. `serviceRequested`：显示“已转人工，等待客服建单”。此时不得提前声称已预约上门。
6. `workOrderCreated` 或 `partsConfirmed`：显示真实共享工单号、工程师和上门时间，状态更新为“客服已建单”。
7. `serviceCompleted` 或 `improvementCreated`：显示“服务已完成”，保留完整进度。

用户进度改为四步：`发现异常`、`AI 自助`、`客服建单`、`服务完成`。该进度仅使用圆点和状态文字，`.customer-service-progress` 内所有步骤连接伪元素均不显示。

### 客服视角

- 顶部状态“上下文已同步”改为“自助记录已同步”。
- `detected`、`selfHelp`、`selfResolved` 时，“生成服务工单”不可用；状态说明分别表达尚未转人工或已自助解决。
- `serviceRequested` 时，队列首项显示“用户自助未解决”，当前会话展示用户实际回答、AI 预诊和已尝试的知识库步骤；“生成服务工单”可用。
- 点击后进入 `workOrderCreated`，显示共享工单号、工程师和分配结果；用户与工程师视角立即读取该结果。
- 后续阶段保持工单已生成，不允许重复建单。

### 工程师视角

- `workOrderCreated` 之前显示“等待客服建单”，确认携件和完成服务均不可用。
- `workOrderCreated` 后显示已分配任务，允许“确认携件”。
- `partsConfirmed` 后允许“完成本次服务”。
- `serviceCompleted` 与 `improvementCreated` 显示“首次上门完成”，不允许重复完成。
- 工程师视角的“重新演示”调用全局重置，而非只重置工程师本地状态。

### 后台视角

- `serviceCompleted` 之前，“创建改善任务”不可用，闭环区说明“等待服务结果”。
- `serviceCompleted` 后展示关联案例已完成、首次上门结果和待沉淀线索，并允许创建改善任务。
- 点击后进入 `improvementCreated`，显示任务归属并将闭环步骤推进到产品改进。
- 主题切换仍为本工作台本地展示状态；全局重置同时恢复默认主题和共享案例状态。

## 页面叙事调整

四视角一级标题改为：

- 标题：`一次问题，四种角色，一条完整服务链`
- 说明：`从 AI 自助、客服建单到工程师服务和后台改善，点击查看同一个问题如何一步步闭环。`

其他明显面向用户的“上下文”文案同步替换：

- 客服交接：`用户自助 → 人工服务`
- 五层引擎服务阶段：`带着诊断结果上门`

技术文档中描述 React 或数据传递时仍可使用“上下文”这一技术术语；本轮只调整产品界面的主叙事。

## 组件边界

- `service-journey.ts`：状态类型、初始状态、动作和纯 reducer；不包含 React。
- `perspective-tabs.tsx`：唯一持有 `useReducer` 的组件，负责向四个工作台传递共享状态与动作。
- `customer-workspace.tsx`：用户对话、自助知识卡和用户侧进度；不再持有独立业务 stage。
- `agent-workspace.tsx`：根据共享阶段决定队列、摘要和建单能力；不再持有 `created`。
- `engineer-workspace.tsx`：根据共享阶段决定任务解锁；不再持有本地 `EngineerStage`。
- `operations-workspace.tsx`：保留本地 VOC 主题选择，但改善任务状态来自共享旅程。
- `perspective-demo-data.ts`：保存确定性知识库建议、工单、工程师、预约和文案。

所有工作台 props 必须显式声明需要的 state 和 callback，禁止从未约束的全局变量读取状态。

## 可访问性与视觉约束

- 所有新增操作使用药丸文字按钮，文字居中且无箭头。
- 知识库建议使用白色圆角内容块，不新增方形卡片。
- 用户手机外壳、底部操作槽和内部滚动的既有几何契约继续成立。
- 禁用按钮必须使用原生 `disabled`，状态变化通过既有 `aria-live` 区域播报。
- Tab 键盘行为、inactive panel 的 `inert` 和左右全屏切换保持不变。
- `390 × 844` 下自助方案与后续消息只能增加 `.customer-chat` 内部滚动，不得撑高手机或操作槽。

## 重置规则

四个工作台的“重新演示”均调用 `resetJourney()`。重置后：

- 共享阶段回到 `detected`；
- 用户回答被清空；
- 客服回到等待转人工；
- 工程师回到等待工单；
- 后台改善任务被清空并恢复温度主题；
- 当前选中的角色 Tab 保持不变，避免重置造成页面跳转。

## 测试与验收

### reducer 测试

1. 完整人工服务路径按顺序推进至 `improvementCreated`。
2. `selfHelp` 可进入 `selfResolved`，且不能再创建工单。
3. 不满足前置条件的动作不改变状态。
4. 任意阶段重置后回到初始状态并清空用户回答。

### 组件串联测试

1. 初始客服建单按钮、工程师操作和后台改善按钮均禁用。
2. 用户选择回答后看到知识库建议与两个分支按钮。
3. 点击“仍需人工服务”后，客服队列和按钮立即更新。
4. 客服生成工单后，用户显示工单信息，工程师确认携件按钮解锁。
5. 工程师完成服务后，用户显示服务完成，后台改善按钮解锁。
6. 后台创建改善任务后显示闭环状态。
7. 任一角色重置后四个视角全部恢复初始状态。
8. 点击“问题已解决”后客服仍不可建单。
9. 用户环境文案和页面主标题不再使用“上下文”。

### CSS 与真实浏览器

- CSS 合约确认 `.customer-service-progress .demo-timeline li::after` 不显示。
- `1440 × 900` 和 `390 × 844` 完整执行人工服务路径，并逐次切换四个 Tab。
- 用户手机从 `detected` 到 `improvementCreated` 的各可见阶段中，外壳、场景和操作槽位置变化不超过 `1px`。
- 页面无横向溢出；所有新消息在手机内部滚动后可见。
- 控制台为 0 错误、0 警告、0 hydration 异常、0 资源 404。

## 非目标

- 真实模型推理、向量检索或知识库连接；
- 真实工单、工程师调度、配件库存、预约、回访或 VOC 写入；
- 页面刷新后的案例状态持久化；
- 多案例队列和并发处理；
- 飞书认证、Dashboard、Production 配置或系统五层架构重构；
- 推送、创建 PR、合并或 Production 部署，除非用户另行要求。

## Preview

实现与完整验证通过后，只发布新的非 Production Vercel Preview，并重新绑定 `onecare-homepage-preview.vercel.app`。使用匿名限时 Share Link 复核完整串联路径，Share secret 不写入仓库。
