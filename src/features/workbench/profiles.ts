import type { WorkbenchTicket } from "./data";

// Aggregates the ticket table by the two reconstructed identities. Pure functions
// over records already fetched — no second Bitable read, and the same 3628 rows
// the queue views are built from.
//
// What these can and cannot show, measured rather than assumed:
//
// - 2772 users, 600 of them with more than one record (1456 records). Real,
//   because a shared 来源单号 means one support case and therefore one person.
// - **0 users span more than one product category**, because one case concerns one
//   product. A "user" here is much closer to a case than to a lifetime customer,
//   which is why nothing below claims lifetime behaviour and why the UI says so.
// - 854 devices, 206 of them reported more than once (498 records). This is the
//   signal worth a tab: a device instance failing repeatedly is a batch-quality
//   lead, which is exactly what the architecture spec asks 设备 ID to surface
//   ("关联设备状态、型号与历史").

export type IdentityProfile = Readonly<{
  id: string;
  records: number;
  // Distinct product categories seen. Always 1 for users on the current data; kept
  // because devices can legitimately differ and because a future real upstream
  // (where a user does have several cases) would populate it.
  categories: readonly string[];
  models: readonly string[];
  channels: readonly string[];
  dimensions: readonly string[];
  severityHigh: number;
  open: number;
  closed: number;
  firstFeedbackAt: string | null;
  lastFeedbackAt: string | null;
}>;

const TERMINAL = new Set(["已闭环", "无需跟进"]);

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN"),
  );
}

function earliest(dates: readonly (string | null)[]): string | null {
  const usable = dates.filter((date): date is string => date !== null);
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

function latest(dates: readonly (string | null)[]): string | null {
  const usable = dates.filter((date): date is string => date !== null);
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

function toProfile(id: string, group: readonly WorkbenchTicket[]): IdentityProfile {
  return {
    id,
    records: group.length,
    categories: distinct(group.map((ticket) => ticket.category)),
    models: distinct(group.map((ticket) => ticket.model)),
    channels: distinct(group.map((ticket) => ticket.channel)),
    dimensions: distinct(group.flatMap((ticket) => ticket.dimensions)),
    severityHigh: group.filter((ticket) => ticket.severity === "高").length,
    open: group.filter((ticket) => !TERMINAL.has(ticket.state)).length,
    closed: group.filter((ticket) => TERMINAL.has(ticket.state)).length,
    firstFeedbackAt: earliest(group.map((ticket) => ticket.feedbackAt)),
    lastFeedbackAt: latest(group.map((ticket) => ticket.feedbackAt)),
  };
}

// Sorted by record count first: a profile list is a list of *who is complaining
// most*, and an alphabetical list of 2772 synthetic ids answers no question at
// all. The id breaks ties so the order is stable between renders.
function byWeight(a: IdentityProfile, b: IdentityProfile): number {
  return b.records - a.records || a.id.localeCompare(b.id);
}

function group(
  tickets: readonly WorkbenchTicket[],
  key: (ticket: WorkbenchTicket) => string,
): readonly IdentityProfile[] {
  const groups = new Map<string, WorkbenchTicket[]>();
  for (const ticket of tickets) {
    const id = key(ticket).trim();
    // A blank identity is not an identity. Grouping every unidentified record
    // together would report one enormous profile that describes nothing — the same
    // reason selectedRelated refuses to group on an empty case number.
    if (id.length === 0) continue;
    const bucket = groups.get(id);
    if (bucket) bucket.push(ticket);
    else groups.set(id, [ticket]);
  }
  return [...groups.entries()]
    .map(([id, members]) => toProfile(id, members))
    .sort(byWeight);
}

export function userProfiles(
  tickets: readonly WorkbenchTicket[],
): readonly IdentityProfile[] {
  return group(tickets, (ticket) => ticket.userRef);
}

export function deviceProfiles(
  tickets: readonly WorkbenchTicket[],
): readonly IdentityProfile[] {
  return group(tickets, (ticket) => ticket.deviceRef);
}

// Only the profiles worth looking at. A list where 2172 of 2772 rows have exactly
// one record buries the 600 that carry a pattern, and for devices the
// more-than-once rows are the entire point of the view.
export function repeatOnly(
  profiles: readonly IdentityProfile[],
): readonly IdentityProfile[] {
  return profiles.filter((profile) => profile.records > 1);
}
