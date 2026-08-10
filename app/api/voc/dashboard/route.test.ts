import { describe, expect, it, vi } from "vitest";

import { createDashboardRoute } from "./route";

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
