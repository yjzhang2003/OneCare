// 站内消息：每条通知在这里留一份，飞书那份是同一件事的另一个出口。
//
// Its own table rather than a column on the ticket, because a notification is per person
// and per event: the same ticket produces one for the 客服 when it is assigned and
// another for the 工程师 when it is dispatched, and marking one read must not touch the
// other.

import { getSql } from "./records";
import type { NotificationKind } from "../notify/messages";

export type StoredNotification = Readonly<{
  id: number;
  kind: NotificationKind;
  recordId: string;
  recordNumber: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
}>;

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS notifications (
  id            BIGSERIAL PRIMARY KEY,
  open_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  record_id     TEXT NOT NULL DEFAULT '',
  record_number TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  href          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ
);
`;

const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_notifications_open_id ON notifications (open_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (open_id) WHERE read_at IS NULL;`,
];

// Memoized per process: idempotent statements, but still round trips.
let ensured: Promise<void> | null = null;

export function ensureNotificationsTable(): Promise<void> {
  ensured ??= (async () => {
    const sql = getSql();
    await sql.query(CREATE_TABLE);
    for (const statement of CREATE_INDEXES) {
      await sql.query(statement);
    }
  })().catch((error: unknown) => {
    ensured = null;
    throw error;
  });
  return ensured;
}

export type NewNotification = Readonly<{
  openId: string;
  kind: NotificationKind;
  recordId: string;
  recordNumber: string;
  title: string;
  body: string;
  href: string;
}>;

export async function insertNotification(input: NewNotification): Promise<void> {
  await ensureNotificationsTable();
  await getSql().query(
    `INSERT INTO notifications (open_id, kind, record_id, record_number, title, body, href)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.openId,
      input.kind,
      input.recordId,
      input.recordNumber,
      input.title,
      input.body,
      input.href,
    ],
  );
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function readNotifications(
  openId: string,
  limit = 20,
): Promise<Readonly<{ items: readonly StoredNotification[]; unread: number }>> {
  await ensureNotificationsTable();
  const sql = getSql();
  const [rows, counts] = await Promise.all([
    sql.query(
      `SELECT id, kind, record_id, record_number, title, body, href, created_at, read_at
         FROM notifications WHERE open_id = $1
        ORDER BY created_at DESC LIMIT $2`,
      [openId, limit],
    ),
    sql.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE open_id = $1 AND read_at IS NULL`,
      [openId],
    ),
  ]);

  const list = (rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    kind: text(row.kind) as NotificationKind,
    recordId: text(row.record_id),
    recordNumber: text(row.record_number),
    title: text(row.title),
    body: text(row.body),
    href: text(row.href),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    readAt: iso(row.read_at),
  }));
  const first = (counts as unknown as Record<string, unknown>[])[0];
  return { items: list, unread: Number(first?.n ?? 0) };
}

// Marking read is per person: the WHERE clause carries open_id even when an id is given,
// so a guessed id cannot clear somebody else's inbox.
export async function markNotificationsRead(
  openId: string,
  id: number | null,
): Promise<void> {
  await ensureNotificationsTable();
  const sql = getSql();
  if (id === null) {
    await sql.query(
      `UPDATE notifications SET read_at = now() WHERE open_id = $1 AND read_at IS NULL`,
      [openId],
    );
    return;
  }
  await sql.query(
    `UPDATE notifications SET read_at = now() WHERE open_id = $1 AND id = $2 AND read_at IS NULL`,
    [openId, id],
  );
}
