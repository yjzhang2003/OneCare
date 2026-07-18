# OneCare Employee Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有飞书回调从消费者排障脚本转为员工协同机器人，支持进入会话欢迎卡片和八条双语文字指令；第九个子菜单“打开网页演示”继续直接跳转网站。

**Architecture:** 保留 Next.js Route Handler、官方飞书 Node SDK 和 `after()` 的快速确认结构。纯脚本生成员工文字回复与欢迎卡片；事件解析器只新增进入单聊事件；客户端新增按 `chat_id` 主动发送消息，群事件仍安全忽略。

**Tech Stack:** Node.js 24、TypeScript 5.9、Next.js 16.2.10、Vitest 4.1、`@larksuiteoapi/node-sdk` 1.71.1、Vercel Node.js Route Handler。

## Global Constraints

- TypeScript only；不得添加 Python。
- 客服、工程师和运营人员共用同一菜单，本轮不做岗位隔离。
- 只处理经过签名、Verification Token 和 Encrypt Key 验证的事件。
- 只处理 `im.message.receive_v1` 单聊文本和 `im.chat.access_event.bot_p2p_chat_entered_v1`。
- 已订阅的群事件必须返回 `200` 并忽略，不执行群业务。
- 欢迎卡片每次合法进入会话都会发送；本轮不增加数据库或去重存储。
- 回复必须明确是演示，不声称真实工单或真实系统写入。
- 日志不得包含原始事件、消息正文、用户标识、上游响应或任何密钥。

---

### Task 1: Replace the Consumer Script with Employee Menu Replies

**Files:**
- Modify: `src/features/feishu-bot/bot-script.test.ts`
- Modify: `src/features/feishu-bot/bot-script.ts`

**Interfaces:**
- Produces: `createBotReply(input: string): BotReply`
- Produces: `createWelcomeMessage(): FeishuOutboundMessage`
- Produces: `FeishuOutboundMessage = { msgType: "text" | "interactive"; content: string }`

- [x] **Step 1: Write failing employee command and welcome-card tests**

Replace the old consumer assertions with table-driven tests for all eight message commands. Each case must test Chinese, English, and `中文 / English`. Add:

```ts
it("builds the staff welcome card", () => {
  const message = createWelcomeMessage();
  expect(message.msgType).toBe("interactive");
  const card = JSON.parse(message.content);
  expect(card.header.title.content).toBe("万护 OneCare");
  expect(message.content).toContain("OC-240718-037");
  expect(message.content).toContain("等待客服确认");
});
```

- [x] **Step 2: Run RED**

Run: `npx vitest run src/features/feishu-bot/bot-script.test.ts`

Expected: FAIL because employee command kinds and `createWelcomeMessage` do not exist.

- [x] **Step 3: Implement the smallest employee script**

Define reply kinds `help | operations | pending | ticket | progress | tasks | diagnosis | result`. Normalize trim, case and spaces around `/`. Match closed aliases for each command and fall back to help. Every response includes `万护 OneCare 演示` or equivalent explicit demo wording.

Create the card using a JSON object serialized once:

```ts
export function createWelcomeMessage(): FeishuOutboundMessage {
  return {
    msgType: "interactive",
    content: JSON.stringify({
      config: { wide_screen_mode: true },
      header: {
        template: "turquoise",
        title: { tag: "plain_text", content: "万护 OneCare" },
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content:
              "**AI 驱动的用户服务全链路协同助手**\n用于客服、工程师和运营人员协同，不面向消费者。",
          },
        },
        { tag: "hr" },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content:
              "**当前演示案例**\nOC-240718-037 · 冷藏室温度持续偏高\n**当前状态**\nAI 已完成预诊，等待客服确认。",
          },
        },
        {
          tag: "note",
          elements: [
            { tag: "plain_text", content: "请从下方菜单选择工作入口。" },
          ],
        },
      ],
    }),
  };
}
```

- [x] **Step 4: Run GREEN and commit**

Run: `npx vitest run src/features/feishu-bot/bot-script.test.ts`

Expected: all employee script tests pass.

```bash
git add src/features/feishu-bot/bot-script.ts src/features/feishu-bot/bot-script.test.ts
git commit -m "feat: add employee bot menu replies"
```

---

### Task 2: Parse Chat Entry Events and Send Proactive Messages

**Files:**
- Modify: `src/features/feishu-bot/event-handler.test.ts`
- Modify: `src/features/feishu-bot/event-handler.ts`
- Modify: `src/features/feishu-bot/client.test.ts`
- Modify: `src/features/feishu-bot/client.ts`

**Interfaces:**
- Extends: `FeishuEventOutcome` with `{ kind: "entered"; chatId: string }`
- Produces: `sendFeishuMessage({ env, chatId, message }, createClient?): Promise<void>`
- Consumes: `FeishuOutboundMessage` from Task 1.

- [x] **Step 1: Write failing entry-event tests**

Add a signed V2 event fixture:

```ts
function enteredBody(chatId: string | undefined = "oc_onecare_chat") {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_entered",
      event_type: "im.chat.access_event.bot_p2p_chat_entered_v1",
      create_time: "1784371200000",
      token: env.verificationToken,
      app_id: env.appId,
      tenant_key: "tenant_onecare",
    },
    event: { chat_id: chatId, operator_id: { open_id: "ou_onecare" } },
  };
}
```

Assert a signed fixture returns `{ kind: "entered", chatId: "oc_onecare_chat" }`; missing/empty `chat_id` returns `ignored`; an authentic group event returns `ignored`.

- [x] **Step 2: Run event parser RED**

Run: `npx vitest run src/features/feishu-bot/event-handler.test.ts`

Expected: FAIL because the dispatcher does not register the entry event.

- [x] **Step 3: Register the entry event**

Add a narrow event type and register it beside `im.message.receive_v1`:

```ts
type BotP2pEnteredEvent = { chat_id?: string };

"im.chat.access_event.bot_p2p_chat_entered_v1": (
  event: BotP2pEnteredEvent,
) =>
  typeof event.chat_id === "string" && event.chat_id.trim()
    ? ({ kind: "entered", chatId: event.chat_id } as const)
    : ({ kind: "ignored" } as const),
```

- [x] **Step 4: Verify event parser GREEN**

Run: `npx vitest run src/features/feishu-bot/event-handler.test.ts`

Expected: challenge, message, entered, signature and ignored-event cases pass.

- [x] **Step 5: Write failing proactive-send tests**

Extend the narrow client with `create`. Assert:

```ts
await sendFeishuMessage(
  {
    env,
    chatId: "oc_onecare_chat",
    message: { msgType: "interactive", content: "{\"card\":true}" },
  },
  () => client,
);

expect(create).toHaveBeenCalledWith({
  params: { receive_id_type: "chat_id" },
  data: {
    receive_id: "oc_onecare_chat",
    msg_type: "interactive",
    content: "{\"card\":true}",
  },
});
```

Assert non-zero SDK code throws `FeishuBotError("send_failed")` without upstream `msg`.

- [x] **Step 6: Run client RED**

Run: `npx vitest run src/features/feishu-bot/client.test.ts`

Expected: FAIL because `sendFeishuMessage` and `create` are missing.

- [x] **Step 7: Implement proactive send and verify GREEN**

Add `create` to `FeishuBotClient`, extend the stable error code union with `send_failed`, and call `client.im.message.create` using `receive_id_type: "chat_id"`.

Run: `npx vitest run src/features/feishu-bot/client.test.ts`

Expected: reply and proactive-send tests pass.

- [x] **Step 8: Commit**

```bash
git add src/features/feishu-bot/event-handler.ts src/features/feishu-bot/event-handler.test.ts src/features/feishu-bot/client.ts src/features/feishu-bot/client.test.ts
git commit -m "feat: handle Feishu bot chat entry"
```

---

### Task 3: Orchestrate Welcome Delivery in the Event Route

**Files:**
- Modify: `app/api/feishu/events/route.test.ts`
- Modify: `app/api/feishu/events/route.ts`

**Interfaces:**
- Consumes: `createWelcomeMessage()` from Task 1.
- Consumes: `sendFeishuMessage()` from Task 2.
- Extends route dependencies with `createWelcome` and `sendMessage`.

- [x] **Step 1: Write failing Route tests**

Add `createWelcome` and `sendMessage` fakes. For `{ kind: "entered", chatId: "oc_onecare_chat" }`, assert HTTP `200 {}` is returned before the scheduled callback runs, then assert:

```ts
expect(sendMessage).toHaveBeenCalledWith({
  env,
  chatId: "oc_onecare_chat",
  message: {
    msgType: "interactive",
    content: "{\"welcome\":true}",
  },
});
```

Add a send-failure case that calls the same constant `reportFailure` marker without leaking the exception.

- [x] **Step 2: Run Route RED**

Run: `npx vitest run app/api/feishu/events/route.test.ts`

Expected: FAIL because entered outcomes are not orchestrated.

- [x] **Step 3: Implement the Route branch**

Import `createWelcomeMessage` and `sendFeishuMessage`. After challenge/unauthorized/ignored handling, branch on `entered`, schedule a caught proactive send, and return `200 {}`. Preserve the existing message reply path unchanged.

- [x] **Step 4: Run targeted GREEN**

Run:

```bash
npx vitest run app/api/feishu/events/route.test.ts src/features/feishu-bot
```

Expected: all bot script, parser, client and Route tests pass.

- [x] **Step 5: Commit**

```bash
git add app/api/feishu/events/route.ts app/api/feishu/events/route.test.ts
git commit -m "feat: send employee bot welcome card"
```

---

### Task 4: Update Documentation and Run Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/TECH_STACK.md`
- Modify: `docs/superpowers/specs/2026-07-18-onecare-feishu-experience-design.md`
- Modify: `docs/superpowers/specs/2026-07-18-onecare-employee-bot-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-onecare-employee-bot.md`

**Interfaces:**
- Produces: accurate employee bot status and external Production acceptance checklist.

- [x] **Step 1: Update documentation**

Replace the consumer self-service description with the employee bot behavior. Record the two handled events, eight message commands plus the direct website link, welcome-card repetition boundary, group-event ignore behavior, custom callback domain, and lack of real service-system writes. Do not claim Production conversation success before a real Feishu member tests it.

- [x] **Step 2: Run complete verification**

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

Expected: every command exits `0`; all tests pass; audit reports zero production vulnerabilities.

- [x] **Step 3: Record exact verification results**

Append test file/test counts, build result and remaining external acceptance gap to the new spec and plan. Harness reflection must explicitly state whether repository instructions caused durable ambiguity; update `AGENTS.md` only if evidence supports a durable rule change.

- [x] **Step 4: Commit documentation**

```bash
git add README.md docs/TECH_STACK.md docs/superpowers
git commit -m "docs: describe employee Feishu bot"
```

---

## Plan Self-Review

- Spec coverage: all eight menu messages plus the direct website link, welcome card, entry-event parsing, proactive send, ignored group events, security, no isolation and no persistence map to Tasks 1–4.
- Scope: the work changes one existing bot subsystem and one Route Handler; no independent subsystem requires a separate plan.
- Type consistency: `FeishuOutboundMessage`, `createWelcomeMessage`, `entered`, `sendFeishuMessage`, `createWelcome` and `sendMessage` use identical names across tasks.
- Placeholder scan: the plan contains no `TBD`, `TODO`, “similar to”, unspecified errors or missing verification command.
- Deployment: Production deployment and real-member acceptance are deliberately excluded until the user reviews the implemented branch and authorizes remote release.

## Execution Record — 2026-07-18

- RED evidence: employee script tests failed 11 cases against the consumer script; the new entry event failed as `ignored`; proactive send failed 2 cases because the adapter was absent; Route welcome delivery failed 2 cases before orchestration was added.
- GREEN commits: `e431bc5` implements employee menu replies and the welcome card; `b54fa9f` implements entry-event parsing and proactive SDK send; `e20ab50` schedules welcome delivery after callback acknowledgement.
- Final automated verification: `npm test` passed 24 files / 110 tests; `npm run test:runtime` passed 1 file / 4 tests; lint, typecheck, explicit production build, production dependency audit and `git diff --check` exited successfully; audit reported 0 vulnerabilities.
- Production remains unchanged by this branch. The custom callback URL is verified, but this revision still requires Production deployment, application-version publication and real-member testing of chat entry plus all eight message commands.
- Harness reflection: repository instructions were clear. The initial nine-versus-eight command count was caught during plan self-review and came from counting the direct web link as a bot message, not from durable repository ambiguity; no `AGENTS.md` or `docs/HARNESS_REFLECTIONS.md` update is warranted.
