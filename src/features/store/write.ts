import {
  parseReplyText,
  VOC_FIELD_NAMES,
  type BitableFields,
  type VocRecord,
} from "../bitable/field-map";

// Translates a Bitable write into a Postgres write.
//
// The app writes to Postgres first now, and pushes to the Bitable afterwards, so this
// is where an operator's click actually lands. Two consequences worth stating:
//
// - Only the columns the mirror carries are translated. 打标来源, 失败原因 and 原始输出
//   are written to the Bitable but never read back by this app — they are not on
//   VocRecord and not in the schema — so they are absent here and travel to the
//   Bitable with the original field object instead. Silently dropping a field the app
//   *does* read would be a data-loss bug, which is why the mapping is derived from
//   VOC_FIELD_NAMES rather than written out by hand.
// - Values arrive in Bitable's own encodings: a person field is [{id}], a DateTime is
//   epoch milliseconds. Postgres wants text[] and a timestamp. Those conversions are
//   the reason this cannot be a generic column copy.

type Column = Readonly<{
  column: string;
  convert: (value: unknown) => unknown;
}>;

const asText = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const asNumber = (value: unknown): number =>
  typeof value === "number" ? value : Number(value ?? 0);

// Bitable DateTime fields are epoch milliseconds on the wire; an ISO string is
// silently rejected by that API and would be an invalid timestamp here.
const asTimestamp = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
};

// A people field reads and writes as [{ id }] — keyed by `id`, not `open_id`, which
// is calibrated against the live Base.
const asOpenIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && "id" in item) {
      const id = (item as { id?: unknown }).id;
      return typeof id === "string" ? [id] : [];
    }
    return [];
  });
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

// Keyed by the Bitable column name, derived from VOC_FIELD_NAMES so a renamed column
// cannot leave this map pointing at a name that no longer exists.
const COLUMNS: Readonly<Record<string, Column>> = {
  [VOC_FIELD_NAMES.state]: { column: "state", convert: asText },
  [VOC_FIELD_NAMES.owner]: { column: "owner_open_ids", convert: asOpenIds },
  [VOC_FIELD_NAMES.ticketOpenedAt]: {
    column: "ticket_opened_at",
    convert: asTimestamp,
  },
  [VOC_FIELD_NAMES.closedAt]: { column: "closed_at", convert: asTimestamp },
  [VOC_FIELD_NAMES.warRoomChatId]: {
    column: "war_room_chat_id",
    convert: asText,
  },
  [VOC_FIELD_NAMES.polarity]: { column: "polarity", convert: asText },
  [VOC_FIELD_NAMES.dimensions]: { column: "dimensions", convert: asStringArray },
  [VOC_FIELD_NAMES.summary]: { column: "summary", convert: asText },
  // Stored as a text blob in the Bitable ("【语气】正文" separated by blank lines) and
  // as JSONB here, so this is the one field whose local form is parsed rather than
  // copied.
  [VOC_FIELD_NAMES.replies]: {
    column: "replies",
    convert: (value) => JSON.stringify(parseReplyText(asText(value))),
  },
  [VOC_FIELD_NAMES.severity]: { column: "severity", convert: asText },
  [VOC_FIELD_NAMES.retryCount]: { column: "retry_count", convert: asNumber },
};

export type LocalWrite = Readonly<{
  assignments: readonly string[];
  params: readonly unknown[];
}>;

// Builds the SET clause for the fields this mirror knows about. Returns no
// assignments when a write touches only Bitable-only columns, which the caller must
// treat as "nothing to apply locally" rather than as an error.
export function toLocalWrite(fields: BitableFields): LocalWrite {
  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [name, value] of Object.entries(fields)) {
    const mapping = COLUMNS[name];
    if (!mapping) continue;
    params.push(mapping.convert(value));
    assignments.push(`${mapping.column} = $${params.length}`);
  }

  return { assignments, params };
}

// The Bitable column names this mirror deliberately does not carry. Exported so a
// test can assert the list is a decision rather than an oversight — if one of these
// ever becomes something the console reads, it needs a column, not silence.
export const UNMIRRORED_FIELDS: readonly string[] = [
  VOC_FIELD_NAMES.tagSource,
  VOC_FIELD_NAMES.failureReason,
  VOC_FIELD_NAMES.rawOutput,
  VOC_FIELD_NAMES.sentiment,
  // 跟进记录 and 闭环结论 are written on closure and never read back by this app —
  // they are not on VocRecord and have no column here.
  VOC_FIELD_NAMES.followUpNote,
  VOC_FIELD_NAMES.closingNote,
];

// A people write carries ids, not names, so applying it locally leaves owner_names
// stale — and owner_names is what the 未分配 queue and both profile views read. The
// local apply is therefore an optimistic projection, not the final truth: the push
// path re-reads the record from the Bitable afterwards, which resolves the names, and
// only then clears pending_push. Named here because "the optimistic write is
// incomplete" is the kind of thing that is obvious for a week and mysterious after.
export const OPTIMISTIC_ONLY: readonly string[] = [VOC_FIELD_NAMES.owner];


// The reverse direction: a mirror row expressed as Bitable fields.
//
// Used when re-pushing a write whose first attempt failed. Nothing records *which*
// fields that attempt carried, and nothing needs to: Postgres is authoritative for
// every column below, so pushing its current values is exactly what the Bitable
// should end up holding. Storing a pending-field payload would add a second source of
// truth for the same question.
//
// Only the mirrored columns appear. The write-only ones (打标来源, 失败原因, 原始输出,
// 情绪标签, 跟进记录, 闭环结论) are not reconstructible here and are left untouched in
// the Bitable, which is correct — a retry must not blank a column it never owned.
export function toBitableFields(record: VocRecord): BitableFields {
  return {
    [VOC_FIELD_NAMES.state]: record.state,
    [VOC_FIELD_NAMES.owner]: record.ownerOpenIds.map((id) => ({ id })),
    [VOC_FIELD_NAMES.retryCount]: record.retryCount,
    [VOC_FIELD_NAMES.warRoomChatId]: record.warRoomChatId,
    ...(record.polarity ? { [VOC_FIELD_NAMES.polarity]: record.polarity } : {}),
    ...(record.severity ? { [VOC_FIELD_NAMES.severity]: record.severity } : {}),
    ...(record.dimensions.length > 0
      ? { [VOC_FIELD_NAMES.dimensions]: [...record.dimensions] }
      : {}),
    ...(record.summary.length > 0
      ? { [VOC_FIELD_NAMES.summary]: record.summary }
      : {}),
    ...(record.ticketOpenedAt
      ? { [VOC_FIELD_NAMES.ticketOpenedAt]: Date.parse(record.ticketOpenedAt) }
      : {}),
    ...(record.closedAt
      ? { [VOC_FIELD_NAMES.closedAt]: Date.parse(record.closedAt) }
      : {}),
  };
}
