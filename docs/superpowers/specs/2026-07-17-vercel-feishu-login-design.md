# Vercel 展示站与飞书登录设计

## 状态

设计已于 2026-07-17 获得用户确认。本规格定义首个可部署展示站；它不代表代码、飞书配置或 Vercel 部署已经完成。

## 目标

创建一个可部署到 Vercel 的 Auto Insight 展示站，让当前企业成员通过一个飞书企业自建应用完成真实 OAuth 登录，并在登录后进入简化的洞察工作台框架。

## 本次范围

首版包含：

- 响应式产品首页；
- 飞书 OAuth 登录入口、回调和退出；
- 服务端签名的短期网站会话；
- 受保护的工作台页面；
- Vercel 项目、生产环境变量和生产部署；
- 部署与飞书后台回调配置说明。

首版不包含：

- 汽车数据采集、真实洞察计算或 AI 模型调用；
- PostgreSQL、Drizzle 或持久化用户记录；
- 飞书机器人、事件订阅或智能体安装；
- 商店应用、ISV 流程或跨企业登录；
- 用户刷新令牌持久化。

## 产品与租户边界

本次使用企业自建应用，因此只有该应用所属企业中、且位于应用可用范围内的成员能够登录。此前规划的“一个商店应用服务多个企业”仍是未来方向，但不属于当前可部署版本。

页面和文档必须把当前能力描述为单企业演示，不得暗示已经支持多个企业。未来迁移到商店应用时保留身份适配器边界，重新引入 `tenant_key` 与持久化租户模型。

## 技术方案

应用继续采用仓库已选定的 TypeScript 模块化单体：

- Node.js 24 LTS；
- Next.js App Router；
- React Server Components 默认渲染页面；
- Route Handlers 承载 OAuth HTTP 端点；
- Vitest 测试认证领域函数和适配器；
- Vercel 托管生产部署。

不引入 Auth.js、数据库或客户端状态库。OAuth 与会话使用小型、可测试的 TypeScript 模块实现，避免首版增加未使用的基础设施。

## 页面与组件

### 首页 `/`

首页使用清晰、克制的汽车研究视觉语言，包含：

- Auto Insight 品牌和一句话价值主张；
- “千万级数据洞察”“动态人群地图”“飞书协同”三项能力摘要；
- “使用飞书登录”主操作；
- 当前版本为单企业演示的准确说明。

如果用户已有有效网站会话，主操作改为“进入工作台”。

### 工作台 `/dashboard`

工作台为受保护的 Server Component。没有有效会话时重定向首页；有会话时展示：

- 飞书头像、姓名和身份状态；
- 三个静态的产品能力入口卡片；
- 清晰的“演示框架”标识，避免把静态内容描述为真实分析结果；
- 退出入口。

### 错误反馈

OAuth 回调失败时重定向到首页并使用非敏感错误码展示中文提示。页面不得显示飞书响应体、访问令牌、应用密钥或内部堆栈。

## OAuth 数据流

### 发起登录

`GET /api/auth/feishu/start`：

1. 验证服务端必需环境变量存在；
2. 使用加密安全随机数生成一次性 `state`；
3. 将 `state` 写入名为 `auto_insight_oauth_state`、有效期 10 分钟的 `HttpOnly`、`SameSite=Lax` Cookie；生产环境额外启用 `Secure`；
4. 以 `app_id`、精确 `redirect_uri` 和 `state` 构造飞书授权 URL；
5. 返回 302 跳转。

### 处理回调

`GET /api/auth/feishu/callback`：

1. 拒绝飞书返回的错误、缺失授权码或缺失 `state`；
2. 使用常量时间比较请求 `state` 与 Cookie，并立即清除 state Cookie；
3. 通过当前官方 v3 端点 `POST https://accounts.feishu.cn/oauth/v3/token` 交换授权码，请求体包含 `grant_type=authorization_code`、应用凭证、授权码和与授权请求完全一致的回调地址；
4. 使用服务端用户访问令牌调用 `GET https://open.feishu.cn/open-apis/authen/v1/user_info`；
5. 仅提取稳定用户标识、姓名和头像 URL；
6. 创建有明确过期时间的签名网站会话 Cookie；
7. 跳转 `/dashboard`。

飞书用户访问令牌只在单次服务端请求期间存在，不写入 Cookie、日志或客户端数据。

### 网站会话

网站会话采用 HMAC-SHA-256 签名，载荷仅包含：

- 版本号；
- 飞书稳定用户标识；
- 展示名称；
- 可选头像 URL；
- 签发和过期时间。

`SESSION_SECRET` 至少为 32 字节随机值。解析时校验签名、版本、必需字段和过期时间；任何异常都视为未登录。名为 `auto_insight_session` 的会话 Cookie 有效期为 8 小时，使用 `HttpOnly`、`SameSite=Lax` 和根路径，生产环境额外启用 `Secure`。

`POST /api/auth/logout` 清除会话并跳转首页。

## 模块边界

- `src/lib/env.ts`：读取并校验服务端环境变量；不得导出到客户端模块。
- `src/features/auth/session.ts`：创建和验证签名网站会话。
- `src/features/auth/feishu.ts`：构造授权 URL、交换令牌和读取用户信息。
- `src/features/auth/cookies.ts`：集中定义 state 与会话 Cookie 属性。
- `app/api/auth/**/route.ts`：HTTP 输入、跳转和 Cookie 编排。
- `app/page.tsx` 与 `app/dashboard/page.tsx`：展示页面，不直接处理 OAuth 网络协议。

外部飞书请求通过可注入的 `fetch` 接口测试，确保测试不访问真实飞书服务。

## 环境变量

生产环境需要：

- `FEISHU_APP_ID`：飞书企业自建应用 ID；
- `FEISHU_APP_SECRET`：飞书企业自建应用密钥，必须在 Vercel 标记为敏感；
- `FEISHU_REDIRECT_URI`：完整生产回调 URL；
- `SESSION_SECRET`：独立生成的会话签名密钥，必须在 Vercel 标记为敏感。

仓库只提交 `.env.example` 的变量名和无敏感示例。`.env*`、`.vercel/` 与本地密钥文件必须被 Git 忽略。

## 部署流程

部署分两阶段完成：

1. 构建并首次部署，取得稳定的 Vercel 生产域名；
2. 在飞书开发者后台把精确回调 URL 加入安全设置，将相同 URL 写入 Vercel 的 `FEISHU_REDIRECT_URI`，然后重新生产部署。

生产部署使用 Vercel CLI 的项目链接和 `--prod`。环境变量只通过 CLI 标准输入或 Vercel 控制台录入，命令行参数和输出不得包含密钥。环境变量更新只对后续部署生效，因此配置完成后必须重新部署。

若 Vercel CLI 尚未登录，部署在账号授权处暂停；代码、测试和本地构建仍应先完成。

## 错误与安全边界

- 缺失配置时返回可诊断但不泄密的错误；
- OAuth `state` 必须在 10 分钟内单次使用，并在成功或失败回调后清除；
- 回调只接受当前站点配置的固定跳转目标，不接受客户端提供的任意重定向；
- 密钥和飞书令牌不得出现在 Git、客户端 Bundle、URL、日志或错误页面；
- 认证路由使用 Node.js Runtime，不使用 Edge Runtime；
- 用户头像属于外部 URL，首版使用普通图片元素或明确配置允许域名，避免任意远程图片优化代理；
- 不持久化飞书访问令牌或用户隐私字段。

## 测试与验收

实现遵循 RED → GREEN → REFACTOR。至少覆盖：

- 授权 URL 包含正确的应用 ID、回调地址和随机 state；
- 缺失或不匹配 state 的回调被拒绝；
- 飞书令牌和用户信息错误被映射为安全错误；
- 有效会话可验证，篡改、过期或畸形会话被拒绝；
- 未登录访问工作台会返回首页；
- 首页和工作台的关键文案可渲染；
- `npm test`、`npm run lint`、`npm run typecheck` 与 `npm run build` 通过；
- 生产 URL 返回成功响应，且密钥未出现在构建产物或 Git diff 中；
- 在完成飞书后台回调配置后，使用企业成员账号完成一次端到端登录、查看工作台和退出。

如果最后一项因飞书后台配置尚未完成而无法验证，必须把部署报告为“已发布但登录待配置”，不能声称真实登录已经可用。

## 文档更新

实现时同步更新：

- `README.md`：本地启动、测试和部署入口；
- `docs/TECH_STACK.md`：记录 Vercel 已选定，以及企业自建应用是当前单企业演示方案；
- `.env.example`：列出必需变量但不包含真实值。

## 官方参考

- [飞书浏览器网页接入指南](https://open.feishu.cn/document/sso/web-application-end-user-consent/guide?lang=zh-CN)
- [飞书获取授权码](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code?lang=zh-CN)
- [飞书获取用户访问令牌 v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)
- [飞书获取用户信息](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Cookie API](https://nextjs.org/docs/app/api-reference/functions/cookies)
- [Vercel CLI 部署](https://vercel.com/docs/cli/deploy)
- [Vercel 环境变量](https://vercel.com/docs/environment-variables)
- [Vercel CLI 环境变量命令](https://vercel.com/docs/cli/env)
