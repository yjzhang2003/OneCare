# VOC 协同群与群内智能体 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 高严重度 VOC 工单由机器人提请、人工确认后自动建群拉人，群内发工单卡、可 `@机器人` 就该工单自由问答、闭环时把过程收敛成结论写回 Base。

**Architecture:** 状态写入路径一个字不改——仍然只发生在卡片回调里，身份仍来自签名事件的 `event.operator.open_id`，三重校验保持原样。新增的是一条升级路径：分片作业发升级卡 → 新增两个卡片动作决定建群或拒绝 → 建群后 `chat_id` 落回 Base 新列并以此实现幂等 → 群内 `@` 消息经 Bitable 取事实后交给 aily 第二个技能作答。纯逻辑（群名、幂等判定、事实拼装）与 IO（建群、拉人、拉消息、调技能）分开在不同文件，前者全部可测。

**Tech Stack:** TypeScript / Next.js 16 App Router（`cacheComponents: true`）/ 飞书 OpenAPI（`im/v1/chats`、`im/v1/chats/{id}/members`、`im/v1/messages`、`bitable/v1/.../records/search`、`aily/v1/.../skills/{id}/start`）/ Vitest 4。

## 前置条件（非代码，实施前或实施中完成）

- **P1 aily 问答技能**：在 aily 应用 `spring_50e4fc2838__c` 上新建第二个技能。入参 `question`、`facts`（均为 String——aily 自定义参数只支持 String/Boolean/Float/Integer，无数组无对象，2026-08-11 实测）。出参一个 String，自然语言散文，**不要 JSON**。技能 ID 形如 `skill_xxxxx`，取自技能编辑页地址栏。由控制方在浏览器中建。
- **P2 负责人表填真人**：`负责人表` 现为 0 条。`负责范围` 必须按**渠道**填（`resolveOwner` 依次匹配 `渠道/品类` 与 `渠道`，不匹配品类）。三行：`400 客服`→zhangyujian（勾兜底）、`电商评价`→huangqi、`社媒`→zhangruizhe。`负责人` 用多维表格人员选择器挑选——**本项目无通讯录权限**（`contact/v3/*` 全部 `99991672`），代码不解析姓名，只读多维表格已解析好的 open_id。由用户在界面完成，控制方提供链接。

## Global Constraints

- 仅 TypeScript。不得引入 Python 代码或工具链。**不得新增任何 npm 依赖。**
- **不得使用 `as any`**（触发 `no-explicit-any` error）。用 `as never` 或 `as unknown as X`。
- **假 mock 必须声明参数类型，不得对 `.mock.calls[n]` 做元组强转**（`vi.fn(async () => ...)` 推断成零参，强转触发 `TS2352`，而 `vitest run` 不做类型检查）。
- **不得写 `export const dynamic` 或 `export const runtime`**——`cacheComponents: true` 下会被直接拒绝。
- **`use cache` 函数内部抛出是构建级致命错误**，try/catch 必须在缓存函数内部，返回判别联合而不是抛。
- **单选/多选字段写入只能用已存在的选项值**。飞书对不存在的选项会自动创建，删记录不会删选项。本设计**不新增任何选择型字段**，`协同群 ID` 是文本列。
- **状态写入与三重校验不得改动**：四个既有动作（`voc_start_follow_up` / `voc_submit_follow_up` / `voc_confirm_closure` / `voc_mark_no_action`）的负责人校验一个字不改。放宽只对本设计新增的两个动作生效。
- **生成闭环结论不得撤销闭环**：状态与闭环时间先写，结论是之后独立的、不参与事务的一步。
- 每个任务结束必须全绿：`npx vitest run`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run test:runtime`、`FEISHU_BITABLE_APP_TOKEN=bogusX npm run build`。
- 提交信息用英文，正文说明「为什么」而非「改了什么」。提交前 `git diff --check` 无输出。
- **不得对真实飞书租户做自动化建群测试**。建群有副作用且不可幂等清理，端到端靠一次人工演练。
- 凭据在 gitignored 的 `.env.local`，**不得写进任何脚本、命令行字面量、报告或提交**。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/features/warroom/naming.ts`（新建） | 纯函数：群名生成、幂等判定 |
| `src/features/warroom/facts.ts`（新建） | 纯函数：问答事实拼装、`@` 前缀剔除、聚合计算 |
| `src/features/feishu-bot/chat-client.ts`（新建） | IO：建群、拉人、拉群内消息 |
| `src/features/tagging/answer-provider.ts`（新建） | IO：调 aily 问答技能，返回散文 |
| `src/features/bitable/field-map.ts` | 加 `warRoomChatId` 与 `VOC_FIELD_NAMES.warRoomChatId` |
| `src/features/bitable/client.ts` | 加 `findByWarRoomChatId`（`records/search`） |
| `src/features/feishu-bot/card-types.ts` | 两个新 action 进白名单 |
| `src/features/feishu-bot/cards.ts` | 升级卡；工单卡支持不截断原文 |
| `src/features/feishu-bot/war-room-actions.ts`（新建） | 两个新 action 的处理器 |
| `app/api/voc/analyze/route.ts` | 严重度=高时发升级卡 |
| `app/api/feishu/events/route.ts` | 群内 `@` 消息接线 |
| `src/lib/env.ts` | 加 `FEISHU_AILY_SKILL_ANSWER` |

---

### Task 1: `协同群 ID` 列与字段映射

**Files:**
- Modify: `src/features/bitable/field-map.ts`
- Test: `src/features/bitable/field-map.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `VOC_FIELD_NAMES.warRoomChatId === "协同群 ID"`；`VocRecord.warRoomChatId: string`

- [ ] **Step 1: 在真实 Base 上新建这一列**

用 `POST bitable/v1/apps/{app}/tables/{voc}/fields`，`{"field_name":"协同群 ID","type":1}`（type 1 = 多行文本）。**必须是文本列**，不能是单选——单选会引入选项污染面。建完读回 `fields` 确认它出现在清单里，且其余 24 列与选项一字未变。

- [ ] **Step 2: Write the failing test**

```ts
// src/features/bitable/field-map.test.ts 追加
it("reads the war room chat id, and treats a missing column as no group", () => {
  expect(
    toVocRecord({ [VOC_FIELD_NAMES.warRoomChatId]: "oc_abc123" }, "rec1")
      .warRoomChatId,
  ).toBe("oc_abc123");
  // 列不存在（老数据、或列被运营改名）时是空串而不是 undefined：下游用
  // 「空串表示尚未建群」这一个判据，不必再区分 undefined 与 ""。
  expect(toVocRecord({}, "rec1").warRoomChatId).toBe("");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/bitable/field-map.test.ts`
Expected: FAIL — `Property 'warRoomChatId' does not exist`

- [ ] **Step 4: Write minimal implementation**

`VOC_FIELD_NAMES` 追加 `warRoomChatId: "协同群 ID",`；`VocRecord` 追加 `warRoomChatId: string;`；`toVocRecord` 追加 `warRoomChatId: text(safeFields[VOC_FIELD_NAMES.warRoomChatId]),`。

`text()` 已把非字符串与缺失值折成空串，无需新辅助函数。

- [ ] **Step 5: Run tests**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: 全绿。既有 VocRecord 构造点（测试夹具）会因新必填字段报错，逐个补 `warRoomChatId: ""`。

- [ ] **Step 6: Commit**

```bash
git add src/features/bitable/field-map.ts src/features/bitable/field-map.test.ts
git commit -m "feat: read the war room chat id off the VOC row

The chat id has to live on the ticket, not in memory: the shard job re-runs and
card buttons get double-clicked, so 'has this ticket already got a group' must be
answerable from the Base alone. A missing column reads as an empty string so
downstream code has one predicate — empty means no group yet — instead of having
to tell undefined from \"\"."
```

---

### Task 2: 按群 ID 反查工单

**Files:**
- Modify: `src/features/bitable/client.ts`
- Test: `src/features/bitable/client.test.ts`

**Interfaces:**
- Consumes: `VOC_FIELD_NAMES.warRoomChatId`（Task 1）
- Produces: `BitableClient.findByWarRoomChatId(chatId: string): Promise<VocRecord | null>`

- [ ] **Step 1: Write the failing test**

```ts
it("finds a ticket by its war room chat id with a filtered search, not a full scan", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toContain("/records/search");
    const body = JSON.parse(init?.body as string) as {
      filter: { conditions: ReadonlyArray<{ field_name: string; value: string[] }> };
    };
    expect(body.filter.conditions[0]?.field_name).toBe("协同群 ID");
    expect(body.filter.conditions[0]?.value).toEqual(["oc_abc123"]);
    return new Response(
      JSON.stringify({
        code: 0,
        data: { items: [{ record_id: "rec1", fields: { 记录编号: "R-1" } }] },
      }),
      { status: 200 },
    );
  });

  const client = createBitableClient(env, async () => "t", fetcher as unknown as typeof fetch);

  expect((await client.findByWarRoomChatId("oc_abc123"))?.recordId).toBe("rec1");
});

it("returns null rather than throwing when no ticket carries that chat id", async () => {
  const fetcher = vi.fn(async () =>
    new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 }),
  );
  const client = createBitableClient(env, async () => "t", fetcher as unknown as typeof fetch);

  expect(await client.findByWarRoomChatId("oc_missing")).toBeNull();
});

it("returns null for a blank chat id without calling the API", async () => {
  // Otherwise every non-group message would cost a cross-border request to look
  // up the empty string.
  const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
  const client = createBitableClient(env, async () => "t", fetcher as unknown as typeof fetch);

  expect(await client.findByWarRoomChatId("")).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/bitable/client.test.ts`
Expected: FAIL — `findByWarRoomChatId is not a function`

- [ ] **Step 3: Write minimal implementation**

`BitableClient` 接口加 `findByWarRoomChatId(chatId: string): Promise<VocRecord | null>`。实现：`chatId.trim()` 为空直接 `return null`（不发请求）；否则 `POST {recordsUrl}/search?user_id_type=open_id&page_size=1`，body：

```ts
{
  filter: {
    conjunction: "and",
    conditions: [
      { field_name: VOC_FIELD_NAMES.warRoomChatId, operator: "is", value: [chatId] },
    ],
  },
}
```

复用文件内既有的超时（`BITABLE_TIMEOUT_MS`）、`code !== 0` 抛错与 `toVocRecord` 转换。`items` 为空返回 `null`，否则取第一条。

**用 search 而不是 `listRecords` 过滤**：表里 3628 条记录，全表扫描是 8 次分页跨境请求，而每条群消息都要查一次。

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/features/bitable/client.ts src/features/bitable/client.test.ts
git commit -m "feat: look a ticket up from its war room chat id

Every @-mention in a group has to resolve which ticket the group is about.
Filtering server-side keeps that one request; listRecords would scan 3628 rows
across eight paginated cross-border calls to answer the same question. A blank
chat id short-circuits before the network, so ordinary non-group traffic costs
nothing."
```

---

### Task 3: 群名与幂等判定（纯函数）

**Files:**
- Create: `src/features/warroom/naming.ts`
- Test: `src/features/warroom/naming.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `warRoomName(input: Readonly<{ recordNumber: string; category: string; severity: string | null }>): string`
  - `DECLINED_MARKER = "declined"`
  - `warRoomDecision(chatId: string): "create" | "exists" | "declined"`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { DECLINED_MARKER, warRoomDecision, warRoomName } from "./naming";

describe("warRoomName", () => {
  it("uses the last six characters of the record number", () => {
    expect(
      warRoomName({ recordNumber: "0030084c-b4dd-424e-8c6c-0489e86af5df", category: "冰箱", severity: "高" }),
    ).toBe("VOC-6af5df-冰箱-高");
  });

  it("keeps a short record number whole instead of padding it", () => {
    expect(warRoomName({ recordNumber: "R-1", category: "电视", severity: "中" })).toBe("VOC-R-1-电视-中");
  });

  it("drops the category segment when the Base has none", () => {
    // 714 of the 3628 imported rows have no product category, because the source
    // file mixes product lines with org units in one column.
    expect(warRoomName({ recordNumber: "abcdef", category: "", severity: "高" })).toBe("VOC-abcdef-高");
  });

  it("drops the severity segment when the ticket is not yet tagged", () => {
    expect(warRoomName({ recordNumber: "abcdef", category: "冰箱", severity: null })).toBe("VOC-abcdef-冰箱");
  });
});

describe("warRoomDecision", () => {
  it("creates when the column is empty", () => {
    expect(warRoomDecision("")).toBe("create");
    expect(warRoomDecision("   ")).toBe("create");
  });

  it("reports an existing group for any oc_ id", () => {
    expect(warRoomDecision("oc_abc123")).toBe("exists");
  });

  it("reports a declined escalation for the marker", () => {
    expect(warRoomDecision(DECLINED_MARKER)).toBe("declined");
  });

  it("treats an unrecognised value as an existing group rather than creating a second one", () => {
    // A hand-edited cell must never cause a duplicate group. Erring toward
    // "exists" is recoverable by clearing the cell; erring toward "create"
    // leaves two groups and no way to tell which one people are talking in.
    expect(warRoomDecision("garbage")).toBe("exists");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/warroom/naming.test.ts`
Expected: FAIL — `Failed to resolve import "./naming"`

- [ ] **Step 3: Write minimal implementation**

```ts
export const DECLINED_MARKER = "declined";

export function warRoomName(
  input: Readonly<{ recordNumber: string; category: string; severity: string | null }>,
): string {
  const tail = input.recordNumber.slice(-6);
  const segments = ["VOC", tail, input.category, input.severity ?? ""].filter(
    (segment) => segment.trim().length > 0,
  );
  return segments.join("-");
}

export function warRoomDecision(chatId: string): "create" | "exists" | "declined" {
  const value = chatId.trim();
  if (value.length === 0) return "create";
  if (value === DECLINED_MARKER) return "declined";
  return "exists";
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/warroom && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/features/warroom/naming.ts src/features/warroom/naming.test.ts
git commit -m "feat: name war rooms and decide whether one already exists

The record number is an enterprise uuid, so the name carries its last six
characters — recognisable without a group name nobody can read. Segments that the
Base has not filled are dropped rather than rendered blank, because 714 of the
3628 imported rows genuinely have no product category.

An unrecognised value in the column resolves to 'exists', not 'create'. A
hand-edited cell must never produce a second group: too many groups is
unrecoverable — nobody can tell which one the conversation is in — while a
wrongly-blocked group is fixed by clearing the cell."
```

---

### Task 4: 建群、拉人、拉群内消息

**Files:**
- Create: `src/features/feishu-bot/chat-client.ts`
- Test: `src/features/feishu-bot/chat-client.test.ts`

**Interfaces:**
- Consumes: `BotEnv`（既有）
- Produces:
  - `createWarRoomChat(input: Readonly<{ env: BotEnv; name: string; memberOpenIds: readonly string[] }>): Promise<string>` — 返回 `chat_id`
  - `listChatMessages(input: Readonly<{ env: BotEnv; chatId: string; limit?: number }>): Promise<readonly string[]>` — 返回文本，按时间正序

- [ ] **Step 1: Write the failing test**

```ts
it("creates the chat with de-duplicated members and returns the chat id", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toContain("/im/v1/chats");
    expect(url).toContain("user_id_type=open_id");
    const body = JSON.parse(init?.body as string) as { name: string; user_id_list: string[] };
    expect(body.name).toBe("VOC-6af5df-冰箱-高");
    // The operator is usually one of the owners; sending a duplicate makes the
    // API reject the whole call rather than ignoring the repeat.
    expect(body.user_id_list).toEqual(["ou_owner", "ou_operator"]);
    return jsonResponse({ code: 0, data: { chat_id: "oc_new" } });
  });

  const chatId = await createWarRoomChat(
    { env, name: "VOC-6af5df-冰箱-高", memberOpenIds: ["ou_owner", "ou_operator", "ou_owner"] },
    fetcher as unknown as typeof fetch,
  );

  expect(chatId).toBe("oc_new");
});

it("throws with the Feishu code when creation fails", async () => {
  const fetcher = vi.fn(async () => jsonResponse({ code: 232002, msg: "no permission" }));

  await expect(
    createWarRoomChat({ env, name: "n", memberOpenIds: [] }, fetcher as unknown as typeof fetch),
  ).rejects.toThrow(/232002/);
});

it("reads group messages oldest first and keeps only text", async () => {
  const fetcher = vi.fn(async (url: string) => {
    expect(url).toContain("container_id_type=chat");
    expect(url).toContain("container_id=oc_1");
    return jsonResponse({
      code: 0,
      data: {
        items: [
          { msg_type: "text", body: { content: JSON.stringify({ text: "第一条" }) } },
          { msg_type: "interactive", body: { content: "{}" } },
          { msg_type: "text", body: { content: JSON.stringify({ text: "第二条" }) } },
        ],
      },
    });
  });

  expect(
    await listChatMessages({ env, chatId: "oc_1" }, fetcher as unknown as typeof fetch),
  ).toEqual(["第一条", "第二条"]);
});

it("returns an empty list when the group has no readable text", async () => {
  // The closing summary must still be attempted on an empty conversation rather
  // than throwing and taking the closure down with it.
  const fetcher = vi.fn(async () => jsonResponse({ code: 0, data: { items: [] } }));

  expect(
    await listChatMessages({ env, chatId: "oc_1" }, fetcher as unknown as typeof fetch),
  ).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/feishu-bot/chat-client.test.ts`
Expected: FAIL — `Failed to resolve import "./chat-client"`

- [ ] **Step 3: Write minimal implementation**

`createWarRoomChat`：`POST https://open.feishu.cn/open-apis/im/v1/chats?user_id_type=open_id`，body `{ name, user_id_list }`，成员先 `[...new Set(memberOpenIds)]` 去重并剔除空串。token 由 `createTenantTokenProvider(env.appId, env.appSecret)` 取得（与 `client.ts` 同一套）。`code !== 0` 抛 `new Error(\`Feishu chat create failed (code ${code})\`)`。超时用与 Bitable 同量级的常量，本文件内定义 `CHAT_TIMEOUT_MS = 15_000`。

`listChatMessages`：`GET im/v1/messages?container_id_type=chat&container_id={chatId}&page_size={limit ?? 50}&sort_type=ByCreateTimeAsc`。只保留 `msg_type === "text"` 的项，`body.content` 是 JSON 字符串，取其 `text` 字段；解析失败的单条跳过而不是整体失败。

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/features/feishu-bot/chat-client.ts src/features/feishu-bot/chat-client.test.ts
git commit -m "feat: create war room chats and read their transcript

Members are de-duplicated before the call because the operator approving the
escalation is usually also one of the ticket's owners, and Feishu rejects the
whole request on a repeated id rather than ignoring it.

Reading the transcript tolerates an empty or unparseable message list instead of
throwing: it feeds the closing summary, and a summary failure must never be able
to take the closure itself down."
```

---

### Task 5: 升级卡与两个新动作

**Files:**
- Modify: `src/features/feishu-bot/card-types.ts`
- Modify: `src/features/feishu-bot/cards.ts`
- Test: `src/features/feishu-bot/cards.test.ts`

**Interfaces:**
- Consumes: `VocTicketCardRecord` / `VocTicketCardTag`（既有）
- Produces:
  - `VOC_CARD_ACTIONS` 增加 `"voc_open_war_room"` 与 `"voc_decline_war_room"`
  - `createWarRoomEscalationCard(record: VocTicketCardRecord, tag: VocTicketCardTag, ownerNames: readonly string[]): FeishuCard`
  - `createVocTicketCard(record, tag, options?: Readonly<{ fullContent?: boolean }>)` — 新增可选第三参

- [ ] **Step 1: Write the failing test**

```ts
it("keeps the raw complaint out of the escalation card", () => {
  const card = createWarRoomEscalationCard(
    { ...ticketRecord, content: "报修后等了三天没人上门" },
    ticketTag,
    ["张三"],
  );
  const json = JSON.stringify(card);

  // The escalation card is a notification sent to one approver. The complaint
  // itself belongs in the group, after people have been deliberately added —
  // one less surface carrying a customer's words.
  expect(json).not.toContain("报修后等了三天没人上门");
  expect(json).toContain("张三");
  expect(json).toContain("voc_open_war_room");
  expect(json).toContain("voc_decline_war_room");
});

it("renders the full complaint on the in-group ticket card", () => {
  const long = "投".repeat(400);
  const json = JSON.stringify(createVocTicketCard({ ...ticketRecord, content: long }, ticketTag, { fullContent: true }));

  // Everyone in the group was deliberately added to work this ticket; a
  // truncated complaint is one they cannot act on.
  expect(json).toContain(long);
});

it("still truncates by default so the single-chat card is unchanged", () => {
  const long = "投".repeat(400);
  const json = JSON.stringify(createVocTicketCard({ ...ticketRecord, content: long }, ticketTag));

  expect(json).not.toContain(long);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/feishu-bot/cards.test.ts`
Expected: FAIL — `createWarRoomEscalationCard is not a function`

- [ ] **Step 3: Write minimal implementation**

`card-types.ts`：`VOC_CARD_ACTIONS` 数组追加两个字面量。

`cards.ts`：
- `createVocTicketCard` 第三参 `options` 默认 `{}`；`const content = options.fullContent ? record.content : truncateContent(record.content);`
- `createWarRoomEscalationCard` 复用 `cardRoot`，标题「VOC 升级提请」，副标题 `${channel} · ${category}`，字段：记录编号、严重度、情绪极性、问题维度、AI 摘要、负责人（`ownerNames.join("、")`，空数组时写「未解析到负责人」）。两个按钮的 `value` 携带 `record_id`，与既有四个动作同一形状。

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/features/feishu-bot/card-types.ts src/features/feishu-bot/cards.ts src/features/feishu-bot/cards.test.ts
git commit -m "feat: add the escalation card and let the group card show everything

Two cards with deliberately different disclosure. The escalation card goes to one
approver who only needs to decide whether this warrants a group, so it carries the
AI summary and not the customer's words. The in-group card goes to people who were
deliberately added to work the ticket, so it carries the complaint in full —
truncation there hands them something they cannot act on.

The single-chat card keeps truncating: the new behaviour is opt-in so the existing
path is provably unchanged."
```

---

### Task 6: 两个新动作的处理器

**Files:**
- Create: `src/features/feishu-bot/war-room-actions.ts`
- Test: `src/features/feishu-bot/war-room-actions.test.ts`

**Interfaces:**
- Consumes: `warRoomDecision` / `warRoomName` / `DECLINED_MARKER`（Task 3）、`createWarRoomChat`（Task 4）、`createVocTicketCard`（Task 5）、`VOC_FIELD_NAMES.warRoomChatId`（Task 1）
- Produces: `resolveWarRoomAction(input: WarRoomActionInput): Promise<CardActionResult>`

```ts
export type WarRoomActionInput = Readonly<{
  action: "voc_open_war_room" | "voc_decline_war_room";
  recordId: string;
  operatorOpenId: string;
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  updateRecord: (recordId: string, fields: Record<string, unknown>) => Promise<void>;
  fallbackOpenIds: () => Promise<readonly string[]>;
  createChat: (name: string, memberOpenIds: readonly string[]) => Promise<string>;
  sendToChat: (chatId: string, card: FeishuCard) => Promise<void>;
}>;
```

- [ ] **Step 1: Write the failing test**

```ts
it("lets a fallback approver open the room even though they are not the owner", async () => {
  // Approving an escalation is the fallback's job, not the owner's. The four
  // status actions keep the strict owner check — changing state is the owner's
  // job, and this relaxation must not leak into them.
  const created: string[] = [];
  const result = await resolveWarRoomAction({
    action: "voc_open_war_room",
    recordId: "rec1",
    operatorOpenId: "ou_fallback",
    getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
    updateRecord: async () => {},
    fallbackOpenIds: async () => ["ou_fallback"],
    createChat: async (name, members) => { created.push(name); expect(members).toContain("ou_owner"); expect(members).toContain("ou_fallback"); return "oc_new"; },
    sendToChat: async () => {},
  });

  expect(created).toHaveLength(1);
  expect(JSON.stringify(result)).toContain("已创建");
});

it("rejects a stranger who is neither owner nor fallback, and creates nothing", async () => {
  const createChat = vi.fn(async () => "oc_should_not_happen");
  const result = await resolveWarRoomAction({
    action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_stranger",
    getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
    updateRecord: async () => {}, fallbackOpenIds: async () => ["ou_fallback"],
    createChat, sendToChat: async () => {},
  });

  expect(createChat).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).toMatch(/无权|不是/);
});

it("does not create a second group when one already exists", async () => {
  const createChat = vi.fn(async () => "oc_second");
  await resolveWarRoomAction({
    action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
    getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "oc_existing" }),
    updateRecord: async () => {}, fallbackOpenIds: async () => [],
    createChat, sendToChat: async () => {},
  });

  expect(createChat).not.toHaveBeenCalled();
});

it("writes the chat id and posts the ticket card into the new group", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const posts: string[] = [];
  await resolveWarRoomAction({
    action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
    getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
    updateRecord: async (_id, fields) => { writes.push(fields); },
    fallbackOpenIds: async () => [],
    createChat: async () => "oc_new",
    sendToChat: async (chatId) => { posts.push(chatId); },
  });

  expect(writes[0]?.[VOC_FIELD_NAMES.warRoomChatId]).toBe("oc_new");
  expect(posts).toEqual(["oc_new"]);
});

it("says the group exists but was not recorded when the write fails", async () => {
  // Creating then failing to record leaves a real group nobody can find from the
  // Base. Saying so is the only way the operator knows to retry rather than
  // assume the click did nothing.
  const result = await resolveWarRoomAction({
    action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
    getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
    updateRecord: async () => { throw new Error("bitable down"); },
    fallbackOpenIds: async () => [],
    createChat: async () => "oc_new",
    sendToChat: async () => {},
  });

  expect(JSON.stringify(result)).toMatch(/未记录/);
});

it("marks a declined escalation so it is not proposed again", async () => {
  const writes: Array<Record<string, unknown>> = [];
  await resolveWarRoomAction({
    action: "voc_decline_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
    getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
    updateRecord: async (_id, fields) => { writes.push(fields); },
    fallbackOpenIds: async () => [], createChat: async () => "x", sendToChat: async () => {},
  });

  expect(writes[0]?.[VOC_FIELD_NAMES.warRoomChatId]).toBe(DECLINED_MARKER);
});

it("rejects a record id that does not exist", async () => {
  const result = await resolveWarRoomAction({
    action: "voc_open_war_room", recordId: "rec_gone", operatorOpenId: "ou_owner",
    getRecord: async () => null, updateRecord: async () => {},
    fallbackOpenIds: async () => [], createChat: async () => "x", sendToChat: async () => {},
  });

  expect(JSON.stringify(result)).toMatch(/记录/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/feishu-bot/war-room-actions.test.ts`
Expected: FAIL — `Failed to resolve import "./war-room-actions"`

- [ ] **Step 3: Write minimal implementation**

顺序固定，不可调换：

1. `getRecord(recordId)`，为 `null` → 返回 toast「未找到该工单记录」
2. 授权：`operatorOpenId` 属于 `record.ownerOpenIds` 或 `await fallbackOpenIds()` 之一，否则 toast「你不是该工单的负责人或兜底人」
3. `voc_decline_war_room` → `updateRecord(recordId, { [warRoomChatId]: DECLINED_MARKER })`，toast「已记录：暂不需要协同群」
4. `voc_open_war_room` → `warRoomDecision(record.warRoomChatId)`
   - `"exists"` → toast「协同群已存在」
   - `"declined"` → toast「此前已选择暂不需要」
   - `"create"` → `createChat(warRoomName(record), [...record.ownerOpenIds, operatorOpenId])` → 成功后 `updateRecord`（失败则 toast「协同群已创建但未记录，请重试」并返回）→ `sendToChat(chatId, createVocTicketCard(record, tag, { fullContent: true }))`（失败只影响 toast 文案，不回滚）→ toast「协同群已创建」
5. 建群本身抛错 → toast「协同群创建失败」，不写列

返回 `CardActionResult` 的 `kind: "update"` 形状，与既有四个动作一致。

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/features/feishu-bot/war-room-actions.ts src/features/feishu-bot/war-room-actions.test.ts
git commit -m "feat: resolve the two war room card actions

Approving an escalation is the fallback approver's job, so these two actions
accept an owner or a fallback. The four status actions keep the strict owner
check untouched — changing a ticket's state is the owner's job, and a relaxation
that leaked into them would hand every fallback write access to every ticket.

Order is load-bearing: record, then authorization, then idempotence, then create.
Checking existence before authorization would tell a stranger whether a group
exists; creating before writing the id back is the lesser evil, but the toast has
to say so, because a group nobody can find from the Base needs a retry rather
than a shrug."
```

---

### Task 7: 分片作业发升级卡

**Files:**
- Modify: `app/api/voc/analyze/route.ts`
- Test: `app/api/voc/analyze/route.test.ts`

**Interfaces:**
- Consumes: `createWarRoomEscalationCard`（Task 5）、`listOwnerRules`（既有）
- Produces: `AnalyzeRouteDependencies` 新增 `escalate?: (input: Readonly<{ record: VocRecord; fallbackOpenIds: readonly string[] }>) => Promise<void>`；返回体新增 `escalated: number`

- [ ] **Step 1: Write the failing test**

```ts
it("proposes a war room for a high-severity ticket and not for the others", async () => {
  const escalated: string[] = [];
  const route = createAnalyzeRoute({
    ...deps,
    listPending: async () => [highSeverityRecord, midSeverityRecord],
    escalate: async ({ record }) => { escalated.push(record.recordId); },
  });

  const body = await (await route(cronRequest())).json();

  expect(escalated).toEqual([highSeverityRecord.recordId]);
  expect(body.escalated).toBe(1);
});

it("does not propose a war room twice for the same ticket", async () => {
  // The shard job re-runs daily and retries failures; a proposal per run would
  // nag the approver about a ticket they already answered.
  const escalate = vi.fn(async () => {});
  const route = createAnalyzeRoute({
    ...deps,
    listPending: async () => [{ ...highSeverityRecord, warRoomChatId: "oc_existing" }],
    escalate,
  });

  await route(cronRequest());

  expect(escalate).not.toHaveBeenCalled();
});

it("keeps processing the shard when escalation throws", async () => {
  // Escalation is an enhancement. A ticket must still reach 待跟进 and its owner
  // must still get the single-chat card when the proposal cannot be sent.
  const route = createAnalyzeRoute({
    ...deps,
    listPending: async () => [highSeverityRecord],
    escalate: async () => { throw new Error("im down"); },
  });

  const body = await (await route(cronRequest())).json();

  expect(body.processed).toBe(1);
  expect(body.escalated).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/voc/analyze/route.test.ts`
Expected: FAIL — `escalated` 为 `undefined`

- [ ] **Step 3: Write minimal implementation**

在既有 per-record `try` 内、状态推进与 `notifyOwner` 之后追加：若 `record.severity === "高"` 且 `warRoomDecision(record.warRoomChatId) === "create"` 且 `dependencies.escalate` 存在，则调用它并计数；抛错落进既有 per-record catch，仅不计数。

`defaultDependencies.escalate` 用 `createWarRoomEscalationCard` 拼卡，收件人取 `listOwnerRules` 里 `fallback === true` 的 open_id（去重），逐个 `sendFeishuMessage`。无兜底人时直接返回、不发、不报错——理由见 spec §3.1。

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run test:runtime`

- [ ] **Step 5: Commit**

```bash
git add app/api/voc/analyze/route.ts app/api/voc/analyze/route.test.ts
git commit -m "feat: propose a war room for high-severity tickets

Only 严重度 高 escalates, and only once per ticket: the shard job runs daily and
retries failures, so an unconditional proposal would nag the approver about a
ticket they already answered. The chat-id column carries that memory, which is
why it also records a refusal.

A failed proposal never blocks the shard. The ticket still reaches 待跟进 and its
owner still gets the single-chat card — escalation is an enhancement, and letting
it fail the main path would trade a working loop for a nicer one."
```

---

### Task 8: 群内自由问答

**Files:**
- Create: `src/features/warroom/facts.ts`
- Create: `src/features/tagging/answer-provider.ts`
- Modify: `src/lib/env.ts`
- Modify: `app/api/feishu/events/route.ts`
- Test: `src/features/warroom/facts.test.ts`、`src/features/tagging/answer-provider.test.ts`、`app/api/feishu/events/route.test.ts`

**Interfaces:**
- Consumes: `BitableClient.findByWarRoomChatId`（Task 2）、`unwrapSkillOutput`（既有）
- Produces:
  - `stripMention(text: string): string`
  - `buildAnswerFacts(input: Readonly<{ ticket: VocRecord; sameDimension: Readonly<{ total: number; closed: number }>; sameModel: number }>): string`
  - `createAnswerProvider(config): { answer(question: string, facts: string): Promise<string | null> }`
  - `TaggingEnv` 的 aily 分支新增 `answerSkillId: string`

- [ ] **Step 1: Write the failing tests（纯函数部分）**

```ts
describe("stripMention", () => {
  it("removes the @-mention Feishu puts in front of the question", () => {
    expect(stripMention("@_user_1 这条投诉以前出现过吗")).toBe("这条投诉以前出现过吗");
    expect(stripMention("@OneCare  同型号还有几条")).toBe("同型号还有几条");
  });

  it("leaves a question with no mention alone", () => {
    expect(stripMention("直接问的问题")).toBe("直接问的问题");
  });

  it("returns an empty string when the message is nothing but a mention", () => {
    // The caller uses "empty" to decide whether to answer at all, instead of
    // sending a blank question to the model and getting a hallucinated reply.
    expect(stripMention("@_user_1")).toBe("");
  });
});

describe("buildAnswerFacts", () => {
  it("carries the ticket and both aggregates as JSON", () => {
    const facts = JSON.parse(
      buildAnswerFacts({ ticket, sameDimension: { total: 12, closed: 5 }, sameModel: 3 }),
    ) as { ticket: Record<string, unknown>; aggregates: Record<string, unknown> };

    expect(facts.ticket.recordNumber).toBe(ticket.recordNumber);
    expect(facts.aggregates).toEqual({
      sameDimensionLast7Days: 12,
      sameDimensionClosed: 5,
      sameModelTotal: 3,
    });
  });

  it("omits the record id so the model cannot quote an internal identifier", () => {
    // The answer goes into a group chat. A Bitable record_id in it is noise at
    // best and a leak of internal addressing at worst.
    expect(buildAnswerFacts({ ticket, sameDimension: { total: 0, closed: 0 }, sameModel: 0 }))
      .not.toContain(ticket.recordId);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/warroom/facts.test.ts`
Expected: FAIL — `Failed to resolve import "./facts"`

- [ ] **Step 3: Implement the pure functions**

`stripMention`：把开头连续的 `@非空白串` 逐个剔除后 `trim()`。

`buildAnswerFacts`：`JSON.stringify({ ticket: <VocRecord 去掉 recordId 与 warRoomChatId>, aggregates: { sameDimensionLast7Days, sameDimensionClosed, sameModelTotal } })`。

- [ ] **Step 4: Write the failing test（技能客户端）**

```ts
it("returns the skill's prose answer", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toContain("/skills/skill_answer/start");
    const body = JSON.parse(init?.body as string) as { input: string };
    const input = JSON.parse(body.input) as { question: string; facts: string };
    // Both are String parameters: aily's custom parameters are scalars only —
    // String, Boolean, Float, Integer, no arrays and no objects.
    expect(typeof input.question).toBe("string");
    expect(typeof input.facts).toBe("string");
    return jsonResponse({ code: 0, data: { status: "success", output: JSON.stringify({ output: "这条投诉本周同维度还有 12 条。" }) } });
  });

  const provider = createAnswerProvider({ ailyAppId: "spring_x__c", skillId: "skill_answer", tenantAccessToken: async () => "t" }, fetcher as unknown as typeof fetch);

  expect(await provider.answer("同维度还有几条", "{}")).toBe("这条投诉本周同维度还有 12 条。");
});

it("returns null rather than a fabricated answer on any failure", async () => {
  for (const response of [
    jsonResponse({ code: 2320008, msg: "not found" }),
    jsonResponse({ code: 0, data: { status: "running", output: "x" } }),
    jsonResponse({ code: 0, data: { status: "success", output: JSON.stringify({ output: "   " }) } }),
    jsonResponse({}, 500),
  ]) {
    const provider = createAnswerProvider(config, (async () => response) as unknown as typeof fetch);
    expect(await provider.answer("q", "{}")).toBeNull();
  }
});
```

- [ ] **Step 5: Implement the answer provider**

与 `aily-provider.ts` 同形：`POST aily/v1/apps/{ailyAppId}/skills/{skillId}/start`，`input` 是 `JSON.stringify({ question, facts })`，超时复用 `TAGGING_TIMEOUT_MS`。响应经 `unwrapSkillOutput` 后**直接当散文返回**——不过 `parseTagPayload`，因为这是给人读的文本。`status !== "success"`、`code !== 0`、HTTP 非 2xx、答案 `trim()` 为空，一律返回 `null`。

`src/lib/env.ts`：`TaggingEnv` 的 aily 分支加 `answerSkillId: readRequired(source, "FEISHU_AILY_SKILL_ANSWER")`，`ServerEnvironmentName` 加该名字。

- [ ] **Step 6: Wire the group @ path**

`app/api/feishu/events/route.ts` 的 `im.message.receive_v1` 处理分支：`chat_type === "group"` 时，用 `chat_id` 调 `findByWarRoomChatId`。

- 查不到 → 回「这个群没有关联的 VOC 工单」
- `stripMention` 后为空 → 回工单卡而不是问模型
- 否则：取聚合（同 `问题维度` 近 7 天与其中已闭环、同 `机型` 总数，来源 `listRecords` 的已缓存读取）→ `buildAnswerFacts` → `provider.answer` → `null` 时回「暂时答不上来，可以稍后再问，或直接在多维表格里查这条记录」

单聊分支行为不变。三秒响应仍先返回 200，回复走既有 `after()`。

- [ ] **Step 7: Run tests**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run test:runtime && FEISHU_BITABLE_APP_TOKEN=bogusX npm run build`

- [ ] **Step 8: Commit**

```bash
git add src/features/warroom/facts.ts src/features/warroom/facts.test.ts src/features/tagging/answer-provider.ts src/features/tagging/answer-provider.test.ts src/lib/env.ts app/api/feishu/events/route.ts app/api/feishu/events/route.test.ts
git commit -m "feat: answer questions in the war room from the ticket's own facts

The agent reads rather than guesses: the chat id resolves to a ticket, the ticket
and two aggregates become the facts, and the model only ever sees those. A group
with no ticket behind it gets told so — answering generally would be the one
behaviour that makes the whole thing untrustworthy.

Any failure returns null and the group is told the bot cannot answer right now.
A fabricated answer about a real customer complaint is worse than no answer.

The record id is deliberately absent from the facts: the reply lands in a group
chat, where an internal Bitable identifier is noise at best."
```

---

### Task 9: 闭环归档

**Files:**
- Modify: `src/features/feishu-bot/card-actions.ts`（或 VOC 动作所在模块）
- Test: 同模块测试文件

**Interfaces:**
- Consumes: `listChatMessages`（Task 4）、`createAnswerProvider`（Task 8）、`buildAnswerFacts`（Task 8）
- Produces: 无新导出；`voc_confirm_closure` 在群内触发时追加写 `闭环结论`

- [ ] **Step 1: Write the failing test**

```ts
it("writes the closure first and the summary second", async () => {
  const writes: Array<Record<string, unknown>> = [];
  await resolveVocCardAction({
    action: "voc_confirm_closure", recordId: "rec1", operatorOpenId: "ou_owner",
    bitable: { ...bitable, updateRecord: async (_id, fields) => { writes.push(fields); } },
    chatId: "oc_1",
    readTranscript: async () => ["先跟进了", "已上门解决"],
    summarise: async () => "已上门更换配件，用户确认解决。",
  });

  expect(writes[0]?.[VOC_FIELD_NAMES.state]).toBe("已闭环");
  expect(writes[1]?.[VOC_FIELD_NAMES.closingNote]).toBe("已上门更换配件，用户确认解决。");
});

it("keeps the closure when the summary fails", async () => {
  // This is the load-bearing rule of the whole design. Closure is a fact that
  // already happened; a failed summary must not be able to undo it.
  const writes: Array<Record<string, unknown>> = [];
  const result = await resolveVocCardAction({
    action: "voc_confirm_closure", recordId: "rec1", operatorOpenId: "ou_owner",
    bitable: { ...bitable, updateRecord: async (_id, fields) => { writes.push(fields); } },
    chatId: "oc_1",
    readTranscript: async () => ["内容"],
    summarise: async () => null,
  });

  expect(writes[0]?.[VOC_FIELD_NAMES.state]).toBe("已闭环");
  expect(writes).toHaveLength(1);
  expect(JSON.stringify(result)).toMatch(/结论生成失败/);
});

it("skips the summary entirely for a single-chat closure", async () => {
  const summarise = vi.fn(async () => "x");
  await resolveVocCardAction({
    action: "voc_confirm_closure", recordId: "rec1", operatorOpenId: "ou_owner",
    bitable, chatId: null, readTranscript: async () => [], summarise,
  });

  expect(summarise).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/feishu-bot`
Expected: FAIL — 未知参数 `chatId` / `readTranscript` / `summarise`

- [ ] **Step 3: Write minimal implementation**

VOC 动作入参新增三个可选项：`chatId: string | null`、`readTranscript: () => Promise<readonly string[]>`、`summarise: (facts: string, transcript: readonly string[]) => Promise<string | null>`。

`voc_confirm_closure` 现有写入完成**之后**：若 `chatId` 非空 → `readTranscript()` → `summarise()` → 非 `null` 则第二次 `updateRecord` 只写 `闭环结论`。任一步抛错或返回 `null`，toast 追加「（结论生成失败）」，**不回滚状态**。

`chatId` 为 `null`（单聊）时整段跳过。

`summarise` 的默认实现调 Task 8 的问答技能，`question` 固定为「请把这次协同过程收敛成一段闭环结论，说明问题、处理动作与结果」。

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run test:runtime`

- [ ] **Step 5: Commit**

```bash
git add src/features/feishu-bot src/features/feishu-bot/card-actions.test.ts
git commit -m "fix: write the closure before generating its summary

Closure is a fact that already happened when the owner pressed the button. The
summary is a nicety generated afterwards from the group's transcript, so it gets
its own write and its own failure path: if the model is down, the ticket is still
closed, the column is left empty, and the toast says why.

Implementing this as one transaction would mean a model outage silently reopening
closed tickets — the failure nobody would notice until the closure rate moved."
```

---

### Task 10: 文档一致性与全量验证

**Files:**
- Modify: `README.md`、`AGENTS.md`、`docs/TECH_STACK.md`、`.env.example`

- [ ] **Step 1: 更新文档**

如实描述：高严重度工单提请拉群、人工确认后建群、群内工单卡与四个按钮、群内 `@` 问答（事实来自 Bitable、回答来自 aily 第二个技能）、闭环时生成结论。

**明确写清仍未实现的**：SLA 催办、话术改写、同类问题背景、两个机器人同群、群解散归档。`redactVocContent` 表述维持现状。

`.env.example` 加 `FEISHU_AILY_SKILL_ANSWER=replace_with_answer_skill_id`。

同时补记 §2 的实测结论：通讯录接口未开通因此不解析姓名；aily 自定义参数只支持标量。

- [ ] **Step 2: 全量验证**

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
FEISHU_BITABLE_APP_TOKEN=bogusX npm run build
FEISHU_APP_SECRET=wrongX npm run build
```

`npm audit --omit=dev` 预期仍非零（既有例外，README 已记录，不处置）。其余必须绿。

- [ ] **Step 3: 人工端到端演练（不自动化）**

按 spec §12 的 11 条验收逐条走一遍，用真实租户、真实群。**这是唯一验证建群与群内交互的方式**——建群有副作用且不可幂等清理。逐条记录结果，失败项如实报告。

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md docs/TECH_STACK.md .env.example
git commit -m "docs: state what the war room does and what it still does not

Records the escalation path, the in-group card, the fact-grounded Q&A and the
closing summary — and keeps naming what is absent: SLA nudges, reply rewriting,
the similar-tickets panel, two bots in one group, group archival.

Also records two measured constraints so the next person does not rediscover
them: the contact API is unauthorized, which is why nothing resolves a name; and
aily's custom skill parameters are scalars only, which is why structured input
travels as a JSON string."
```

---

## 自查

**规格覆盖**：§2 已验证前提 → 计划前置条件与 Global Constraints；§3 触发与闸门 → Task 5、6、7；§4 建群与幂等 → Task 3、4、6；§5 开场简报 → Task 5、6；§6 群内问答 → Task 8；§7 闭环归档 → Task 9；§8 数据模型 → Task 1；§9 运营前提 → 前置条件 P2；§10 测试 → 各任务测试步骤 + Task 10 Step 3；§11 不做 → Task 10 Step 1 如实记录；§12 验收 → Task 10 Step 3。

**占位符扫描**：无 TBD、无「适当处理错误」。每个代码步骤都给了可运行的代码或精确到接口与顺序的说明。

**类型一致性**：`warRoomChatId`（Task 1）被 Task 2、3、6、7 消费；`DECLINED_MARKER` / `warRoomDecision` / `warRoomName`（Task 3）被 Task 6、7 消费；`createWarRoomChat` / `listChatMessages`（Task 4）被 Task 6、9 消费；`createWarRoomEscalationCard` 与 `createVocTicketCard` 的第三参（Task 5）被 Task 6、7 消费；`buildAnswerFacts` / `createAnswerProvider`（Task 8）被 Task 9 消费。命名全程一致。

**已知取舍**：Task 6 先建群再写列，中间失败会留下一个未记录的群。选择这一顺序而不是相反，是因为「多一个空群」可由人清理，而「记录指向不存在的群」会让所有人走进一个不存在的地方；toast 明确告知需要重试。
