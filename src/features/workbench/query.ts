import { VOC_POLARITIES, VOC_DIMENSIONS, VOC_SEVERITIES } from "../voc/triage";
import { VOC_STATES } from "../voc/service-event";
import type { WorkbenchTicket } from "./data";

// Everything here is driven by URL query parameters and runs on the server, so
// the whole triage surface — queues, filters, search, sort, paging — works
// without shipping a line of JavaScript or handing 3628 rows to the browser.
// A shared link reproduces exactly what the sender was looking at, which is
// what an operator actually does when escalating something.

export const QUEUES = [
  {
    key: "open",
    label: "待处理",
    hint: "已建单但还没闭环，也没有被判为无需跟进",
  },
  {
    key: "overdue",
    label: "超时风险",
    hint: "停留超过 72 小时且仍未闭环",
  },
  {
    key: "unassigned",
    label: "未分配",
    hint: "已建单但没有负责人，谁都不会去看",
  },
  {
    key: "failed",
    label: "分析异常",
    hint: "打标失败或重试次数已到上限，需要人介入",
  },
  {
    key: "all",
    label: "全部",
    hint: "含尚未打标的全部记录",
  },
] as const;

export type QueueKey = (typeof QUEUES)[number]["key"];

// 72 hours. Not a configured SLA — the enterprise has not given one — so it is
// named as an assumption everywhere it surfaces rather than presented as a
// contractual breach.
export const ASSUMED_SLA_HOURS = 72;

const TERMINAL_STATES = new Set(["已闭环", "无需跟进"]);
const FAILED_STATES = new Set(["分析失败"]);

export const SORTS = [
  { key: "feedback_desc", label: "反馈时间（新→旧）" },
  { key: "feedback_asc", label: "反馈时间（旧→新）" },
  { key: "dwell_desc", label: "停留时长（长→短）" },
  { key: "severity_desc", label: "严重度（高→低）" },
] as const;

export type SortKey = (typeof SORTS)[number]["key"];

// The console's top-level navigation. Lives in the URL rather than in component
// state so a link can point at 设备追踪 — while these were content tabs, any
// navigation bounced back to the ticket list and no link could address them.
export const SECTIONS = ["tickets", "users", "devices", "metrics"] as const;

export type SectionKey = (typeof SECTIONS)[number];

export const PAGE_SIZE = 50;

export type WorkbenchQuery = Readonly<{
  section: SectionKey;
  queue: QueueKey;
  channel: string | null;
  category: string | null;
  polarity: string | null;
  dimension: string | null;
  severity: string | null;
  state: string | null;
  owner: string | null;
  unit: string | null;
  level1: string | null;
  // An exact source case number, not a search term: the drawer links here to show
  // every record that came from the same 400 case or the same review.
  sourceTicketNo: string | null;
  // Exact identity filters, set by clicking a row in the profile tabs.
  userRef: string | null;
  deviceRef: string | null;
  search: string;
  sort: SortKey;
  page: number;
}>;

type RawParams = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// An unrecognised value becomes null rather than an error or an empty result.
// A stale bookmark or a hand-edited URL should show the operator a slightly
// wider list, never an error page and never a silently empty one they might
// read as "nothing to do".
function oneOf(
  value: string | string[] | undefined,
  allowed: readonly string[],
): string | null {
  const candidate = first(value);
  return candidate !== null && allowed.includes(candidate) ? candidate : null;
}

export function parseWorkbenchQuery(params: RawParams): WorkbenchQuery {
  const queueKeys = QUEUES.map((queue) => queue.key);
  const sortKeys = SORTS.map((sort) => sort.key);
  const rawPage = Number(first(params.page) ?? "1");

  return {
    section: (oneOf(params.section, SECTIONS) ?? "tickets") as SectionKey,
    queue: (oneOf(params.queue, queueKeys) ?? "open") as QueueKey,
    channel: first(params.channel),
    category: first(params.category),
    polarity: oneOf(params.polarity, VOC_POLARITIES),
    dimension: oneOf(params.dimension, VOC_DIMENSIONS),
    severity: oneOf(params.severity, VOC_SEVERITIES),
    state: oneOf(params.state, VOC_STATES),
    owner: first(params.owner),
    unit: first(params.unit),
    level1: first(params.level1),
    sourceTicketNo: first(params.ticketNo),
    userRef: first(params.user),
    deviceRef: first(params.device),
    search: first(params.search) ?? "",
    sort: (oneOf(params.sort, sortKeys) ?? "feedback_desc") as SortKey,
    page: Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1,
  };
}

// Dwell time is measured from when the ticket was opened, or from the feedback
// itself when no ticket exists yet — an untriaged complaint is aging too, and
// measuring only opened tickets would hide the worst backlog. Returns null for
// records that are already finished, because "this closed ticket has been open
// 400 hours" is noise in a queue meant to show what still needs work.
export function dwellHours(
  ticket: WorkbenchTicket,
  now: number,
): number | null {
  if (TERMINAL_STATES.has(ticket.state)) return null;
  const startedAt = ticket.ticketOpenedAt ?? ticket.feedbackAt;
  if (!startedAt) return null;
  const parsed = Date.parse(startedAt);
  if (!Number.isFinite(parsed)) return null;
  const hours = (now - parsed) / 3_600_000;
  return hours < 0 ? 0 : hours;
}

export function isOverdue(ticket: WorkbenchTicket, now: number): boolean {
  const hours = dwellHours(ticket, now);
  return hours !== null && hours > ASSUMED_SLA_HOURS;
}

function inQueue(
  ticket: WorkbenchTicket,
  queue: QueueKey,
  now: number,
): boolean {
  switch (queue) {
    case "open":
      return ticket.ticketOpenedAt !== null && !TERMINAL_STATES.has(ticket.state);
    case "overdue":
      return isOverdue(ticket, now);
    case "unassigned":
      return ticket.ticketOpenedAt !== null && ticket.ownerNames.length === 0;
    case "failed":
      return FAILED_STATES.has(ticket.state);
    case "all":
      return true;
  }
}

// Case-insensitive substring over the fields an operator would actually search:
// the complaint text, the model, and the record number they were handed in a
// chat. Not the owner name — an owner filter exists for that, and folding it in
// here would make "张" match every ticket that person owns.
function matchesSearch(ticket: WorkbenchTicket, search: string): boolean {
  if (search.length === 0) return true;
  const needle = search.toLowerCase();
  return (
    ticket.content.toLowerCase().includes(needle) ||
    ticket.model.toLowerCase().includes(needle) ||
    ticket.recordNumber.toLowerCase().includes(needle) ||
    // An operator handed a 400 case number in chat pastes it here, and it is not
    // the record number — it is the number the customer's own call was logged
    // under, which is what anyone outside this system will quote.
    ticket.sourceTicketNo.toLowerCase().includes(needle)
  );
}

function matchesFilters(ticket: WorkbenchTicket, query: WorkbenchQuery): boolean {
  if (query.channel !== null && ticket.channel !== query.channel) return false;
  if (query.category !== null && ticket.category !== query.category) return false;
  if (query.polarity !== null && ticket.polarity !== query.polarity) return false;
  if (query.severity !== null && ticket.severity !== query.severity) return false;
  if (query.state !== null && ticket.state !== query.state) return false;
  if (
    query.dimension !== null &&
    !ticket.dimensions.includes(query.dimension as never)
  ) {
    return false;
  }
  if (query.owner !== null && !ticket.ownerNames.includes(query.owner)) {
    return false;
  }
  if (query.unit !== null && ticket.businessUnit !== query.unit) return false;
  if (query.level1 !== null && ticket.categoryLevel1 !== query.level1) {
    return false;
  }
  if (
    query.sourceTicketNo !== null &&
    ticket.sourceTicketNo !== query.sourceTicketNo
  ) {
    return false;
  }
  if (query.userRef !== null && ticket.userRef !== query.userRef) return false;
  if (query.deviceRef !== null && ticket.deviceRef !== query.deviceRef) {
    return false;
  }
  return matchesSearch(ticket, query.search);
}

const SEVERITY_RANK: Readonly<Record<string, number>> = {
  高: 3,
  中: 2,
  低: 1,
};

function feedbackRank(ticket: WorkbenchTicket): number {
  if (!ticket.feedbackAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(ticket.feedbackAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

// A final tiebreak on the record number, so the order is total rather than
// merely sorted. Ties were previously left to Array.prototype.sort's stability,
// which means "whatever order the source returned them in" — fine on its own, and
// impossible to reproduce in SQL. With a deterministic last key, this function and
// the Postgres ORDER BY that mirrors it can be compared row for row, which is how
// the two are kept honest about agreeing.
function compare(
  a: WorkbenchTicket,
  b: WorkbenchTicket,
  sort: SortKey,
  now: number,
): number {
  return rank(a, b, sort, now) || a.recordNumber.localeCompare(b.recordNumber);
}

function rank(
  a: WorkbenchTicket,
  b: WorkbenchTicket,
  sort: SortKey,
  now: number,
): number {
  switch (sort) {
    case "feedback_desc":
      return feedbackRank(b) - feedbackRank(a);
    case "feedback_asc":
      // Records with no feedback time still sort last rather than first, so a
      // blank timestamp never masquerades as the oldest, most urgent item.
      return feedbackRank(a) === Number.NEGATIVE_INFINITY
        ? 1
        : feedbackRank(b) === Number.NEGATIVE_INFINITY
          ? -1
          : feedbackRank(a) - feedbackRank(b);
    case "dwell_desc":
      return (dwellHours(b, now) ?? -1) - (dwellHours(a, now) ?? -1);
    case "severity_desc":
      return (
        (SEVERITY_RANK[b.severity ?? ""] ?? 0) -
          (SEVERITY_RANK[a.severity ?? ""] ?? 0) ||
        feedbackRank(b) - feedbackRank(a)
      );
  }
}

export type WorkbenchPage = Readonly<{
  rows: readonly WorkbenchTicket[];
  matched: number;
  page: number;
  pageCount: number;
  queueCounts: Readonly<Record<QueueKey, number>>;
}>;

export function applyWorkbenchQuery(
  tickets: readonly WorkbenchTicket[],
  query: WorkbenchQuery,
  now: number,
): WorkbenchPage {
  // Queue counts are computed over every record and ignore the filters, so the
  // tabs keep telling the truth about the whole backlog while the operator
  // narrows the list. A count that moved with the filters would make "待处理 12"
  // mean something different on every page.
  const queueCounts = Object.fromEntries(
    QUEUES.map((queue) => [
      queue.key,
      tickets.filter((ticket) => inQueue(ticket, queue.key, now)).length,
    ]),
  ) as Record<QueueKey, number>;

  const matchedRows = tickets
    .filter((ticket) => inQueue(ticket, query.queue, now))
    .filter((ticket) => matchesFilters(ticket, query))
    .slice()
    .sort((a, b) => compare(a, b, query.sort, now));

  const pageCount = Math.max(1, Math.ceil(matchedRows.length / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const start = (page - 1) * PAGE_SIZE;

  return {
    rows: matchedRows.slice(start, start + PAGE_SIZE),
    matched: matchedRows.length,
    page,
    pageCount,
    queueCounts,
  };
}
