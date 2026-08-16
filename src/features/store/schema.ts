// The mirror's shape. One row per Bitable record, keyed by the Bitable record id
// so a sync is an upsert rather than a diff.
//
// Deliberately not normalised: this table exists to answer "give me every VOC
// record" in one query, replacing a 9-second, 8-request, 1.6MB scan of the Feishu
// Bitable. Splitting dimensions or replies into child tables would trade that one
// query for joins and buy nothing — nothing writes here except the sync, and every
// consumer wants whole records.
//
// Text columns rather than enums: the enum values live in TypeScript
// (VOC_STATES, VOC_DIMENSIONS, …) and are validated there before anything is
// written to Bitable. A Postgres enum would be a second declaration of the same
// list, and adding a value would then need a migration in lockstep with a code
// change.
export const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS voc_records (
  record_id         TEXT PRIMARY KEY,
  record_number     TEXT NOT NULL DEFAULT '',
  channel           TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT '',
  model             TEXT NOT NULL DEFAULT '',
  content           TEXT NOT NULL DEFAULT '',
  rating            INTEGER,
  feedback_at       TIMESTAMPTZ,
  state             TEXT NOT NULL DEFAULT '待分析',
  polarity          TEXT,
  dimensions        TEXT[] NOT NULL DEFAULT '{}',
  summary           TEXT NOT NULL DEFAULT '',
  replies           JSONB NOT NULL DEFAULT '[]'::jsonb,
  severity          TEXT,
  owner_open_ids    TEXT[] NOT NULL DEFAULT '{}',
  owner_names       TEXT[] NOT NULL DEFAULT '{}',
  retry_count       INTEGER NOT NULL DEFAULT 0,
  ticket_opened_at  TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  war_room_chat_id  TEXT NOT NULL DEFAULT '',
  -- 派工: the engineer sent on site, and when. Separate from owner_* because the two
  -- answer different questions — who owns closing this ticket, and who is going.
  engineer_open_ids TEXT[] NOT NULL DEFAULT '{}',
  engineer_names    TEXT[] NOT NULL DEFAULT '{}',
  dispatched_at     TIMESTAMPTZ,
  follow_up_note    TEXT NOT NULL DEFAULT '',
  closing_note      TEXT NOT NULL DEFAULT '',
  user_ref          TEXT NOT NULL DEFAULT '',
  device_ref        TEXT NOT NULL DEFAULT '',
  source_ticket_no  TEXT NOT NULL DEFAULT '',
  source_url        TEXT NOT NULL DEFAULT '',
  source_detail     TEXT NOT NULL DEFAULT '',
  business_unit     TEXT NOT NULL DEFAULT '',
  category_level1   TEXT NOT NULL DEFAULT '',
  -- When this row last came from Bitable. A stale mirror is a real failure mode,
  -- so the freshness has to be answerable from the data rather than assumed.
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when this app has written the row locally and the corresponding Bitable
  -- write has not been confirmed yet. The periodic pull skips these: without it, a
  -- sync landing in that window would overwrite a fresh local row with the older
  -- Bitable values and silently undo an operator's action.
  pending_push      BOOLEAN NOT NULL DEFAULT FALSE
);
`;

// Existing deployments were created before pending_push existed, and CREATE TABLE IF
// NOT EXISTS will not add it. Written as a separate idempotent statement rather than
// a migration framework, which this one table does not warrant.
export const ALTER_STATEMENTS = [
  `ALTER TABLE voc_records ADD COLUMN IF NOT EXISTS pending_push BOOLEAN NOT NULL DEFAULT FALSE;`,
  // 派工 arrived after the table existed, so these three are added the same way
  // pending_push was: idempotent statements rather than a migration framework.
  `ALTER TABLE voc_records ADD COLUMN IF NOT EXISTS engineer_open_ids TEXT[] NOT NULL DEFAULT '{}';`,
  `ALTER TABLE voc_records ADD COLUMN IF NOT EXISTS engineer_names TEXT[] NOT NULL DEFAULT '{}';`,
  `ALTER TABLE voc_records ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;`,
  // 跟进记录 / 闭环结论 were unmirrored while nothing read them back; the ticket page
  // reads them now.
  `ALTER TABLE voc_records ADD COLUMN IF NOT EXISTS follow_up_note TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE voc_records ADD COLUMN IF NOT EXISTS closing_note TEXT NOT NULL DEFAULT '';`,
];

// Indexes for what the console actually filters and groups by. Created separately
// because Postgres does not accept INDEX inside CREATE TABLE.
export const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_voc_state ON voc_records (state);`,
  `CREATE INDEX IF NOT EXISTS idx_voc_feedback_at ON voc_records (feedback_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_voc_user_ref ON voc_records (user_ref);`,
  `CREATE INDEX IF NOT EXISTS idx_voc_device_ref ON voc_records (device_ref);`,
  `CREATE INDEX IF NOT EXISTS idx_voc_source_ticket ON voc_records (source_ticket_no);`,
  `CREATE INDEX IF NOT EXISTS idx_voc_pending_push ON voc_records (pending_push) WHERE pending_push;`,
];
