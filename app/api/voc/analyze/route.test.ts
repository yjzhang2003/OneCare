import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../../../../src/features/bitable/field-map";
import type { FeishuOutboundMessage } from "../../../../src/features/feishu-bot/card-types";
import {
  buildPendingShard,
  createAnalyzeRoute,
  escalateToWarRoom,
  fallbackOwnerOpenIds,
  GET,
  listOwnerRules,
  parseOwnerRules,
  POST,
  readFieldShortcutRows,
  resolveTagSource,
} from "./route";

// Declared as a typed fake (not `vi.fn(async () => undefined)`) so
// `.mock.calls[0]` is already the real argument tuple. A zero-arg inference
// would force a tuple cast at every assertion site, which vitest never
// type-checks but `tsc --noEmit` rejects.
function notifyOwnerSpy() {
  return vi.fn(
    async (_input: {
      openId: string;
      message: FeishuOutboundMessage;
    }): Promise<void> => undefined,
  );
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    cronSecret: "s3cret",
    // The mirror pull that now runs before every shard. A no-op here: these tests
    // drive the tagging loop, and its own tests cover the sync.
    syncStore: vi.fn(async () => ({ read: 0, written: 0, skipped: 0 })),
    shardSize: 2,
    tagSource: "field-shortcut",
    notifyOwner: notifyOwnerSpy(),
    listPending: vi.fn(async () => [
      {
        recordId: "rec1",
        recordNumber: "VOC-0001",
        feedbackAt: "2026-01-20T00:00:00.000Z",
        channel: "电商评价",
        category: "冰箱",
        content: "等了三天",
        rating: 2,
        state: "待分析" as const,
        polarity: null,
        dimensions: [],
        ownerOpenIds: [],
        retryCount: 0,
        ticketOpenedAt: null,
        closedAt: null,
        // Blank by default — no group proposed yet. Task 7's escalation gate
        // reads this pass's own triage() severity, not a column on this
        // fixture (see the "war room escalation" describe block below), so
        // there is no equivalent "severity" default to set here.
        warRoomChatId: "",
        engineerOpenIds: [],
        engineerNames: [],
        dispatchedAt: null,
        followUpNote: "",
        closingNote: "",
        sourceTicketNo: "CAS-42567239-Q7Q8Q",
        userRef: "U-3878645B",
        deviceRef: "D-91C2A70E",
        sourceUrl: "",
        sourceDetail: "400投诉",
        businessUnit: "冰冷事业部",
        categoryLevel1: "安装调试",
      },
    ]),
    // Recordid-aware (not a fixed single-item array) so a shard of more than
    // one record — as Task 7's escalation tests supply, without overriding
    // this fixture — tags every record it is handed, not just "rec1". Same
    // shape as taggedOutcome() below for any id, so this is a pure
    // generalisation: existing single-record tests still get exactly the
    // same one outcome they did before.
    tag: vi.fn(async (records: readonly { recordId: string }[]) =>
      records.map((record) => taggedOutcome(record.recordId)),
    ),
    ownerRules: vi.fn(async () => [
      { scope: "", openId: "ou_backstop", fallback: true },
    ]),
    updateRecord: vi.fn(
      async (_recordId: string, _fields: Record<string, unknown>) => undefined,
    ),
    // Present (as undefined) rather than left off entirely, so the property
    // exists on deps()'s own inferred return type with a concrete type of its
    // own — the same reason every other overridable dependency above is a
    // named property of this base object rather than something callers can
    // only ever add via the generic `overrides: Record<string, unknown>`
    // parameter. Every test but Task 7's own runs escalation-less by default,
    // exactly as this route behaved before that task existed.
    escalate: undefined,
    ...overrides,
  };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/voc/analyze", {
    method: "POST",
    headers,
  });
}

// The authorized request every Task 7 escalation test sends — same shape as
// request({ authorization: "Bearer s3cret" }), named for what it represents
// (Vercel Cron's own call) rather than what header it carries.
function cronRequest(): Request {
  return request({ authorization: "Bearer s3cret" });
}

// tagSource is a plain string on the dependency type but a *getter* in
// production (a fresh aily batch number per Cron tick, via readTaggingEnv(),
// which throws when TAGGING_PROVIDER is misconfigured). These tests therefore
// have to control and observe the act of *reading* the property, not just its
// value — which is exactly the read that slipped between the previous
// per-read try blocks.
function defineTagSource(dependencies: object, read: () => string): void {
  Object.defineProperty(dependencies, "tagSource", {
    get: read,
    configurable: true,
  });
}

function taggedOutcome(recordId: string) {
  return {
    kind: "tagged" as const,
    result: {
      recordId,
      sentiment: ["失望"],
      polarity: "差评" as const,
      dimensions: ["维修时间"] as const,
      summary: "等待三天",
      replies: [],
    },
  };
}

// Drives triage()'s real severity computation rather than asserting a label:
// 差评 + 2 or more dimensions is "高", 差评 + fewer than 2 is "中" (see
// src/features/voc/triage.ts). The escalation gate (Task 7) reads *this
// pass's* triage verdict, not any column on the input record, so every
// escalation test below controls severity by shaping what tag() returns,
// not by setting a field on the record itself.
function taggedOutcomeWithSeverity(recordId: string, severity: "高" | "中") {
  return {
    kind: "tagged" as const,
    result: {
      recordId,
      sentiment: ["愤怒"],
      polarity: "差评" as const,
      dimensions:
        severity === "高"
          ? (["维修时间", "服务态度"] as const)
          : (["维修时间"] as const),
      summary: "多重问题",
      replies: [],
    },
  };
}

// Fixtures for the escalation gate (Task 7). Distinguished only by recordId —
// neither carries a 严重度 field, because the gate no longer reads one off
// the input record at all (see the "war room escalation" describe block
// below for why: the gate reads this pass's own triage() verdict, computed
// from whatever tag() returns for a given recordId, not a pre-tagging
// column). Plain object literals, not built through pendingRecord() below,
// so their own field types stay concrete rather than merged through that
// helper's generic Record<string, unknown> overrides parameter.
const highSeverityRecord = {
  recordId: "rec-high",
  recordNumber: "VOC-0002",
  feedbackAt: "2026-01-21T00:00:00.000Z",
  channel: "电商评价",
  category: "冰箱",
  content: "严重问题",
  rating: 1,
  state: "待分析" as const,
  retryCount: 0,
  warRoomChatId: "",
  engineerOpenIds: [],
  engineerNames: [],
  dispatchedAt: null,
  followUpNote: "",
  closingNote: "",
  sourceTicketNo: "CAS-42567239-Q7Q8Q",
  userRef: "U-3878645B",
  deviceRef: "D-91C2A70E",
  sourceUrl: "",
  sourceDetail: "400投诉",
  businessUnit: "冰冷事业部",
  categoryLevel1: "安装调试",
};

const midSeverityRecord = {
  ...highSeverityRecord,
  recordId: "rec-mid",
};

describe("createAnalyzeRoute", () => {
  it("rejects a request with no cron secret", async () => {
    const dependencies = deps();
    const response = await createAnalyzeRoute(dependencies)(request());

    expect(response.status).toBe(401);
    expect(dependencies.listPending).not.toHaveBeenCalled();
  });

  it("rejects a wrong cron secret", async () => {
    const dependencies = deps();
    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer wrong" }),
    );

    expect(response.status).toBe(401);
  });

  it("tags a shard and writes the AI columns plus the ticket state", async () => {
    const dependencies = deps();
    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processed: 1,
      tagged: 1,
      failed: 0,
    });

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields["情绪极性"]).toBe("差评");
    expect(fields["严重度"]).toBe("中");
    expect(fields["流程状态"]).toBe("待跟进");
    expect(fields["负责人"]).toEqual([{ id: "ou_backstop" }]);
  });

  // Spec §3.2: 打标来源 must be written on every AI result, success or
  // failure, so a row is explainable and traceable to whichever track
  // produced it. The route only forwards dependencies.tagSource verbatim —
  // the "aily:<skill_id>@<批次号>" vs "field-shortcut" formatting itself is
  // resolveTagSource's job and is locked separately below.
  it("writes 打标来源 from dependencies onto a tagged record", async () => {
    const dependencies = deps({ tagSource: "aily:skill_x@1700000000000" });
    await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields["打标来源"]).toBe("aily:skill_x@1700000000000");
  });

  it("marks a failed record so the next shard can retake it", async () => {
    const dependencies = deps({
      tag: vi.fn(async () => [
        {
          kind: "failed" as const,
          recordId: "rec1",
          reason: "模型未返回该 id",
          rawOutput: "{}",
        },
      ]),
    });

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(await response.json()).toMatchObject({ failed: 1, tagged: 0 });

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields["流程状态"]).toBe("分析失败");
    expect(fields["失败原因"]).toBe("模型未返回该 id");
    expect(fields["重试次数"]).toBe(1);
    expect(fields["打标来源"]).toBe("field-shortcut");
  });

  // brief's given 6 tests all supply a backstop rule, so resolveOwner never
  // actually returns null anywhere in the suite — the hasOwner guard that
  // keeps a ticket-worthy record at 已分析 was correct but unlocked by any
  // test.
  it("keeps a ticket-worthy record at 已分析 when no owner or backstop resolves", async () => {
    const dependencies = deps({ ownerRules: vi.fn(async () => []) });
    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(await response.json()).toMatchObject({ tagged: 1, failed: 0 });

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields["流程状态"]).toBe("已分析");
    expect(fields["负责人"]).toBeUndefined();
    expect(fields["建单时间"]).toBeUndefined();
  });

  it("returns early when the shard is empty", async () => {
    const dependencies = deps({ listPending: vi.fn(async () => []) });
    const readTagSource = vi.fn(() => "field-shortcut");
    defineTagSource(dependencies, readTagSource);

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    // Exactly the seven contracted keys — the fail-closed work must not have
    // leaked a diagnostic field into the success body.
    expect(await response.json()).toEqual({
      processed: 0,
      tagged: 0,
      failed: 0,
      writeErrors: 0,
      notified: 0,
      notifyErrors: 0,
      escalated: 0,
    });
    expect(dependencies.tag).toHaveBeenCalledTimes(0);
    // Nothing to route means no reason to read the owner table, and no reason
    // to mint a batch number for a shard that tags nothing.
    expect(dependencies.ownerRules).toHaveBeenCalledTimes(0);
    expect(readTagSource).toHaveBeenCalledTimes(0);
  });

  it("reads ownerRules and tagSource exactly once each on the normal path", async () => {
    const dependencies = deps();
    const readTagSource = vi.fn(() => "field-shortcut");
    defineTagSource(dependencies, readTagSource);

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed: 1,
      tagged: 1,
      failed: 0,
      writeErrors: 0,
      notified: 1,
      notifyErrors: 0,
      escalated: 0,
    });
    expect(dependencies.ownerRules).toHaveBeenCalledTimes(1);
    expect(readTagSource).toHaveBeenCalledTimes(1);
    expect(dependencies.tag).toHaveBeenCalledTimes(1);
    expect(dependencies.updateRecord).toHaveBeenCalledTimes(1);
  });

  // A batch number identifies one shard run, so it must be minted once per
  // request and shared by every record in that request — a per-record read
  // would stamp two rows of the same run with two different batches.
  it("stamps every record in a shard with the same batch number", async () => {
    let reads = 0;
    const dependencies = deps({
      listPending: vi.fn(async () => [
        pendingRecord({ recordId: "rec1", state: "待分析" }),
        pendingRecord({ recordId: "rec2", state: "待分析" }),
      ]),
      tag: vi.fn(async () => [taggedOutcome("rec1"), taggedOutcome("rec2")]),
    });
    defineTagSource(dependencies, () => `aily:skill_x@${(reads += 1)}`);

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(await response.json()).toEqual({
      processed: 2,
      tagged: 2,
      failed: 0,
      writeErrors: 0,
      notified: 2,
      notifyErrors: 0,
      escalated: 0,
    });
    expect(reads).toBe(1);
    expect(dependencies.updateRecord).toHaveBeenCalledTimes(2);
    const [, first] = dependencies.updateRecord.mock.calls[0];
    const [, second] = dependencies.updateRecord.mock.calls[1];
    expect(first["打标来源"]).toBe("aily:skill_x@1");
    expect(second["打标来源"]).toBe("aily:skill_x@1");
  });

  it("keeps going when one record fails to write", async () => {
    const dependencies = deps({
      updateRecord: vi.fn(async () => {
        throw new Error("bitable down");
      }),
    });

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ writeErrors: 1 });
  });

  // Before this, createVocTicketCard had no caller outside its own unit test:
  // the shard wrote 待跟进 into the Base and told nobody, so 待跟进 → 跟进中 →
  // 待闭环 → 已闭环 could never be entered by the person responsible for it.
  // These tests assert the seam itself — that a ticket-worthy record produces
  // one addressed push carrying a real, clickable Card 2.0 payload.
  describe("ticket card delivery", () => {
    it("pushes the ticket card to the resolved owner exactly once", async () => {
      const dependencies = deps();

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(200);
      expect(dependencies.notifyOwner).toHaveBeenCalledTimes(1);

      const [delivery] = dependencies.notifyOwner.mock.calls[0];
      // Addressed to the person the owner table resolved, not to a chat.
      expect(delivery.openId).toBe("ou_backstop");
      expect(delivery.message.msgType).toBe("interactive");

      const card = JSON.parse(delivery.message.content) as Record<
        string,
        unknown
      >;
      expect(card.schema).toBe("2.0");
      // The card must carry the freshly written state and a button addressing
      // this specific row — that button is the only entrance to the closure
      // flow, so a card without it delivers nothing.
      expect(delivery.message.content).toContain("待跟进");
      expect(delivery.message.content).toContain("voc_start_follow_up");
      expect(delivery.message.content).toContain("rec1");
      expect(delivery.message.content).toContain("VOC-0001");
      // The AI work the shard just paid for has to be on the card the owner
      // reads, or the push is a bare notification.
      expect(delivery.message.content).toContain("等待三天");
    });

    it("keeps the written state and does not count a push failure as a write error", async () => {
      const dependencies = deps({
        notifyOwner: vi.fn(
          async (_input: {
            openId: string;
            message: FeishuOutboundMessage;
          }): Promise<void> => {
            throw new Error("feishu im rate limited");
          },
        ),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(200);
      // writeErrors means "failed to write back to the Base" and nothing
      // else; a failed push must be visible on its own key instead of
      // borrowing that meaning.
      expect(await response.json()).toEqual({
        processed: 1,
        tagged: 1,
        failed: 0,
        writeErrors: 0,
        notified: 0,
        notifyErrors: 1,
        escalated: 0,
      });
      // The state write already succeeded and must not be rolled back.
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(1);
      const [, fields] = dependencies.updateRecord.mock.calls[0];
      expect(fields["流程状态"]).toBe("待跟进");
    });

    it("keeps processing the rest of the shard after a push throws", async () => {
      const dependencies = deps({
        listPending: vi.fn(async () => [
          pendingRecord({ recordId: "rec1", state: "待分析" }),
          pendingRecord({ recordId: "rec2", state: "待分析" }),
        ]),
        tag: vi.fn(async () => [taggedOutcome("rec1"), taggedOutcome("rec2")]),
        notifyOwner: vi.fn(
          async (input: {
            openId: string;
            message: FeishuOutboundMessage;
          }): Promise<void> => {
            if (input.message.content.includes("rec1")) {
              throw new Error("feishu im rate limited");
            }
          },
        ),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        processed: 2,
        tagged: 2,
        failed: 0,
        writeErrors: 0,
        notified: 1,
        notifyErrors: 1,
        escalated: 0,
      });
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(2);
    });

    it("does not push when the record needs no ticket", async () => {
      const dependencies = deps({
        tag: vi.fn(async () => [
          {
            kind: "tagged" as const,
            result: {
              recordId: "rec1",
              sentiment: ["满意"],
              polarity: "好评" as const,
              dimensions: [] as const,
              summary: "上门很快",
              replies: [],
            },
          },
        ]),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(await response.json()).toMatchObject({
        notified: 0,
        notifyErrors: 0,
      });
      const [, fields] = dependencies.updateRecord.mock.calls[0];
      expect(fields["流程状态"]).toBe("无需跟进");
      expect(dependencies.notifyOwner).not.toHaveBeenCalled();
    });

    it("does not push when no owner or backstop resolves", async () => {
      const dependencies = deps({ ownerRules: vi.fn(async () => []) });

      await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      // The record stayed at 已分析, so there is no 待跟进 ticket to announce
      // and nobody to announce it to.
      expect(dependencies.notifyOwner).not.toHaveBeenCalled();
    });

    it("does not push a card for a state that failed to write", async () => {
      const dependencies = deps({
        updateRecord: vi.fn(async () => {
          throw new Error("bitable down");
        }),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(await response.json()).toMatchObject({
        writeErrors: 1,
        notified: 0,
        notifyErrors: 0,
      });
      // A card claiming 待跟进 for a row still sitting at 待分析 would send the
      // owner to a button the state machine is going to reject.
      expect(dependencies.notifyOwner).not.toHaveBeenCalled();
    });

    it("does not push for a failed tagging outcome", async () => {
      const dependencies = deps({
        tag: vi.fn(async () => [
          {
            kind: "failed" as const,
            recordId: "rec1",
            reason: "模型未返回该 id",
          },
        ]),
      });

      await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(dependencies.notifyOwner).not.toHaveBeenCalled();
    });
  });

  // Task 7: 严重度 高 tickets get an extra push — an escalation card asking
  // the fallback approver whether the ticket warrants a war room. The three
  // tests below are the brief's own, adapted to this file's deps(overrides)
  // factory (the brief's "...deps" spread assumes deps is already a plain
  // object; here it is a factory, so the equivalent call is deps({...})) and
  // its request(headers) helper (cronRequest() is a thin wrapper over it).
  //
  // A correction after the first version of this gate shipped: it read
  // record.severity (the input row's own pre-tagging 严重度 column) instead
  // of this pass's own triage() verdict. That column is null for any 待分析
  // row on its first tagging pass, which made the whole feature unreachable
  // in production even though every test here — which set that column
  // directly on the fixture — stayed green. Every test below now drives
  // severity through what tag() returns (via taggedOutcomeWithSeverity,
  // which shapes the polarity/dimensions triage() itself reads), not through
  // a field on the input record, so a regression back to reading the stale
  // column would fail here rather than only in production.
  describe("war room escalation", () => {
    it("proposes a war room for a high-severity ticket and not for the others", async () => {
      const escalated: string[] = [];
      const route = createAnalyzeRoute(
        deps({
          listPending: async () => [highSeverityRecord, midSeverityRecord],
          tag: async (records: readonly { recordId: string }[]) =>
            records.map((record) =>
              record.recordId === highSeverityRecord.recordId
                ? taggedOutcomeWithSeverity(record.recordId, "高")
                : taggedOutcomeWithSeverity(record.recordId, "中"),
            ),
          escalate: async ({ record }: { record: { recordId: string } }) => {
            escalated.push(record.recordId);
          },
        }),
      );

      const body = await (await route(cronRequest())).json();

      expect(escalated).toEqual([highSeverityRecord.recordId]);
      expect(body.escalated).toBe(1);
    });

    it("does not propose a war room twice for the same ticket", async () => {
      // The shard job re-runs daily and retries failures; a proposal per run
      // would nag the approver about a ticket they already answered. This
      // pass's own triage still says 高 (tag() below guarantees it) — the
      // only thing standing between this ticket and a proposal is the
      // persisted chat-id column, which is exactly what this test isolates.
      const escalate = vi.fn(async () => {});
      const route = createAnalyzeRoute(
        deps({
          listPending: async () => [
            { ...highSeverityRecord, warRoomChatId: "oc_existing" },
          ],
          tag: async (records: readonly { recordId: string }[]) =>
            records.map((record) =>
              taggedOutcomeWithSeverity(record.recordId, "高"),
            ),
          escalate,
        }),
      );

      await route(cronRequest());

      expect(escalate).not.toHaveBeenCalled();
    });

    it("keeps processing the shard when escalation throws", async () => {
      // Escalation is an enhancement. A ticket must still reach 待跟进 and its
      // owner must still get the single-chat card when the proposal cannot be
      // sent.
      const route = createAnalyzeRoute(
        deps({
          listPending: async () => [highSeverityRecord],
          tag: async (records: readonly { recordId: string }[]) =>
            records.map((record) =>
              taggedOutcomeWithSeverity(record.recordId, "高"),
            ),
          escalate: async () => {
            throw new Error("im down");
          },
        }),
      );

      const body = await (await route(cronRequest())).json();

      expect(body.processed).toBe(1);
      expect(body.escalated).toBe(0);
    });

    it("does not propose a war room for a ticket the approver already declined", async () => {
      // warRoomDecision treats DECLINED_MARKER the same as an existing group:
      // both mean "do not ask again". Not one of the brief's three, but the
      // brief's own gate condition (warRoomDecision(...) === "create") is
      // meaningless without covering its third outcome too. Same isolation
      // as the "twice" test above: this pass's own triage says 高, so only
      // the declined marker can be blocking it.
      const escalate = vi.fn(async () => {});
      const route = createAnalyzeRoute(
        deps({
          listPending: async () => [
            { ...highSeverityRecord, warRoomChatId: "declined" },
          ],
          tag: async (records: readonly { recordId: string }[]) =>
            records.map((record) =>
              taggedOutcomeWithSeverity(record.recordId, "高"),
            ),
          escalate,
        }),
      );

      await route(cronRequest());

      expect(escalate).not.toHaveBeenCalled();
    });

    it("does not propose a war room when no escalate dependency is injected", async () => {
      // Every other test in this file omits escalate entirely (deps() does
      // not set it). This pins that an escalation-less run behaves exactly
      // as it did before this task existed, even for a ticket that would
      // otherwise qualify.
      const dependencies = deps({
        listPending: async () => [highSeverityRecord],
        tag: async (records: readonly { recordId: string }[]) =>
          records.map((record) =>
            taggedOutcomeWithSeverity(record.recordId, "高"),
          ),
      });

      const body = await (
        await createAnalyzeRoute(dependencies)(cronRequest())
      ).json();

      expect(body.escalated).toBe(0);
    });

    it("does not propose a war room for a ticket that never reaches 待跟进", async () => {
      // The escalate check sits after the `if (!delivery) continue` guard —
      // a record with no resolvable owner never reaches it, so a
      // high-severity ticket that fails to route must not be proposed
      // either.
      const escalate = vi.fn(async () => {});
      const route = createAnalyzeRoute(
        deps({
          listPending: async () => [highSeverityRecord],
          tag: async (records: readonly { recordId: string }[]) =>
            records.map((record) =>
              taggedOutcomeWithSeverity(record.recordId, "高"),
            ),
          ownerRules: async () => [],
          escalate,
        }),
      );

      await route(cronRequest());

      expect(escalate).not.toHaveBeenCalled();
    });

    // The regression pin the coordinator asked for: these two are the direct
    // positive/negative proof that the gate reads this pass's own triage()
    // verdict and not the input record's pre-tagging 严重度 column. Neither
    // fixture record carries a severity field at all (per the comment above
    // them) — "severity" below is an inert extra property standing in for a
    // stale/hand-edited column value, added only via spread, and read by
    // nothing in the route.
    it("escalates when this pass's own triage says 高, even though the record carries no 严重度 column at all", async () => {
      const escalate = vi.fn(async () => {});
      const route = createAnalyzeRoute(
        deps({
          // midSeverityRecord has no severity field — standing in for a
          // first-time 待分析 row, whose real 严重度 column is genuinely
          // blank because nothing has tagged it yet.
          listPending: async () => [midSeverityRecord],
          tag: async (records: readonly { recordId: string }[]) =>
            records.map((record) =>
              taggedOutcomeWithSeverity(record.recordId, "高"),
            ),
          escalate,
        }),
      );

      await route(cronRequest());

      expect(escalate).toHaveBeenCalledTimes(1);
    });

    it("does not escalate when a stale 严重度 column says 高 but this pass's own triage says otherwise", async () => {
      const escalate = vi.fn(async () => {});
      const route = createAnalyzeRoute(
        deps({
          // The extra `severity: "高"` property here is never read by the
          // route (PendingRecord has no such field) — it stands in for a
          // leftover or hand-edited column value that must not, by itself,
          // trigger an escalation this pass's own tagging does not support.
          listPending: async () => [
            { ...highSeverityRecord, severity: "高" },
          ],
          tag: async (records: readonly { recordId: string }[]) =>
            records.map((record) =>
              taggedOutcomeWithSeverity(record.recordId, "中"),
            ),
          escalate,
        }),
      );

      await route(cronRequest());

      expect(escalate).not.toHaveBeenCalled();
    });

    // The mirror of the two regression pins above, at the card-content layer
    // rather than the gate: a second bug in the same family was found after
    // the severity-gate fix landed — escalateToWarRoom built the card from
    // record.summary/.polarity/.dimensions/.replies/.severity, which for any
    // ticket escalating on its first tagging pass are genuinely blank (they
    // are Bitable columns nothing has written yet), so the approver received
    // a card that triggered correctly but showed no AI summary and no
    // severity — "looks like it worked, tells the approver nothing." This
    // test proves the fix at the value level: midSeverityRecord carries no
    // summary/severity fields at all (there is nowhere else the values below
    // could come from), tag() returns a real, distinctive summary and
    // dimensions that make triage() say 高, and the assertions read exactly
    // what runShard handed to escalate().
    it("passes this pass's fresh tag result and severity to escalate, not blank/stale AI columns", async () => {
      const seen: Array<{
        tag: { summary: string };
        severity: string;
      }> = [];
      const route = createAnalyzeRoute(
        deps({
          listPending: async () => [midSeverityRecord],
          tag: async (records: readonly { recordId: string }[]) =>
            records.map((record) => ({
              kind: "tagged" as const,
              result: {
                recordId: record.recordId,
                sentiment: ["愤怒"],
                polarity: "差评" as const,
                dimensions: ["维修时间", "服务态度"] as const,
                summary: "本轮生成的真实摘要",
                replies: [],
              },
            })),
          escalate: async (input: {
            tag: { summary: string };
            severity: string;
          }) => {
            seen.push({ tag: input.tag, severity: input.severity });
          },
        }),
      );

      await route(cronRequest());

      expect(seen).toHaveLength(1);
      expect(seen[0]?.tag.summary).toBe("本轮生成的真实摘要");
      expect(seen[0]?.severity).toBe("高");
    });
  });

  // Read-before-acting: listPending and ownerRules are both read-and-decide
  // dependencies this route needs before it can safely spend AI budget or
  // write anything. 已分析 is a dead end (nothing ever re-fetches it), so a
  // record tagged but then strandable for lack of a routable owner table
  // read is worse than refusing the whole shard up front. A transient
  // Bitable failure here must surface as an explicit 503, not an uncaught
  // exception Next.js turns into an opaque 500, and must not touch tag() or
  // updateRecord() at all.
  describe("fails closed when a read dependency errors", () => {
    it("returns 503 when ownerRules() throws, without tagging or writing anything", async () => {
      const dependencies = deps({
        ownerRules: vi.fn(async () => {
          throw new Error("owner table rate limited");
        }),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "service_unavailable",
        source: "ownerRules",
      });
      expect(dependencies.tag).not.toHaveBeenCalled();
      expect(dependencies.updateRecord).not.toHaveBeenCalled();
    });

    it("returns 503 when ownerRules() returns a rejected promise, without tagging or writing anything", async () => {
      const dependencies = deps({
        ownerRules: vi.fn(() => Promise.reject(new Error("network down"))),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "service_unavailable",
        source: "ownerRules",
      });
      expect(dependencies.tag).not.toHaveBeenCalled();
      expect(dependencies.updateRecord).not.toHaveBeenCalled();
    });

    it("returns 503 when listPending() throws, without tagging or writing anything", async () => {
      const dependencies = deps({
        listPending: vi.fn(async () => {
          throw new Error("voc table rate limited");
        }),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "service_unavailable",
        source: "listPending",
      });
      expect(dependencies.tag).not.toHaveBeenCalled();
      expect(dependencies.updateRecord).not.toHaveBeenCalled();
    });

    it("still returns 401 when unauthorized, even though ownerRules() would throw", async () => {
      const dependencies = deps({
        ownerRules: vi.fn(async () => {
          throw new Error("owner table rate limited");
        }),
      });

      // No Authorization header at all — proves the auth check was not
      // pushed later by this fix's reordering of the read dependencies.
      const response = await createAnalyzeRoute(dependencies)(request());

      expect(response.status).toBe(401);
      expect(dependencies.listPending).not.toHaveBeenCalled();
      expect(dependencies.ownerRules).not.toHaveBeenCalled();
    });
  });

  // The two named sources above cover the reads whose failure was *predicted*.
  // Three rounds of this task each found one more read that had not been
  // predicted (ownerRules inside the loop, then listPending, then the
  // tagSource getter, which landed in the gap between the two try blocks added
  // for the first two). These tests lock the property that replaces the
  // enumeration: no matter where the throw comes from, the handler answers 503
  // — never an uncaught exception Next.js renders as a 500 — and the 401 path
  // is unaffected by the guard that makes that true.
  describe("fails closed on any unexpected error", () => {
    it("returns 503 when the tagSource getter throws", async () => {
      const dependencies = deps();
      defineTagSource(dependencies, () => {
        throw new Error("TAGGING_PROVIDER must be aily or field-shortcut");
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "service_unavailable",
        source: "unexpected",
        reason: "TAGGING_PROVIDER must be aily or field-shortcut",
      });
      expect(dependencies.tag).toHaveBeenCalledTimes(0);
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });

    it("still returns 401 when unauthorized, even though the tagSource getter would throw", async () => {
      const dependencies = deps();
      defineTagSource(dependencies, () => {
        throw new Error("TAGGING_PROVIDER must be aily or field-shortcut");
      });

      // No Authorization header at all. The catch-all now wraps the auth check
      // too (dependencies.cronSecret is itself a throwing getter in
      // production), so this asserts the wrapping did not turn a 401 into a
      // 503 or let anything downstream run first.
      const response = await createAnalyzeRoute(dependencies)(request());

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(dependencies.listPending).toHaveBeenCalledTimes(0);
      expect(dependencies.tag).toHaveBeenCalledTimes(0);
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });

    // tag() gets no try of its own on purpose: the providers hold a
    // never-throw contract (Tasks 6/7) and a dedicated catch would absorb a
    // break in it silently. The catch-all covers it as a backstop only.
    it("returns 503 when tag() breaks its never-throw contract", async () => {
      const dependencies = deps({
        tag: vi.fn(async () => {
          throw new Error("provider contract broken");
        }),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "service_unavailable",
        source: "unexpected",
        reason: "provider contract broken",
      });
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });

    it("returns 503 when listPending resolves to something that is not a shard", async () => {
      const dependencies = deps({
        // A resolved-but-wrong value throws on records.map, well past every
        // read a per-read try block would have been placed around.
        listPending: vi.fn(async () => "not-a-shard" as never),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "service_unavailable",
        source: "unexpected",
      });
      expect(dependencies.tag).toHaveBeenCalledTimes(0);
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });

    it("returns 503 when a field of a listed record cannot be read", async () => {
      const poisoned = pendingRecord({ recordId: "rec1", state: "待分析" });
      Object.defineProperty(poisoned, "content", {
        get() {
          throw new Error("content decode failed");
        },
        configurable: true,
      });
      const dependencies = deps({
        listPending: vi.fn(async () => [poisoned]),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "service_unavailable",
        source: "unexpected",
        reason: "content decode failed",
      });
      expect(dependencies.tag).toHaveBeenCalledTimes(0);
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });

    it("returns 503 rather than 500 when the thrown value cannot be stringified", async () => {
      const dependencies = deps({
        tag: vi.fn(async () => {
          // A prototype-less value: String(value) raises TypeError of its
          // own, so a catch-all that formatted the error naively would throw
          // from inside its own catch block and 500 anyway.
          const opaque: unknown = Object.create(null);
          throw opaque;
        }),
      });

      const response = await createAnalyzeRoute(dependencies)(
        request({ authorization: "Bearer s3cret" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "service_unavailable",
        source: "unexpected",
        reason: "unreadable error",
      });
      expect(dependencies.updateRecord).toHaveBeenCalledTimes(0);
    });
  });
});

// I6: the field-shortcut (B) track's replies are parseReplyText's re-parse of
// whatever prose Bitable's own AI field shortcut already wrote into AI 回复
// 话术 (see readFieldShortcutRows below) — not freshly generated text. A
// shortcut cell that doesn't match "【语气】正文" parses to result.replies = []
// even though the cell itself holds real text. Before this fix, the same
// updateRecord call that advanced the record's 流程状态 also re-serialized
// that [] and overwrote the column with "", destroying the AI's actual
// output. The aily (A) track generates replies itself (never re-parses an
// existing column), so an empty result there is a genuine "no reply" and
// must still be written.
describe("B-track replies must not clobber unparsed AI prose", () => {
  it("omits AI 回复话术 from the update payload when the field-shortcut track's reply text failed to parse", async () => {
    const dependencies = deps({
      tagSource: "field-shortcut",
      tag: vi.fn(async () => [
        {
          kind: "tagged" as const,
          result: {
            recordId: "rec1",
            sentiment: ["失望"],
            polarity: "差评" as const,
            dimensions: ["维修时间"] as const,
            summary: "等待三天",
            // Stands in for parseReplyText("散文，不是【语气】正文格式") — the
            // provider already dropped the unparseable segment upstream of
            // this route.
            replies: [] as const,
          },
        },
      ]),
    });

    const response = await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    expect(response.status).toBe(200);
    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields).not.toHaveProperty("AI 回复话术");
    // The rest of the write must be unaffected.
    expect(fields["情绪极性"]).toBe("差评");
    expect(fields["流程状态"]).toBe("待跟进");
  });

  it("writes AI 回复话术 normally when the field-shortcut track parses a well-formed reply", async () => {
    const dependencies = deps({
      tagSource: "field-shortcut",
      tag: vi.fn(async () => [
        {
          kind: "tagged" as const,
          result: {
            recordId: "rec1",
            sentiment: ["失望"],
            polarity: "差评" as const,
            dimensions: ["维修时间"] as const,
            summary: "等待三天",
            replies: [{ tone: "致歉安抚", text: "抱歉" }],
          },
        },
      ]),
    });

    await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields).toHaveProperty("AI 回复话术");
    expect(fields["AI 回复话术"]).toContain("致歉安抚");
  });

  it("still writes an empty AI 回复话术 for the aily track when the model genuinely returns no reply", async () => {
    const dependencies = deps({
      tagSource: "aily:skill_x@1700000000000",
      tag: vi.fn(async () => [
        {
          kind: "tagged" as const,
          result: {
            recordId: "rec1",
            sentiment: ["失望"],
            polarity: "差评" as const,
            dimensions: ["维修时间"] as const,
            summary: "等待三天",
            replies: [] as const,
          },
        },
      ]),
    });

    await createAnalyzeRoute(dependencies)(
      request({ authorization: "Bearer s3cret" }),
    );

    const [, fields] = dependencies.updateRecord.mock.calls[0];
    expect(fields).toHaveProperty("AI 回复话术", "");
  });
});

describe("route exports", () => {
  // Vercel Cron Jobs always invoke their target with an HTTP GET, never a
  // POST (per vercel.com/docs/cron-jobs), and vercel.json's crons entry has
  // no field to change that. A POST-only export would pass every test above
  // — none of them send a GET — and still 405 the moment the real Cron
  // fires. Both verbs must resolve to the exact same handler.
  it("wires GET to the same handler as POST", () => {
    expect(GET).toBe(POST);
  });
});

function pendingRecord(overrides: Record<string, unknown> = {}) {
  return {
    recordId: "rec1",
    recordNumber: "VOC-0001",
    feedbackAt: "2026-01-20T00:00:00.000Z",
    channel: "电商评价",
    category: "冰箱",
    content: "内容",
    rating: 2,
    state: "分析失败" as const,
    retryCount: 0,
    // Default added for Task 7's escalation gate — none of buildPendingShard's
    // own tests care about this column, so it gets the value that means "no
    // group yet" and every existing call site below keeps working unchanged.
    warRoomChatId: "",
    engineerOpenIds: [],
    engineerNames: [],
    dispatchedAt: null,
    followUpNote: "",
    closingNote: "",
    sourceTicketNo: "CAS-42567239-Q7Q8Q",
    userRef: "U-3878645B",
    deviceRef: "D-91C2A70E",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ...overrides,
  };
}

describe("buildPendingShard", () => {
  // Before this fix, 分析失败 -> 重试 -> 待分析 (and its retryCount < 3 guard)
  // was dead code: nothing in the repo ever called it. These tests exercise
  // the real transition(), not a re-implemented numeric comparison.
  it("returns pending unchanged once it already fills the shard", () => {
    const pending = [pendingRecord({ recordId: "p1", state: "待分析" })];
    const failedCandidates = [pendingRecord({ recordId: "f1", retryCount: 1 })];

    expect(buildPendingShard(pending, failedCandidates, 1)).toEqual(pending);
  });

  it("resets a retry-eligible 分析失败 record to 待分析 to fill a remaining slot", () => {
    const pending = [pendingRecord({ recordId: "p1", state: "待分析" })];
    const failedCandidates = [
      pendingRecord({ recordId: "f1", state: "分析失败", retryCount: 1 }),
    ];

    const shard = buildPendingShard(pending, failedCandidates, 2);

    expect(shard).toHaveLength(2);
    expect(shard[1]).toMatchObject({ recordId: "f1", state: "待分析" });
  });

  it("leaves a record at the retry ceiling out of the shard entirely", () => {
    const failedCandidates = [
      pendingRecord({ recordId: "f1", state: "分析失败", retryCount: 3 }),
    ];

    expect(buildPendingShard([], failedCandidates, 5)).toEqual([]);
  });

  it("stops filling once the shard is full even with more eligible candidates", () => {
    const failedCandidates = [
      pendingRecord({ recordId: "f1", state: "分析失败", retryCount: 0 }),
      pendingRecord({ recordId: "f2", state: "分析失败", retryCount: 0 }),
    ];

    const shard = buildPendingShard([], failedCandidates, 1);

    expect(shard).toHaveLength(1);
    expect(shard[0]).toMatchObject({ recordId: "f1", state: "待分析" });
  });
});

// A complete VocRecord, used only to satisfy escalateToWarRoom's parameter
// type below — the one test here never reads any of its fields, because an
// empty fallbackOpenIds list returns before the function does anything with
// `record` at all.
const fullVocRecord: VocRecord = {
  recordId: "rec1",
  recordNumber: "VOC-0001",
  channel: "电商评价",
  category: "冰箱",
  model: "",
  content: "内容",
  rating: null,
  feedbackAt: null,
  state: "待跟进",
  polarity: "差评",
  dimensions: ["维修时间"],
  summary: "摘要",
  replies: [],
  severity: "高",
  ownerOpenIds: ["ou_owner"],
  ownerNames: ["张三"],
  retryCount: 0,
  ticketOpenedAt: null,
  closedAt: null,
  warRoomChatId: "",
  engineerOpenIds: [],
  engineerNames: [],
  dispatchedAt: null,
  followUpNote: "",
  closingNote: "",
  sourceTicketNo: "CAS-42567239-Q7Q8Q",
  userRef: "U-3878645B",
  deviceRef: "D-91C2A70E",
  sourceUrl: "",
  sourceDetail: "400投诉",
  businessUnit: "冰冷事业部",
  categoryLevel1: "安装调试",
};

// A complete TagResult, used the same way fullVocRecord is above — only to
// satisfy escalateToWarRoom's parameter type for the one test that never
// reads it.
const fullTagResult = {
  recordId: "rec1",
  sentiment: ["失望"],
  polarity: "差评" as const,
  dimensions: ["维修时间"] as const,
  summary: "摘要",
  replies: [],
};

describe("escalateToWarRoom", () => {
  // The one branch that is safe to exercise without a fake fetcher: spec
  // §3.1's "no fallback resolves" case must return before ever calling
  // readBotEnv() or sendFeishuMessage, so this cannot fail on missing bot
  // credentials in this test environment — it never reaches that code at all.
  it("resolves without sending or throwing when no fallback approver resolves", async () => {
    await expect(
      escalateToWarRoom({
        record: fullVocRecord,
        tag: fullTagResult,
        severity: "高",
        fallbackOpenIds: [],
      }),
    ).resolves.toBeUndefined();
  });
});

// fallbackOwnerOpenIds is Task 7's one real piece of logic in the escalation
// path — "no fallback resolves" (spec §3.1's silent no-op) depends entirely
// on this returning an empty array, so it gets the same isolated coverage
// parseOwnerRules below already has.
describe("fallbackOwnerOpenIds", () => {
  it("keeps only rows with 兜底 checked", () => {
    expect(
      fallbackOwnerOpenIds([
        { scope: "电商评价", openId: "ou_a", fallback: false },
        { scope: "", openId: "ou_b", fallback: true },
      ]),
    ).toEqual(["ou_b"]);
  });

  it("deduplicates repeated open ids", () => {
    expect(
      fallbackOwnerOpenIds([
        { scope: "电商评价", openId: "ou_b", fallback: true },
        { scope: "社媒", openId: "ou_b", fallback: true },
      ]),
    ).toEqual(["ou_b"]);
  });

  it("drops a fallback row with a blank open id", () => {
    // parseOwnerRules already defaults openId to "" when nobody is assigned;
    // a blank fallback approver is a configuration gap, not a recipient.
    expect(
      fallbackOwnerOpenIds([{ scope: "", openId: "", fallback: true }]),
    ).toEqual([]);
  });

  it("returns an empty array when nobody has 兜底 checked", () => {
    expect(
      fallbackOwnerOpenIds([
        { scope: "电商评价", openId: "ou_a", fallback: false },
      ]),
    ).toEqual([]);
  });
});

describe("parseOwnerRules", () => {
  // listOwnerRules' raw fetch was previously exercised only by the live Base
  // round-trip. This is the mapping that fetch feeds, tested in isolation.
  it("maps scope/openId/fallback from raw Bitable items", () => {
    expect(
      parseOwnerRules([
        { fields: { 负责范围: "电商评价/冰箱", 负责人: [{ id: "ou_a" }], 兜底: false } },
        { fields: { 负责范围: "", 负责人: [{ id: "ou_b" }], 兜底: true } },
      ]),
    ).toEqual([
      { scope: "电商评价/冰箱", openId: "ou_a", fallback: false },
      { scope: "", openId: "ou_b", fallback: true },
    ]);
  });

  it("defaults openId to an empty string when nobody is assigned", () => {
    expect(
      parseOwnerRules([{ fields: { 负责范围: "APP", 负责人: [], 兜底: false } }]),
    ).toEqual([{ scope: "APP", openId: "", fallback: false }]);
  });

  it("drops malformed items instead of throwing", () => {
    expect(parseOwnerRules([null, "x", 42, {}, { fields: null }])).toEqual([]);
  });
});

const ownerBitableEnv = {
  appToken: "bascn_demo",
  vocTableId: "tblvoc",
  ownerTableId: "tblowner",
};
const ownerToken = async () => "t1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Fetch-level coverage for listOwnerRules, mirroring the fetcher-injection
// pattern client.test.ts already uses for createBitableClient — bitableEnv
// and token are passed in directly (not read from process.env or a module
// singleton), so this needs no real env vars and no live Base call. Behavior
// asserted here is exactly what the function already did; nothing here
// changes what a non-zero code, a malformed response, or a rejecting
// fetcher does.
describe("listOwnerRules", () => {
  it("builds the URL from app_token and the owner table id with an Authorization header and a timeout signal", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { items: [] } }),
    );

    await listOwnerRules(
      ownerBitableEnv,
      ownerToken,
      fetcher as unknown as typeof fetch,
    );

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/bitable/v1/apps/bascn_demo/tables/tblowner/records?user_id_type=open_id&page_size=100",
    );
    expect(init?.headers).toMatchObject({ Authorization: "Bearer t1" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the parsed rules from a successful response", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        code: 0,
        data: {
          items: [
            { fields: { 负责范围: "APP", 负责人: [{ id: "ou_a" }], 兜底: false } },
          ],
        },
      }),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).resolves.toEqual([{ scope: "APP", openId: "ou_a", fallback: false }]);
  });

  it("drops a non-object item in the response instead of throwing", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        code: 0,
        data: {
          items: [
            null,
            { fields: { 负责范围: "门店", 负责人: [{ id: "ou_b" }], 兜底: true } },
          ],
        },
      }),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).resolves.toEqual([{ scope: "门店", openId: "ou_b", fallback: true }]);
  });

  it("throws when the business code is non-zero", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 99991663, msg: "forbidden" }),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).rejects.toThrow(/99991663/);
  });

  it("throws with an unknown code when the payload is not an object", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse([]),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).rejects.toThrow(/unknown/);
  });

  it("treats a response with no data as an empty list instead of throwing", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0 }),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).resolves.toEqual([]);
  });

  it("treats a non-array items field as an empty list instead of throwing", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { items: "not-an-array" } }),
    );

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).resolves.toEqual([]);
  });

  it("propagates a rejection when the fetcher itself throws", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw new Error("network down");
    });

    await expect(
      listOwnerRules(ownerBitableEnv, ownerToken, fetcher as unknown as typeof fetch),
    ).rejects.toThrow("network down");
  });
});

const shortcutBitableEnv = {
  appToken: "bascn_demo",
  vocTableId: "tblvoc",
  ownerTableId: "tblowner",
};
const shortcutToken = async () => "t1";

// I5: readFieldShortcutRows previously used a bare fetch that checked neither
// response.ok nor payload.code !== 0 — every sibling read in this file
// (listOwnerRules above, BitableClient.listRecords/updateRecord) checks both.
// A non-2xx status or non-zero business code (rate limit 1254005, an expired
// token, a permission change) has no `data.record`, so the row decoded as all
// blanks. That blank row then failed downstream tag-payload validation with
// "polarity 不在枚举内：" — a misdiagnosis that points an operator at the AI
// model for what was actually a failed API call, while also burning one of
// the record's limited retries. bitableEnv/token/fetcher are explicit
// parameters (mirroring listOwnerRules) so this is testable without a live
// Base call.
describe("readFieldShortcutRows", () => {
  it("builds the per-record URL with an Authorization header and a timeout signal", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { record: { fields: {} } } }),
    );

    await readFieldShortcutRows(
      shortcutBitableEnv,
      shortcutToken,
      ["rec1"],
      fetcher as unknown as typeof fetch,
    );

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/bitable/v1/apps/bascn_demo/tables/tblvoc/records/rec1?user_id_type=open_id",
    );
    expect(init?.headers).toMatchObject({ Authorization: "Bearer t1" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps a well-formed response to a FieldShortcutRow, including parsed replies", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        code: 0,
        data: {
          record: {
            fields: {
              情绪标签: ["着急"],
              情绪极性: "差评",
              问题维度: ["维修时间"],
              "AI 摘要": "上门太慢",
              "AI 回复话术": "【致歉安抚】抱歉",
            },
          },
        },
      }),
    );

    const rows = await readFieldShortcutRows(
      shortcutBitableEnv,
      shortcutToken,
      ["rec1"],
      fetcher as unknown as typeof fetch,
    );

    expect(rows).toEqual([
      {
        recordId: "rec1",
        sentiment: ["着急"],
        polarity: "差评",
        dimensions: ["维修时间"],
        summary: "上门太慢",
        replies: [{ tone: "致歉安抚", text: "抱歉" }],
      },
    ]);
  });

  it("throws with the real Bitable code when the business code is non-zero, instead of decoding a blank row", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 1254005, msg: "too many requests" }),
    );

    await expect(
      readFieldShortcutRows(
        shortcutBitableEnv,
        shortcutToken,
        ["rec1"],
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/1254005/);
  });

  it("throws with an unknown code when the payload is not an object", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse([]),
    );

    await expect(
      readFieldShortcutRows(
        shortcutBitableEnv,
        shortcutToken,
        ["rec1"],
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/unknown/);
  });

  it("throws when the HTTP response is not ok, even if the body parses as JSON", async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ code: 0, data: {} }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(
      readFieldShortcutRows(
        shortcutBitableEnv,
        shortcutToken,
        ["rec1"],
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/500/);
  });

  it("reads the token exactly once for a multi-record batch", async () => {
    const token = vi.fn(async () => "t1");
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: 0, data: { record: { fields: {} } } }),
    );

    await readFieldShortcutRows(
      shortcutBitableEnv,
      token,
      ["rec1", "rec2"],
      fetcher as unknown as typeof fetch,
    );

    expect(token).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("propagates a rejection when the fetcher itself throws", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw new Error("network down");
    });

    await expect(
      readFieldShortcutRows(
        shortcutBitableEnv,
        shortcutToken,
        ["rec1"],
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow("network down");
  });
});

describe("resolveTagSource", () => {
  it("returns the literal field-shortcut for the B track", () => {
    expect(resolveTagSource({ provider: "field-shortcut" })).toBe(
      "field-shortcut",
    );
  });

  it("formats aily:<skill_id>@<batch> for the A track", () => {
    expect(
      resolveTagSource(
        {
          provider: "aily",
          ailyAppId: "spring_x",
          taggingSkillId: "skill_x",
          answerSkillId: "skill_answer_x",
          credential: null,
        },
        () => 1700000000000,
      ),
    ).toBe("aily:skill_x@1700000000000");
  });
});
