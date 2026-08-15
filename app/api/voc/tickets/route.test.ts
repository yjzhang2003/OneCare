import { describe, expect, it, vi } from "vitest";

import { createNewTicketRoute, toMirrorRecord, type NewTicketDependencies } from "./route";

const NOW = Date.parse("2026-08-15T03:00:00.000Z");

const DRAFT = {
  channel: "400 客服",
  category: "电视",
  model: "海信 65E5Q-PRO",
  content: "电视三次上门都没修好，还要再等一周",
  userRef: "",
  deviceRef: "",
};

function deps(overrides: Partial<NewTicketDependencies> = {}): NewTicketDependencies {
  return {
    session: async () => ({ openId: "ou_admin", name: "张禹健" }),
    options: async () => ({
      channels: ["400 客服", "电商评价"],
      categories: ["冰箱", "电视"],
    }),
    create: async () => "recNew",
    mirror: async () => {},
    revalidate: () => {},
    recordNumber: () => "uuid-1",
    now: () => NOW,
    ...overrides,
  };
}

const post = (body: unknown) =>
  new Request("https://example.test/api/voc/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/voc/tickets", () => {
  it("creates a 待分析 ticket and mirrors it so the console can see it", async () => {
    const create = vi.fn(async () => "recNew");
    const mirror = vi.fn(async () => {});
    const revalidate = vi.fn();

    const response = await createNewTicketRoute(deps({ create, mirror, revalidate }))(
      post(DRAFT),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recordNumber: "uuid-1",
      mirrored: true,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ 流程状态: "待分析", 记录编号: "uuid-1" }),
    );
    expect(mirror).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: "recNew", state: "待分析" }),
    );
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("refuses a channel the Base does not have, before writing anything", async () => {
    const create = vi.fn(async () => "recNew");
    const response = await createNewTicketRoute(deps({ create }))(
      post({ ...DRAFT, channel: "抖音" }),
    );

    expect(response.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses an empty complaint", async () => {
    const response = await createNewTicketRoute(deps())(post({ ...DRAFT, content: "" }));
    expect(response.status).toBe(422);
  });

  // 评委通道 is read-only, and the check lives in the route because the console's hidden
  // button is not a permission — the session is handed out by a link on a public page.
  it("refuses a guest session, before writing anything", async () => {
    const create = vi.fn(async () => "recNew");
    const response = await createNewTicketRoute(
      deps({
        session: async () => ({ openId: "guest", name: "评委", guest: true }),
        create,
      }),
    )(post(DRAFT));

    expect(response.status).toBe(403);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("只读");
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses without a session", async () => {
    const create = vi.fn(async () => "recNew");
    const response = await createNewTicketRoute(
      deps({ session: async () => null, create }),
    )(post(DRAFT));

    expect(response.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("reports a failed create rather than claiming a ticket exists", async () => {
    const mirror = vi.fn(async () => {});
    const response = await createNewTicketRoute(
      deps({
        create: async () => {
          throw new Error("bitable down");
        },
        mirror,
      }),
    )(post(DRAFT));

    expect(response.status).toBe(502);
    expect(mirror).not.toHaveBeenCalled();
  });

  // A row the console cannot see is worse than no row: the operator is told it worked
  // and finds nothing. Reported as a partial success, with the number to look for.
  it("says so when the row landed in the Base but not in the mirror", async () => {
    const revalidate = vi.fn();
    const response = await createNewTicketRoute(
      deps({
        mirror: async () => {
          throw new Error("neon down");
        },
        revalidate,
      }),
    )(post(DRAFT));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mirrored: false });
    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe("toMirrorRecord", () => {
  it("carries nothing the pipeline has not produced yet", () => {
    const record = toMirrorRecord("recNew", "uuid-1", DRAFT, NOW);
    expect(record).toMatchObject({
      state: "待分析",
      polarity: null,
      severity: null,
      summary: "",
      ownerOpenIds: [],
      engineerOpenIds: [],
      ticketOpenedAt: null,
      sourceDetail: "手动录入（演示）",
    });
  });
});
