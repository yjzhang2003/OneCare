# Vercel 展示站与飞书登录实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建并部署一个支持真实飞书企业自建应用 OAuth 登录的 Auto Insight Next.js 展示站。

**Architecture:** 一个 Next.js App Router TypeScript 模块化单体负责页面、OAuth Route Handlers 和无数据库签名会话。飞书协议、会话签名和 Cookie 策略各自隔离为小模块；Vercel 仅接收服务端环境变量，用户访问令牌不持久化。

**Tech Stack:** Node.js 24 LTS、Next.js 16.2.10、React 19.2.7、TypeScript 5.9.3、Vitest 4.1.10、Testing Library、Vercel。

## Global Constraints

- 仓库只使用 TypeScript，不添加 Python 代码或工具。
- 当前登录应用是企业自建应用，只支持所属企业内且位于可用范围内的成员。
- OAuth 令牌交换固定使用 `POST https://accounts.feishu.cn/oauth/v3/token`。
- App Secret、飞书令牌和会话密钥不得进入 Git、客户端 Bundle、URL 或日志。
- OAuth state 有效期为 10 分钟且单次使用；网站会话有效期为 8 小时。
- 所有生产行为遵循 RED → GREEN → REFACTOR。
- 首版不引入数据库、Auth.js、机器人、真实洞察数据或 AI 调用。

## Execution Status (2026-07-17)

- Tasks 1–4 and Task 5 Steps 1–8 are implemented and deployed at `https://auto-insight-omega.vercel.app`.
- Final code review found a production-bundle `NextRequest` callback failure and a missing Feishu user-info request header. Both were reproduced with failing tests and fixed; `npm run test:runtime` now exercises the built authentication routes under `next start`.
- Real Feishu login, identity presentation, logout, post-logout dashboard protection, and a redacted Vercel log scan are verified.
- Tasks 1–5 and all final review steps are complete. The review fixes, runtime regression coverage, documentation, and Harness reflection were finalized in commit `1b21b5d`.

---

## File Map

- `package.json`、`package-lock.json`：Node 依赖与统一验证命令。
- `tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`vitest.config.ts`、`vitest.runtime.config.ts`、`vitest.setup.ts`：TypeScript、Next.js、ESLint 与测试配置。
- `app/layout.tsx`、`app/globals.css`：全站壳层与视觉系统。
- `app/page.tsx`、`app/landing-content.tsx`：首页会话编排与纯展示组件。
- `app/dashboard/page.tsx`、`app/dashboard/dashboard-content.tsx`：登录保护与工作台展示。
- `app/api/auth/feishu/start/route.ts`：生成 state 并跳转飞书。
- `app/api/auth/feishu/callback/route.ts`：校验 state、交换令牌、创建会话。
- `app/api/auth/logout/route.ts`：清除会话。
- `src/lib/env.ts`：服务端环境变量验证。
- `src/features/auth/types.ts`：认证边界共享类型和安全错误码。
- `src/features/auth/cookies.ts`：state、会话 Cookie 名称和属性。
- `src/features/auth/session.ts`：HMAC 会话创建与验证。
- `src/features/auth/feishu.ts`：飞书授权 URL、令牌和用户信息适配器。
- `src/features/auth/current-session.ts`：从 Next.js Cookie Store 读取当前会话。
- `*.test.ts(x)`：与上述领域模块、路由和展示组件相邻的测试。
- `tests/runtime/auth-routes.test.ts`：启动 `next build` 产物，回归验证真实生产 Bundle 中的认证路由。
- `.env.example`：无敏感值的变量清单。
- `README.md`、`docs/TECH_STACK.md`：运行、验证、部署与架构现状。

---

### Task 1: 建立 Next.js 与测试基线

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `src/lib/env.test.ts`
- Create: `src/lib/env.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `AuthEnv` and `readAuthEnv(source?: NodeJS.ProcessEnv): AuthEnv`.
- Produces: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

- [x] **Step 1: 创建工具链配置，不创建页面或认证生产行为**

`package.json` 固定 Node 24 和依赖版本：

```json
{
  "name": "auto-insight",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "16.2.10",
    "react": "19.2.7",
    "react-dom": "19.2.7"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.2",
    "@types/node": "24.13.3",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "eslint": "9.39.5",
    "eslint-config-next": "16.2.10",
    "jsdom": "29.1.1",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  }
}
```

配置 TypeScript 严格模式、`@/*` 根目录别名、Vitest `jsdom` 环境和 `vitest.setup.ts` 中的 `@testing-library/jest-dom/vitest`。`.gitignore` 增加 `node_modules/`、`.next/`、`.vercel/`、`.env*`，并显式保留 `!.env.example`。

- [x] **Step 2: 安装依赖并提交 lockfile**

Run: `npm install`

Expected: 生成 `package-lock.json`，安装过程退出码 0。

- [x] **Step 3: 为环境变量契约写失败测试**

`src/lib/env.test.ts` 至少断言：完整变量返回原值、缺失变量抛出只含变量名的错误、短于 32 字节的 `SESSION_SECRET` 被拒绝。

```ts
expect(() => readAuthEnv({ FEISHU_APP_ID: "cli_test" })).toThrow(
  "Missing server environment variable: FEISHU_APP_SECRET",
);
```

Run: `npm test -- src/lib/env.test.ts`

Expected: FAIL，因为 `./env` 尚不存在。

- [x] **Step 4: 实现最小环境变量读取器**

```ts
export type AuthEnv = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  sessionSecret: string;
};

export function readAuthEnv(source = process.env): AuthEnv;
```

错误只报告缺失或非法变量名，不包含值。

- [x] **Step 5: 验证并提交**

Run: `npm test -- src/lib/env.test.ts && npm run typecheck && npm run lint`

Expected: 全部退出码 0。

Commit: `chore: scaffold Next.js TypeScript application`

---

### Task 2: 实现安全 state 与签名网站会话

**Files:**
- Create: `src/features/auth/types.ts`
- Create: `src/features/auth/cookies.ts`
- Create: `src/features/auth/cookies.test.ts`
- Create: `src/features/auth/session.ts`
- Create: `src/features/auth/session.test.ts`

**Interfaces:**
- Produces: `AuthUser { openId: string; name: string; avatarUrl?: string }`.
- Produces: `generateOAuthState()`, `statesMatch(received, expected)`.
- Produces: `createSession(user, secret, now?)` and `verifySession(token, secret, now?)`.
- Produces: `OAUTH_STATE_COOKIE`, `SESSION_COOKIE`, `stateCookieOptions()`, `sessionCookieOptions()`.

- [x] **Step 1: 写 state 与 Cookie 策略失败测试**

断言随机 state 非空且连续两次不同、相同 state 匹配、不同长度或值不匹配；生产 Cookie 含 `secure: true`，state `maxAge: 600`，session `maxAge: 28800`，两者均为 `httpOnly`、`sameSite: "lax"`、`path: "/"`。

Run: `npm test -- src/features/auth/cookies.test.ts`

Expected: FAIL，因为模块不存在。

- [x] **Step 2: 最小实现 state 与 Cookie 策略**

使用 `randomBytes(32).toString("base64url")` 生成 state，使用 `timingSafeEqual` 且先比较 Buffer 长度。Cookie 名固定为 `auto_insight_oauth_state` 和 `auto_insight_session`。

- [x] **Step 3: 写签名会话失败测试**

断言有效会话恢复用户；任一载荷字符被篡改、签名被篡改、过期、版本错误、畸形 JSON、空用户 ID 均返回 `null`；密钥不足 32 字节抛出不含密钥值的错误。

```ts
const token = createSession(user, secret, new Date("2026-07-17T00:00:00Z"));
expect(verifySession(token, secret, new Date("2026-07-17T01:00:00Z"))).toEqual(user);
```

Run: `npm test -- src/features/auth/session.test.ts`

Expected: FAIL，因为模块不存在。

- [x] **Step 4: 最小实现 HMAC-SHA-256 会话**

令牌格式为 `<base64url-json>.<base64url-signature>`，签名覆盖编码后的载荷。载荷固定为：

```ts
type SessionPayload = {
  version: 1;
  user: AuthUser;
  issuedAt: number;
  expiresAt: number;
};
```

时间使用 Unix 秒，过期时间为签发后 28,800 秒。验证器捕获解析异常并返回 `null`，但配置密钥错误仍抛出。

- [x] **Step 5: 验证并提交**

Run: `npm test -- src/features/auth && npm run typecheck && npm run lint`

Expected: 全部退出码 0。

Commit: `feat: add signed authentication sessions`

---

### Task 3: 实现飞书适配器与 OAuth 路由

**Files:**
- Create: `src/features/auth/feishu.test.ts`
- Create: `src/features/auth/feishu.ts`
- Create: `src/features/auth/current-session.ts`
- Create: `app/api/auth/feishu/start/route.test.ts`
- Create: `app/api/auth/feishu/start/route.ts`
- Create: `app/api/auth/feishu/callback/route.test.ts`
- Create: `app/api/auth/feishu/callback/route.ts`
- Create: `app/api/auth/logout/route.test.ts`
- Create: `app/api/auth/logout/route.ts`

**Interfaces:**
- Consumes: `AuthEnv`, state utilities, Cookie policies, `createSession`.
- Produces: `buildAuthorizationUrl`, `exchangeAuthorizationCode`, `fetchFeishuUser`.
- Produces: GET start/callback handlers and POST logout handler.

- [x] **Step 1: 写授权 URL 失败测试**

断言 URL origin/path 为 `https://accounts.feishu.cn/open-apis/authen/v1/authorize`，参数含 `client_id`、`response_type=code`、精确 `redirect_uri`、`state`，且不含 App Secret。

Run: `npm test -- src/features/auth/feishu.test.ts`

Expected: FAIL，因为适配器不存在。

- [x] **Step 2: 实现授权 URL 构造器**

```ts
export function buildAuthorizationUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): URL;
```

使用 `URL` 和 `searchParams`，不手工拼接编码。

- [x] **Step 3: 写令牌交换与用户信息失败测试**

通过注入 `fetcher: typeof fetch` 验证：

- 令牌请求只发往 `https://accounts.feishu.cn/oauth/v3/token`，JSON 请求体包含规范字段；
- HTTP 非成功、`code !== 0` 或缺失 `access_token` 均抛出 `AuthFlowError("token_exchange_failed")`；
- 用户信息请求发送 `Authorization: Bearer <token>` 与飞书要求的 `Content-Type: application/json; charset=utf-8`；
- 用户信息响应只映射 `open_id`、`name`、可选 `avatar_url`；
- 错误对象和消息不得包含令牌或 App Secret。

Run: `npm test -- src/features/auth/feishu.test.ts`

Expected: FAIL 在尚未实现的网络函数断言。

- [x] **Step 4: 实现飞书网络适配器**

```ts
export async function exchangeAuthorizationCode(
  input: { code: string; env: AuthEnv },
  fetcher?: typeof fetch,
): Promise<string>;

export async function fetchFeishuUser(
  accessToken: string,
  fetcher?: typeof fetch,
): Promise<AuthUser>;
```

响应先按 `unknown` 解析再做字段守卫。`AuthFlowError` 只允许固定安全码：`configuration_error`、`access_denied`、`invalid_state`、`token_exchange_failed`、`user_info_failed`。

- [x] **Step 5: 写三个 Route Handler 的失败测试**

使用真实 `Request`/`NextRequest` 和可控模块依赖，断言：

- start 返回 302 飞书地址并设置 10 分钟 state Cookie；
- callback 对缺失/不匹配 state 返回 `/?auth_error=invalid_state` 并删除 state Cookie；
- callback 成功返回 `/dashboard` 并设置 8 小时 session Cookie；
- callback 的飞书拒绝映射为 `/?auth_error=access_denied`；
- logout 删除 session Cookie 并返回首页。

Run: `npm test -- app/api/auth`

Expected: FAIL，因为路由尚不存在。

- [x] **Step 6: 实现 Route Handlers 与当前会话读取器**

所有认证路由导出 `export const runtime = "nodejs"`。callback 无论成功或失败都在返回响应上删除 state Cookie。`current-session.ts` 通过 `await cookies()` 读取会话并调用 `verifySession`；缺失或非法配置时返回未登录，不向页面泄露细节。

- [x] **Step 7: 验证并提交**

Run: `npm test -- src/features/auth app/api/auth && npm run typecheck && npm run lint`

Expected: 全部退出码 0，测试输出不包含凭证。

Commit: `feat: implement Feishu OAuth login flow`

---

### Task 4: 构建首页与受保护工作台

**Files:**
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/landing-content.test.tsx`
- Create: `app/landing-content.tsx`
- Create: `app/page.tsx`
- Create: `app/dashboard/dashboard-content.test.tsx`
- Create: `app/dashboard/dashboard-content.tsx`
- Create: `app/dashboard/page.tsx`
- Create: `app/icon.svg`

**Interfaces:**
- Consumes: `getCurrentSession()` and `AuthUser`.
- Produces: responsive `/` and authenticated `/dashboard`.

- [x] **Step 1: 写首页展示失败测试**

断言未登录版本呈现“让每一次产品定义，都听见真实用户”、三项能力、“使用飞书登录”和单企业演示说明；已登录版本显示“进入工作台”。登录链接必须指向 `/api/auth/feishu/start`。

Run: `npm test -- app/landing-content.test.tsx`

Expected: FAIL，因为组件不存在。

- [x] **Step 2: 实现首页结构和全局视觉系统**

视觉方向为深石墨背景、暖白内容面、信号橙点缀和轻量数据网格。使用系统中文字体栈，不下载外部字体。首页由品牌导航、主叙事、数据刻度、能力卡和可信边界说明组成；移动端保持单列和 44px 最小点击区域。

- [x] **Step 3: 写工作台展示失败测试**

断言用户名和身份状态可见，三个入口分别为“人群地图”“用户原声”“车型对比”，每项均标记“演示框架”，并存在 POST 到 `/api/auth/logout` 的退出表单。

Run: `npm test -- app/dashboard/dashboard-content.test.tsx`

Expected: FAIL，因为组件不存在。

- [x] **Step 4: 实现受保护工作台**

`app/dashboard/page.tsx` 调用 `getCurrentSession()`，无用户时执行 `redirect("/")`，有用户时传给纯展示组件。头像 URL 存在时使用带明确 `referrerPolicy="no-referrer"` 的普通 `<img>`，否则显示姓名首字符；不得渲染 open ID。

- [x] **Step 5: 运行页面与生产构建验证**

Run: `npm test -- app && npm run typecheck && npm run lint && npm run build`

Expected: 所有测试通过，Next.js 构建成功，首页、工作台和三个认证路由出现在构建路由表中。

- [x] **Step 6: 本地 HTTP 行为验证并提交**

Run: `npm run dev`

另一个终端运行：

```bash
curl -I http://127.0.0.1:3000/
curl -I http://127.0.0.1:3000/dashboard
```

Expected: 首页 200；无会话工作台返回到首页的重定向。

Commit: `feat: add Auto Insight landing and dashboard`

---

### Task 5: 文档、全量校验与 Vercel 生产部署

**Files:**
- Create: `.env.example`
- Modify: `README.md`
- Modify: `docs/TECH_STACK.md`
- Modify: `docs/superpowers/plans/2026-07-17-vercel-feishu-login.md`
- Optional modify: `docs/HARNESS_REFLECTIONS.md` and `AGENTS.md` only if concrete durable evidence justifies a rule change.

**Interfaces:**
- Consumes: complete application and Vercel CLI authentication.
- Produces: production URL, Vercel project link, configured server secrets and deployment evidence.

- [x] **Step 1: 写无敏感值的运行与部署文档**

`.env.example` 只包含：

```dotenv
FEISHU_APP_ID=cli_example
FEISHU_APP_SECRET=replace_in_local_env_only
FEISHU_REDIRECT_URI=http://127.0.0.1:3000/api/auth/feishu/callback
SESSION_SECRET=replace_with_at_least_32_random_bytes
```

README 记录 Node 24、`npm install`、本地环境变量、测试命令、飞书安全设置路径和 Vercel 两阶段部署。`docs/TECH_STACK.md` 将 Vercel 从 deferred 改为已选定，并说明当前企业自建应用覆盖单企业、商店应用多租户仍为未来方向。

- [x] **Step 2: 运行完成前全量验证**

Run:

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
git diff --check
git status --short
```

再扫描真实 App Secret 的完整值与已知前缀，范围包含 tracked/untracked 文件但排除 `.git`、`node_modules`、`.next` 和 `.vercel`。Expected: 全部退出码 0，密钥扫描无匹配，工作区仅包含预期文件。

- [x] **Step 3: 提交应用与文档**

Commit: `docs: add deployment and Feishu setup guide`

- [x] **Step 4: 检查 Vercel 登录并链接项目**

Run: `npx vercel@latest whoami`

若未登录，运行 `npx vercel@latest login` 并完成账号授权。随后运行：

```bash
npx vercel@latest link --yes
```

Expected: `.vercel/project.json` 存在但被 Git 忽略，项目链接成功。

- [x] **Step 5: 通过标准输入设置生产环境变量**

为 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_REDIRECT_URI`、`SESSION_SECRET` 分别执行 `vercel env add <NAME> production`。App Secret 和 Session Secret 使用 `--sensitive`；不得把值放在命令参数、shell history、临时文件或输出中。首次 `FEISHU_REDIRECT_URI` 可使用不可用占位域名，取得正式域名后立即更新。

- [x] **Step 6: 首次生产部署并取得稳定域名**

Run: `npx vercel@latest --prod --yes`

Expected: 构建成功并返回 HTTPS 生产 URL。用 `curl -fsS -o /dev/null -w '%{http_code}' <URL>` 验证首页为 200。

- [x] **Step 7: 完成飞书回调与最终生产环境变量**

在飞书开发者后台进入该企业自建应用的“开发配置 → 安全设置 → 重定向 URL”，加入：

```text
https://<production-domain>/api/auth/feishu/callback
```

随后用 Vercel CLI 更新 `FEISHU_REDIRECT_URI` 为同一精确值，并重新运行 `npx vercel@latest --prod --yes`。环境变量值仍通过标准输入提供。

- [x] **Step 8: 生产冒烟与真实登录验收**

验证：

1. 首页 200 且无敏感信息；
2. 登录按钮跳转到飞书官方授权域名，URL 不含 App Secret；
3. 当前企业成员授权后返回 `/dashboard`；
4. 工作台显示姓名但不显示 open ID 或 token；
5. 退出后再次访问 `/dashboard` 返回首页；
6. Vercel 函数日志不含 App Secret、用户访问令牌或完整会话 Cookie。

- [x] **Step 9: 最终仓库与 Harness 复盘**

Run: `git status --short --branch && git log --oneline --decorate -5`

若开发过程没有暴露持久、仓库特定的指令问题，则不修改 `AGENTS.md`，并在交付摘要明确“无 Harness 规则变更”。若有证据，则先追加 `docs/HARNESS_REFLECTIONS.md`，再修改 `AGENTS.md` 并重复全量验证。
