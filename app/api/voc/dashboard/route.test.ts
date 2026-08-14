import { afterEach, describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../../../../src/features/bitable/field-map";
import { createDashboardRoute, getVocDashboardMetrics } from "./route";

afterEach(() => {
  vi.restoreAllMocks();
});

function authenticatedSession() {
  return async () => ({ openId: "ou_operator", name: "运营" });
}

const records: readonly VocRecord[] = [
  {
    recordId: "rec1",
    recordNumber: "VOC-0001",
    channel: "电商评价",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "我的手机号是保密的，等了三天",
    rating: 2,
    feedbackAt: "2026-01-23T01:00:00.000Z",
    state: "已闭环",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "工程师上门维修耗时较长",
    replies: [],
    severity: "高",
    ownerOpenIds: ["ou_owner"],
    ownerNames: ["李工"],
    retryCount: 0,
    ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    closedAt: "2026-01-24T02:00:00.000Z",
    warRoomChatId: "",
    engineerOpenIds: [],
    engineerNames: [],
    dispatchedAt: null,
    sourceTicketNo: "CAS-42567239-Q7Q8Q",
    userRef: "U-3878645B",
    deviceRef: "D-91C2A70E",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
  },
];

describe("createDashboardRoute", () => {
  it("returns aggregate numbers and ticket detail for a signed-in caller", async () => {
    const route = createDashboardRoute({
      listAll: vi.fn(async () => records),
      session: authenticatedSession(),
      manualMinutesPerRecord: 4,
    });

    const body = (await (await route()).json()) as Record<string, unknown>;

    expect(body).toMatchObject({ total: 1, ticketsClosed: 1 });
    expect(body.effort).toEqual({
      taggedRecords: 1,
      manualMinutesPerRecord: 4,
      savedHours: expect.any(Number),
    });
    // The gated response is now allowed to carry per-ticket detail — that is
    // exactly why an unauthenticated caller must never reach it (see the
    // "never leaks" test below).
    expect(body.tickets).toEqual([
      expect.objectContaining({ recordNumber: "VOC-0001", content: records[0].content }),
    ]);
  });

  it("never leaks ticket detail to a caller without a session", async () => {
    const listAll = vi.fn(async () => records);
    const route = createDashboardRoute({
      listAll,
      session: async () => null,
    });

    const response = await route();
    const raw = await response.text();

    expect(response.status).toBe(401);
    expect(listAll).not.toHaveBeenCalled();
    expect(raw).not.toContain("等了三天");
    expect(raw).not.toContain("rec1");
  });

  it("returns 503 when the Base cannot be read", async () => {
    const route = createDashboardRoute({
      listAll: vi.fn(async () => {
        throw new Error("bitable down");
      }),
      session: authenticatedSession(),
    });

    expect((await route()).status).toBe(503);
  });
});

describe("dashboard route session gate", () => {
  it("returns 401 without a session and never reads the Base", async () => {
    const listAll = vi.fn(async () => []);
    const route = createDashboardRoute({
      listAll,
      session: async () => null,
    });

    const response = await route();

    expect(response.status).toBe(401);
    expect(listAll).not.toHaveBeenCalled();
  });

  it("returns aggregates and tickets with a session", async () => {
    const route = createDashboardRoute({
      listAll: vi.fn(async () => []),
      session: async () => ({ openId: "ou_a", name: "张三" }),
    });

    const response = await route();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("tickets");
    expect(body).toHaveProperty("total");
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
