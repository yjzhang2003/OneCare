import { afterEach, describe, expect, it, vi } from "vitest";

import { createDashboardRoute, getVocDashboardMetrics } from "./route";

afterEach(() => {
  vi.restoreAllMocks();
});

const records = [
  {
    recordId: "rec1",
    channel: "电商评价",
    category: "冰箱",
    content: "我的手机号是保密的，等了三天",
    rating: 2,
    state: "已闭环" as const,
    polarity: "差评" as const,
    dimensions: ["维修时间"] as const,
    ownerOpenIds: ["ou_owner"],
    retryCount: 0,
    ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    closedAt: "2026-01-24T02:00:00.000Z",
  },
];

describe("createDashboardRoute", () => {
  it("returns aggregate numbers", async () => {
    const route = createDashboardRoute({
      listAll: vi.fn(async () => records),
      manualMinutesPerRecord: 4,
    });

    const body = (await (await route()).json()) as Record<string, unknown>;

    expect(body).toMatchObject({ total: 1, ticketsClosed: 1 });
    expect(body.effort).toEqual({
      taggedRecords: 1,
      manualMinutesPerRecord: 4,
      savedHours: expect.any(Number),
    });
  });

  it("never leaks raw VOC content", async () => {
    const route = createDashboardRoute({
      listAll: vi.fn(async () => records),
    });

    const raw = await (await route()).text();

    expect(raw).not.toContain("等了三天");
    expect(raw).not.toContain("原始内容");
    expect(raw).not.toContain("rec1");
  });

  it("returns 503 when the Base cannot be read", async () => {
    const route = createDashboardRoute({
      listAll: vi.fn(async () => {
        throw new Error("bitable down");
      }),
    });

    expect((await route()).status).toBe(503);
  });
});

describe("getVocDashboardMetrics", () => {
  // This is the function the home page and the dashboard page call directly,
  // with no try/catch of their own — a build-breaking regression here (task
  // 14 fix round 1: a bad FEISHU_BITABLE_APP_TOKEN or FEISHU_APP_SECRET took
  // down `next build` for "/" itself, not just the dashboard) would not show
  // up in createDashboardRoute's own tests above, since that route already
  // had its own try/catch. This must never throw. `readRecords` here mirrors
  // the `{ ok: true | false }` shape readVocRecordsCached itself resolves to
  // (never a rejection) — the same shape production wiring's `listAll`
  // adapter and getVocDashboardMetrics both consume.
  it("resolves ok with real numbers when the read succeeds", async () => {
    const readRecords = vi.fn(async () => ({ ok: true as const, records }));

    const result = await getVocDashboardMetrics(readRecords);

    expect(result).toEqual({
      status: "ok",
      metrics: expect.objectContaining({ total: 1, ticketsClosed: 1 }),
    });
  });

  it("resolves unavailable instead of throwing when the read fails", async () => {
    const readRecords = vi.fn(async () => ({ ok: false as const }));

    await expect(getVocDashboardMetrics(readRecords)).resolves.toEqual({
      status: "unavailable",
    });
  });
});
