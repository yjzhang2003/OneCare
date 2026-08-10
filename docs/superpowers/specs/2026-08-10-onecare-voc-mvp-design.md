# 万护 OneCare：VOC 闭环 MVP 设计

- 日期：2026-08-10
- 状态：待用户评审
- 提交截止：2026-08-16 24:00（剩 6 天）
- 命题来源：海信集团｜AFFT 协同文档
- 参考案例：星纪魅族｜用飞书多维表格，打造售后 VOC AI 智能应用
- 本版依据：2026-08-10 独立评审结论，已修正上一版的三处致命问题与六处事实错误

## 1. 背景与范围

### 1.1 当前状态

仓库是一个已部署的单企业方案展示站：四个角色视角共享一份浏览器内演示状态，卡片动作校验硬编码案例号（`event-handler.ts:141`），机器人无状态。没有数据库、没有模型调用、没有持久化。

### 1.2 评分锚点

参考案例的说服力来自四件事，本设计据此对齐：真实数据可被运营人员直接查看、AI 真实打标、工单在飞书内真实流转、收益量化。

**注意参考案例用的是多维表格 AI 字段捷径，不是 aily。** 本设计的 AI 引擎为双轨（见 §5），以消除单点依赖。

### 1.3 范围：三件事 + 话术生成

1. **真实 VOC 数据入多维表格，AI 真实打标落列**
2. **一条中差评在飞书卡片内走完 `待跟进 → 跟进中 → 待闭环 → 已闭环`**，服务端做 `record_id` + 负责人 `open_id` + 状态转移三重校验，拒绝时给出明确提示
3. **看板读真实聚合，每个数字可在 Base 里点开对账**
4. **AI 回复话术生成**，仅作人工参考写入表格

第 2 条是「不是表格、是系统」的唯一硬证据；第 3 条是评委唯一能自行验证的东西。

### 1.4 明确的范围外

本期不实现，且必须在提交文档与仓库文档中标注为规划中：

- 真实 IoT 与智能预诊、智能客服自由文本对话、自动回访
- **周期洞察报告技能**（`voc-insight`）
- **xlsx 导入路由**：改用多维表格自带「导入 Excel」，这本就是参考案例里运营人员的真实动作
- **重试队列、指数退避、令牌桶**：改用可恢复分片作业（§5.6）
- **首次响应时长、环比、按日趋势**：源数据只有一个周期，环比无从计算
- **网站 OAuth 登录与角色**：评委已在同一企业内，登录不再是访问前提；卡片鉴权身份来自事件签名保证的 `event.operator.open_id`，从不读网站会话
- 用户、客服、工程师三视角改造；多企业租户隔离

## 2. 架构

### 2.1 分层原则

**IO 在边缘，逻辑在中心。** 沿用仓库已有模式：`fetcher: typeof fetch = fetch` 注入（见 `auth/feishu.ts`、`feishu-bot/client.ts`），解析与判定为纯函数（见 `event-handler.ts`）。

### 2.2 数据流

```
VOC xlsx ──运营手动「导入 Excel」──▶ 多维表格「VOC 记录表」
                                          │
                        ┌─────────────────┴─────────────────┐
                        │  打标（双轨，见 §5）                │
                        │  A) aily skill start（优先）        │
                        │  B) 多维表格 AI 字段捷径（兜底）     │
                        └─────────────────┬─────────────────┘
                                          │ 打标结果落列
                                          ▼
                    Next.js 服务端：状态机 + triage + 指标聚合
                                          │
                                          │ 现有机器人（Card 2.0 + card.action.trigger 已跑通）
                                          ▼
                    中差评卡片推负责人 → 点按钮 → 三重校验 → 写回状态
                                          │
                                          ▼
                    公开看板页读真实聚合（只出数字，不出原文）
```

### 2.3 模块清单

```
src/lib/env.ts                    扩展 readBitableEnv() / readTaggingEnv()

src/features/bitable/             薄 IO 层
  client.ts                       记录 get/list/update，注入 fetcher，显式 user_id_type=open_id
  field-map.ts                    字段名 ↔ 领域类型的唯一映射点
  schema-guard.ts                 启动时校验 Base 字段清单，缺字段即 503

src/features/tagging/             打标提供方抽象（双轨的接缝）
  provider.ts                     TaggingProvider 接口
  aily-provider.ts                A 轨：skill start，注入 fetcher
  field-shortcut-provider.ts      B 轨：直接读多维表格 AI 字段值
  contracts.ts                    打标结果契约与运行时校验

src/features/voc/                 纯逻辑，零 IO
  triage.ts                       打标结果 → 严重度 / 是否建单
  service-event.ts                状态机（含单调序号与幂等）
  metrics.ts                      指标聚合

app/api/voc/analyze/route.ts      分片打标，仅 Cron 可调用
app/api/voc/dashboard/route.ts    聚合查询，只返回数字
app/dashboard/voc/page.tsx        公开看板页
```

`field-map.ts` 与 `schema-guard.ts` 成对存在：多维表格字段名可被运营人员随手改，映射收敛到一处，且启动时主动校验——否则改名的表现是静默写空，比报错危险得多。

### 2.4 现有代码改动面

| 位置 | 现状（已核实） | 改为 |
| --- | --- | --- |
| `event-handler.ts:104-112` | `authorizedEventHeader` 校验 `app_id` + `tenant_key` | 不变 |
| `event-handler.ts:139-143` | `caseId !== ONECARE_CASE_ID` 对所有卡片动作等值校验 | **按动作类型分流**：九个演示动作保持 `case_id` 校验不变；四个 VOC 动作要求 `record_id` 形如 `rec*` 且 `operator.open_id` 非空。`FeishuEventOutcome` 的 `card_action` 分支（21-26 行）扩展 `recordId` 与 `operatorOpenId` |
| `card-types.ts` | 39 行，含 `ONECARE_CASE_ID` 与 action 白名单 | **保留** `ONECARE_CASE_ID`——`cards.ts` 有 8 处在用，既是保留的八类演示卡文案，也是其按钮载荷（`cards.ts:66`）。一刀切移除会让演示卡按钮全部失效。新增 `VOC_CARD_ACTIONS` 白名单 |
| `card-actions.ts` | 80 行，**不引用** `ONECARE_CASE_ID`；`resolveCardAction(action)` 同步单参 | 改为 async 多参，接收 `record_id` 与 `operatorOpenId`，做三重校验 |
| `app/api/feishu/events/route.ts:50` | `resolveAction: (action) => CardActionResult` 同步单参 | 签名改 async 多参；`route.test.ts` 同步改 |
| `cards.ts` | 403 行八类演示卡 | 复用 Card 2.0 外壳，新增 VOC 工单卡 |
| `perspective-demo-data.ts` | 76 行，含 `vocTopics` | 移除 `vocTopics` |
| `perspective-demo-data.test.ts:19` | `expect(vocTopics[0].relatedCaseId).toBe(serviceCase.id)` | 删除该断言 |
| `operations-workspace.tsx` | `"use client"`，渲染演示数据含硬编码趋势条 | 真实指标由服务端穿透 `PerspectiveTabs` props 传入；趋势条删除 |
| `vercel.json` + `vercel-config.test.ts` | `toEqual` 全表断言，仅 events 钉 `hkg1` | `app/api/voc/**` 一并钉 `hkg1`；测试同步改 |
| `.gitignore` | 不排除 `docs/data/` | 新增 `docs/data/` |
| `session.ts` / `cookies.ts` | 会话仅 `openId` + `name` | **不动**（登录已移出范围） |

上一版规格把卡片案例号校验的位置写在 `card-actions.ts`，是错的；真实位置为 `event-handler.ts:141`。

## 3. 数据模型

### 3.1 数据落地方式

**xlsx 不进仓库。** 仓库是 public（已核实 `{"isPrivate":false,"visibility":"PUBLIC"}`），VOC 原文含用户反馈原始表述，天然可能含姓名、电话、地址、订单号。`.gitignore` 新增 `docs/data/`，xlsx 只留本地。

导入由运营在多维表格里用自带「导入 Excel」完成。

**入库前脱敏**：`原始内容` 正文必须过一遍清洗（手机号、邮箱、订单号、身份证号模式），不能只脱敏「用户标识」一列——那是假脱敏。清洗规则为纯函数，有测试。

> **待校准**：源数据列结构以常见 VOC 周报结构推定。真实 xlsx 到手后回填本节。若不一致，改动限于 `field-map.ts`、脱敏规则及其测试，不影响状态机、契约、指标。

### 3.2 「VOC 记录表」

**源数据字段（待校准）**：反馈时间、渠道、产品品类、机型、原始内容、原始评分、用户标识（脱敏）

**AI 字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| 情绪标签 | 多选 | 愤怒 / 失望 / 着急 / 感激 / 开心等 |
| 情绪极性 | 单选 | 好评 / 中评 / 差评 |
| 问题维度 | 多选 | 服务态度 / 维修技术 / 维修价格 / 维修时间 / 售后服务 / 环境设施 / 产品质量 |
| AI 摘要 | 文本 | 一句话，供卡片展示 |
| AI 回复话术 | 多行文本 | 多套话术，人工参考，不自动对外发布 |
| 严重度 | 单选 | 高 / 中 / 低，**由仓库侧 triage 写入，非 AI 输出** |
| 打标来源 | 文本 | `aily:<skill_id>@<批次号>` 或 `field-shortcut`，保证可解释可追溯 |
| 失败原因 | 文本 | 打标失败时填写 |
| 原始输出 | 多行文本 | 打标失败时保留，用于排查 |
| 重试次数 | 数字 | 上限 3 |

**流转字段**：流程状态、状态序号、负责人、建单时间、跟进记录（追加式）、闭环时间、闭环结论

### 3.3 单一状态源

上一版同时有 `打标状态` 与 `流程状态`，两者都含「待分析」且未定义谁权威——这是自相矛盾的。**本版只保留 `流程状态`。** 打标成功率由 `流程状态 ∈ {已分析, 待跟进, 跟进中, 待闭环, 已闭环, 无需跟进}` 的占比反推。

### 3.4 「负责人表」

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| 负责范围 | 文本 | 渠道 + 品类组合 |
| 负责人 | 人员 | 取 `open_id` 推送卡片 |
| 兜底 | 复选 | 无匹配时的接收人 |

**兜底是必需项**：路由未命中若静默丢弃，工单会消失，闭环率随之失真。

### 3.5 只有两张表

服务事件状态直接落在 VOC 记录表上。本期一条记录对应至多一个工单，独立表只有同步成本没有收益。

### 3.6 导入幂等

业务唯一键为 `渠道 + 反馈时间 + 原始内容哈希`。重复导入按此去重，避免条数虚高把指标做假。

## 4. 状态机

### 4.1 状态与序号

单调递增序号是并发保护的基础（见 4.4）：

| 状态 | 序号 | 终态 |
| --- | --- | --- |
| 待分析 | 0 | |
| 分析失败 | 1 | |
| 已分析 | 2 | |
| 无需跟进 | 3 | ✔ |
| 待跟进 | 4 | |
| 跟进中 | 5 | |
| 待闭环 | 6 | |
| 已闭环 | 7 | ✔ |

### 4.2 转移规则

| 起始 | 动作 | 目标 | 触发者 | 守卫 |
| --- | --- | --- | --- | --- |
| 待分析 | 打标成功 | 已分析 | 系统 | 输出通过契约校验 |
| 待分析 | 打标失败 | 分析失败 | 系统 | 写入失败原因与原始输出 |
| 分析失败 | 重试 | 待分析 | 系统 | 重试次数 < 3 |
| 已分析 | 需建单 | 待跟进 | 系统 | triage 判定需建单，且路由到负责人或兜底 |
| 已分析 | 无需建单 | 无需跟进 | 系统 | triage 判定不需建单 |
| 待跟进 | 开始跟进 | 跟进中 | 负责人 | 操作者是该记录负责人 |
| 跟进中 | 提交跟进结果 | 待闭环 | 负责人 | 同上 + 跟进记录非空 |
| 待闭环 | 确认闭环 | 已闭环 | 负责人或兜底 | 同上 + 闭环结论非空 |

`分析失败 → 待分析` 是唯一的序号回退，仅由系统触发，不经用户动作。

### 4.3 实现约束

- `service-event.ts` 为纯函数：`transition(current, action, context) -> Result<next, error>`，无 IO
- 非法转移返回明确错误，不静默忽略、不落默认分支
- **幂等**：重复提交同一动作到已处于目标状态的记录，返回成功且不改变状态与时间戳。飞书卡片存在重复点击与网络重试，这是必需属性
- 测试穷举转移表：每个合法转移一例，每个非法组合一例

### 4.4 并发：承认边界

多维表格没有 CAS，记录更新接口无版本号，官方明确「建议对单一多维表格同时只请求一次 API 写操作」。两个负责人同时操作会读-改-写竞态，后写覆盖先写。

**缓解**：写回前用刚读到的状态判断「目标序号 > 当前序号才写」。这仍是 best-effort。

**提交文档必须如实写**：本期不保证强一致，生产版需引入数据库行锁。承认边界比假装解决了更像企业级。

### 4.5 triage

`triage.ts` 纯函数：差评 → 建单；中评且问题维度非空 → 建单；好评 → 不建单。严重度由极性与维度数量共同决定。

**判定规则留在仓库侧而非提示词里**，因为它是业务策略，需要版本化、测试、可在评审时讲清。AI 只负责语义理解，不负责业务决策。

## 5. 打标：双轨设计

### 5.1 为什么双轨

已核实的风险：飞书官方口径「**自定义模型**功能自 2026-06-01 起，仅针对飞书 AI plus 会员或购买 AI 包旗舰版以上的客户开放」。2026-04 那波首个自定义智能体赠额有效期 60 天，现已过期。aily OpenAPI 文档标题为「OpenAPI 接入与接口说明（**beta**）」。

门槛卡的是自定义模型，不是整个 aily 平台，但**我们租户能否真正跑通尚未验证**。单点押注不可接受。

### 5.2 提供方接口

```
TaggingProvider {
  name: "aily" | "field-shortcut"
  tag(records): Promise<TagResult[]>
}
```

两轨产出同一份 `TagResult`，`triage.ts` 与状态机对轨道无感知。切换由环境变量决定，不改业务代码。

### 5.3 A 轨：aily skill start

```
POST https://open.feishu.cn/open-apis/aily/v1/apps/:app_id/skills/:skill_id/start
Authorization: Bearer <tenant_access_token>
权限点：aily:skill:write      应用类型：Custom App      限流：100 次/分钟
响应：{ code, msg, data: { output: string /* JSON String */, status: string } }
```

按官方文档（2026-08-10 查阅）。`app_id` 为 aily 侧 `spring_xxx__c`（≤64），与飞书 `cli_xxx` 是两个独立配置项；`skill_id` ≤32。

**硬约束**：`input` 是 **JSON String**（≤40960 字符），不是 JSON 对象。`output` 按开发者在 **Workflow 技能「结束节点」**配置的响应参数输出——即技能必须做成 Workflow 类型并在结束节点逐字段配好，否则两侧对不上。`data.status` 官方仅给出 `success` 一个示例值，其余值含义未文档化，契约**不得假设 status 只有两种取值**：非 `success` 一律按失败处理。

技能输入（序列化为 JSON String 后放入 `input`）：

```json
{ "records": [ { "id": "recxxx", "content": "...", "channel": "电商评价", "category": "冰箱", "rating": 2 } ] }
```

技能输出：

```json
{ "results": [ { "id": "recxxx", "sentiment": ["失望"], "polarity": "差评",
                 "dimensions": ["维修时间"], "summary": "...",
                 "replies": [ { "tone": "致歉安抚", "text": "..." } ] } ] }
```

`severity` 不在输出中，由 `triage.ts` 计算。话术并入同一技能，省一次调用与一次限流预算。

### 5.4 B 轨：多维表格 AI 字段捷径

打标由运营在多维表格里配 AI 字段捷径（分类、信息提取、总结、自定义 AI 自动填充）完成，AI 结果就是普通字段值。仓库侧只**读**这些字段并映射成同一份 `TagResult`。

**话术生成在 B 轨同样由字段捷径产出**，写入 `AI 回复话术` 字段。两轨都必须填满 `TagResult` 的全部字段（含 `replies`），否则 `triage.ts` 与卡片渲染会出现轨道差异——这正是提供方抽象要防的事。

与参考案例完全同构。零付费门槛，零 API 调用，直接删掉 A 轨的批处理与限流代码路径。

### 5.5 契约执行

`contracts.ts` 对结果做运行时校验：

- A 轨：`output` 先 JSON parse，失败即该批失败
- `polarity` 与 `dimensions` 必须落在枚举内；枚举外的值不静默丢弃，记为该条失败并保留原始输出
- **id 左连接**：以输入 id 为准。输入里不存在的 id 丢弃；同一 id 重复出现取第一条并记警告；**未返回的 id 一律置分析失败**。20 条一批时大模型漏条是常见失败模式，不能默认返回完整
- **单条失败不污染整批**：逐条判定，成功的写回，失败的置分析失败

### 5.6 分片作业，不是队列

上一版设计的令牌桶 + 指数退避 + 重试队列在 6 天内做不完，且 `after()` 并非异步队列——它只延长同一次调用的生命周期，仍受 `maxDuration` 约束（现有 `app/api/feishu/events/route.ts:27` 为 `maxDuration = 10`）。一次 20 条的 Workflow 调用是真实 LLM 生成，若 20s/批，500 条 = 500s，超出默认上限。

**改为可恢复分片**：`/api/voc/analyze` 每次只取 N 条 `流程状态 = 待分析` 的记录处理完即返回，由 Vercel Cron 每分钟推进一片。天然满足 100 次/分钟限流，天然幂等（按状态过滤，成功的不会被重取），天然可恢复（中断后下次继续）。

批大小由「单批端到端 ≤ 20s」实测反推，初值 5 条，实测后调整。官方对该接口未给出超时时间，**我们自己设 25s 上限**。

## 6. 飞书工单流转

### 6.1 VOC 工单卡

复用 `cards.ts` 的 Card 2.0 外壳。内容：记录编号、渠道、品类、反馈时间、原始内容（截断）、AI 摘要、极性、问题维度、严重度、AI 话术建议。按钮：开始跟进 / 提交跟进结果 / 确认闭环 / 标记无需跟进。

`card.action.trigger` 的 `value` 携带 **`record_id`（`recxxx`）与 `owner_open_id`**。

不用「记录编号」自动编号做载荷：自动编号不可写、由 Bitable 生成、按它定位还要多一次 search，吃掉 3 秒预算。`record_id` 才是 API 寻址主键；记录编号只给人看。

### 6.2 三秒预算

官方要求卡片回调 3 秒内响应，回调 token 有效期 30 分钟且**最多更新 2 次**。跨境延迟是已知问题（`vercel.json` 当初钉 `hkg1` 就是为此）。

因此：

- 按钮 `value` 自带 `record_id` 与 `owner_open_id`，服务端只做**一次** `record get`，同时校验 owner 与当前状态
- `tenant_access_token` 做模块级内存缓存，避免每次回调换 token
- `app/api/voc/**` 一并钉 `hkg1`
- **鉴权在同步响应内完成并直接返回 toast**，不走 `after()`。上一版把「先确认再 after()」与「拒绝时给明确提示」写在一起是矛盾的——先确认时还不知道有没有权限，而卡片更新次数上限只有 2。写操作可以留在 `after()`，鉴权结论不行

### 6.3 三重校验

每次卡片动作必须校验：

1. `app_id` 与 `tenant_key`（`event-handler.ts:104-112` 已有）
2. `record_id` 存在，且 `owner_open_id` 与表中负责人一致
3. **操作者 `event.operator.open_id` 等于负责人或兜底人**
4. 请求的状态转移在当前状态下合法

任一不通过返回明确 toast 且不改变任何状态。缺负责人上下文视为无权限，与 `AGENTS.md`「Treat missing tenant context as no access」同一原则。

读记录时**显式传 `user_id_type=open_id`**，并写一条「id 类型不匹配即拒绝」的测试。否则可能永远匹配不上而全拒，或实现方为了跑通而放宽比较——后者更糟。

### 6.4 信任边界：如实说明

负责人表的「负责人」是多维表格人员字段。**任何拥有该 Base 编辑权的人都能把自己填成负责人，或勾上兜底从而获得对所有记录的操作权。** 这不是角色系统，是一张可写的 ACL 表。

提交文档必须写明：权限的信任边界是多维表格的编辑权限。**把这句话说出来，比藏起来更能回答「只是个表格还是系统」这个追问。**

## 7. 指标与看板

`metrics.ts` 纯函数聚合。

**流量与分布**：总量、按极性分布、按问题维度 Top N、按渠道分布、中差评占比

**效率**：闭环率、平均闭环时长（建单 → 已闭环）、打标覆盖率与成功率

首次响应时长已砍（缺「开始跟进时间」字段，且 `跟进记录` 追加式文本不是可靠时间源）。环比与趋势已砍（源数据只有一个周期）。

**人效**：`实测打标条数 × 假设单条人工耗时基线 = 折算工时`

> **不给年化金额。** 我们没有海信的人工耗时实测数据。参考案例给出的是实测值（10000+ 条、每人每天 20min、20+ 人、年省 14.4 万）；我们的推算值若与之并排出现，读者会默认同一置信度。提交文档中，魅族数字单独放在「参考案例」小节并标注「他人实测」，我们的数字标注基线取值与来源。

### 7.1 公开看板页

`app/dashboard/voc/page.tsx` 无需登录即可访问，**只返回聚合数字，绝不返回 `原始内容`**。这既是评委唯一能自行验证的真实证据，也顺手消除了 VOC 原文公网泄露的风险。

聚合用 Next.js 16 的 `use cache` + `cacheLife`（60s），避免每个访客每次打开都打一次跨境 Bitable 接口。

## 8. 鉴权与错误处理

### 8.1 路由鉴权（上一版完全遗漏）

仓库无 `middleware.ts`（已核实），首页匿名可访问且生产站返回 200。上一版的三个新路由没有任何鉴权说明，等于：任何人可写多维表格、可烧 AI 额度并把我们顶到限流、可公网拉取 VOC 原文。

| 路由 | 调用者 | 鉴权 |
| --- | --- | --- |
| `/api/voc/analyze` | 仅 Vercel Cron | `CRON_SECRET` 校验，非法请求 401 |
| `/api/voc/dashboard` | 公开 | 无需鉴权，但只出聚合数字，不出原文 |
| `/api/feishu/events` | 飞书 | 现有签名 + token + app_id 校验，不变 |

### 8.2 错误处理

| 场景 | 处理 |
| --- | --- |
| 打标调用超时（>25s）或非 `success` | 该批置分析失败，下一片 Cron 自然重取，不写重试队列 |
| 返回畸形 JSON | 该条置分析失败，保留原始输出，不抛到路由层 |
| 结果漏条 | 未返回的 id 置分析失败（§5.5） |
| Bitable 限流或 5xx | 该次分片失败，下一片重试；不做退避算法 |
| Base 字段被改名或删除 | `schema-guard.ts` 启动校验，缺字段返回 503 并指明字段名 |
| 缺 tenant context 或负责人上下文 | 视为无访问权限 |
| 环境变量缺失 | 503 `configuration_unavailable`，沿用现有 `readBotEnv` 失败路径 |

所有外部调用显式设超时（Bitable 10s，打标 25s），不依赖默认值。

## 9. 测试策略

- **`src/features/voc/`**：纯函数直接单测。状态机穷举合法与非法转移 + 幂等 + 序号回退；triage 覆盖各极性与维度组合；metrics 用固定输入验证聚合与时长
- **`src/features/tagging/`**：注入 fake fetcher。覆盖契约校验通过、字段缺失、枚举越界、`output` 非法 JSON、**漏条**、**重复 id**、**status 非 success**、分片边界；两轨产出同一 `TagResult`
- **`src/features/bitable/`**：注入 fake fetcher。覆盖字段映射双向转换、`user_id_type` 不匹配即拒、分页、写回失败、schema-guard 缺字段
- **脱敏规则**：手机号、邮箱、订单号、身份证号各一例
- **Route handlers**：沿用 `tests/runtime/`；新增 `analyze` 无 `CRON_SECRET` 返回 401、`dashboard` 响应不含原文字段
- **不测**：AI 打标准确率。仓库侧只保证「AI 返回任何东西我们都不崩、不静默错」

按 `AGENTS.md` 走 RED → GREEN → REFACTOR。

## 10. 配置

| 变量 | 用途 | 敏感 |
| --- | --- | --- |
| `FEISHU_BITABLE_APP_TOKEN` | 多维表格 app token | 是 |
| `FEISHU_BITABLE_TABLE_VOC` | VOC 记录表 table id | 否 |
| `FEISHU_BITABLE_TABLE_OWNER` | 负责人表 table id | 否 |
| `TAGGING_PROVIDER` | `aily` 或 `field-shortcut` | 否 |
| `FEISHU_AILY_APP_ID` | A 轨：`spring_xxx__c` | 否 |
| `FEISHU_AILY_SKILL_TAGGING` | A 轨：`skill_xxx` | 否 |
| `CRON_SECRET` | analyze 路由鉴权 | 是 |

飞书自建应用需新增：`aily:skill:write`（仅 A 轨）、多维表格读写权限。多维表格需将应用加为协作者。

## 11. 人工依赖与关键路径

| # | 事项 | 责任人 | 截止 | 阻塞什么 |
| --- | --- | --- | --- | --- |
| 1 | **aily 冒烟：建一个智能体 + 一个 Workflow 技能，拿到一次 `code=0` 且 `output` 非空** | 用户 | **08-11** | 决定走 A 轨还是 B 轨。**失败即切 B 轨，不拖到 08-14** |
| 2 | 建两张 Base 表，字段对齐 §3，应用加为协作者 | 用户 | 08-11 | 全部开发 |
| 3 | 导出 xlsx 到本地并完成「导入 Excel」 | 用户 | 08-12 | §3.1 校准、验收 1 |
| 4 | 若走 B 轨：在 Base 配 AI 字段捷径 | 用户 | 08-12 | 打标 |
| 5 | 补权限点、发布应用版本 | 用户 | 08-12 | 卡片流转 |
| 6 | 人效基线取值及依据 | 用户 | 08-14 | 看板人效栏 |

第 1、2 项是关键路径。契约在本文档钉死后，两侧可并行开工。

## 12. 交付形态

评委已在同一企业内（租户已切至 `cli_aaf3ce600df5dd21`），飞书内体验对评委开放。交付物三件：

1. **飞书方案文档**，按官方模板
2. **不剪辑的连续同屏视频**：Base 记录 → 卡片推送 → 点按钮 → Base 状态变化 → 看板数字变化，全程带时间戳。不剪辑本身就是可信度证据
3. **公开看板页**：评委唯一能自行验证的真实证据

## 13. 仓库文档一致性

以下三处现在都写着「VOC / AI 未接入」，必须与实际实现同步修改，否则会出现 README 说没接、提交文档说接了的自相矛盾：

- `README.md`「当前实现」章节
- `AGENTS.md`「Project Baseline → Current phase」
- `docs/TECH_STACK.md:5`

## 14. 验收标准

1. 真实 VOC 数据在 Base 中可见，条数与源文件一致（按 §3.6 去重后）
2. 打标跑通，成功率与失败原因可查；分析失败的记录可被下一片 Cron 重取
3. 至少一条中差评走完 `待跟进 → 跟进中 → 待闭环 → 已闭环`，全程在飞书卡片内操作，状态写回 Base
4. **非负责人点击按钮，在同步响应内被拒绝并收到明确 toast**，状态不变
5. 公开看板显示真实聚合，每个数字可在 Base 中点开对账；页面响应不含 `原始内容`
6. `/api/voc/analyze` 无 `CRON_SECRET` 返回 401
7. `npm test`、`npm run test:runtime`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm audit --omit=dev` 全绿
8. 提交文档中已实现与规划中的边界表述准确；人效基线标注为假设；并发与权限信任边界如实说明
9. 不剪辑视频完成录制
10. `README.md`、`AGENTS.md`、`docs/TECH_STACK.md` 三处措辞与实际一致
