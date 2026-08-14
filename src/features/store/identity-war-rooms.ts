// Which identity already has a 协同群, and which one.
//
// Tickets record their group in the Bitable's own 协同群 ID column, because a ticket is a
// row there. An identity is not: 用户画像 and 设备追踪 are aggregations over many rows, so
// there is nothing to write the chat id onto without either inventing a Bitable column or
// stamping the same id across every record behind the identity. Postgres is the primary
// store now, so this lives here — a two-column mapping, not a schema change to the
// enterprise's Base.
//
// The point of persisting it at all is idempotence: a second click on 拉群处理 must join
// the operator to the group that exists rather than create a second one with the same
// name, which is exactly the failure the ticket path's warRoomDecision() exists to
// prevent.

import { getSql } from "./records";

export type IdentityKind = "user" | "device";

export type IdentityWarRoom = Readonly<{
  kind: IdentityKind;
  identity: string;
  chatId: string;
  createdBy: string;
  createdAt: string;
}>;

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS identity_war_rooms (
  kind       TEXT NOT NULL,
  identity   TEXT NOT NULL,
  chat_id    TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, identity)
);
`;

// Memoized per process rather than run per request: this is one idempotent statement, but
// it is still a round trip, and the alternative — folding it into migrate() — would make
// every caller of this pay for the whole voc_records migration.
let ensured: Promise<void> | null = null;

export function ensureIdentityWarRoomTable(): Promise<void> {
  ensured ??= (async () => {
    await getSql().query(CREATE_TABLE);
  })().catch((error: unknown) => {
    // A failed create must not be cached as success, or every later call in this process
    // would proceed against a table that does not exist.
    ensured = null;
    throw error;
  });
  return ensured;
}

export async function readIdentityWarRoom(
  kind: IdentityKind,
  identity: string,
): Promise<IdentityWarRoom | null> {
  await ensureIdentityWarRoomTable();
  const rows = (await getSql().query(
    `SELECT kind, identity, chat_id, created_by, created_at
     FROM identity_war_rooms WHERE kind = $1 AND identity = $2`,
    [kind, identity],
  )) as Record<string, unknown>[];
  const row = rows[0];
  if (!row) return null;
  return {
    kind,
    identity,
    chatId: String(row.chat_id ?? ""),
    createdBy: String(row.created_by ?? ""),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ""),
  };
}

// Records the group, and answers with whichever group is now authoritative. ON CONFLICT
// DO NOTHING plus a read-back rather than an upsert: if two operators click at the same
// moment, the loser must be told about the winner's group, not have its own id
// overwrite it.
export async function claimIdentityWarRoom(
  kind: IdentityKind,
  identity: string,
  chatId: string,
  createdBy: string,
): Promise<Readonly<{ chatId: string; created: boolean }>> {
  await ensureIdentityWarRoomTable();
  const rows = (await getSql().query(
    `INSERT INTO identity_war_rooms (kind, identity, chat_id, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (kind, identity) DO NOTHING
     RETURNING chat_id`,
    [kind, identity, chatId, createdBy],
  )) as Record<string, unknown>[];

  if (rows[0]) return { chatId, created: true };

  const existing = await readIdentityWarRoom(kind, identity);
  return { chatId: existing?.chatId ?? chatId, created: false };
}
