import type { WorkbenchQuery } from "./query";

// Every workbench URL is built here, by both the server that renders the first
// page and the client console that navigates within it. Two implementations of
// "what does this link point at" would drift, and the drift would show up as a
// shared link reproducing a different view than the sender was looking at —
// which is the one property this whole URL-as-state design exists to provide.

export type QueryPatch = Readonly<
  Partial<
    Record<
      | "section"
      | "queue"
      | "channel"
      | "category"
      | "polarity"
      | "dimension"
      | "severity"
      | "state"
      | "owner"
      | "unit"
      | "level1"
      | "ticketNo"
      | "user"
      | "device"
      | "search"
      | "sort"
      | "page",
      string | null
    >
  >
>;

export type StringFilterField =
  | "channel"
  | "category"
  | "polarity"
  | "dimension"
  | "severity"
  | "state"
  | "owner"
  | "unit"
  | "level1";

function baseParams(query: WorkbenchQuery): Record<string, string | null> {
  return {
    section: query.section === "tickets" ? null : query.section,
    queue: query.queue,
    channel: query.channel,
    category: query.category,
    polarity: query.polarity,
    dimension: query.dimension,
    severity: query.severity,
    state: query.state,
    owner: query.owner,
    unit: query.unit,
    level1: query.level1,
    ticketNo: query.sourceTicketNo,
    user: query.userRef,
    device: query.deviceRef,
    search: query.search.length > 0 ? query.search : null,
    sort: query.sort,
    page: query.page > 1 ? String(query.page) : null,
  };
}

function toHref(params: Readonly<Record<string, string | null>>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value.length > 0) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs.length > 0 ? `/?${qs}` : "/";
}

// Changing the queue, a filter, the search term or the sort order always lands
// back on page one: the matched set just changed, so whatever "page 3" meant a
// moment ago no longer describes it.
export function filterHref(query: WorkbenchQuery, patch: QueryPatch): string {
  return toHref({ ...baseParams(query), page: null, ...patch });
}

export function pageHref(query: WorkbenchQuery, page: number): string {
  return toHref({ ...baseParams(query), page: page > 1 ? String(page) : null });
}

// Rebuild the allowlisted list view so returning from a detail page preserves
// its queue, filters, search, sort and page.
export function listHref(query: WorkbenchQuery): string {
  return toHref(baseParams(query));
}

// The reverse of the encoding below, applied to whatever the router hands the page.
//
// 225 of the 3628 records carry a 记录编号 that came out of the enterprise's Excel as a
// number in scientific notation ("2.0148551742220401E+18"). ticketDetailHref percent-
// encodes that "+" as %2B, correctly — but the param arrives at the page still encoded,
// so the lookup searched for the literal text "…E%2B18", found nothing, and every one of
// those 225 tickets rendered as "工单不存在或已被移除".
//
// A malformed sequence decodes to itself rather than throwing: a record number is data,
// and a URL somebody hand-edited must not take the page down.
export function decodeRecordNumber(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function ticketDetailHref(
  query: WorkbenchQuery,
  recordNumber: string,
): string {
  const list = new URL(listHref(query), "https://onecare.invalid");
  const search = list.searchParams.toString();
  const path = `/workbench/tickets/${encodeURIComponent(recordNumber)}`;
  return search ? `${path}?${search}` : path;
}

// A computed property key needs an assertion because TypeScript cannot see that
// `field`'s type is exactly the subset of QueryPatch's keys it indexes —
// StringFilterField is that subset by construction (every member also names a
// string-or-null field on WorkbenchQuery), so this is a type-level fact about
// the shape above rather than an unchecked escape hatch around an unverified
// value.
export function toPatch(
  field: StringFilterField,
  value: string | null,
): QueryPatch {
  return { [field]: value } as QueryPatch;
}
