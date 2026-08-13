import type { AuthUser } from "../src/features/auth/types";
import type { StringFilterField } from "../src/features/workbench/href";
import { parseWorkbenchQuery } from "../src/features/workbench/query";
import {
  readFilterOptions,
  readProfile,
  readProfiles,
  readWorkbenchPage,
} from "../src/features/store/workbench-query";
import { readWorkbenchCached } from "./api/voc/dashboard/route";
import { WorkbenchConsole } from "./workbench-console";

type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

const EMPTY_PROFILES = { profiles: [], total: 0 } as const;

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

  // Fetched per section, and only the overview still reads the whole table — its
  // aggregate (aggregateVocMetrics) has a wider surface than the profile grouping and
  // is the one section an operator rarely opens, so it keeps the cached full read
  // rather than a rushed transcription into SQL.
  const needsFullSet = query.section === "metrics";
  const data = needsFullSet ? await readWorkbenchCached() : null;

  // Profiles are a GROUP BY now, not a pass over 3628 rows.
  const users =
    query.section === "users" ? await readProfiles("user") : EMPTY_PROFILES;
  const devices =
    query.section === "devices" ? await readProfiles("device") : EMPTY_PROFILES;

  // Looked up separately because the lists above carry only repeat profiles: a
  // single-record identity would otherwise open to an empty page.
  const selectedProfile =
    query.userRef !== null
      ? await readProfile("user", query.userRef)
      : query.deviceRef !== null
        ? await readProfile("device", query.deviceRef)
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
      users={users.profiles}
      devices={devices.profiles}
      userTotal={users.total}
      deviceTotal={devices.total}
      selectedProfile={selectedProfile}
    />
  );
}
