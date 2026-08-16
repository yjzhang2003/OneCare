import { neon } from "@neondatabase/serverless";

import type { VocRecord } from "../bitable/field-map";
import type { VocReply } from "../tagging/contracts";
import { VOC_DIMENSIONS, VOC_POLARITIES, VOC_SEVERITIES } from "../voc/triage";
import type { VocDimension, VocPolarity, VocSeverity } from "../voc/triage";
import { VOC_STATES, type VocState } from "../voc/service-event";
import { ALTER_STATEMENTS, CREATE_INDEXES, CREATE_TABLE } from "./schema";

// Lazy, and never at module scope: neon() throws when DATABASE_URL is unset, and
// Next evaluates top-level module code during `next build`, so a module-level call
// fails the build on any machine without the variable. Not a Proxy wrapper either —
// those break libraries that inspect the client object.
type Sql = ReturnType<typeof neon>;
let cached: Sql | null = null;

export function getSql(): Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing server environment variable: DATABASE_URL");
    cached = neon(url);
  }
  return cached;
}

export async function migrate(): Promise<void> {
  const sql = getSql();
  await sql.query(CREATE_TABLE);
  for (const statement of ALTER_STATEMENTS) {
    await sql.query(statement);
  }
  for (const statement of CREATE_INDEXES) {
    await sql.query(statement);
  }
}

// Postgres hands back nulls, Dates and unknown-typed JSON; VocRecord promises
// strings, typed unions and arrays. Everything below is that conversion, and it is
// deliberately total — a column the sync has never written must read back as the
// same empty value the Bitable mapping would produce, or the two sources would
// disagree about a record that is actually identical in both.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function replies(value: unknown): readonly VocReply[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.tone !== "string" || typeof candidate.text !== "string") {
      return [];
    }
    return [{ tone: candidate.tone, text: candidate.text }];
  });
}

export function toVocRecord(row: Record<string, unknown>): VocRecord {
  return {
    recordId: text(row.record_id),
    recordNumber: text(row.record_number),
    channel: text(row.channel),
    category: text(row.category),
    model: text(row.model),
    content: text(row.content),
    rating: typeof row.rating === "number" ? row.rating : null,
    feedbackAt: iso(row.feedback_at),
    state: (oneOf<VocState>(row.state, VOC_STATES) ?? "待分析") as VocState,
    polarity: oneOf<VocPolarity>(row.polarity, VOC_POLARITIES),
    dimensions: stringArray(row.dimensions).filter((item): item is VocDimension =>
      (VOC_DIMENSIONS as readonly string[]).includes(item),
    ),
    summary: text(row.summary),
    replies: replies(row.replies),
    severity: oneOf<VocSeverity>(row.severity, VOC_SEVERITIES),
    ownerOpenIds: stringArray(row.owner_open_ids),
    ownerNames: stringArray(row.owner_names),
    retryCount: typeof row.retry_count === "number" ? row.retry_count : 0,
    ticketOpenedAt: iso(row.ticket_opened_at),
    closedAt: iso(row.closed_at),
    warRoomChatId: text(row.war_room_chat_id),
    engineerOpenIds: stringArray(row.engineer_open_ids),
    engineerNames: stringArray(row.engineer_names),
    dispatchedAt: iso(row.dispatched_at),
    followUpNote: text(row.follow_up_note),
    closingNote: text(row.closing_note),
    userRef: text(row.user_ref),
    deviceRef: text(row.device_ref),
    sourceTicketNo: text(row.source_ticket_no),
    sourceUrl: text(row.source_url),
    sourceDetail: text(row.source_detail),
    businessUnit: text(row.business_unit),
    categoryLevel1: text(row.category_level1),
  };
}

export async function readAllRecords(): Promise<readonly VocRecord[]> {
  const rows = await getSql().query(
    // Newest first so the default view needs no re-sort; the query layer still
    // applies whichever order the operator chose.
    `SELECT * FROM voc_records ORDER BY feedback_at DESC NULLS LAST`,
  );
  return (rows as Record<string, unknown>[]).map(toVocRecord);
}

// One record by its Bitable id. The card callback path reads through this rather than
// the Bitable directly: writes land in Postgres first now, so a card reading the
// Bitable would decide against state the web has already changed.
//
// No fallback to the Bitable when this fails. A fallback would read *stale* data and
// then act on it — approving a war room for a ticket already declined, or advancing a
// state twice — which is worse than the card reporting an error the operator can retry.
export async function readRecordById(
  recordId: string,
): Promise<VocRecord | null> {
  const rows = (await getSql().query(
    `SELECT * FROM voc_records WHERE record_id = $1 LIMIT 1`,
    [recordId],
  )) as Record<string, unknown>[];
  const row = rows[0];
  return row ? toVocRecord(row) : null;
}

export async function countRecords(): Promise<number> {
  const rows = (await getSql().query(
    `SELECT COUNT(*)::int AS n FROM voc_records`,
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}

// The 27 columns, in one place: the insert list, the conflict-update list and the
// parameter order all have to agree, and three hand-maintained copies of the same
// sequence is how a column silently ends up written into the wrong slot.
const COLUMNS = [
  "record_id",
  "record_number",
  "channel",
  "category",
  "model",
  "content",
  "rating",
  "feedback_at",
  "state",
  "polarity",
  "dimensions",
  "summary",
  "replies",
  "severity",
  "owner_open_ids",
  "owner_names",
  "retry_count",
  "ticket_opened_at",
  "closed_at",
  "war_room_chat_id",
  "engineer_open_ids",
  "engineer_names",
  "dispatched_at",
  "follow_up_note",
  "closing_note",
  "user_ref",
  "device_ref",
  "source_ticket_no",
  "source_url",
  "source_detail",
  "business_unit",
  "category_level1",
] as const;

function toRow(record: VocRecord): readonly unknown[] {
  return [
    record.recordId,
    record.recordNumber,
    record.channel,
    record.category,
    record.model,
    record.content,
    record.rating,
    record.feedbackAt,
    record.state,
    record.polarity,
    [...record.dimensions],
    record.summary,
    JSON.stringify(record.replies),
    record.severity,
    [...record.ownerOpenIds],
    [...record.ownerNames],
    record.retryCount,
    record.ticketOpenedAt,
    record.closedAt,
    record.warRoomChatId,
    [...record.engineerOpenIds],
    [...record.engineerNames],
    record.dispatchedAt,
    record.followUpNote,
    record.closingNote,
    record.userRef,
    record.deviceRef,
    record.sourceTicketNo,
    record.sourceUrl,
    record.sourceDetail,
    record.businessUnit,
    record.categoryLevel1,
  ];
}

// 200 records per statement. The first version sent one statement per record, which
// is 3628 round trips — tolerable inside a datacentre and completely unusable from
// anywhere else. 200 × 27 = 5400 parameters, well under Postgres's 65535 limit, and
// it turns the full sync into ~19 statements.
const BATCH = 200;

// Upsert rather than insert so a sync is re-runnable, and so refreshing a single
// record after a write goes down the same path as a bulk sync — one code path means
// the incremental case cannot drift from the bulk case.
export async function upsertRecords(
  records: readonly VocRecord[],
): Promise<number> {
  if (records.length === 0) return 0;
  const sql = getSql();
  const updates = COLUMNS.filter((column) => column !== "record_id")
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(", ");

  let written = 0;
  for (let offset = 0; offset < records.length; offset += BATCH) {
    const chunk = records.slice(offset, offset + BATCH);
    const params: unknown[] = [];
    const tuples = chunk.map((record) => {
      const row = toRow(record);
      const placeholders = row.map((_, index) => `$${params.length + index + 1}`);
      params.push(...row);
      return `(${placeholders.join(",")}, now())`;
    });

    await sql.query(
      `INSERT INTO voc_records (${COLUMNS.join(", ")}, synced_at)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (record_id) DO UPDATE SET ${updates}, synced_at = now()`,
      params,
    );
    written += chunk.length;
  }
  return written;
}

// Pulls every Bitable record into the mirror. Rows this app has written locally and
// not yet confirmed in the Bitable are skipped: overwriting one with the older
// Bitable values would silently undo an operator's action, which is the failure a
// periodic pull invites and the reason pending_push exists.
export type SyncDependencies = Readonly<{
  listRecords: () => Promise<readonly VocRecord[]>;
  // Injected rather than called through the module, matching how every route in this
  // codebase takes its IO — and because a module-internal call cannot be substituted
  // in a test, which is what makes the skip rule below untestable otherwise.
  pendingIds: () => Promise<ReadonlySet<string>>;
  upsert: (records: readonly VocRecord[]) => Promise<number>;
}>;

export async function readPendingPushIds(): Promise<ReadonlySet<string>> {
  const rows = (await getSql().query(
    `SELECT record_id FROM voc_records WHERE pending_push`,
  )) as { record_id: string }[];
  return new Set(rows.map((row) => row.record_id));
}

export async function syncFromBitable(
  dependencies: SyncDependencies,
): Promise<Readonly<{ read: number; written: number; skipped: number }>> {
  const [records, pending] = await Promise.all([
    dependencies.listRecords(),
    dependencies.pendingIds(),
  ]);

  const writable = records.filter((record) => !pending.has(record.recordId));
  const written = await dependencies.upsert(writable);
  return {
    read: records.length,
    written,
    skipped: records.length - writable.length,
  };
}

// Marks a row as locally written and awaiting its Bitable push, and clears it once
// the push lands. Separate from upsertRecords because the flag's lifetime is owned by
// the write path, not by whoever happens to be refreshing a row.
export async function markPendingPush(recordId: string): Promise<void> {
  await getSql().query(
    `UPDATE voc_records SET pending_push = TRUE WHERE record_id = $1`,
    [recordId],
  );
}

export async function clearPendingPush(recordId: string): Promise<void> {
  await getSql().query(
    `UPDATE voc_records SET pending_push = FALSE WHERE record_id = $1`,
    [recordId],
  );
}
