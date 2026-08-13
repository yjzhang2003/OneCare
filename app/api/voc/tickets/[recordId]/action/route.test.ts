import { describe, expect, test, vi } from "vitest";

import type { VocRecord } from "../../../../../../src/features/bitable/field-map";
import { createTicketActionRoute } from "./route";

const NOW = 1_770_000_000_000;
const OWNER = "ou_owner";

function record(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec1",
    recordNumber: "VOC-000001",
    channel: "400 客服",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "制冷不足",
    rating: 2,
    feedbackAt: "2026-01-24T00:00:00.000Z",
    state: "待跟进",
    polarity: "差评",
    dimensions: ["产品质量"],
    summary: "用户反馈冷藏室不制冷",
    replies: [],
    severity: "中",
    ownerOpenIds: [OWNER],
    ownerNames: ["张禹健"],
    retryCount: 0,
    ticketOpenedAt: null,
    closedAt: null,
    warRoomChatId: "",
    sourceTicketNo: "CAS-42567239-Q7Q8Q",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ...overrides,
  };
}

function route(
  overrides: Partial<{
    user: { openId: string; name: string } | null;
    found: VocRecord | null;
    updateRecord: (id: string, fields: Record<string, unknown>) => Promise<void>;
  }> = {},
) {
  const updateRecord = vi.fn(
    overrides.updateRecord ?? (async () => undefined),
  );
  const revalidate = vi.fn();
  const handler = createTicketActionRoute({
    session: async () =>
      overrides.user === undefined
        ? { openId: OWNER, name: "张禹健" }
        : overrides.user,
    getRecord: async () =>
      overrides.found === undefined ? record() : overrides.found,
    updateRecord,
    revalidate,
    now: () => NOW,
  });
  return { handler, updateRecord, revalidate };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/voc/tickets/rec1/action", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ recordId: "rec1" }) };

describe("ticket action route — gating", () => {
  // The Base read must not happen for an anonymous caller: this endpoint writes,
  // and an unauthenticated request should cost nothing and reveal nothing.
  test("401 before touching the record", async () => {
    const getRecord = vi.fn(async () => record());
    const handler = createTicketActionRoute({
      session: async () => null,
      getRecord,
      updateRecord: async () => undefined,
      revalidate: () => {},
      now: () => NOW,
    });

    const response = await handler(
      post({ kind: "transition", action: "开始跟进", seenState: "待跟进" }),
      params,
    );

    expect(response.status).toBe(401);
    expect(getRecord).not.toHaveBeenCalled();
  });

  test("403 for a non-owner, with nothing written", async () => {
    const { handler, updateRecord } = route({
      user: { openId: "ou_stranger", name: "路人" },
    });

    const response = await handler(
      post({ kind: "transition", action: "开始跟进", seenState: "待跟进" }),
      params,
    );

    expect(response.status).toBe(403);
    expect(updateRecord).not.toHaveBeenCalled();
  });
});

describe("ticket action route — request validation", () => {
  test.each([
    ["a missing body", null],
    ["an unknown kind", { kind: "delete", seenState: "待跟进" }],
    ["an action outside WORKBENCH_ACTIONS", { kind: "transition", action: "打标成功", seenState: "待跟进" }],
    ["a state outside VOC_STATES", { kind: "transition", action: "开始跟进", seenState: "瞎编的" }],
    ["no seenState at all", { kind: "transition", action: "开始跟进" }],
  ])("400 for %s", async (_label, body) => {
    const { handler, updateRecord } = route();
    const response = await handler(post(body), params);
    expect(response.status).toBe(400);
    expect(updateRecord).not.toHaveBeenCalled();
  });

  // 打标成功 is a real VocAction the state machine would happily apply; it is
  // rejected because it is not a person's to perform, and that rejection has to
  // live at the wire boundary rather than relying on the UI not offering it.
  test("the tagging pipeline's actions cannot be driven over HTTP", async () => {
    const { handler, updateRecord } = route({ found: record({ state: "待分析" }) });
    const response = await handler(
      post({ kind: "transition", action: "打标成功", seenState: "待分析" }),
      params,
    );
    expect(response.status).toBe(400);
    expect(updateRecord).not.toHaveBeenCalled();
  });
});

describe("ticket action route — outcomes", () => {
  test("404 when the record is gone", async () => {
    const { handler } = route({ found: null });
    const response = await handler(
      post({ kind: "transition", action: "开始跟进", seenState: "待跟进" }),
      params,
    );
    expect(response.status).toBe(404);
  });

  test("409 when the record moved under the operator", async () => {
    const { handler, updateRecord } = route({ found: record({ state: "跟进中" }) });
    const response = await handler(
      post({ kind: "transition", action: "开始跟进", seenState: "待跟进" }),
      params,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ actual: "跟进中" });
    expect(updateRecord).not.toHaveBeenCalled();
  });

  test("422 when the state machine refuses", async () => {
    const { handler, updateRecord } = route({ found: record({ state: "待闭环" }) });
    const response = await handler(
      post({ kind: "transition", action: "确认闭环", seenState: "待闭环", note: " " }),
      params,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ message: "闭环结论不能为空" });
    expect(updateRecord).not.toHaveBeenCalled();
  });

  test("200 and the written fields on a legal transition", async () => {
    const { handler, updateRecord } = route();
    const response = await handler(
      post({ kind: "transition", action: "开始跟进", seenState: "待跟进" }),
      params,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: "已流转到「跟进中」",
      state: "跟进中",
    });
    expect(updateRecord).toHaveBeenCalledWith("rec1", { 流程状态: "跟进中" });
  });

  // The cached reads behind the workbench are otherwise time-based, so without
  // this the operator gets a success toast over a row that still shows the old
  // state for as long as the cache window lasts.
  test("a landed write invalidates the cached reads", async () => {
    const { handler, revalidate } = route();
    await handler(
      post({ kind: "transition", action: "开始跟进", seenState: "待跟进" }),
      params,
    );
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["a refusal", { kind: "transition", action: "开始跟进", seenState: "跟进中" }],
    ["a noop", { kind: "claim", seenState: "待跟进" }],
  ])("nothing is invalidated on %s", async (_label, body) => {
    const { handler, revalidate } = route();
    await handler(post(body), params);
    expect(revalidate).not.toHaveBeenCalled();
  });

  // Dropping a good cache entry on behalf of a write that then failed would
  // make an outage cost a cold read on every subsequent page view.
  test("nothing is invalidated when the write fails", async () => {
    const { handler, revalidate } = route({
      updateRecord: async () => {
        throw new Error("bitable down");
      },
    });
    await handler(
      post({ kind: "transition", action: "开始跟进", seenState: "待跟进" }),
      params,
    );
    expect(revalidate).not.toHaveBeenCalled();
  });

  test("200 and the owner column on a claim", async () => {
    const { handler, updateRecord } = route({
      user: { openId: "ou_newcomer", name: "新人" },
      found: record({ ownerOpenIds: [], ownerNames: [] }),
    });
    const response = await handler(
      post({ kind: "claim", seenState: "待跟进" }),
      params,
    );
    expect(response.status).toBe(200);
    expect(updateRecord).toHaveBeenCalledWith("rec1", {
      负责人: [{ id: "ou_newcomer" }],
    });
  });

  // A failed write must be distinguishable from a refused one: the operator's
  // click was legal and simply did not land, so repeating it is the right move.
  test("502 when the Base write throws", async () => {
    const { handler } = route({
      updateRecord: async () => {
        throw new Error("bitable down");
      },
    });
    const response = await handler(
      post({ kind: "transition", action: "开始跟进", seenState: "待跟进" }),
      params,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "write_failed" });
  });

  test("a read failure is a 500, not an unhandled rejection", async () => {
    const handler = createTicketActionRoute({
      session: async () => ({ openId: OWNER, name: "张禹健" }),
      getRecord: async () => {
        throw new Error("bitable down");
      },
      updateRecord: async () => undefined,
      revalidate: () => {},
      now: () => NOW,
    });
    const response = await handler(
      post({ kind: "transition", action: "开始跟进", seenState: "待跟进" }),
      params,
    );
    expect(response.status).toBe(500);
  });
});
