import type { AuthUser } from "../src/features/auth/types";
import type { WorkbenchData, WorkbenchTicket } from "../src/features/workbench/data";
import type { StringFilterField } from "../src/features/workbench/href";
import {
  applyWorkbenchQuery,
  parseWorkbenchQuery,
} from "../src/features/workbench/query";
import {
  deviceProfiles,
  repeatOnly,
  userProfiles,
} from "../src/features/workbench/profiles";
import { WorkbenchConsole } from "./workbench-console";

type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

// Distinct values for one filter, taken from every record rather than from the
// current page: a filter that only offers what happens to be on screen cannot
// be used to find what is off it. Sorted so the list is stable between renders —
// Bitable returns records in no guaranteed order, and an option list that
// reshuffles on every load is unusable even when its contents are correct.
function distinctValues(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN"),
  );
}

function filterOptions(
  tickets: readonly WorkbenchTicket[],
): Readonly<Record<StringFilterField, readonly string[]>> {
  return {
    channel: distinctValues(tickets.map((ticket) => ticket.channel)),
    category: distinctValues(tickets.map((ticket) => ticket.category)),
    polarity: distinctValues(tickets.map((ticket) => ticket.polarity ?? "")),
    dimension: distinctValues(tickets.flatMap((ticket) => ticket.dimensions)),
    severity: distinctValues(tickets.map((ticket) => ticket.severity ?? "")),
    state: distinctValues(tickets.map((ticket) => ticket.state)),
    owner: distinctValues(tickets.flatMap((ticket) => ticket.ownerNames)),
    unit: distinctValues(tickets.map((ticket) => ticket.businessUnit)),
    level1: distinctValues(tickets.map((ticket) => ticket.categoryLevel1)),
  };
}

type WorkbenchContentProps = Readonly<{
  data: WorkbenchData;
  user: AuthUser;
  // Passed in rather than read from Date.now() here: queues, the overdue marker
  // and dwell time all key off "now", and this app runs under Next's Cache
  // Components model, where a component that reaches for the wall clock makes
  // its own caching behaviour far harder to reason about. The page decides
  // "now" once and hands it down.
  now: number;
  searchParams: RawSearchParams;
}>;

// The whole of the workbench's rendering now lives in WorkbenchConsole, an Arco
// client component. What stays on the server is everything that must: reading
// the URL, filtering and paging 3628 records so only 50 cross the wire, and
// deriving the filter option lists from the full set.
//
// The query itself remains URL state rather than component state. The console
// navigates by pushing the URLs that src/features/workbench/href.ts builds, so a
// pasted link still reproduces the exact view its sender was looking at — the
// property that made this design worth keeping when the presentation moved to a
// component library.
export function WorkbenchContent({
  data,
  user,
  now,
  searchParams,
}: WorkbenchContentProps) {
  const query = parseWorkbenchQuery(searchParams);
  const view = applyWorkbenchQuery(data.tickets, query, now);

  // Only the profiles that carry a pattern cross the wire. 2172 of 2772 users and
  // 648 of 854 devices have a single record; sending all of them would bury the
  // ones worth looking at and serialize ~3600 rows into the page for nothing.
  // The totals travel alongside so the UI can say what it left out rather than
  // presenting a filtered list as if it were complete.
  const users = userProfiles(data.tickets);
  const devices = deviceProfiles(data.tickets);

  return (
    <WorkbenchConsole
      user={user}
      metrics={data.metrics.status === "ok" ? data.metrics.metrics : null}
      view={view}
      query={query}
      now={now}
      options={filterOptions(data.tickets)}
      users={repeatOnly(users)}
      devices={repeatOnly(devices)}
      userTotal={users.length}
      deviceTotal={devices.length}
    />
  );
}
