import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../../../../../../src/features/bitable/field-map";
import { RETRY_CEILING } from "../../../../../../src/features/voc/service-event";
import { createTicketAnalyzeRoute } from "./route";

function record(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec1",
    recordNumber: "VOC-001",
    feedbackAt: "2026-08-12T08:00:00.000Z",
    channel: "电商评价",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "报修后等了三天没人上门",
    rating: 2,
    polarity: null,
    dimensions: [],
    summary: "",
    replies: [],
    severity: null,
    state: "待分析",
    ownerNames: [],
    ownerOpenIds: [],
    retryCount: 0,
    warRoomChatId: "",
    sourceTicketNo: "CAS-1",
    userRef: "U-A",
    deviceRef: "D-A",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ticketOpenedAt: null,
    closedAt: null,
    ...overrides,
  };
}

// The shard's own response shape, as far as this route reads it.
function shard(
  counts: Partial<{
    tagged: number;
    failed: number;
    writeErrors: number;
  }>,
  status = 200,
) {
  return new Response(
    JSON.stringify({ processed: 1, tagged: 0, failed: 0, writeErrors: 0, ...counts }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function route(
  overrides: Partial<Parameters<typeof createTicketAnalyzeRoute>[0]> = {},
) {
  const analyze = vi.fn(async () => shard({ tagged: 1 }));
  const revalidate = vi.fn();
  const dependencies = {
    session: async () => ({ openId: "ou_operator", name: "运营" }),
    getRecord: async () => record(),
    analyze,
    revalidate,
    ...overrides,
  };
  return {
    analyze,
    revalidate,
    post: createTicketAnalyzeRoute(dependencies),
  };
}

function call(post: ReturnType<typeof createTicketAnalyzeRoute>, recordId = "rec1") {
  return post(new Request("https://example.com", { method: "POST" }), {
    params: Promise.resolve({ recordId }),
  });
}

describe("ticket analyze route", () => {
  it("tags the record and expires the cached reads", async () => {
    const { post, analyze, revalidate } = route();

    const response = await call(post);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      tagged: true,
      message: "AI 分析完成，打标结果已回写",
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  // The pipeline can only start from 待分析. A 分析失败 record is presented to it as
  // 待分析 — in memory only, exactly as the Cron path's buildPendingShard does — so the
  // one write reflects wherever tagging actually lands the record.
  it("hands a failed record to the pipeline as 待分析", async () => {
    const { post, analyze } = route({
      getRecord: async () => record({ state: "分析失败", retryCount: 1 }),
    });

    await call(post);

    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({ state: "分析失败" }),
      "待分析",
    );
  });

  it("refuses a record that has used up its retries, without calling the pipeline", async () => {
    const { post, analyze, revalidate } = route({
      getRecord: async () =>
        record({ state: "分析失败", retryCount: RETRY_CEILING }),
    });

    const response = await call(post);

    expect(response.status).toBe(422);
    expect((await response.json()).message).toContain(
      `重试次数已达上限 ${RETRY_CEILING}`,
    );
    expect(analyze).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  // A browser can post whatever it likes; the refusal that counts is this one. The
  // button is hidden for an already-tagged record, and a request for one is still
  // turned away rather than overwriting a human's follow-up work.
  it("refuses an already-tagged record even though the UI hides the button", async () => {
    const { post, analyze } = route({
      getRecord: async () => record({ state: "跟进中" }),
    });

    const response = await call(post);

    expect(response.status).toBe(422);
    expect(analyze).not.toHaveBeenCalled();
  });

  // The pipeline ran and recorded why it could not produce a result. That is not a
  // failed request — the record now carries a 失败原因 — but it is not a success
  // either, so `tagged` says which and the workbench shows a warning.
  it("reports a failed analysis as a completed run that produced no tags", async () => {
    const { post, revalidate } = route({
      analyze: async () => shard({ failed: 1 }),
    });

    const response = await call(post);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      tagged: false,
      message: "AI 分析失败，失败原因已记录在工单上",
    });
    // The record changed — 失败原因, 重试次数, 打标来源 — so the cached reads are stale.
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  // A write that did not land must never be reported as a success, and must not expire
  // a cache entry that is still correct.
  it("reports a failed write as a failure and leaves the cache alone", async () => {
    const { post, revalidate } = route({
      analyze: async () => shard({ tagged: 1, writeErrors: 1 }),
    });

    const response = await call(post);

    expect(response.status).toBe(502);
    expect((await response.json()).message).toBe("分析完成但写入失败，请稍后重试");
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("turns the shard's own refusal into something retryable", async () => {
    const { post, revalidate } = route({
      analyze: async () =>
        new Response(JSON.stringify({ error: "unavailable", source: "ownerRules" }), {
          status: 503,
        }),
    });

    const response = await call(post);

    expect(response.status).toBe(503);
    expect((await response.json()).message).toBe("打标服务暂时不可用，请稍后重试");
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller before reading anything", async () => {
    const getRecord = vi.fn();
    const { post } = route({ session: async () => null, getRecord });

    const response = await call(post);

    expect(response.status).toBe(401);
    expect(getRecord).not.toHaveBeenCalled();
  });

  it("answers 404 for a record that is gone", async () => {
    const { post, analyze } = route({ getRecord: async () => null });

    const response = await call(post);

    expect(response.status).toBe(404);
    expect(analyze).not.toHaveBeenCalled();
  });

  // A 23-second aily call has more ways to throw than this route can enumerate, and an
  // uncaught one would reach the browser as an opaque 500 behind a spinner that never
  // resolves.
  it("turns an unexpected throw into a legible failure", async () => {
    const { post } = route({
      analyze: async () => {
        throw new Error("aily gateway 504");
      },
    });

    const response = await call(post);

    expect(response.status).toBe(500);
    expect((await response.json()).message).toBe("服务暂时不可用，请稍后重试");
  });
});
