import { getCurrentSession } from "../../../../src/features/auth/current-session";
import type { AuthUser } from "../../../../src/features/auth/types";
import {
  markNotificationsRead,
  readNotifications,
  type StoredNotification,
} from "../../../../src/features/store/notifications";

// 站内消息的读与已读。Both are scoped to whoever is signed in — an inbox is the one
// surface where "whose" is the entire question, so open_id is never taken from the
// request.
export type NotificationRoutesDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  list: (
    openId: string,
  ) => Promise<Readonly<{ items: readonly StoredNotification[]; unread: number }>>;
  markRead: (openId: string, id: number | null) => Promise<void>;
}>;

export function createNotificationListRoute(
  dependencies: NotificationRoutesDependencies,
) {
  return async function GET(): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }
      const { items, unread } = await dependencies.list(user.openId);
      return Response.json({ ok: true, items, unread });
    } catch {
      // The bell polls this. A failure answers with an empty inbox rather than a 500
      // the console would have to render as an error badge every few seconds.
      return Response.json({ ok: true, items: [], unread: 0, degraded: true });
    }
  };
}

export function createNotificationReadRoute(
  dependencies: NotificationRoutesDependencies,
) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }
      const body: unknown = await request.json().catch(() => null);
      const raw =
        typeof body === "object" && body !== null
          ? (body as { id?: unknown }).id
          : undefined;
      // No id means "all of them", which is what the 全部已读 control sends.
      const id = typeof raw === "number" && Number.isInteger(raw) ? raw : null;

      await dependencies.markRead(user.openId, id);
      return Response.json({ ok: true });
    } catch {
      return Response.json(
        { error: "internal", message: "服务暂时不可用，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

const dependencies: NotificationRoutesDependencies = {
  session: getCurrentSession,
  list: (openId) => readNotifications(openId),
  markRead: markNotificationsRead,
};

export const GET = createNotificationListRoute(dependencies);
export const POST = createNotificationReadRoute(dependencies);
