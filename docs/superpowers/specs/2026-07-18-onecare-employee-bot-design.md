# 万护 OneCare 员工机器人设计

## 状态

本规格记录 2026-07-18 已确认的员工机器人转向。飞书菜单已由用户配置完成；客服、工程师和运营人员共用一套菜单，当前不做岗位权限隔离。除“打开网页演示”直接跳转 OneCare 网站外，其余菜单均以文字消息发送给机器人。

## 目标

让当前已验证的飞书 HTTP 回调真正承接员工协同演示：

1. 员工进入与机器人的单聊会话时收到一张万护欢迎卡片；
2. 机器人识别已配置的八条中文、英文和中英双语菜单消息；
3. 客服、工程师和运营入口围绕同一个演示服务案例返回确定性信息；
4. 回调仍在三秒内确认，消息发送在请求后任务中完成；
5. 未使用的群事件通过验证后安全忽略，不触发业务动作。

## 已配置菜单

| 一级菜单 | English | 子菜单 | English | 动作 |
|---|---|---|---|---|
| 体验万护 | Explore OneCare | 打开网页演示 | Open Web Demo | 跳转 `https://onecare.ohmyfeishu.top/` |
| 体验万护 | Explore OneCare | 使用帮助 | Help | 发送文字消息 |
| 体验万护 | Explore OneCare | 运营后台 | Operations Center | 发送文字消息 |
| 客服工作台 | Service Desk | 待确认服务 | Pending Services | 发送文字消息 |
| 客服工作台 | Service Desk | 创建服务工单 | Create Ticket | 发送文字消息 |
| 客服工作台 | Service Desk | 查询服务进度 | Track Progress | 发送文字消息 |
| 工程师工作台 | Engineer Hub | 今日任务 | Today’s Tasks | 发送文字消息 |
| 工程师工作台 | Engineer Hub | AI预诊与配件 | AI Diagnosis & Parts | 发送文字消息 |
| 工程师工作台 | Engineer Hub | 提交服务结果 | Submit Result | 发送文字消息 |

菜单消息采用 `中文 / English` 形式；机器人同时接受中文、英文或完整双语文本，避免客户端语言和后台配置差异造成无法识别。

## 欢迎卡片

订阅事件：`im.chat.access_event.bot_p2p_chat_entered_v1`。

事件中的 `chat_id` 是主动发送目标。收到合法事件后，HTTP Route 立即返回 `200 {}`，再通过官方 Node SDK 的 `im.message.create` 向该 `chat_id` 发送 `interactive` 消息：

- 标题：`万护 OneCare`；
- 副标题：`AI 驱动的用户服务全链路协同助手`；
- 说明：用于客服、工程师和运营人员协同，不面向消费者；
- 当前演示案例：`OC-240718-037 · 冷藏室温度持续偏高`；
- 当前状态：`AI 已完成预诊，等待客服确认`；
- 引导：从底部菜单选择工作入口。

该 V2 事件在用户进入会话时触发，不等同于“首次创建会话”。当前无持久化存储，因此第一版每次合法进入都会发送简短欢迎卡片；24 小时去重需要持久化后再单独设计。

## 员工菜单回复

所有回复均为确定性演示内容，不调用大模型、知识库、IoT、工单或配件系统，也不持久化业务状态。

| 指令 | 回复要点 |
|---|---|
| 使用帮助 / Help | 说明三类岗位入口和当前案例，提示使用底部菜单 |
| 运营后台 / Operations Center | 服务总览、当前阶段、闭环风险和 VOC 主题入口 |
| 待确认服务 / Pending Services | 展示案例、AI 预诊结论和待客服确认动作 |
| 创建服务工单 / Create Ticket | 返回明确标注“演示”的工单摘要，不声称创建真实工单 |
| 查询服务进度 / Track Progress | 展示感知、预诊、客服确认、预约上门四阶段进度 |
| 今日任务 / Today’s Tasks | 展示工程师的演示任务、时间窗和地址脱敏信息 |
| AI预诊与配件 / AI Diagnosis & Parts | 展示传感器/风道诊断建议和建议携带配件 |
| 提交服务结果 / Submit Result | 返回演示服务结果和后续回访动作，不写入真实系统 |
| 其他文本 | 返回使用帮助，不再进入面向消费者的旧排障脚本 |

## 事件和消息边界

`parseFeishuEvent` 新增一种认证结果：

```ts
type FeishuEventOutcome =
  | { kind: "challenge"; challenge: string }
  | { kind: "message"; messageId: string; text: string }
  | { kind: "entered"; chatId: string }
  | { kind: "ignored" }
  | { kind: "unauthorized" };
```

事件分发器只注册：

- `im.message.receive_v1`：仅接受 `chat_type=p2p` 的文本；
- `im.chat.access_event.bot_p2p_chat_entered_v1`：仅接受非空 `chat_id`。

已订阅但本轮不用的解散群、机器人进群、机器人被移出群、用户进群等事件不会注册业务处理器，经过来源验证后返回 `200 {}`。

客户端适配器保留按 `message_id` 回复文本，并新增按 `chat_id` 主动发送消息。SDK 非零错误码统一映射为稳定内部错误，不记录飞书上游响应、消息正文或密钥。

## 安全与准确性

- App Secret、Verification Token、Encrypt Key 和 tenant token 只留在服务端；
- 原始事件、员工消息和飞书用户标识不进入普通日志；
- 缺少合法租户/事件验证时默认无访问；
- 当前共用菜单只是演示导航，不宣称具备岗位权限控制；
- 所有业务结果使用“演示”措辞，不声称真实工单、配件锁定或回访已经写入系统；
- 机器人不处理消费者服务请求，也不替代现有网站用户手机 Demo。

## 测试与验收

实现遵循 RED → GREEN → REFACTOR，至少覆盖：

1. 八条中文、英文和双语菜单指令均命中对应回复；
2. 未知文本返回员工帮助；
3. 欢迎卡片内容、消息类型和案例状态固定；
4. 合法进入事件解析为 `entered`，缺少 `chat_id` 安全忽略；
5. 群事件继续返回 `ignored`；
6. 主动消息使用 `receive_id_type=chat_id` 和 SDK `im.message.create`；
7. Route 对进入事件先确认再调度发送；
8. 发送失败只记录稳定常量标记；
9. 现有 challenge、签名校验、单聊回复和运行时测试保持通过；
10. `npm test`、`npm run test:runtime`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm audit --omit=dev`、`git diff --check` 全部通过。

## 非目标

- 岗位识别、岗位授权或不同用户显示不同菜单；
- 数据库、24 小时欢迎去重或事件 ID 持久化；
- 真实服务状态跨飞书与网页同步；
- 卡片按钮回调、机器人自定义菜单事件或群聊业务；
- LLM、RAG、真实 IoT、工单、配件、VOC 和回访集成。

## 实施与验收记录（2026-07-18）

本规格已在分支 `codex/onecare-employee-bot` 按 RED → GREEN 实现。机器人脚本已从消费者排障切换为八条员工菜单回复，并生成无按钮欢迎卡片；事件解析器已支持进入单聊事件；官方 SDK 适配器已支持按 `chat_id` 主动发送；Route Handler 会先确认事件，再调度欢迎卡片或原消息回复。群生命周期事件继续安全忽略。

本地验证结果：`npm test` 通过 24 个测试文件中的 110 项测试；`npm run test:runtime` 通过 1 个文件中的 4 项生产运行时测试；Lint、TypeScript 类型检查、显式生产构建、生产依赖审计和 `git diff --check` 均通过，依赖审计报告 0 个漏洞。

本分支尚未部署到 Production，也未发布新的飞书应用版本。仍需由真实企业成员验证进入会话欢迎卡片和八条菜单消息，完成前不宣称生产机器人已经可用。当前每次进入会话都会发送欢迎卡片，这是无持久化 MVP 的已知边界。

## 官方依据

- [飞书机器人概述](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/bot-overview)
- [飞书事件列表](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-list)
- [飞书发送消息 API](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create)
- [飞书 Node SDK](https://open.feishu.cn/document/server-docs/server-side-sdk)
