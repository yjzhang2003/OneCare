# OneCare Feishu Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立飞书体验页、三角色飞书入口和部署在 Vercel Route Handler 中的轻量单聊机器人，让加入组织、身份验证与机器人体验形成一条准确路径。

**Architecture:** 网站继续使用现有 Next.js 模块化单体；`/login` 读取现有签名会话并呈现二维码和三步引导，OAuth 回调返回该页面。机器人使用独立纯脚本、飞书事件解析器、官方 Node SDK 客户端和 `POST /api/feishu/events`；Route Handler 通过 Next.js `after()` 在先确认事件后发送回复，不增加数据库或队列。

**Tech Stack:** Node.js 24、TypeScript 5.9、Next.js 16.2.10、React 19.2、Vitest 4.1、React Testing Library、`@larksuiteoapi/node-sdk` 1.71.1、CSS、Playwright CLI、Vercel Preview。

## Global Constraints

- TypeScript only；不得添加 Python 代码或 Python 工具。
- 当前仍是单企业自建应用；用户必须加入 OneCare 企业且处于应用可用范围内。
- 复用当前 `FEISHU_APP_ID` 与 `FEISHU_APP_SECRET`，所有凭证只留在服务端。
- 新增 `FEISHU_EVENT_VERIFICATION_TOKEN` 与 `FEISHU_EVENT_ENCRYPT_KEY`；两者都必须配置，不能使用 `NEXT_PUBLIC_*`。
- OAuth state、HttpOnly 会话、八小时过期和现有错误映射保持不变。
- Bot 只接收 `im.message.receive_v1` 的 `p2p` 文本，不读取群聊消息，不处理文件、图片、语音或卡片交互。
- Bot 回复是确定性演示脚本，不调用真实 AI、知识库、IoT、工单、配件、回访或 VOC 服务。
- Bot 不持久化会话、用户标识、消息正文、token 或 event id；极端重推可能产生重复演示回复，必须在文档中保留该边界。
- 事件请求先验证签名、Verification Token 与 Encrypt Key；日志不得输出原始请求体、消息正文或上游响应体。
- URL Verification 在一秒内返回；普通事件在三秒内返回 HTTP 200，回复通过 Next.js `after()` 执行。
- 新登录页保持 MiSans、黑白与海信青、白色圆角容器、圆形/药丸按钮；按钮文字居中、无箭头，只用颜色反转动效。
- 邀请二维码必须完整显示、无滤镜、无遮罩，保留 `+86` 与 2026 年 8 月 29 日失效信息。
- 客服、工程师、后台复用同一个 `FeishuExperienceBanner`；用户手机工作台不显示。
- 所有行为修改严格执行 RED → GREEN → REFACTOR。
- 完成本地验证后自动发布非 Production Preview；用户确认前不修改 Production 飞书回调或声称机器人真实可用。

---

## File Structure

- `public/images/feishu/onecare-enterprise-invite-2026-08-29.png`：用户授权公开展示的完整飞书邀请二维码截图。
- `src/lib/env.ts`：保留 `readAuthEnv`，新增独立 `readBotEnv`，避免普通页面构建被机器人变量耦合。
- `src/features/feishu-bot/bot-script.ts`：无状态纯函数脚本。
- `src/features/feishu-bot/event-handler.ts`：签名、token、解密、challenge、单聊文本筛选。
- `src/features/feishu-bot/client.ts`：官方 SDK Client 的安全回复适配器。
- `app/api/feishu/events/route.ts`：读取 HTTP 输入、立即应答并用 `after()` 调度回复。
- `app/login/page.tsx`：读取会话和安全 Query，组合体验页。
- `app/login/login-content.tsx`：体验页纯展示组件。
- `src/features/showcase/components/feishu-experience-banner.tsx`：三个角色复用的飞书入口。
- `app/dashboard/page.tsx`：兼容旧地址并重定向 `/login`。
- `app/api/auth/feishu/callback/route.ts`：成功或失败均回到 `/login`。
- `app/globals.css`：体验页与 Banner 响应式样式。
- `tests/runtime/auth-routes.test.ts`：构建产物中的登录重定向、Dashboard 兼容和 event challenge。
- `README.md`、`docs/TECH_STACK.md`、`.env.example`：实际能力、配置和边界。

---

### Task 1: Add Bot Environment Contract and Approved QR Asset

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`
- Modify: `.env.example`
- Create: `public/images/feishu/onecare-enterprise-invite-2026-08-29.png`

**Interfaces:**
- Produces: `BotEnv { appId, appSecret, verificationToken, encryptKey }`.
- Produces: `readBotEnv(source?: Readonly<Record<string, string | undefined>>): BotEnv`.
- Adds runtime dependency `@larksuiteoapi/node-sdk@1.71.1`.

- [x] **Step 1: Write the failing environment tests**

Extend `src/lib/env.test.ts`:

```ts
import { readAuthEnv, readBotEnv } from "./env";

const validBotEnvironment = {
  FEISHU_APP_ID: "cli_test",
  FEISHU_APP_SECRET: "test-app-secret",
  FEISHU_EVENT_VERIFICATION_TOKEN: "verification-token",
  FEISHU_EVENT_ENCRYPT_KEY: "12345678901234567890123456789012",
};

it("maps the server-only bot environment independently from OAuth", () => {
  expect(readBotEnv(validBotEnvironment)).toEqual({
    appId: "cli_test",
    appSecret: "test-app-secret",
    verificationToken: "verification-token",
    encryptKey: "12345678901234567890123456789012",
  });
});

it("rejects missing bot verification settings without exposing values", () => {
  expect(() =>
    readBotEnv({
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "private-value",
    }),
  ).toThrow(
    "Missing server environment variable: FEISHU_EVENT_VERIFICATION_TOKEN",
  );
});
```

- [x] **Step 2: Run the tests and verify RED**

Run:

```bash
npx vitest run src/lib/env.test.ts
```

Expected: FAIL because `readBotEnv` is not exported.

- [x] **Step 3: Implement the isolated bot environment reader**

Add to `src/lib/env.ts` without changing `readAuthEnv` requirements:

```ts
export type BotEnv = {
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
};

export function readBotEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): BotEnv {
  return {
    appId: readRequired(source, "FEISHU_APP_ID"),
    appSecret: readRequired(source, "FEISHU_APP_SECRET"),
    verificationToken: readRequired(
      source,
      "FEISHU_EVENT_VERIFICATION_TOKEN",
    ),
    encryptKey: readRequired(source, "FEISHU_EVENT_ENCRYPT_KEY"),
  };
}
```

Expand the `readRequired` name union with both event variable names. Do not require event variables from `readAuthEnv`.

- [x] **Step 4: Add the official SDK and QR asset**

Run:

```bash
npm install @larksuiteoapi/node-sdk@1.71.1
mkdir -p public/images/feishu
cp /Users/chihayaanon/Downloads/飞书20260718-181948.png public/images/feishu/onecare-enterprise-invite-2026-08-29.png
```

Append only variable names and safe examples to `.env.example`:

```dotenv
FEISHU_EVENT_VERIFICATION_TOKEN=replace_with_event_verification_token
FEISHU_EVENT_ENCRYPT_KEY=replace_with_event_encrypt_key
```

- [x] **Step 5: Verify GREEN and asset integrity**

Run:

```bash
npx vitest run src/lib/env.test.ts
file public/images/feishu/onecare-enterprise-invite-2026-08-29.png
```

Expected: environment tests pass; `file` reports a readable PNG image.

- [x] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/env.ts src/lib/env.test.ts .env.example public/images/feishu/onecare-enterprise-invite-2026-08-29.png
git commit -m "chore: add Feishu bot runtime contract"
```

---

### Task 2: Implement the Stateless OneCare Bot Script

**Files:**
- Create: `src/features/feishu-bot/bot-script.test.ts`
- Create: `src/features/feishu-bot/bot-script.ts`

**Interfaces:**
- Produces: `BotReplyKind = "welcome" | "knowledge" | "resolved" | "handoff"`.
- Produces: `BotReply { kind: BotReplyKind; text: string }`.
- Produces: `createBotReply(input: string): BotReply`.

- [x] **Step 1: Write the failing script tests**

Create `src/features/feishu-bot/bot-script.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createBotReply } from "./bot-script";

describe("createBotReply", () => {
  it.each(["开始体验", "开始", "你好", "无法识别的内容"])(
    "returns the welcome menu for %s",
    (input) => {
      const reply = createBotReply(input);
      expect(reply.kind).toBe("welcome");
      expect(reply.text).toContain("1 饮料不够凉");
      expect(reply.text).toContain("演示流程");
    },
  );

  it.each(["1", "饮料不够凉", " 2 ", "刚才开始", "3", "没有影响"])(
    "returns knowledge help for %s",
    (input) => {
      const reply = createBotReply(input);
      expect(reply.kind).toBe("knowledge");
      expect(reply.text).toContain("确认冰箱门体已完全闭合");
      expect(reply.text).toContain("回复「已解决」或「转人工」");
    },
  );

  it("closes the self-service path", () => {
    expect(createBotReply(" 已解决 ")).toMatchObject({ kind: "resolved" });
  });

  it("creates a clearly simulated handoff summary", () => {
    const reply = createBotReply("转人工");
    expect(reply.kind).toBe("handoff");
    expect(reply.text).toContain("预诊摘要");
    expect(reply.text).toContain("未创建真实工单");
  });

  it("always restarts from the welcome menu", () => {
    expect(createBotReply("重新开始").kind).toBe("welcome");
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run src/features/feishu-bot/bot-script.test.ts
```

Expected: FAIL because `bot-script.ts` does not exist.

- [x] **Step 3: Implement the smallest deterministic script**

Create `src/features/feishu-bot/bot-script.ts` with normalized exact keyword sets. The reply text must include these stable contracts:

```ts
export type BotReplyKind = "welcome" | "knowledge" | "resolved" | "handoff";

export type BotReply = Readonly<{
  kind: BotReplyKind;
  text: string;
}>;

const diagnosisInputs = new Set([
  "1",
  "2",
  "3",
  "饮料不够凉",
  "刚才开始",
  "没有影响",
]);

function normalize(input: string): string {
  return input.trim().toLocaleLowerCase("zh-CN");
}

export function createBotReply(input: string): BotReply {
  const value = normalize(input);

  if (value === "已解决") {
    return {
      kind: "resolved",
      text: "已记录为 AI 自助解决。本次为万护 OneCare 演示流程；回复「重新开始」可再次体验。",
    };
  }

  if (value === "转人工") {
    return {
      kind: "handoff",
      text: "预诊摘要｜冷藏室温度持续偏高，知识库排查后仍未解决，建议客服核验温度传感器与风道。本次为演示流程，未创建真实工单。回复「重新开始」可再次体验。",
    };
  }

  if (diagnosisInputs.has(value)) {
    return {
      kind: "knowledge",
      text: "知识库建议\n1. 确认冰箱门体已完全闭合\n2. 保持冷藏室出风口无遮挡\n3. 减少开门并等待十分钟后复查\n\n回复「已解决」或「转人工」。本次为演示流程。",
    };
  }

  return {
    kind: "welcome",
    text: "检测到冷藏室温度持续偏高。请选择最接近的情况：\n1 饮料不够凉\n2 刚才开始\n3 没有影响\n\n本次为万护 OneCare 演示流程。",
  };
}
```

- [x] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run src/features/feishu-bot/bot-script.test.ts
```

Expected: all bot script cases pass.

- [x] **Step 5: Commit**

```bash
git add src/features/feishu-bot/bot-script.ts src/features/feishu-bot/bot-script.test.ts
git commit -m "feat: add OneCare bot demo script"
```

---

### Task 3: Add Verified Feishu Event Handling and Vercel Reply Route

**Files:**
- Create: `src/features/feishu-bot/event-handler.ts`
- Create: `src/features/feishu-bot/event-handler.test.ts`
- Create: `src/features/feishu-bot/client.ts`
- Create: `src/features/feishu-bot/client.test.ts`
- Create: `app/api/feishu/events/route.ts`
- Create: `app/api/feishu/events/route.test.ts`
- Modify: `tests/runtime/auth-routes.test.ts`

**Interfaces:**
- Consumes: `BotEnv`, `createBotReply(text)`.
- Produces: `FeishuEventOutcome = challenge | message | ignored | unauthorized`.
- Produces: `parseFeishuEvent({ rawBody, headers, env }): Promise<FeishuEventOutcome>`.
- Produces: `replyToFeishuMessage({ env, messageId, text }): Promise<void>`.
- Produces: `createFeishuEventRoute(dependencies?): (request: Request) => Promise<Response>`.

- [x] **Step 1: Write failing event parser tests**

Create `src/features/feishu-bot/event-handler.test.ts` using a fixed `BotEnv`. Cover:

```ts
it("returns an authenticated URL verification challenge", async () => {
  const rawBody = JSON.stringify({
    type: "url_verification",
    token: env.verificationToken,
    challenge: "challenge-value",
  });

  await expect(
    parseFeishuEvent({ rawBody, headers: new Headers(), env }),
  ).resolves.toEqual({ kind: "challenge", challenge: "challenge-value" });
});

it("rejects a challenge with the wrong verification token", async () => {
  const rawBody = JSON.stringify({
    type: "url_verification",
    token: "wrong-token",
    challenge: "must-not-return",
  });

  await expect(
    parseFeishuEvent({ rawBody, headers: new Headers(), env }),
  ).resolves.toEqual({ kind: "unauthorized" });
});
```

Add signed V2 payload cases for `p2p + text`, `group`, non-text and wrong signature. Generate `x-lark-signature` inside the test with `sha256(timestamp + nonce + encryptKey + rawBody)` so the test proves the production contract.

- [x] **Step 2: Run the parser test and verify RED**

Run:

```bash
npx vitest run src/features/feishu-bot/event-handler.test.ts
```

Expected: FAIL because `event-handler.ts` does not exist.

- [x] **Step 3: Implement source verification and SDK dispatch**

Create `src/features/feishu-bot/event-handler.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";

import { AESCipher, EventDispatcher, LoggerLevel } from "@larksuiteoapi/node-sdk";

import type { BotEnv } from "../../lib/env";

export type FeishuEventOutcome =
  | Readonly<{ kind: "challenge"; challenge: string }>
  | Readonly<{ kind: "message"; messageId: string; text: string }>
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "unauthorized" }>;

export type ParseFeishuEventInput = Readonly<{
  rawBody: string;
  headers: Headers;
  env: BotEnv;
}>;
```

Implementation rules:

1. Parse JSON inside `try/catch`; malformed input returns `ignored`.
2. For an unencrypted `url_verification`, constant-time compare `body.token` with `env.verificationToken` and return the challenge.
3. For ordinary events require timestamp, nonce and signature headers; compare against `sha256(timestamp + nonce + encryptKey + rawBody)` with `timingSafeEqual`.
4. If `body.encrypt` exists, decrypt with `new AESCipher(env.encryptKey).decrypt(body.encrypt)` and check the decrypted token/header token.
5. Build `EventDispatcher({ verificationToken, encryptKey, loggerLevel: LoggerLevel.error })`, register only `im.message.receive_v1`, and call `invoke(requestData, { needCheck: false })` after the explicit raw-body signature check.
6. In the registered handler, accept only `message.chat_type === "p2p"` and `message.message_type === "text"`; parse `message.content` as JSON and return a non-empty `message_id` and text.
7. Missing or mismatched token/signature returns `unauthorized`; unsupported but authentic payload returns `ignored`.

- [x] **Step 4: Verify parser GREEN**

Run:

```bash
npx vitest run src/features/feishu-bot/event-handler.test.ts
```

Expected: challenge, message, ignored and unauthorized cases all pass.

- [x] **Step 5: Write failing SDK reply adapter tests**

Create `src/features/feishu-bot/client.test.ts` with an injected client:

```ts
it("replies to the original message with text content", async () => {
  const reply = vi.fn(async () => ({ code: 0, msg: "success" }));

  await replyToFeishuMessage(
    { env, messageId: "om_message", text: "演示回复" },
    () => ({ im: { message: { reply } } }),
  );

  expect(reply).toHaveBeenCalledWith({
    path: { message_id: "om_message" },
    data: {
      msg_type: "text",
      content: JSON.stringify({ text: "演示回复" }),
    },
  });
});
```

Also assert non-zero SDK `code` throws `FeishuBotError("reply_failed")` without preserving `msg` or secrets.

- [x] **Step 6: Implement the official SDK client adapter**

Create `src/features/feishu-bot/client.ts`:

```ts
import { Client, LoggerLevel } from "@larksuiteoapi/node-sdk";

import type { BotEnv } from "../../lib/env";

export class FeishuBotError extends Error {
  constructor(public readonly code: "reply_failed") {
    super(code);
    this.name = "FeishuBotError";
  }
}

export async function replyToFeishuMessage(
  input: Readonly<{ env: BotEnv; messageId: string; text: string }>,
  createClient = () =>
    new Client({
      appId: input.env.appId,
      appSecret: input.env.appSecret,
      loggerLevel: LoggerLevel.error,
    }),
): Promise<void> {
  const response = await createClient().im.message.reply({
    path: { message_id: input.messageId },
    data: {
      msg_type: "text",
      content: JSON.stringify({ text: input.text }),
    },
  });

  if (response.code !== 0) throw new FeishuBotError("reply_failed");
}
```

Define a narrow structural client type so the injected fake is type-safe without asserting it as the full SDK `Client`.

- [x] **Step 7: Verify client GREEN**

Run:

```bash
npx vitest run src/features/feishu-bot/client.test.ts
```

Expected: reply payload and safe failure tests pass.

- [x] **Step 8: Write failing Route Handler tests**

Create `app/api/feishu/events/route.test.ts` covering:

- challenge returns `200 { challenge }` and schedules nothing;
- unauthorized returns `403` and schedules nothing;
- ignored returns `200 {}`;
- message returns `200 {}` immediately, schedules one callback, and the callback replies with `createBotReply(text).text`;
- reply failure is caught and writes only the constant marker `[onecare-bot] reply_failed`.

Use dependencies:

```ts
type Scheduler = (task: () => Promise<void>) => void;

const scheduled: Array<() => Promise<void>> = [];
const schedule: Scheduler = (task) => scheduled.push(task);
```

- [x] **Step 9: Implement the Vercel Route Handler**

Create `app/api/feishu/events/route.ts` with `runtime = "nodejs"`, `maxDuration = 10`, dependency injection and the production scheduler:

```ts
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10;

const defaultDependencies = {
  readEnv: () => readBotEnv(),
  parseEvent: parseFeishuEvent,
  createReply: createBotReply,
  replyMessage: replyToFeishuMessage,
  schedule: (task: () => Promise<void>) => after(task),
  reportFailure: () => console.error("[onecare-bot] reply_failed"),
};
```

Read `request.text()` once. Map outcomes exactly: challenge → JSON challenge; unauthorized/configuration failure → 403/503 safe JSON; ignored → 200 empty object; message → schedule a caught reply Promise and return 200 immediately.

- [x] **Step 10: Verify the Route Handler and built runtime**

Run:

```bash
npx vitest run app/api/feishu/events/route.test.ts src/features/feishu-bot
```

Then extend `tests/runtime/auth-routes.test.ts` child-process environment with both event values and add an unencrypted valid-token challenge request. Run:

```bash
npm run test:runtime
```

Expected: production build succeeds; challenge returns within the built Next.js runtime; existing auth smoke tests remain green.

- [x] **Step 11: Commit**

```bash
git add src/features/feishu-bot app/api/feishu/events tests/runtime/auth-routes.test.ts
git commit -m "feat: add verified Feishu bot webhook"
```

---

### Task 4: Replace the Dashboard Landing with the Feishu Experience Page

**Files:**
- Create: `app/login/login-content.test.tsx`
- Create: `app/login/login-content.tsx`
- Create: `app/login/page.tsx`
- Modify: `app/landing-content.test.tsx`
- Modify: `app/landing-content.tsx`
- Modify: `src/features/showcase/components/site-header.tsx`
- Modify: `app/api/auth/feishu/callback/route.test.ts`
- Modify: `app/api/auth/feishu/callback/route.ts`
- Modify: `app/dashboard/page.tsx`
- Modify: `tests/runtime/auth-routes.test.ts`

**Interfaces:**
- Consumes: `AuthUser | null`, safe `authError`, safe `from` role.
- Produces: `LoginContent({ user, authError, sourceRole })`.
- Produces: `/login` Server Component and `/dashboard` compatibility redirect.

- [x] **Step 1: Write the failing login page presentation tests**

Create `app/login/login-content.test.tsx`:

```tsx
it("guides a visitor through joining, verifying and opening Feishu", () => {
  render(<LoginContent user={null} />);
  expect(screen.getByRole("heading", { name: "在飞书里体验万护" })).toBeInTheDocument();
  expect(screen.getByText("加入体验组织")).toBeInTheDocument();
  expect(screen.getByText("验证飞书身份")).toBeInTheDocument();
  expect(screen.getByText("在飞书开始体验")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "使用飞书验证身份" })).toHaveAttribute(
    "href",
    "/api/auth/feishu/start",
  );
  expect(screen.getByRole("img", { name: "加入 OneCare 体验组织的飞书二维码" })).toHaveAttribute(
    "src",
    expect.stringContaining("onecare-enterprise-invite-2026-08-29.png"),
  );
  expect(screen.getByText("二维码有效期至 2026 年 8 月 29 日")).toBeInTheDocument();
});

it("shows the verified identity without rendering a second dashboard", () => {
  render(<LoginContent user={{ openId: "ou_test", name: "服务体验员" }} />);
  expect(screen.getByText("服务体验员")).toBeInTheDocument();
  expect(screen.getByText("飞书身份已验证")).toBeInTheDocument();
  expect(screen.getByText("打开飞书，在顶部搜索「OneCare」开始体验")).toBeInTheDocument();
  expect(screen.queryByText("服务闭环指挥台")).not.toBeInTheDocument();
});
```

Add a safe known-error test and a source-role test; do not render arbitrary source query text.

- [x] **Step 2: Run the login page test and verify RED**

Run:

```bash
npx vitest run app/login/login-content.test.tsx
```

Expected: FAIL because the login components do not exist.

- [x] **Step 3: Implement the login page components**

Create `app/login/login-content.tsx` as a pure component. Reuse `OneCareLogo`; use `next/image` for the QR asset; use a real POST form for logout. Define source copy as a closed map:

```ts
const sourceMessages = {
  agent: "从客服视角继续：在飞书接收转人工会话与 AI 预诊摘要。",
  engineer: "从工程师视角继续：在飞书接收工单、配件与上门提醒。",
  operations: "从后台视角继续：在飞书接收 VOC 异常与闭环任务。",
} as const;
```

Create `app/login/page.tsx` to read `getCurrentSession()` and `searchParams`, map only known auth error codes and source roles, then render `LoginContent`. Unknown values become `undefined`.

- [x] **Step 4: Verify login page GREEN**

Run:

```bash
npx vitest run app/login/login-content.test.tsx
```

Expected: visitor, verified identity, safe error and source-role cases pass.

- [x] **Step 5: Write failing navigation and OAuth redirect tests**

Update existing expectations:

```ts
expect(screen.getAllByRole("link", { name: "飞书体验" })[0]).toHaveAttribute(
  "href",
  "/login",
);
expect(screen.getByRole("link", { name: "使用飞书体验" })).toHaveAttribute(
  "href",
  "/login",
);
```

In `app/api/auth/feishu/callback/route.test.ts`, change success to `/login?auth=success`; change all callback errors to `/login?auth_error=<code>`.

- [x] **Step 6: Run targeted tests and verify RED**

Run:

```bash
npx vitest run app/landing-content.test.tsx app/api/auth/feishu/callback/route.test.ts
```

Expected: FAIL because production links still point directly to OAuth and callback still points to `/dashboard` or `/`.

- [x] **Step 7: Rewire navigation and redirects**

Implement:

- `LandingContent` Hero href `/login`, label `使用飞书体验`.
- `SiteHeader` href `/login`, label `飞书体验` for both session states.
- OAuth callback success `/login?auth=success`; error `/login?auth_error=<code>`.
- `DashboardPage` contains only `redirect("/login")` and no session read.
- Runtime expectations use `/login` for invalid callback, Dashboard and logout return destinations where applicable.

- [x] **Step 8: Verify GREEN and commit**

Run:

```bash
npx vitest run app/login app/landing-content.test.tsx app/api/auth/feishu/callback/route.test.ts
```

Expected: all targeted presentation and auth redirect tests pass.

```bash
git add app/login app/landing-content.tsx app/landing-content.test.tsx src/features/showcase/components/site-header.tsx app/api/auth/feishu/callback app/dashboard/page.tsx tests/runtime/auth-routes.test.ts
git commit -m "feat: add guided Feishu experience page"
```

---

### Task 5: Add Reusable Feishu Entry to Three Role Workspaces and Finish Styling

**Files:**
- Create: `src/features/showcase/components/feishu-experience-banner.test.tsx`
- Create: `src/features/showcase/components/feishu-experience-banner.tsx`
- Modify: `src/features/showcase/components/agent-workspace.tsx`
- Modify: `src/features/showcase/components/engineer-workspace.tsx`
- Modify: `src/features/showcase/components/operations-workspace.tsx`
- Modify: `src/features/showcase/components/perspective-workspaces.test.tsx`
- Modify: `app/globals.css`
- Modify: `app/fullscreen-showcase-styles.test.ts`

**Interfaces:**
- Produces: `FeishuExperienceBanner({ role, children })`, where `role` is `"agent" | "engineer" | "operations"` and `children` is the role value statement.
- Consumes: existing workspace shells and `/login?from=<role>`.

- [x] **Step 1: Write failing shared Banner tests**

Create `feishu-experience-banner.test.tsx`:

```tsx
it("renders a centered pill link without an arrow", () => {
  const { container } = render(
    <FeishuExperienceBanner role="agent">
      在飞书接收转人工会话与 AI 预诊摘要
    </FeishuExperienceBanner>,
  );

  expect(screen.getByText("计划接入飞书")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "登录体验" })).toHaveAttribute(
    "href",
    "/login?from=agent",
  );
  expect(container.textContent).not.toMatch(/[↗→]/);
});
```

- [x] **Step 2: Run Banner test and verify RED**

Run:

```bash
npx vitest run src/features/showcase/components/feishu-experience-banner.test.tsx
```

Expected: FAIL because the component does not exist.

- [x] **Step 3: Implement and connect the shared Banner**

Create one rounded Banner component with semantic text and a pill link. Insert it directly after `DemoStatusBar` in:

- `AgentWorkspace`, role `agent`, customer-service copy;
- `EngineerWorkspace`, role `engineer`, engineer copy;
- `OperationsWorkspace`, role `operations`, backend copy.

Do not import it into `CustomerWorkspace`.

- [x] **Step 4: Extend integration assertions**

In `perspective-workspaces.test.tsx`, assert each role test id contains its copy and correct href; assert `workspace-customer` has no `计划接入飞书` text.

Run:

```bash
npx vitest run src/features/showcase/components/feishu-experience-banner.test.tsx src/features/showcase/components/perspective-workspaces.test.tsx
```

Expected: shared component and all four workspace boundaries pass.

- [x] **Step 5: Add login and Banner styling**

Append focused CSS sections to `app/globals.css`:

- `.feishu-login-shell`: white page with black header/footer and `min-height: 100svh`;
- `.feishu-login-main`: centered two-column grid, max width aligned to current showroom content;
- `.feishu-login-guide`, `.feishu-invite-card`: white rounded surfaces with existing border token;
- `.feishu-step-list`: numbered vertical list, no tiny card grid;
- `.feishu-auth-action`, `.feishu-experience-banner__action`: pill, centered text, no pseudo-element arrow, existing 180ms color transition;
- `.feishu-invite-image`: full width, `height: auto`, `object-fit: contain`, no filter/transform animation;
- `.feishu-experience-banner`: slim rounded strip using black, white and teal with one horizontal content flow;
- at `max-width: 760px`, login grid becomes one column and QR remains at least 280 CSS pixels wide when the viewport allows;
- workspace Banner stays within the existing scene and does not add page-level overflow.

- [x] **Step 6: Add CSS contract tests**

Extend `app/fullscreen-showcase-styles.test.ts` to read `globals.css` and assert:

- QR image has `object-fit: contain` and no `filter` rule;
- both new actions use pill radius and centered layout;
- Banner has rounded corners;
- mobile login grid becomes one column;
- no `.feishu-...::after` arrow content is defined.

Run:

```bash
npx vitest run app/fullscreen-showcase-styles.test.ts
```

Expected: CSS contract passes.

- [x] **Step 7: Verify all UI tests and commit**

Run:

```bash
npx vitest run app/login app/landing-content.test.tsx app/fullscreen-showcase-styles.test.ts src/features/showcase/components
```

Expected: login page, navigation, Banner and existing service journey tests all pass.

```bash
git add src/features/showcase/components app/globals.css app/fullscreen-showcase-styles.test.ts
git commit -m "feat: add Feishu entry across service roles"
```

---

### Task 6: Document, Validate, Review in Browser, and Publish Preview

**Files:**
- Modify: `README.md`
- Modify: `docs/TECH_STACK.md`
- Modify: `docs/superpowers/specs/2026-07-18-onecare-feishu-experience-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-onecare-feishu-experience.md`
- Modify only if durable evidence supports it: `docs/HARNESS_REFLECTIONS.md`, `AGENTS.md`

**Interfaces:**
- Produces: accurate repository status, external Feishu checklist, validation record and non-Production Preview URL.

- [x] **Step 1: Update repository documentation**

Document exactly:

- `/login` is the canonical Feishu experience gateway;
- `/dashboard` is a compatibility redirect;
- invitation QR supports only `+86` and expires 2026-08-29;
- Bot is deterministic, p2p text only, stateless and not real AI/work-order integration;
- event URL is `/api/feishu/events` and requires both new secret variables;
- Preview cannot be used for live Feishu callbacks while Deployment Protection is active;
- Production activation still requires bot ability, minimal scopes, event subscription, app version publishing and availability range review.

Do not claim real bot success until Production and a real Feishu member complete the flow.

- [x] **Step 2: Run targeted and complete automated validation**

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

Expected: all commands exit 0 and audit reports 0 vulnerabilities. If `test:runtime` already performed the same build, still run the explicit final `build` required by repository completion rules.

- [x] **Step 3: Inspect QR asset and desktop/mobile layouts**

Start the production build locally and use Playwright at `1440 × 900` and `390 × 844`:

1. Open `/login` anonymously.
2. Confirm all three steps, invite metadata and QR are visible.
3. Confirm `document.documentElement.scrollWidth === window.innerWidth`.
4. Confirm QR natural aspect ratio is preserved and no ancestor clips its quiet zone.
5. Open `/#perspectives`; inspect customer, agent, engineer and operations tabs.
6. Confirm Banner is present only for agent, engineer and operations.
7. Complete the existing four-role service journey to prove the Banner did not break state transitions.
8. Record console errors/warnings and require zero.

- [ ] **Step 4: Perform one physical QR scan**

Use a real phone camera or Feishu scan entry against the locally rendered or deployed page. Confirm it opens the OneCare enterprise invitation and shows the same 2026-08-29 expiry. This proves responsive scaling did not make the code unreadable.

- [x] **Step 5: Publish the non-Production Preview**

Run the existing linked Vercel workflow without `--prod`, bind the fixed Preview alias `onecare-homepage-preview.vercel.app`, and create an anonymous share link if Deployment Protection requires it. Do not copy Production secrets into Preview.

Re-run desktop/mobile browser checks on the deployed URL. The `/login` OAuth button may return the safe configuration error in Preview; this is expected and must not be reported as a working login.

- [x] **Step 6: Record verification and Harness reflection**

Append exact command results, browser viewport results, Preview deployment ID/URL and known gap “Production bot callback not yet activated” to the spec and plan. Assess whether existing instructions caused durable repository-specific ambiguity; update `AGENTS.md` only after first recording evidence and rollback condition in `docs/HARNESS_REFLECTIONS.md`.

- [x] **Step 7: Commit final documentation**

```bash
git add README.md docs/TECH_STACK.md docs/superpowers
git commit -m "docs: verify OneCare Feishu experience"
```

Do not push, create a PR, merge or deploy Production unless the user asks after reviewing Preview.

---

## Plan Self-Review

- Spec coverage: login gateway, QR asset, OAuth redirects, Dashboard compatibility, three shared role entries, deterministic Bot, verified event endpoint, minimal single-chat scope, responsive design, documentation and Preview are all mapped to tasks.
- Scope: website and Bot remain in one plan because both are required to produce the single user journey approved as方案一; each has an independent RED/GREEN task boundary.
- Type consistency: `BotEnv`, `BotReply`, `FeishuEventOutcome`, `parseFeishuEvent`, `replyToFeishuMessage`, `LoginContent` and `FeishuExperienceBanner` use one spelling and one producing task.
- Security: event variables are isolated from OAuth, query source is a closed display map, raw messages and secrets are excluded from logs, and live callbacks are explicitly deferred until Production.
- Placeholder scan: no `TBD`, `TODO`, “similar to”, unspecified error handling or missing test command remains.

## Execution Record — 2026-07-18

- Tasks 1–5 completed test-first and committed as `8632a48`, `ae6c67e`, `6bc460d`, `13df257` and `48e747b`.
- The canonical experience route is `/login`; `/dashboard` redirects there, and OAuth start/callback failures also return there with a closed error code.
- Local automated verification: `npm test` passed 23 files / 104 tests; `npm run test:runtime` passed 4 built-runtime cases; lint, typecheck, explicit production build and production dependency audit passed. The final rerun results are recorded in the delivery commit.
- Local Playwright at `1440 × 900` and `390 × 844` found no horizontal overflow and no console errors or warnings. The QR rendered from a `750 × 1334` source with `object-fit: contain`; customer → agent → engineer → operations state transitions completed successfully.
- Vercel Preview deployment `dpl_62YKiDZXoD1SsYetbQpiRqLQKwHD` is READY. Fixed alias: `https://onecare-homepage-preview.vercel.app`. A seven-day Vercel shareable link was generated for user review; Preview contains no Production OAuth or bot secrets.
- Deployed Playwright confirmed `/login` at 390 px, full QR load, no horizontal overflow, no console errors/warnings, and safe return to `/login?auth_error=configuration_error` when the unconfigured Preview OAuth button is used.
- Physical phone scanning remains a user-side acceptance check and is intentionally not marked complete. Production bot callback activation, Feishu bot permissions, event subscription, version publication, availability-scope review, OAuth re-verification and real-member bot conversation also remain external follow-up work.
- Harness reflection: the repository instructions were clear and did not create durable ambiguity or rework, so no `AGENTS.md` or `docs/HARNESS_REFLECTIONS.md` change was warranted.
