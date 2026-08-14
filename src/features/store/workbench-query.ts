import type { WorkbenchTicket } from "../workbench/data";
import { toWorkbenchTicket } from "../workbench/data";
import type { StringFilterField } from "../workbench/href";
import {
  ASSUMED_SLA_HOURS,
  PAGE_SIZE,
  QUEUES,
  type QueueKey,
  type WorkbenchPage,
  type WorkbenchQuery,
} from "../workbench/query";
import {
  deviceProfiles,
  userProfiles,
  type IdentityProfile,
} from "../workbench/profiles";
import type { VocMetrics } from "../voc/metrics";
import type { VocDimension } from "../voc/triage";
import { getSql, toVocRecord } from "./records";

// The same triage semantics as applyWorkbenchQuery, expressed in SQL.
//
// Why both exist: reading every record so JavaScript can filter it costs a measured
// 6–7 seconds for 3628 rows, while one page is 947ms and a GROUP BY is 116ms. But
// applyWorkbenchQuery is where the semantics are *defined* and where 25 tests pin
// them, so it stays as the reference implementation rather than being deleted. The
// two are held to agreement by scripts/verify-query-equivalence, which runs both
// over the real table across many query combinations and compares row for row.
//
// Every predicate below is a transcription of a specific function in
// ../workbench/query.ts, named in its comment. When one changes, both change.

// dwellHours(): null for terminal states and for records with neither timestamp,
// otherwise hours since ticket_opened_at ?? feedback_at, floored at 0.
const DWELL = `
  CASE
    WHEN state IN ('已闭环', '无需跟进') THEN NULL
    WHEN COALESCE(ticket_opened_at, feedback_at) IS NULL THEN NULL
    ELSE GREATEST(
      0,
      EXTRACT(EPOCH FROM ($NOW::timestamptz - COALESCE(ticket_opened_at, feedback_at))) / 3600.0
    )
  END`;

// inQueue(). `unassigned` keys off owner_names, not owner_open_ids, because that is
// what the reference does — a record can carry an id whose name never resolved.
function queuePredicate(queue: QueueKey): string {
  switch (queue) {
    case "open":
      return `ticket_opened_at IS NOT NULL AND state NOT IN ('已闭环', '无需跟进')`;
    case "overdue":
      return `(${DWELL}) > ${ASSUMED_SLA_HOURS}`;
    case "unassigned":
      return `ticket_opened_at IS NOT NULL AND cardinality(owner_names) = 0`;
    case "failed":
      return `state = '分析失败'`;
    case "all":
      return `TRUE`;
  }
}

// compare(). NULLS LAST on both directions mirrors feedbackRank's use of
// -Infinity plus the explicit "blank timestamps still sort last" branch in the
// ascending case. record_number is the same final tiebreak the reference now
// applies, which is what makes the two orders comparable at all.
function orderBy(sort: WorkbenchQuery["sort"]): string {
  switch (sort) {
    case "feedback_desc":
      return `feedback_at DESC NULLS LAST, record_number ASC`;
    case "feedback_asc":
      return `feedback_at ASC NULLS LAST, record_number ASC`;
    case "dwell_desc":
      return `(${DWELL}) DESC NULLS LAST, record_number ASC`;
    case "severity_desc":
      return `CASE severity WHEN '高' THEN 3 WHEN '中' THEN 2 WHEN '低' THEN 1 ELSE 0 END DESC,
              feedback_at DESC NULLS LAST, record_number ASC`;
  }
}

type Bound = Readonly<{ clause: string; params: readonly unknown[] }>;

// matchesFilters() and matchesSearch(). Parameterised throughout — the values are
// operator input arriving from a URL.
function filterClauses(query: WorkbenchQuery, from: number): Bound {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    clauses.push(sql.replace("$?", `$${from + params.length - 1}`));
  };

  if (query.channel !== null) add(`channel = $?`, query.channel);
  if (query.category !== null) add(`category = $?`, query.category);
  if (query.polarity !== null) add(`polarity = $?`, query.polarity);
  if (query.severity !== null) add(`severity = $?`, query.severity);
  if (query.state !== null) add(`state = $?`, query.state);
  if (query.dimension !== null) add(`$? = ANY(dimensions)`, query.dimension);
  if (query.owner !== null) add(`$? = ANY(owner_names)`, query.owner);
  if (query.unit !== null) add(`business_unit = $?`, query.unit);
  if (query.level1 !== null) add(`category_level1 = $?`, query.level1);
  if (query.sourceTicketNo !== null) {
    add(`source_ticket_no = $?`, query.sourceTicketNo);
  }
  if (query.userRef !== null) add(`user_ref = $?`, query.userRef);
  if (query.deviceRef !== null) add(`device_ref = $?`, query.deviceRef);

  if (query.search.length > 0) {
    // ILIKE rather than lower(...) LIKE: same case-insensitive substring test the
    // reference performs, and it reads as the intent rather than as a trick.
    params.push(`%${query.search}%`);
    const p = `$${from + params.length - 1}`;
    clauses.push(
      `(content ILIKE ${p} OR model ILIKE ${p} OR record_number ILIKE ${p} OR source_ticket_no ILIKE ${p})`,
    );
  }

  return {
    clause: clauses.length > 0 ? clauses.map((c) => `(${c})`).join(" AND ") : "TRUE",
    params,
  };
}

// The five numbers on the sider. Its own function because the sider is now chrome
// on every page rather than part of the list view: the ticket detail page renders
// the same navigation and needs the same counts, without paying for a page of rows
// it will not show.
export async function readQueueCounts(
  now: number,
): Promise<Readonly<Record<QueueKey, number>>> {
  // Always mentions $NOW, because the overdue predicate is one of the five it
  // evaluates.
  const rows = (await getSql().query(
    `SELECT ${QUEUES.map(
      (q, i) =>
        `COUNT(*) FILTER (WHERE ${queuePredicate(q.key).replaceAll("$NOW", "$1")})::int AS q${i}`,
    ).join(", ")}
     FROM voc_records`,
    [new Date(now).toISOString()],
  )) as Record<string, number>[];
  const counts = rows[0] ?? {};
  return Object.fromEntries(
    QUEUES.map((q, i) => [q.key, counts[`q${i}`] ?? 0]),
  ) as Record<QueueKey, number>;
}

// How many repeat identities each profile view lists — the other two sider counts.
//
// Separate from readProfiles because the sider needs the numbers on every page while
// the lists themselves are only needed on their own section. Before this, the sider
// took its two counts from whichever list happened to be loaded, so 用户画像 and
// 设备追踪 both read "0" everywhere else — a count of zero where the truth was 2772,
// stated with the same confidence as the five that were right.
//
// `records > 1` is readProfiles' own filter for what those lists contain; a HAVING
// clause is the same test, counted in the database instead of in memory.
export async function readProfileCounts(): Promise<
  Readonly<{ users: number; devices: number }>
> {
  const repeats = (column: string) =>
    `(SELECT COUNT(*)::int FROM (
        SELECT 1 FROM voc_records
        WHERE ${column} <> ''
        GROUP BY ${column}
        HAVING COUNT(*) > 1
      ) AS r)`;

  const rows = (await getSql().query(
    `SELECT ${repeats("user_ref")} AS users, ${repeats("device_ref")} AS devices`,
  )) as Record<string, number>[];
  const row = rows[0] ?? {};
  return { users: row.users ?? 0, devices: row.devices ?? 0 };
}

export async function readWorkbenchPage(
  query: WorkbenchQuery,
  now: number,
): Promise<WorkbenchPage> {
  const sql = getSql();
  const nowIso = new Date(now).toISOString();

  const queueCounts = await readQueueCounts(now);

  // Filters are numbered from $1 and `now` is appended only if the queue predicate
  // or the sort actually references it. Passing an unreferenced parameter is not
  // merely wasteful — Postgres rejects the statement outright ("bind message
  // supplies 1 parameters, but prepared statement requires 0"), which is exactly
  // what queue=all with no filters did.
  const filters = filterClauses(query, 1);
  const rawWhere = `(${queuePredicate(query.queue)}) AND (${filters.clause})`;
  const rawOrder = orderBy(query.sort);

  // Postgres rejects a statement that is handed a parameter it never mentions, so
  // each statement gets exactly the parameters its own text references. `now` is
  // appended last and only when needed, which differs between the two: the count
  // query sees only the WHERE, while the rows query also has an ORDER BY that can
  // reference dwell time on its own. Sorting by dwell inside queue=all is precisely
  // that case, and it is what the first version of this got wrong twice.
  const bind = (needsNow: boolean) => {
    const params: unknown[] = [...filters.params];
    if (needsNow) params.push(nowIso);
    const placeholder = `$${params.length}`;
    return {
      params,
      text: (sqlText: string) =>
        needsNow ? sqlText.replaceAll("$NOW", placeholder) : sqlText,
    };
  };

  const forCount = bind(rawWhere.includes("$NOW"));
  const matchedRows = (await sql.query(
    `SELECT COUNT(*)::int AS n FROM voc_records WHERE ${forCount.text(rawWhere)}`,
    forCount.params,
  )) as { n: number }[];
  const matched = matchedRows[0]?.n ?? 0;

  const pageCount = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  const forRows = bind(`${rawWhere} ${rawOrder}`.includes("$NOW"));
  const rows = (await sql.query(
    `SELECT * FROM voc_records
     WHERE ${forRows.text(rawWhere)}
     ORDER BY ${forRows.text(rawOrder)}
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    forRows.params,
  )) as Record<string, unknown>[];

  return {
    rows: rows.map((row) => toWorkbenchTicket(toVocRecord(row))),
    matched,
    page,
    pageCount,
    queueCounts,
  };
}

// One record, for the detail route. Previously this meant reading all 3628 and
// finding one of them.
export async function readTicketByNumber(
  recordNumber: string,
): Promise<WorkbenchTicket | null> {
  const rows = (await getSql().query(
    `SELECT * FROM voc_records WHERE record_number = $1 LIMIT 1`,
    [recordNumber],
  )) as Record<string, unknown>[];
  const row = rows[0];
  return row ? toWorkbenchTicket(toVocRecord(row)) : null;
}

// How many OTHER records share this one's source case number. Empty case numbers
// group nothing, matching the reference.
export async function countRelatedBySource(
  sourceTicketNo: string,
  recordNumber: string,
): Promise<number> {
  if (sourceTicketNo.trim().length === 0) return 0;
  const rows = (await getSql().query(
    `SELECT COUNT(*)::int AS n FROM voc_records
     WHERE source_ticket_no = $1 AND record_number <> $2`,
    [sourceTicketNo, recordNumber],
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}

// distinctValues() over the whole table, one round trip instead of nine. unnest for
// the two array columns; sorting stays in JavaScript so the collation matches what
// the reference produced.
export async function readFilterOptions(): Promise<
  Readonly<Record<StringFilterField, readonly string[]>>
> {
  const rows = (await getSql().query(`
    SELECT 'channel' AS field, channel AS value FROM voc_records WHERE channel <> ''
    UNION SELECT 'category', category FROM voc_records WHERE category <> ''
    UNION SELECT 'polarity', polarity FROM voc_records WHERE polarity IS NOT NULL AND polarity <> ''
    UNION SELECT 'severity', severity FROM voc_records WHERE severity IS NOT NULL AND severity <> ''
    UNION SELECT 'state', state FROM voc_records WHERE state <> ''
    UNION SELECT 'unit', business_unit FROM voc_records WHERE business_unit <> ''
    UNION SELECT 'level1', category_level1 FROM voc_records WHERE category_level1 <> ''
    UNION SELECT 'dimension', d FROM voc_records, unnest(dimensions) AS d WHERE d <> ''
    UNION SELECT 'owner', o FROM voc_records, unnest(owner_names) AS o WHERE o <> ''
  `)) as { field: string; value: string }[];

  // Keyed by StringFilterField rather than by string, so a field the console
  // filters on but this query forgot to select is a compile error rather than an
  // empty dropdown.
  const grouped: Record<StringFilterField, string[]> = {
    channel: [],
    category: [],
    polarity: [],
    dimension: [],
    severity: [],
    state: [],
    owner: [],
    unit: [],
    level1: [],
  };
  for (const row of rows) {
    const bucket = grouped[row.field as StringFilterField];
    if (bucket) bucket.push(row.value);
  }
  for (const bucket of Object.values(grouped)) {
    bucket.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }
  return grouped;
}

// GROUP BY user_ref / device_ref, replacing a pass over all 3628 rows in memory.
//
// A transcription of profiles.ts: same blank-identity exclusion, same terminal-state
// split, same ordering (heaviest first, id breaking ties), and the same restriction
// to repeat profiles — 2172 of 2772 users have a single record and would bury the 600
// that carry a pattern.
//
// Sorting of the distinct arrays stays in JavaScript so the collation matches what
// the reference produced; Postgres's own ordering of Chinese text depends on the
// database's locale and would differ.
export async function readProfiles(
  kind: "user" | "device",
): Promise<Readonly<{ profiles: readonly IdentityProfile[]; total: number }>> {
  const column = kind === "user" ? "user_ref" : "device_ref";
  // dimensions is pre-aggregated in its own CTE and joined, rather than fetched by a
  // correlated subquery per group. The first version did the latter, which re-scans
  // the whole table once per group — 2772 scans for the user view — and is the kind
  // of N+1 that hides inside a single statement and looks like one query.
  const rows = (await getSql().query(
    `WITH dims AS (
       SELECT ${column} AS id, array_agg(DISTINCT d) AS dimensions
       FROM voc_records, unnest(dimensions) AS d
       WHERE ${column} <> '' AND d <> ''
       GROUP BY ${column}
     )
     SELECT
       r.${column} AS id,
       COUNT(*)::int AS records,
       COUNT(*) FILTER (WHERE r.severity = '高')::int AS severity_high,
       COUNT(*) FILTER (WHERE r.state NOT IN ('已闭环', '无需跟进'))::int AS open,
       COUNT(*) FILTER (WHERE r.state IN ('已闭环', '无需跟进'))::int AS closed,
       MIN(r.feedback_at) AS first_feedback_at,
       MAX(r.feedback_at) AS last_feedback_at,
       array_agg(DISTINCT r.category) FILTER (WHERE r.category <> '') AS categories,
       array_agg(DISTINCT r.model) FILTER (WHERE r.model <> '') AS models,
       array_agg(DISTINCT r.channel) FILTER (WHERE r.channel <> '') AS channels,
       dims.dimensions AS dimensions
     FROM voc_records r
     LEFT JOIN dims ON dims.id = r.${column}
     WHERE r.${column} <> ''
     GROUP BY r.${column}, dims.dimensions
     ORDER BY COUNT(*) DESC, r.${column} ASC`,
  )) as Record<string, unknown>[];

  const sortText = (values: unknown): readonly string[] =>
    (Array.isArray(values) ? values.filter((v): v is string => typeof v === "string") : [])
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  const iso = (value: unknown): string | null =>
    value instanceof Date ? value.toISOString() : null;

  const all = rows.map((row) => ({
    id: String(row.id ?? ""),
    records: Number(row.records ?? 0),
    categories: sortText(row.categories),
    models: sortText(row.models),
    channels: sortText(row.channels),
    dimensions: sortText(row.dimensions),
    severityHigh: Number(row.severity_high ?? 0),
    open: Number(row.open ?? 0),
    closed: Number(row.closed ?? 0),
    firstFeedbackAt: iso(row.first_feedback_at),
    lastFeedbackAt: iso(row.last_feedback_at),
  }));

  return {
    profiles: all.filter((profile) => profile.records > 1),
    total: all.length,
  };
}

// The one profile a detail page needs, including single-record identities that the
// list above deliberately omits.
export async function readProfile(
  kind: "user" | "device",
  id: string,
): Promise<IdentityProfile | null> {
  const { profiles, total } = await readProfiles(kind);
  const listed = profiles.find((profile) => profile.id === id);
  if (listed) return listed;
  if (total === 0) return null;
  // A single-record identity: one more grouped query, scoped to it.
  const column = kind === "user" ? "user_ref" : "device_ref";
  const rows = (await getSql().query(
    `SELECT * FROM voc_records WHERE ${column} = $1`,
    [id],
  )) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const tickets = rows.map((row) => toWorkbenchTicket(toVocRecord(row)));
  const grouped =
    kind === "user" ? userProfiles(tickets) : deviceProfiles(tickets);
  return grouped[0] ?? null;
}

// aggregateVocMetrics in SQL: one statement for the scalars, two small ones for the
// dimension and channel breakdowns. This was the last surface reading all 3628 rows
// to render a page.
//
// A transcription, field by field:
//   total              COUNT(*)
//   byPolarity         three FILTERed counts, always all three keys present
//   negativeShare      (中评 + 差评) / tagged, where tagged = the three polarity counts
//   ticketsOpened      records with a 建单时间
//   ticketsClosed      of those, records with a 闭环时间
//   closureRate        closed / opened, 0 when opened is 0
//   averageClosureHours mean over closed records only
//   taggingAttempted   COUNT(*) — the reference counts every record, not just tagged
//   taggingSucceeded   the six post-tagging states
//   taggingFailed      分析失败
//   taggingPending     待分析
//   effort             taggedRecords × minutes / 60, only when a baseline is supplied
export async function readVocMetrics(
  options: Readonly<{ manualMinutesPerRecord?: number }> = {},
): Promise<VocMetrics> {
  const sql = getSql();

  const [scalars, dimensionRows, channelRows] = await Promise.all([
    sql.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE polarity = '好评')::int AS good,
        COUNT(*) FILTER (WHERE polarity = '中评')::int AS neutral,
        COUNT(*) FILTER (WHERE polarity = '差评')::int AS bad,
        COUNT(*) FILTER (WHERE ticket_opened_at IS NOT NULL)::int AS opened,
        COUNT(*) FILTER (WHERE ticket_opened_at IS NOT NULL AND closed_at IS NOT NULL)::int AS closed,
        COALESCE(AVG(
          EXTRACT(EPOCH FROM (closed_at - ticket_opened_at)) / 3600.0
        ) FILTER (WHERE ticket_opened_at IS NOT NULL AND closed_at IS NOT NULL), 0) AS avg_closure_hours,
        COUNT(*) FILTER (
          WHERE state IN ('已分析', '无需跟进', '待跟进', '跟进中', '待闭环', '已闭环')
        )::int AS tagged,
        COUNT(*) FILTER (WHERE state = '分析失败')::int AS failed,
        COUNT(*) FILTER (WHERE state = '待分析')::int AS pending
      FROM voc_records
    `),
    sql.query(`
      SELECT d AS key, COUNT(*)::int AS count
      FROM voc_records, unnest(dimensions) AS d
      GROUP BY d
      ORDER BY COUNT(*) DESC, d ASC
    `),
    sql.query(`
      SELECT channel AS key, COUNT(*)::int AS count
      FROM voc_records
      GROUP BY channel
      ORDER BY COUNT(*) DESC, channel ASC
    `),
  ]);

  const row = (scalars as Record<string, unknown>[])[0] ?? {};
  const num = (value: unknown): number => Number(value ?? 0);
  const ratio = (numerator: number, denominator: number): number =>
    denominator === 0 ? 0 : numerator / denominator;

  const byPolarity = {
    好评: num(row.good),
    中评: num(row.neutral),
    差评: num(row.bad),
  };
  const taggedTotal = byPolarity.好评 + byPolarity.中评 + byPolarity.差评;
  const opened = num(row.opened);
  const closed = num(row.closed);
  const taggedCount = num(row.tagged);

  const metrics: VocMetrics = {
    total: num(row.total),
    byPolarity,
    dimensionTop: (dimensionRows as { key: string; count: number }[]).map(
      (item) => ({ dimension: item.key as VocDimension, count: item.count }),
    ),
    byChannel: (channelRows as { key: string; count: number }[]).map((item) => ({
      channel: item.key,
      count: item.count,
    })),
    negativeShare: ratio(byPolarity.差评 + byPolarity.中评, taggedTotal),
    ticketsOpened: opened,
    ticketsClosed: closed,
    closureRate: ratio(closed, opened),
    averageClosureHours: num(row.avg_closure_hours),
    taggingAttempted: num(row.total),
    taggingSucceeded: taggedCount,
    taggingFailed: num(row.failed),
    taggingPending: num(row.pending),
  };

  if (options.manualMinutesPerRecord === undefined) return metrics;
  return {
    ...metrics,
    effort: {
      taggedRecords: taggedCount,
      manualMinutesPerRecord: options.manualMinutesPerRecord,
      savedHours: (taggedCount * options.manualMinutesPerRecord) / 60,
    },
  };
}
