# OneCare：AI 驱动的用户服务全链路闭环引擎

## 当前实现

仓库当前包含一个 TypeScript 方案展示站：

- Next.js App Router 响应式首页；
- 飞书企业自建应用 OAuth 授权码登录；
- 服务端签名的 8 小时网站会话；
- 仅登录用户可访问的服务闭环工作台静态预览；
- Vercel 生产部署。

当前版本用于呈现 OneCare 的产品方向与服务闭环故事。页面中的设备风险、服务队列和能力模块均为静态方案预览，尚未接入真实 IoT、VOC、客服、工单、配件、回访或 AI 服务。

当前生产站点：<https://auto-insight-omega.vercel.app>

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
- `SESSION_SECRET`：至少 32 字节的随机会话密钥，可用 `openssl rand -base64 48` 生成。

真实密钥不得提交到 Git。仓库会忽略 `.env*`，只保留无敏感值的 `.env.example`。

## 飞书后台配置

在飞书开发者后台打开对应企业自建应用：

1. 确认应用已启用，登录成员位于应用可用范围内；
2. 进入“开发配置 → 安全设置 → 重定向 URL”；
3. 添加与 `FEISHU_REDIRECT_URI` 完全一致的地址，例如 `https://your-domain.example/api/auth/feishu/callback`；
4. 如配置属于正式版本，按企业规则发布版本并完成管理员审核。

登录实现使用飞书当前 OAuth v3 令牌端点，不申请手机号或邮箱权限，也不持久化飞书访问令牌。

## 验证

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
```

## Vercel 部署

首次部署采用两阶段流程，因为飞书回调地址依赖最终生产域名：

1. `vercel link` 链接或创建项目；
2. 在 Vercel Production 环境设置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_REDIRECT_URI` 和 `SESSION_SECRET`；
3. 运行 `vercel --prod` 获得生产域名；
4. 将精确生产回调地址加入飞书安全设置；
5. 更新 Vercel 的 `FEISHU_REDIRECT_URI` 后再次生产部署。

`FEISHU_APP_SECRET` 和 `SESSION_SECRET` 应在 Vercel 标记为 Sensitive。环境变量更新只对后续部署生效。

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

OneCare 探索一套“AI 驱动的海信用户服务全链路闭环引擎”，通过整合 VOC 洞察、智能预诊、协同调度与闭环追踪，形成从发现、判断、响应到复盘的连续服务体验，目标是：

- 缩短服务周期；
- 降低重复上门率；
- 提升用户满意度；
- 让用户在每一个服务触点感受到主动、连续和有温度的关怀。

系统架构、数据边界、AI 编排与业务系统集成方案将在后续规格中继续讨论；当前仓库不把这些能力描述为已经实现。
