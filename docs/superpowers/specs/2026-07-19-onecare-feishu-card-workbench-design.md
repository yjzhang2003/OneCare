# 万护 OneCare 飞书卡片工作台设计

## 状态

本规格记录 2026-07-19 已确认的飞书机器人卡片化重构。用户要求机器人不再返回纯文字信息；欢迎、帮助、八条员工菜单回复、未知输入兜底、查询结果和操作结果全部使用飞书 Card 2.0。菜单仍可向机器人发送文字作为触发输入，“打开网页演示”仍可直接跳转网站，但机器人的所有可见业务输出必须是卡片。

当前生产回调已能接收进入会话与菜单消息。开通 `im:message:send_as_bot` 后，2026-07-19 的三次生产回调均返回 HTTP 200 且未再记录发送权限错误；这只证明现有消息发送权限生效，不代表本规格中的卡片按钮回调已经配置或验收。

## 目标

1. 将员工机器人从“文字命令 → 纯文字回复”升级为全部 Card 2.0 输出；
2. 把欢迎卡片升级为客服、工程师和运营人员共用的卡片工作台；
3. 为卡片增加岗位入口、查询跳转、工单创建、配件确认和结果提交按钮；
4. 查询与导航操作生成新的卡片消息，状态动作原地更新当前卡片并禁用重复操作；
5. 复用同一个经过验证的 Production 回调域名，在三秒内完成 `card.action.trigger` 响应；
6. 保持当前确定性、无数据库、无真实业务写入的比赛演示边界。

## 选定方案

采用“卡片工作台”混合交互，而不是纯单卡状态机或每次点击都堆叠新消息：

- 员工进入机器人单聊时，主动发送一张总览工作台卡片；
- 飞书自定义菜单发送文字命令后，机器人以对应岗位卡片回复原消息；
- 查询、岗位切换和导航按钮通过卡片回调确认后，向当前单聊发送一张新的详情卡片；
- 创建演示工单、确认演示配件、提交演示服务结果等状态动作，直接把被点击的卡片更新成完成态，并禁用已完成按钮；
- `open_url` 按钮只负责打开 `https://onecare.ohmyfeishu.top/`，不触发服务端回调；
- Toast 只用于“操作已完成”或“无法识别操作”等短反馈，不能替代主体卡片。

这种结构保留可回看的服务链路，同时避免每个状态动作都产生重复卡片。

## 卡片视觉系统

### 全局约束

- 版本：Card 2.0，根字段必须包含 `"schema": "2.0"`；
- 宽度：`config.width_mode = "default"`，不使用 `fill` 宽表格；
- 共享更新：`config.update_multi = true`；
- 结构：`header + 2–4 个 body 视觉块`，单卡不超过 5 个视觉块；
- 主色：海信青与万护黑白为品牌基线，状态语义使用 yellow、green、red 和 grey；单卡主色系不超过 3 种；
- Header：至少包含标题、场景图标和状态标签；副标题只放案例号、角色或阶段；
- 字段详情：优先使用 `div.fields`，不使用一段 Markdown 模拟多组 label/value；
- 指标：使用 `column_set` + 等权 `column`，不用 `stretch`；
- 分组：使用浅色背景块或描边容器，不用连续 `hr` 平铺；
- 按钮：多按钮时一主多次，主按钮为 `primary_filled`，其余为 `default`；危险操作才使用红色；
- 文案：正文用加粗层级，不使用巨大的 Markdown 标题；所有动态文本限制行数；
- 图标：欢迎/AI 使用 `myai_colorful`，任务使用 `todo_colorful`，运营指标使用 `chart_colorful`，完成状态使用语义一致的图标；
- 客户端下限：Card 2.0 需要飞书客户端 7.20 及以上，真实验收需覆盖桌面端和移动端。

### 卡片状态色

| 卡片 | Header | 状态标签 | 唯一主焦点 |
|---|---|---|---|
| 工作台 / 帮助 | turquoise | `演示工作台` | 当前案例与阶段 |
| 待确认服务 | yellow | `待客服确认` | AI 预诊结论 |
| 演示工单 | orange；完成后 green | `待创建` / `已创建·演示` | 工单号与下一步 |
| 服务进度 | blue | `客服确认中` | 当前阶段 |
| 今日任务 | blue | `待上门·演示` | 14:00–16:00 任务 |
| AI 预诊与配件 | turquoise；确认后 green | `待核验` / `配件已确认·演示` | 建议携带配件 |
| 服务结果 | yellow；提交后 green | `待提交` / `已提交·演示` | 结果与自动回访 |
| 运营后台 | blue | `闭环监控·演示` | 1 个流转案例与风险 |

## 卡片清单

### 1. 工作台卡片

触发：进入单聊会话、`使用帮助 / Help`、未知文本。

内容：

- 标题 `万护 OneCare 员工工作台`；
- 副标题 `OC-240718-037 · AI 已完成预诊`；
- 说明仅供客服、工程师和运营人员协同演示，不面向消费者；
- 当前案例与 `等待客服确认` 状态块；
- 三个岗位入口按钮：`客服待确认`、`工程师任务`、`运营后台`；
- 次要 `打开网页演示` 按钮使用 `open_url`。

岗位入口是 callback 按钮，分别回传 `open_pending`、`open_tasks` 和 `open_operations`。

### 2. 待确认服务卡片

触发：菜单 `待确认服务 / Pending Services` 或 `open_pending`。

内容：案例号、问题、AI 预诊结论、设备信号摘要、待客服动作。

按钮：

- 主操作 `创建演示工单` → `create_ticket`，原地更新为已创建的演示工单卡；
- 次操作 `查看 AI 预诊与配件` → `open_diagnosis`，发送新卡片。

### 3. 演示工单卡片

触发：菜单 `创建服务工单 / Create Ticket` 时直接显示“待创建”的演示工单卡；点击 `create_ticket` 后显示“已创建·演示”状态。

内容：工单号 `OC-240718-037`、问题、建议动作、隐私脱敏说明。卡片必须明确“未写入真实工单系统”。

按钮：

- 待创建状态：`创建演示工单`；
- 已创建状态：该按钮禁用，文字变为 `演示工单已创建`；
- `查询服务进度` → `open_progress`，发送新卡片；
- `查看工程师任务` → `open_tasks`，发送新卡片。

### 4. 服务进度卡片

触发：菜单 `查询服务进度 / Track Progress` 或 `open_progress`。

内容：以四个步骤块展示 `发现异常 → 完成预诊 → 客服确认 → 预约上门`，当前焦点为客服确认。不得使用原来的纯文字圆点列表。

按钮：`查看工程师任务`、`查看运营闭环`，均发送新卡片。

### 5. 今日任务卡片

触发：菜单 `今日任务 / Today's Tasks` 或 `open_tasks`。

内容：一个演示上门任务、时间窗、脱敏地点、设备型号核验提示。

按钮：

- `查看 AI 预诊与配件` → `open_diagnosis`，发送新卡片；
- `提交演示服务结果` → `open_result`，发送结果卡片，不直接宣称完成。

### 6. AI 预诊与配件卡片

触发：菜单 `AI预诊与配件 / AI Diagnosis & Parts` 或 `open_diagnosis`。

内容：三类可能原因、建议携带配件、上门前核验项。所有结论标注为 AI 演示建议。

按钮：

- 主操作 `确认演示配件已备齐` → `confirm_parts`，原地更新为绿色完成态并禁用按钮；
- 次操作 `返回今日任务` → `open_tasks`，发送新卡片。

### 7. 服务结果卡片

触发：菜单 `提交服务结果 / Submit Result` 或 `open_result`。

内容：传感器核验、风道清理、温度恢复观察、下一步自动回访。初始状态为待提交。

按钮：

- 主操作 `提交演示结果` → `submit_result`，原地更新为绿色完成态并禁用按钮；
- 次操作 `查看运营闭环` → `open_operations`，发送新卡片。

完成态必须明确“未写入真实服务或回访系统”。

### 8. 运营后台卡片

触发：菜单 `运营后台 / Operations Center` 或 `open_operations`。

内容：三个并列指标块（流转案例、超时风险、VOC 聚集主题）、当前阶段、30 分钟协同提醒规则和演示边界。

按钮：`查看服务进度` 与 `打开网页演示`；前者发送新卡片，后者使用 `open_url`。

## 命令与卡片映射

现有八组中文、英文和双语命令保持兼容，但返回值从 `text` 改为 `interactive`：

| 指令 Kind | 卡片 |
|---|---|
| `help` | 工作台卡片 |
| `operations` | 运营后台卡片 |
| `pending` | 待确认服务卡片 |
| `ticket` | 待创建演示工单卡片 |
| `progress` | 服务进度卡片 |
| `tasks` | 今日任务卡片 |
| `diagnosis` | AI 预诊与配件卡片 |
| `result` | 待提交服务结果卡片 |
| 未知文本 | 工作台卡片 |

`FeishuOutboundMessage.msgType` 在本轮后只允许 `"interactive"`。仓库不得继续生成机器人纯文字业务回复。

## 按钮协议

Callback 按钮使用 Card 2.0：

```json
{
  "tag": "button",
  "text": { "tag": "plain_text", "content": "查看服务进度" },
  "type": "primary_filled",
  "behaviors": [
    {
      "type": "callback",
      "value": {
        "action": "open_progress",
        "case_id": "OC-240718-037"
      }
    }
  ]
}
```

允许的 action 使用闭合集合：

```ts
type OneCareCardAction =
  | "open_pending"
  | "open_tasks"
  | "open_operations"
  | "open_diagnosis"
  | "open_progress"
  | "open_result"
  | "create_ticket"
  | "confirm_parts"
  | "submit_result";
```

服务端只接受 `case_id === "OC-240718-037"` 和上述 action。未知 action、缺失 action、错误案例号或非按钮回调不执行业务动作，只返回中性 Toast，且不回显输入。

## 事件与回调架构

### 分离两个传输语义

继续复用同一个 HTTP Route：

`POST https://onecare.ohmyfeishu.top/api/feishu/events`

但代码必须区分：

1. 事件订阅：`im.message.receive_v1`、`im.chat.access_event.bot_p2p_chat_entered_v1`；
2. 回调订阅：`card.action.trigger`。

飞书开发者后台的“事件配置”和“回调配置”是两个独立页签。实现部署后，需要在“回调配置”中使用同一请求地址，添加新版“卡片回传交互”回调，并发布应用版本。卡片回调本身不需要额外权限；生成新卡片消息继续依赖已开通的应用身份发消息权限。

### 认证结果

`parseFeishuEvent` 扩展为：

```ts
type FeishuEventOutcome =
  | { kind: "challenge"; challenge: string }
  | { kind: "message"; messageId: string; text: string }
  | { kind: "entered"; chatId: string }
  | {
      kind: "card_action";
      eventId: string;
      tenantKey: string;
      chatId: string;
      messageId: string;
      action: OneCareCardAction;
    }
  | { kind: "invalid_card_action" }
  | { kind: "ignored" }
  | { kind: "unauthorized" };
```

Card callback 必须通过签名、Verification Token 与 Encrypt Key 验证；必须具有由验证后 Header 得到的 `event_id`、`tenant_key`、应用 ID、`context.open_chat_id` 和 `context.open_message_id`。缺少可信 tenant context 时默认无访问。操作者 Open ID 不参与 MVP 岗位判断、不持久化、不记录。

使用官方 Node SDK 的 `CardActionHandler` 或等价的官方验证能力解析新版回调，不自行猜测旧版 payload。现有事件解析继续由官方 SDK `EventDispatcher` 承担。

### 两类按钮响应

#### 导航与查询

`open_*` 动作在三秒内返回 HTTP 200 与简短 Toast，然后通过 Next.js `after()` 使用 `context.open_chat_id` 发送一张新的 Card 2.0 消息。发送失败只记录稳定内部标记，不返回飞书上游响应。

#### 状态动作

`create_ticket`、`confirm_parts`、`submit_result` 在三秒内同步返回：

```json
{
  "toast": {
    "type": "success",
    "content": "演示状态已更新"
  },
  "card": {
    "type": "raw",
    "data": {
      "schema": "2.0"
    }
  }
}
```

`card.data` 必须是完整的新 Card 2.0，不允许部分更新，也不允许从 2.0 降为 1.0。卡片生成是本地确定性纯函数，不调用外部服务，因此必须在三秒内完成。

## 代码边界

为避免现有 `bot-script.ts` 膨胀，按职责拆分：

- `src/features/feishu-bot/card-types.ts`：卡片视图、动作、状态与回调响应类型；
- `src/features/feishu-bot/cards.ts`：纯函数生成全部 Card 2.0 JSON 与 `FeishuOutboundMessage`；
- `src/features/feishu-bot/bot-script.ts`：只负责文字命令归一化并映射到卡片视图；
- `src/features/feishu-bot/event-handler.ts`：验证并解析消息、进入会话和卡片回调；
- `src/features/feishu-bot/client.ts`：按消息 ID 回复 interactive 卡片，或按 chat ID 发送 interactive 卡片；
- `app/api/feishu/events/route.ts`：区分异步消息发送与同步卡片更新响应。

卡片构造复用一个根骨架、Header 工厂、字段块、指标块和按钮工厂；不得为八张卡复制完整根 JSON。

## 无状态边界

- 不新增数据库、KV、队列或 Vercel 内存会话；
- 状态动作只改变被点击卡片的可见状态；
- 重新使用飞书底部菜单会生成该菜单定义的初始卡片，不保证继承其他卡片上的演示状态；
- 不把按钮 value 当作真实工单状态，不写入网页四视角状态；
- 不做岗位权限隔离，客服、工程师和运营成员仍共用同一套入口；
- 不做 event ID 持久化去重；按钮重复点击通过完成态禁用降低重复，但不宣称具备真实幂等保障。

## 错误处理与日志

- URL Verification challenge 保持兼容；
- 验证失败返回 403，不生成卡片；
- 已验证但未支持的普通事件返回 200 `{}` 并忽略；
- 非法卡片 action 返回 HTTP 200 与中性 Toast，不发送新卡片；
- 卡片 JSON 构造失败返回 HTTP 200 与安全错误 Toast，不返回堆栈；
- 回调不得返回 3xx；
- 发送和回复 SDK 失败只记录 `send_failed` 或 `reply_failed` 等稳定标记；
- 关闭官方 SDK 上游错误对象的默认输出，日志不得包含原始事件、消息正文、卡片 value、chat ID、message ID、open ID、tenant token、上游响应或任何密钥。

## 安全与准确性

- App Secret、Verification Token、Encrypt Key 和 tenant token 只留在服务端；
- 卡片 callback action 使用严格 allowlist，不把客户端传来的角色、租户或状态作为可信授权依据；
- tenant context 只来自通过验证的飞书回调 Header；缺失时无访问；
- 当前单企业自建应用不实现跨企业数据模型；
- 所有工单、配件、诊断、服务结果、指标和 VOC 信息明确标注为“演示”；
- 卡片不声称调用真实 AI、IoT、知识库、工单、配件、回访或 VOC 系统；
- 卡片不得展示真实用户姓名、手机号、地址或设备序列号。

## 测试与验收

实现必须遵循 RED → GREEN → REFACTOR。

### 卡片纯函数

1. 八个命令 kind、欢迎和未知输入全部产生 `msgType: "interactive"`；
2. 每张卡包含 `schema: "2.0"`、`config.width_mode: "default"`、Header 图标和演示标记；
3. 不存在 `text` 类型机器人业务输出；
4. 每个 callback 按钮使用 `behaviors[].type = "callback"`，action 和案例号符合 allowlist；
5. 网页按钮只使用 `open_url`；
6. 状态完成卡片使用 green Header、禁用已完成按钮并保留演示声明；
7. 卡片 JSON 满足组件嵌套规则，`column_set` 直接子节点只有 `column`；
8. 卡片视觉块、主按钮数量和主色数量满足 P0–P7 结构化 Gate。

### 事件解析

1. 合法新版 `card.action.trigger` 解析为 `card_action`；
2. 缺失 tenant、event ID、chat ID、message ID、action 或案例号时拒绝动作；
3. 非 allowlist action 解析为 `invalid_card_action`；
4. 错误签名、Token、Encrypt Key 或 App ID 返回 `unauthorized`；
5. 现有 challenge、进入会话、单聊文本和群事件忽略行为保持通过。

### Route

1. 菜单文本仍先确认事件，再异步回复 interactive 卡片；
2. 进入会话仍先确认，再异步发送工作台卡片；
3. 导航 action 返回 200 后调度发送新的 interactive 卡片；
4. 状态 action 在 200 响应中返回 Toast 与完整 Card 2.0；
5. 非法 action 返回安全 Toast，不调用发送或回复适配器；
6. 任何失败都不泄露原始错误和标识符；
7. 生产运行时 URL Verification 测试保持通过。

### 外部验收

1. Vercel Preview 只验证构建和无密钥安全边界，不能验证真实卡片回调；
2. Production 部署后确认事件函数仍位于 `hkg1`；
3. 飞书后台“回调配置”使用 `https://onecare.ohmyfeishu.top/api/feishu/events` 并添加新版 `card.action.trigger`；
4. 发布应用版本后，在桌面端和移动端确认欢迎、八条菜单和未知输入都只返回卡片；
5. 点击所有导航按钮，确认生成正确的新卡片；
6. 点击三个状态按钮，确认原卡片更新、按钮禁用且显示成功 Toast；
7. 确认没有纯文字机器人业务回复、卡片错误提示或三秒超时。

完整验证命令：

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
```

## 非目标

- 真实岗位识别和权限隔离；
- 数据库、KV、队列、跨卡片状态持久化或事件去重；
- 卡片模板平台、CardKit 流式卡片实体或大模型流式输出；
- 表单、日期选择器、人员选择器、图片上传或群聊业务；
- 真实 AI、RAG、IoT、工单、配件、VOC、回访或网页状态同步；
- 修改现有飞书自定义菜单结构；
- 将 Preview URL 用作真实飞书回调地址。

## 官方依据

- [飞书卡片概述](https://open.feishu.cn/document/feishu-cards/feishu-card-overview)
- [新版 Card 2.0 说明](https://open.feishu.cn/document/feishu-cards/feishu-card-cardkit/cardkit-upgraded-version-card-release-notes?lang=zh-CN)
- [卡片回传交互回调](https://open.feishu.cn/document/feishu-cards/card-callback-communication?lang=zh-CN)
- [飞书服务端 SDK 处理回调](https://open.feishu.cn/document/server-side-sdk/golang-sdk-guide/handle-callback?lang=zh-CN)
- [飞书卡片常见问题](https://open.feishu.cn/document/common-capabilities/message-card/message-card)
- [发送消息 API](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create)
