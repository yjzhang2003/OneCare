// Where a rehearsal's "before" state is kept between prepare and restore.
//
// One row per rehearsal record, replaced on each prepare. Postgres rather than a file
// because restore has to work from whatever machine is running the demo — including the
// deployed app, where there is no filesystem to have left a JSON in.

import { getSql } from "./records";
import type { RehearsalFields, RehearsalRole } from "../demo/rehearsal";

export type StoredSnapshot = Readonly<{
  recordId: string;
  recordNumber: string;
  role: RehearsalRole;
  before: RehearsalFields;
  takenAt: string;
}>;

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS demo_rehearsal_snapshots (
  record_id     TEXT PRIMARY KEY,
  record_number TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL,
  before_state  JSONB NOT NULL,
  taken_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  taken_by      TEXT NOT NULL DEFAULT ''
);
`;

// Memoized per process: one idempotent statement, but still a round trip.
let ensured: Promise<void> | null = null;

export function ensureRehearsalTable(): Promise<void> {
  ensured ??= (async () => {
    await getSql().query(CREATE_TABLE);
  })().catch((error: unknown) => {
    ensured = null;
    throw error;
  });
  return ensured;
}

// Replaces the whole snapshot set. A rehearsal is one act — keeping fragments of an older
// one around would let restore put a record back to a state two rehearsals ago.
export async function writeSnapshots(
  snapshots: readonly Omit<StoredSnapshot, "takenAt">[],
  takenBy: string,
): Promise<void> {
  await ensureRehearsalTable();
  const sql = getSql();
  await sql.query(`DELETE FROM demo_rehearsal_snapshots`);
  for (const snapshot of snapshots) {
    await sql.query(
      `INSERT INTO demo_rehearsal_snapshots
         (record_id, record_number, role, before_state, taken_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        snapshot.recordId,
        snapshot.recordNumber,
        snapshot.role,
        JSON.stringify(snapshot.before),
        takenBy,
      ],
    );
  }
}

export async function readSnapshots(): Promise<readonly StoredSnapshot[]> {
  await ensureRehearsalTable();
  const rows = (await getSql().query(
    `SELECT record_id, record_number, role, before_state, taken_at
     FROM demo_rehearsal_snapshots ORDER BY role`,
  )) as Record<string, unknown>[];

  return rows.map((row) => ({
    recordId: String(row.record_id ?? ""),
    recordNumber: String(row.record_number ?? ""),
    role: String(row.role ?? "") as RehearsalRole,
    before: row.before_state as RehearsalFields,
    takenAt:
      row.taken_at instanceof Date
        ? row.taken_at.toISOString()
        : String(row.taken_at ?? ""),
  }));
}

export async function clearSnapshots(): Promise<void> {
  await ensureRehearsalTable();
  await getSql().query(`DELETE FROM demo_rehearsal_snapshots`);
}
