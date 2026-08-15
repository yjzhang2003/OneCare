import { describe, expect, it, vi } from "vitest";

import {
  createNotificationListRoute,
  createNotificationReadRoute,
  type NotificationRoutesDependencies,
} from "./route";

const ITEMS = [
  {
    id: 7,
    kind: "engineer_reported" as const,
    recordId: "rec-1",
    recordNumber: "VOC-a3cdc5",
    title: "工程师已回填，等你确认闭环",
    body: "张睿哲已回填现场结果 · 400 客服 · 冰箱",
    href: "https://example.test/workbench/tickets/VOC-a3cdc5",
    createdAt: "2026-08-15T02:00:00.000Z",
    readAt: null,
  },
];

function deps(
  overrides: Partial<NotificationRoutesDependencies> = {},
): NotificationRoutesDependencies {
  return {
    session: async () => ({ openId: "ou_owner", name: "黄齐" }),
    list: async () => ({ items: ITEMS, unread: 1 }),
    markRead: async () => {},
    ...overrides,
  };
}

describe("GET /api/voc/notifications", () => {
  it("returns this person's inbox and their unread count", async () => {
    const list = vi.fn(async () => ({ items: ITEMS, unread: 1 }));
    const response = await createNotificationListRoute(deps({ list }))();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ unread: 1 });
    // The open_id is the session's, never the request's — an inbox is the one surface
    // where "whose" is the whole question.
    expect(list).toHaveBeenCalledWith("ou_owner");
  });

  it("refuses without a session", async () => {
    const response = await createNotificationListRoute(
      deps({ session: async () => null }),
    )();
    expect(response.status).toBe(401);
  });

  // The bell polls this every 30 seconds. A read failure answers "no messages" rather
  // than a 500 the console would have to render as a permanent error badge.
  it("degrades to an empty inbox instead of failing the poll", async () => {
    const response = await createNotificationListRoute(
      deps({
        list: async () => {
          throw new Error("neon down");
        },
      }),
    )();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [],
      unread: 0,
      degraded: true,
    });
  });
});

describe("POST /api/voc/notifications", () => {
  const request = (body: unknown) =>
    new Request("https://example.test/api/voc/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("marks one message read for the person who is signed in", async () => {
    const markRead = vi.fn(async () => {});
    const response = await createNotificationReadRoute(deps({ markRead }))(
      request({ id: 7 }),
    );

    expect(response.status).toBe(200);
    expect(markRead).toHaveBeenCalledWith("ou_owner", 7);
  });

  it("marks everything read when no id is given", async () => {
    const markRead = vi.fn(async () => {});
    await createNotificationReadRoute(deps({ markRead }))(request({}));
    expect(markRead).toHaveBeenCalledWith("ou_owner", null);
  });

  it("treats a non-integer id as 'all', never as a lookup", async () => {
    const markRead = vi.fn(async () => {});
    await createNotificationReadRoute(deps({ markRead }))(request({ id: "7; DROP" }));
    expect(markRead).toHaveBeenCalledWith("ou_owner", null);
  });

  it("refuses without a session", async () => {
    const markRead = vi.fn(async () => {});
    const response = await createNotificationReadRoute(
      deps({ session: async () => null, markRead }),
    )(request({ id: 7 }));

    expect(response.status).toBe(401);
    expect(markRead).not.toHaveBeenCalled();
  });
});
