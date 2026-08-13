import type { AuthUser } from "../src/features/auth/types";
import type { StringFilterField } from "../src/features/workbench/href";
import { parseWorkbenchQuery } from "../src/features/workbench/query";
import {
  deviceProfiles,
  repeatOnly,
  userProfiles,
} from "../src/features/workbench/profiles";
import {
  readFilterOptions,
  readWorkbenchPage,
} from "../src/features/store/workbench-query";
import { readWorkbenchCached } from "./api/voc/dashboard/route";
import { WorkbenchConsole } from "./workbench-console";

type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

const NO_OPTIONS: Readonly<Record<StringFilterField, readonly string[]>> = {
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

type WorkbenchContentProps = Readonly<{
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
// The list query remains URL state rather than component state. The console
// navigates by pushing the URLs that src/features/workbench/href.ts builds, so a
// pasted list link still reproduces the exact view its sender was looking at.
export async function WorkbenchContent({
  user,
  now,
  searchParams,
}: WorkbenchContentProps) {
  const query = parseWorkbenchQuery(searchParams);

  // Always: the sider's five queue counts, and — on the ticket section — one page of
  // rows. Both come from aggregate SQL rather than from 3628 rows in memory, which
  // is the whole point of having a database: a page is one query, the counts are one
  // GROUP BY, and neither transfers rows nobody will read.
  const view = await readWorkbenchPage(query, now);

  // Everything below is fetched only for the section that needs it. The profile and
  // overview sections still aggregate in JavaScript over the full set, so they still
  // pay for reading it — but the ticket list, which is where an operator spends
  // their time and which every navigation returns to, no longer does.
  const needsFullSet = query.section !== "tickets";
  const data = needsFullSet ? await readWorkbenchCached() : null;
  const tickets = data?.tickets ?? [];

  const users = needsFullSet ? userProfiles(tickets) : [];
  const devices = needsFullSet ? deviceProfiles(tickets) : [];

  // The one profile a detail view needs, looked up across every record rather than
  // taken from the repeat-only lists the console receives — a single-record identity
  // would otherwise open to an empty page.
  const selectedProfile =
    query.userRef !== null
      ? (users.find((profile) => profile.id === query.userRef) ?? null)
      : query.deviceRef !== null
        ? (devices.find((profile) => profile.id === query.deviceRef) ?? null)
        : null;

  return (
    <WorkbenchConsole
      user={user}
      metrics={
        data === null
          ? null
          : data.metrics.status === "ok"
            ? data.metrics.metrics
            : null
      }
      view={view}
      query={query}
      now={now}
      options={
        query.section === "tickets" ? await readFilterOptions() : NO_OPTIONS
      }
      users={repeatOnly(users)}
      devices={repeatOnly(devices)}
      userTotal={users.length}
      deviceTotal={devices.length}
      selectedProfile={selectedProfile}
    />
  );
}
