# OneCare Feishu Card Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace every bot-authored plain-text business response with a Feishu Card 2.0 workbench and make its buttons produce useful, secure, stateful demo interactions.

**Architecture:** Keep Feishu transport verification, business-card construction, command routing, and HTTP orchestration separate. Incoming menu text selects a card view; verified `card.action.trigger` callbacks either update the clicked card synchronously or schedule a new card in the same chat. The demo remains stateless: completed state is encoded in the returned card, not persisted server-side.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, `@larksuiteoapi/node-sdk`, Vercel Functions, Feishu Card 2.0.

## Global Constraints

- Follow RED → GREEN → REFACTOR for each behavior change.
- Use only `interactive` outbound messages; toast is supplemental feedback, never the business response.
- Verify raw callback signatures and tokens before reading actions.
- Require the configured app ID, a non-empty tenant key, the expected case ID, and an allowlisted action.
- Return callback HTTP responses within three seconds; schedule proactive navigation-card sends after acknowledgment.
- Never log app secrets, tokens, raw event bodies, user identifiers, chat identifiers, or message identifiers.
- Do not add persistence, tenant-role isolation, real work-order writes, or new infrastructure in this iteration.
- Do not deploy, push, open a PR, or merge without a later explicit user request.

---

## Task 1: Establish the Card 2.0 domain model and builders

**Files:**

- Create: `src/features/feishu-bot/card-types.ts`
- Create: `src/features/feishu-bot/cards.ts`
- Create: `src/features/feishu-bot/cards.test.ts`

### Steps

- [ ] Write failing structural tests covering all eight card views and the workbench card.
- [ ] Assert every card uses `schema: "2.0"`, contains the demo marker, has no divider elements, and serializes as an `interactive` message.
- [ ] Assert callback buttons contain only allowlisted actions plus `case_id: "OC-240718-037"`; assert the website button is the only `open_url` behavior.
- [ ] Assert completed-state cards use success styling and render their state-changing button disabled.
- [ ] Run `npx vitest run src/features/feishu-bot/cards.test.ts` and confirm the expected missing-module failure.
- [ ] Implement shared card primitives and typed public builders:

```ts
export const ONECARE_CASE_ID = "OC-240718-037";

export const ONECARE_CARD_ACTIONS = [
  "open_pending",
  "open_tasks",
  "open_operations",
  "open_diagnosis",
  "open_progress",
  "open_result",
  "create_ticket",
  "confirm_parts",
  "submit_result",
] as const;

export type OneCareCardAction = (typeof ONECARE_CARD_ACTIONS)[number];
export type OneCareCardView =
  | "workbench"
  | "pending"
  | "ticket"
  | "progress"
  | "tasks"
  | "diagnosis"
  | "result"
  | "operations";
export type OneCareCardState = "initial" | "completed";

export interface FeishuOutboundMessage {
  msgType: "interactive";
  content: string;
}
```

- [ ] Expose `createCardMessage(view, state?)` and `createWelcomeMessage()`; construct cards through reusable root, header, field, metric, and button helpers rather than copying complete JSON documents.
- [ ] Run the targeted test until green, then run `npx vitest run src/features/feishu-bot`.
- [ ] Commit with `feat: add Feishu Card 2.0 builders`.

## Task 2: Route every bot command to a card

**Files:**

- Modify: `src/features/feishu-bot/bot-script.ts`
- Modify: `src/features/feishu-bot/bot-script.test.ts`

### Steps

- [ ] Replace text assertions with failing assertions for interactive card messages for all eight configured menu commands and unknown input.
- [ ] Preserve the current Chinese and English command aliases while mapping them to card views:

```ts
export interface BotReply {
  kind: BotReplyKind;
  message: FeishuOutboundMessage;
}
```

- [ ] Make unknown input return the workbench/help card rather than plain help text.
- [ ] Remove all bot-authored business strings that can be emitted as standalone messages.
- [ ] Run `npx vitest run src/features/feishu-bot/bot-script.test.ts` until green.
- [ ] Commit with `feat: map bot commands to interactive cards`.

## Task 3: Send and reply with generic interactive messages

**Files:**

- Modify: `src/features/feishu-bot/client.ts`
- Modify: `src/features/feishu-bot/client.test.ts`

### Steps

- [ ] Write failing tests proving replies forward `msg_type: "interactive"` and the already-serialized card content unchanged.
- [ ] Write a failing factory test proving the SDK client uses `LoggerLevel.fatal`, preventing the SDK from dumping upstream response objects into Vercel logs.
- [ ] Change the reply API to accept a typed message:

```ts
replyToFeishuMessage({
  env,
  messageId,
  message,
}: {
  env: FeishuBotEnv;
  messageId: string;
  message: FeishuOutboundMessage;
}): Promise<void>
```

- [ ] Keep proactive `sendFeishuMessage` generic but restrict its accepted outbound type to interactive cards.
- [ ] Use a testable SDK-client factory configured with `LoggerLevel.fatal`; retain stable, sanitized `FeishuBotError` messages.
- [ ] Run `npx vitest run src/features/feishu-bot/client.test.ts` until green.
- [ ] Commit with `refactor: send Feishu bot replies as cards`.

## Task 4: Parse and authorize card callbacks

**Files:**

- Modify: `src/features/feishu-bot/event-handler.ts`
- Modify: `src/features/feishu-bot/event-handler.test.ts`

### Steps

- [ ] Add failing signed-fixture tests for a valid `card.action.trigger` callback using `context.open_chat_id`, `context.open_message_id`, a button tag, an allowlisted action, and the expected case ID.
- [ ] Add failing rejection tests for a wrong app ID, missing tenant key, wrong verification token, bad signature, unknown action, wrong case ID, missing normalized IDs, and a non-button action.
- [ ] Extend the outcome union:

```ts
type FeishuEventOutcome =
  | ExistingOutcomes
  | {
      kind: "card_action";
      action: OneCareCardAction;
      chatId: string;
      messageId: string;
    }
  | { kind: "invalid_card_action" };
```

- [ ] Retain raw-body signature verification and AES decryption before payload parsing.
- [ ] For non-challenge callbacks require matching `header.app_id`, non-empty `header.tenant_key`, matching verification token, and `event_type === "card.action.trigger"`.
- [ ] Use the official SDK `normalizeCardAction` helper after transport validation, then enforce button tag, action allowlist, and case ID.
- [ ] Configure the SDK dispatcher logger at `LoggerLevel.fatal` and avoid emitting payload contents on errors.
- [ ] Run `npx vitest run src/features/feishu-bot/event-handler.test.ts` until green.
- [ ] Commit with `feat: verify Feishu card action callbacks`.

## Task 5: Build deterministic callback results

**Files:**

- Create: `src/features/feishu-bot/card-actions.ts`
- Create: `src/features/feishu-bot/card-actions.test.ts`

### Steps

- [ ] Write failing table-driven tests for navigation mappings:

```ts
const navigationViews = {
  open_pending: "pending",
  open_tasks: "tasks",
  open_operations: "operations",
  open_diagnosis: "diagnosis",
  open_progress: "progress",
  open_result: "result",
} as const;
```

- [ ] Write failing tests for state mappings: `create_ticket → ticket/completed`, `confirm_parts → diagnosis/completed`, and `submit_result → result/completed`.
- [ ] Implement a discriminated resolver:

```ts
type CardActionResult =
  | { kind: "navigate"; message: FeishuOutboundMessage; toast: string }
  | { kind: "update"; response: FeishuCardCallbackResponse };
```

- [ ] For updates return a Card 2.0 raw response containing a short success toast and the complete updated card:

```ts
{
  toast: { type: "success", content: "操作已记录（演示）" },
  card: { type: "raw", data: completedCard },
}
```

- [ ] Run `npx vitest run src/features/feishu-bot/card-actions.test.ts` until green.
- [ ] Commit with `feat: resolve Feishu card button actions`.

## Task 6: Orchestrate message, entry, and button flows in the route

**Files:**

- Modify: `src/app/api/feishu/events/route.ts`
- Modify: `src/app/api/feishu/events/route.test.ts`

### Steps

- [ ] Change existing route tests to require interactive replies for received messages and an interactive workbench card for chat entry.
- [ ] Add failing tests proving navigation callbacks return HTTP 200 immediately and schedule a new card to the callback chat.
- [ ] Add failing tests proving state callbacks return HTTP 200 with toast plus raw replacement card and do not schedule another send.
- [ ] Add a failing test proving invalid, already-verified button input returns only a neutral toast and performs no send.
- [ ] Pass `reply.message` into the generic reply client instead of extracting text.
- [ ] Resolve `card_action` with the pure card-action resolver. Schedule only navigation sends through the existing request-lifecycle scheduler.
- [ ] Return deterministic JSON for update and invalid-action callbacks; keep challenge handling unchanged.
- [ ] Keep error reporting to a stable marker and error class/message only, never IDs or request data.
- [ ] Run `npx vitest run src/app/api/feishu/events/route.test.ts` until green.
- [ ] Commit with `feat: connect Feishu card interactions`.

## Task 7: Align documentation and deployment instructions

**Files:**

- Modify: `README.md`
- Modify: `docs/TECH_STACK.md`
- Modify: `docs/superpowers/specs/2026-07-19-onecare-feishu-card-workbench-design.md`
- Modify: `docs/superpowers/plans/2026-07-19-onecare-feishu-card-workbench.md`
- Modify: any existing Feishu setup document discovered through `rg -n "card.action|回调配置|事件订阅" docs README.md`

### Steps

- [ ] Update documentation to describe implemented Card 2.0 behavior without describing future persistence or role isolation as complete.
- [ ] Add the required developer-console step: under **事件与回调 → 回调配置**, use `https://onecare.ohmyfeishu.top/api/feishu/events`, subscribe to `card.action.trigger`, then publish a new app version.
- [ ] State that card callbacks are configured separately from event subscriptions and require the production callback URL.
- [ ] Record completed implementation tasks and exact validation results in this plan.
- [ ] Run documentation checks and `git diff --check`.
- [ ] Commit with `docs: document Feishu card callback setup`.

## Task 8: Full verification and handoff

### Steps

- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck` if defined; otherwise record that the script is absent and rely on the production build.
- [ ] Run `npm run build`.
- [ ] Run any existing Feishu runtime contract tests discovered with `rg -n "runtime|URL Verification|feishu" scripts package.json`.
- [ ] Run `npm audit --audit-level=high`.
- [ ] Run `git diff --check` and `git status --short --branch`.
- [ ] Review the diff for secrets, plaintext bot output, unverified tenant input, and accidental unrelated changes.
- [ ] Briefly assess `docs/HARNESS_REFLECTIONS.md`; update `AGENTS.md` only if durable repository-specific evidence justifies a rule change.
- [ ] Report changed files, commits, test results, callback-console steps, and the remaining production acceptance step. Do not claim the live bot is updated until deployment and app-version publication are both verified.
