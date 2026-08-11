# 万护 OneCare：AI 驱动的用户服务全链路闭环引擎

## 当前实现

仓库当前包含一个 TypeScript 方案展示站：

- 面向比赛评审的品牌展厅式网站，由首页、四个视角、闭环架构和团队四个整屏章节组成；
- 固定显示的 Top Bar 与带方向感的横向整屏切换，每个章节保留独立纵向滚动；
- 可点击和键盘切换的四套沉浸式角色 Demo：带左右双方消息气泡的手机尺寸用户 AI 服务助手、客服智能坐席、工程师一次上门工作台与后台 VOC 闭环驾驶舱；
- 以统一用户 ID、设备 ID 和服务事件 ID 为主线的三层闭环架构、人工审核边界、五步运行闭环和六个月试点目标；
- 三位成员的真实姓名、学历、代表经历与互补能力简介，不展示照片或联系方式；
- 独立 `/login` 飞书体验入口，展示加入 OneCare 企业的邀请二维码、身份验证和机器人体验步骤；
- 飞书企业自建应用 OAuth 授权码登录，登录成功后留在体验入口，不再进入重复的网站工作台；
- 服务端签名的 8 小时网站会话；
- 面向企业成员的轻量飞书机器人 Webhook，提供全 Card 2.0 的员工工作台、八类岗位卡片与可点击的演示操作；
- 真实 VOC 数据落地飞书多维表格「VOC 记录表」，字段与枚举已对真实 Base 校准；仓库额外实现了正文级脱敏函数 `redactVocContent`（`src/features/voc/redact.ts`，覆盖手机号、邮箱、身份证号、订单号，含带分隔符与国家码形态），由 13 条单测锁定其行为，但**当前没有任何生产写入路径调用它**——`BitableClient`（`src/features/bitable/client.ts`）只有 `getRecord`/`listRecords`/`updateRecord`/`listFieldNames`，没有 `createRecord`；唯一的入库方式是运营在多维表格里手动「导入 Excel」（见下文「VOC 闭环配置」第 4 条），发生在本仓库代码之外，脱敏函数无从介入；
- AI 打标双轨：飞书 aily 技能（A 轨）与多维表格 AI 字段捷径（B 轨）二选一，由 `TAGGING_PROVIDER` 切换，两轨产出同一份打标结果契约；是否建单与严重度由仓库侧 triage 规则判定，不写在提示词里；
- 服务事件状态机 `待分析 → 已分析 → 待跟进 → 跟进中 → 待闭环 → 已闭环`（另有无需跟进与分析失败两条支线），转移含幂等与重试上限，负责人路由含兜底；
- 飞书卡片内完成 VOC 工单流转：负责人点击卡片按钮，服务端在同一次同步响应内做 `record_id` 存在性、操作者身份、状态转移合法性三重校验，任一不通过即拒绝并回复明确提示，不写入任何数据；
- Vercel Cron 驱动、可从「分析失败」状态自动重取的可恢复分片打标作业（`/api/voc/analyze`），以 `CRON_SECRET` 校验调用方；
- 公开只读的 VOC 闭环看板（`/dashboard/voc`），只出聚合数字、不出反馈原文，读取失败时显示明确的「指标暂不可用」，这与「Base 为空如实显示 0」是两种不同的展示；
- Vercel 生产部署。

当前版本用于呈现万护 OneCare 的产品方向与服务闭环故事。四个角色共享同一份浏览器内案例状态：用户先接受 AI 预诊和知识库自助建议，自助失败后才转客服建单；客服建单会解锁工程师任务，工程师完成服务会解锁后台改善，任意角色重置都会恢复整条流程。案例固定为 `OC-240718-037`，用户、客服、工程师三个视角的全部回复、设备信号、知识建议、工单、配件和状态变化仍为确定性模拟，尚未接入真实 IoT、知识库、客服、工单、配件或回访。后台视角是例外：其「VOC 闭环驾驶舱」小节的待闭环、已建单、已闭环、闭环率与问题维度聚类改为读取飞书多维表格中的真实 VOC 记录，不再是模拟数字；读取失败会明确显示「VOC 指标暂不可用」，不会静默退回模拟值；该视角的改善任务解锁与重置流程仍是模拟叙事的一部分。

当前网站采用参考海信官网的黑白品牌展厅视觉：顶部和页尾为黑色，主体为白色，使用 MiSans、海信官方大场景图、海信智能冰箱产品图、药丸形文字按钮、圆形图标按钮与白色圆角内容卡。用户提供的万护反色 Logo 已封装为统一品牌组件：黑色顶栏、双层黑色页尾和 AI 头像使用白色图形，手机白色标题栏使用黑色图形；浏览器 Tab 也直接复用同一份深色万护图形。一级页面标题统一使用中文，Top Bar 切换会保留 URL Hash、浏览器前进后退和深链恢复。图片与字体来源及处理记录见 `public/images/hisense/SOURCES.md`。所有业务结果仍是方案目标，不是生产指标。

四个角色当前位于“四个视角”一级页面内，通过二级全屏横向切换演示一条完整服务链。用户端在桌面保持手机尺寸，在移动端直接适配设备宽度；对话通过左侧“万护助手”和右侧“我”的身份、头像、气泡、时间与状态呈现主动提醒、用户回答、AI 预诊、知识库自助和后续服务结果。消息时间或状态与对应气泡组合对齐，初始三枚快捷回复及自助阶段的两个分支按钮固定在等宽底部操作槽中；跨角色状态更新只改变手机内部消息滚动，不改变手机外壳和操作槽高度。客服、工程师和后台使用共享工作台外壳与角色专属布局。自由文本 AI、真实身份权限、刷新后状态持久化和真实业务系统集成仍属于后续阶段。

飞书体验页位于 `/login`。未加入组织的访客可扫描页面上的邀请二维码；该二维码仅支持 `+86` 手机号，有效期至 2026 年 8 月 29 日，加入申请可能需要管理员审核。当前应用是 OneCare 企业自建应用，因此只有已加入该企业、且处于应用可用范围内的成员能够完成 OAuth 和使用机器人。客服、工程师和后台工作台均提供同一个飞书体验入口，用户手机 Demo 不显示该入口。

机器人处理 `im.message.receive_v1` 的单聊文本、`im.chat.access_event.bot_p2p_chat_entered_v1` 的进入会话事件和 `card.action.trigger` 卡片按钮回调。员工进入会话时会收到万护 Card 2.0 工作台；底部菜单发送的八条中文、英文或中英双语指令分别打开使用帮助、运营后台、待确认服务、创建服务工单、查询服务进度、今日任务、AI 预诊与配件、提交服务结果卡片。未知输入也只返回工作台卡片，机器人不再生成纯文字业务回复。“打开网页演示”仍直接跳转网站。

查询和岗位切换按钮在三秒内确认后向当前单聊发送新的详情卡片；创建演示工单、确认演示配件和提交演示结果会原地更新被点击的卡片并禁用重复操作。脚本无状态且不保存消息、身份或事件 ID；所有工单、任务、配件和结果均明确标注为演示，不会调用真实 AI、知识库、IoT、工单或服务系统。当前没有持久化欢迎或事件去重；已订阅但未使用的群事件经过验证后安全忽略。

同一个 `card.action.trigger` 回调处理器另外承载四个真实的 VOC 工单动作（开始跟进、提交跟进结果、确认闭环、标记无需跟进）。这四个动作的按钮 `value` 携带真实的多维表格 `record_id`，操作者身份取自签名事件里的 `event.operator.open_id`，从不信任按钮自带的值；服务端在同一次同步响应内完成记录存在、操作者是否为该记录负责人、状态转移是否合法三重校验，任一不通过直接回复明确 toast，不修改 Base 中任何字段。这条地址空间与其余九个演示动作固定使用的案例号 `OC-240718-037` 完全独立，互不影响。

飞书事件请求已通过自定义域名完成 URL Verification；本分支的新员工机器人逻辑仍需部署到 Production、发布对应应用版本并由真实企业成员验收后，才能宣称飞书内体验可用。

当前生产站点：<https://onecare-loop.vercel.app>

当前主页分支 Preview：<https://onecare-homepage-preview.vercel.app>

Preview 受 Vercel Deployment Protection 保护，可直接访问的限时分享链接在分支交付消息中提供。Preview 未配置飞书认证变量，只用于页面内容和视觉确认；生产站点、生产密钥与飞书回调不受影响。

GitHub 仓库：<https://github.com/yjzhang2003/OneCare>

## 本地运行

需要 Node.js 24。

```bash
npm install
cp .env.example .env.local
npm run dev
```

在 `.env.local` 中配置：

- `FEISHU_APP_ID`：企业自建应用的 App ID；
- `FEISHU_APP_SECRET`：企业自建应用的 App Secret；
- `FEISHU_REDIRECT_URI`：本地或线上完整 OAuth 回调 URL；
- `SESSION_SECRET`：至少 32 字节的随机会话密钥，可用 `openssl rand -base64 48` 生成；
- `FEISHU_EVENT_VERIFICATION_TOKEN`：飞书事件订阅的 Verification Token；
- `FEISHU_EVENT_ENCRYPT_KEY`：飞书事件订阅的 Encrypt Key；
- `FEISHU_BITABLE_APP_TOKEN`：VOC 多维表格（Base）的 app token；
- `FEISHU_BITABLE_TABLE_VOC`：「VOC 记录表」的 table id；
- `FEISHU_BITABLE_TABLE_OWNER`：「负责人表」的 table id；
- `TAGGING_PROVIDER`：AI 打标提供方，取值 `aily` 或 `field-shortcut`；
- `FEISHU_AILY_APP_ID`：仅 `TAGGING_PROVIDER=aily` 时必填，aily 侧应用 ID（`spring_xxx__c` 形态，与飞书 `cli_xxx` App ID 是两个独立配置项）；
- `FEISHU_AILY_SKILL_TAGGING`：仅 `TAGGING_PROVIDER=aily` 时必填，打标技能的 skill id；
- `CRON_SECRET`：`/api/voc/analyze` 的调用方鉴权密钥，请求头须为 `Authorization: Bearer $CRON_SECRET`，否则返回 401。

真实密钥不得提交到 Git。仓库会忽略 `.env*`，只保留无敏感值的 `.env.example`。

## 飞书后台配置

在飞书开发者后台打开对应企业自建应用，先完成网站登录配置：

1. 确认应用已启用，登录成员位于应用可用范围内；
2. 进入“开发配置 → 安全设置 → 重定向 URL”；
3. 添加与 `FEISHU_REDIRECT_URI` 完全一致的地址，例如 `https://your-domain.example/api/auth/feishu/callback`；
4. 如配置属于正式版本，按企业规则发布版本并完成管理员审核。

登录实现使用飞书当前 OAuth v3 令牌端点，不申请手机号或邮箱权限，也不持久化飞书访问令牌。

当前生产回调 URL：

```text
https://onecare-loop.vercel.app/api/auth/feishu/callback
```

要让飞书内的轻量机器人真正可用，还需在同一个应用中完成：

1. 添加机器人能力并设置名称、图标；
2. 申请读取用户发给机器人的单聊消息、以应用身份发送或回复消息所需的最小权限；
3. 在“事件配置”订阅 `im.message.receive_v1` 和 `im.chat.access_event.bot_p2p_chat_entered_v1`，将事件请求 URL 配置为 `https://onecare.ohmyfeishu.top/api/feishu/events`；
4. 在独立的“回调配置”中使用同一请求 URL，并添加 `card.action.trigger`（卡片回传交互）；
5. 在 Vercel Production 配置与飞书后台一致的 Verification Token 与 Encrypt Key；
6. 发布新版本，并把应用可用范围覆盖所有允许体验的成员；
7. 使用飞书 7.20 及以上桌面端和移动端，以真实企业成员完成 OAuth、机器人搜索、欢迎卡、八条菜单卡片及全部按钮验收。

事件接口会验证请求签名、Verification Token、Encrypt Key、App ID 和非空 tenant context；卡片按钮还会校验 Card 2.0 规范化结果、固定演示案例号和 action 白名单。普通事件与导航按钮在三秒响应要求内先确认，再通过 Next.js `after()` 回复或主动发送 interactive 卡片；三个本地确定性状态动作在响应中返回完整替换卡片。已配置但未注册业务处理器的群事件返回 `200` 并忽略。为减少飞书中国侧到 Vercel 默认美国区域的跨境延迟，`vercel.json` 只将该事件函数部署到香港 `hkg1`；网站与 OAuth 函数不受此配置影响。Vercel Preview 受 Deployment Protection 保护，不能用作飞书事件或卡片回调地址；分享链接只用于页面确认。

## VOC 闭环配置

要让 VOC 数据入表、AI 打标和飞书卡片工单流转生效，还需在飞书多维表格与开发者后台完成：

1. 建两张表：`VOC 记录表`（原始反馈、AI 打标结果与流转字段）与 `负责人表`（负责范围、负责人、兜底），字段名与选项需与仓库 `src/features/bitable/field-map.ts` 里的 `VOC_FIELD_NAMES` 逐一一致。表格字段可被运营随手改名，改名的直接后果是新数据被静默写空而不是报错，仓库侧的 `schema-guard.ts` 只在服务启动时做一次性校验，不能替代人工核对；
2. 把当前企业自建应用加为该多维表格的协作者，并授予多维表格的读写权限；
3. 若 `TAGGING_PROVIDER=aily`，额外为应用申请 `aily:skill:write` 权限点，并建一个 Workflow 类型的打标技能，在结束节点按 `TagResult`（`src/features/tagging/contracts.ts`）的形状逐字段配置输出；若 `TAGGING_PROVIDER=field-shortcut`，改为在多维表格里给相应列配好分类、摘要等 AI 字段捷径，仓库侧只读这些列，不发起模型调用；
4. VOC 原始数据由运营在多维表格里用自带的「导入 Excel」手动完成，仓库没有程序化的导入路由。导入前应确认 `VOC 记录表` 为空或已清空，避免重复导入把统计数字做假；
5. `/api/voc/analyze` 由 Vercel Cron 调用（见 `vercel.json`），请求头须带 `Authorization: Bearer $CRON_SECRET`，鉴权失败返回 `401`；`/api/voc/dashboard` 与 `/dashboard/voc` 无需登录即可访问，只返回聚合数字，不返回反馈原文。

以下边界如实说明，而非回避：

- **并发不保证强一致**：飞书多维表格没有乐观锁（CAS），记录更新接口也没有版本号；卡片写回状态时用的是「读到的状态序号比当前更靠后才写」的 best-effort 判断（序号本身不落 Base 列，由 `VOC_STATE_SEQUENCE` 从 `流程状态` 的字符串值推导），两个负责人同时点击仍可能后写覆盖先写。生产版需要引入数据库行锁才能消除这个窗口。
- **权限的信任边界就是多维表格的编辑权限**：负责人表的「负责人」「兜底」是运营可写的普通字段，任何拥有该 Base 编辑权限的人都能把自己填成负责人，或勾上兜底，从而获得对全部记录的操作权。这不是一套独立的角色/权限系统，只是一张可写的 ACL 表。
- **人效数字是折算值，不是实测值**：看板与 `/api/voc/dashboard` 的「折算节省工时」按「已完成打标记录数 × 假设的单条人工处理分钟数」计算，假设基线未经海信真实工时的实测，页面上会同时标注这一点，也不会把它换算成年化金额。
- **Base 为空与读取失败是两种不同展示**：Base 里暂时没有记录时，看板如实显示 `0`；只有网络请求或飞书接口调用失败时才会显示「指标暂不可用」，两者不能混为一谈，也不会用同一套文案掩盖。

## 验证

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
```

前五条命令预期全绿。`npm audit --omit=dev` 目前以非零状态退出——**这是已知例外，不是被隐藏的失败**：它报告 4 项漏洞（1 moderate：`postcss`；3 high：`nanoid`、`next`、`sharp`），均是 `next@16.2.10` 自身或其依赖树带来的传递漏洞（`postcss` 是 `next` 的依赖，其版本已通过 `package.json` 的 `overrides` 钉定以修复更早的 GHSA-qx2v-qp2m-jg93，但仍受一条更新的公告影响并携带了同样受影响的 `nanoid`；`sharp` 是 `next` 内置图片优化能力的可选依赖），分支起点 `b1daba4` 的 `package.json`/`package-lock.json` 与当前完全一致，因此不是本分支引入。`sharp` 携带的四个 libvips CVE（CVE-2026-33327 / 33328 / 35590 / 35591）只能经 Next.js Image Optimization API 触达，本仓库没有面向用户的图片上传入口，唯一使用的是仓库自带的少量静态图；`next` 包本身另外还打包了一组与图片无关的公告（Server Actions、Middleware、rewrites 相关的 SSRF 与缓存混淆等），本仓库未使用 Server Actions、`middleware.ts` 或自定义 rewrites，这组攻击面同样没有被触达的入口。距提交截止仅剩数天，`cacheComponents` / `use cache` / `cacheLife` 这套缓存架构刚在 `next@16.2.10` 上完成开发与验证（见 `next.config.ts`、`app/api/voc/dashboard/route.ts`），`npm audit fix --force` 会把 Next 升级到声明范围外的 `16.3.0`，没有时间重新验证缓存与预渲染行为，因此本次比赛周期内不处置，留待赛后随 Next 一起升级解决。

## Vercel 部署

首次部署采用两阶段流程，因为飞书回调地址依赖最终生产域名：

1. `vercel link` 链接或创建项目；
2. 在 Vercel Production 环境设置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_REDIRECT_URI`、`SESSION_SECRET`、`FEISHU_EVENT_VERIFICATION_TOKEN` 和 `FEISHU_EVENT_ENCRYPT_KEY`；
3. 运行 `vercel --prod` 获得生产域名；
4. 将精确生产回调地址加入飞书安全设置；
5. 更新 Vercel 的 `FEISHU_REDIRECT_URI` 后再次生产部署。

`FEISHU_APP_SECRET`、`SESSION_SECRET`、`FEISHU_EVENT_VERIFICATION_TOKEN` 和 `FEISHU_EVENT_ENCRYPT_KEY` 应在 Vercel 标记为 Sensitive。环境变量更新只对后续部署生效。Preview 不复制 Production 密钥；页面仍可用于视觉验收，但 OAuth 和机器人回调会显示安全配置错误或保持不可用。

部署后可用 `vercel inspect <deployment> --json` 检查 `api/feishu/events` 的 `deployedTo` 是否为 `hkg1`。只有区域、Production 环境变量和飞书后台 URL Verification 都通过后，才能将事件订阅视为已打通。

`npm run test:runtime` 会先执行生产构建，再在本地启动 `next start` 验证认证 Route Handlers。该检查用于捕获只在 Next.js 生产 Bundle 中出现、普通模块单测无法复现的运行时兼容问题。

## 题目背景

海信集团拥有覆盖全球的家庭用户资产，海信爱家 APP 连接千万级 IoT 设备，每年承载数亿次用户服务请求。在“以用户为中心”的战略驱动下，海信正从硬件制造商向智能生活服务伙伴转型。

核心命题是：如何借助 AI 能力，打通从用户问题发现到服务响应、闭环解决的全链路，让用户感受到“有温度”的产品。

## 真实挑战

### 1. 问题发现滞后

用户报修后往往经历多次上门、多次描述和反复等待。问题诊断链路过长、缺乏预判能力，使工程师难以在第一次上门前带齐正确配件和信息。

### 2. 信息孤岛严重

400 客服、工程师服务、配件供应和用户反馈等系统彼此独立，用户体验被分割，问题难以在同一条服务链路中持续追踪。

### 3. 数据沉睡

海信每年积累海量用户声音数据，但缺乏有效的 AI 分析与应用，导致洞察无法及时转化为产品和服务行动。

### 4. 协同效率低

服务链路涉及客服、工程师、配件和回访等多种角色。跨角色协同成本高，响应速度和用户满意度难以兼顾。

## AI 机会点

### 1. 智能预诊

基于 IoT 设备运行数据提前识别故障风险，为工程师准备诊断信息和配件线索，推动服务向“一次就好”靠近。

### 2. VOC 智能分析

自动分析各渠道用户反馈，识别高频问题、情绪变化和改善机会，驱动产品与服务持续迭代。

### 3. 智能客服与协同调度

由 AI Agent 承接重复性问答，将复杂问题智能路由给客服、工程师、配件等对应角色，减少人工转派和重复描述。

### 4. 服务闭环追踪

监控服务全流程，自动触发回访和满意度评价，确认每个问题都有明确结果并沉淀为下一次服务的知识。

## 方案目标

万护 OneCare 探索一套“AI 驱动的海信用户服务全链路闭环引擎”，通过整合 VOC 洞察、智能预诊、协同调度与闭环追踪，形成从发现、判断、响应到复盘的连续服务体验，目标是：

- 缩短服务周期；
- 降低重复上门率；
- 提升用户满意度；
- 让用户在每一个服务触点感受到主动、连续和有温度的关怀。

闭环架构页当前只展示规划中的数据与知识层、智能编排层、多角色应用层及渐进试点路径；真实数据边界、AI 编排、服务事件持久化和业务系统集成仍需后续规格与实施，当前仓库不把这些能力或试点目标描述为已经实现。
