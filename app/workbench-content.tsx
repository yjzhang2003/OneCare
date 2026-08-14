import type { AuthUser } from "../src/features/auth/types";
import type { Member } from "../src/features/directory/members";
import type { OwnerRuleRecord } from "../src/features/voc/owner-rules";
import type { StringFilterField } from "../src/features/workbench/href";
import { parseWorkbenchQuery } from "../src/features/workbench/query";
import { listAssignableMembers } from "../src/features/directory/members";
import { createTenantTokenProvider } from "../src/features/bitable/client";
import { listOwnerRuleRecords } from "../src/features/voc/owner-directory";
import { readBitableEnv, readBotEnv } from "../src/lib/env";
import {
  readFilterOptions,
  readProfile,
  readProfileCounts,
  readProfiles,
  readVocMetrics,
  readWorkbenchPage,
} from "../src/features/store/workbench-query";
import { ASSUMED_MANUAL_MINUTES_PER_RECORD } from "./api/voc/dashboard/route";
import { WorkbenchConsole } from "./workbench-console";

type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

const EMPTY_PROFILES = {
  profiles: [],
  matched: 0,
  total: 0,
  page: 1,
  pageCount: 1,
} as const;

const EMPTY_OWNERS = {
  rules: [] as readonly OwnerRuleRecord[],
  members: [] as readonly Member[],
  unavailable: false,
} as const;

// Both reads are best-effort and independent: a directory that cannot be read leaves the
// person picker empty (and the page says so), while a routing table that cannot be read
// is the one failure the page must not disguise as "no rules".
async function readOwners(): Promise<{
  rules: readonly OwnerRuleRecord[];
  members: readonly Member[];
  unavailable: boolean;
}> {
  const token = () => {
    const bot = readBotEnv();
    return createTenantTokenProvider(bot.appId, bot.appSecret);
  };

  const [rules, members] = await Promise.all([
    listOwnerRuleRecords({ bitable: readBitableEnv(), token: token() })
      .then((value) => ({ value }))
      .catch((error: unknown) => {
        console.error(
          "Owner rules read failed:",
          error instanceof Error ? error.message : String(error),
        );
        return { value: null };
      }),
    listAssignableMembers({ tenantToken: () => token()() }).catch(() => []),
  ]);

  return {
    rules: rules.value ?? [],
    members,
    unavailable: rules.value === null,
  };
}

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

  // One Promise.all, not a chain of awaits. Every read below is an independent HTTP
  // round trip to Neon, so awaiting them in sequence adds their latencies together:
  // the section reads waited on the queue counts, which waited on nothing at all.
  // Only the reads this section actually needs are dispatched; the rest resolve
  // immediately to their empty values.
  const [
    view,
    profileCounts,
    metrics,
    users,
    devices,
    selectedProfile,
    options,
    owners,
  ] = await Promise.all([
      // Always: the sider's five queue counts, and — on the ticket section — one page
      // of rows. Both come from aggregate SQL rather than from 3628 rows in memory,
      // which is the whole point of having a database: a page is one query, the
      // counts are one GROUP BY, and neither transfers rows nobody will read.
      readWorkbenchPage(query, now),

      // Read on every section, unlike the two lists below. The sider carries a count
      // for 用户画像 and 设备追踪 on every page, and taking those numbers from the
      // lists meant reporting 0 on every section that does not load them.
      readProfileCounts(),

      // Nothing here reads the whole table any more. The overview was the last one,
      // and its thirteen fields are now aggregates rather than a pass over 3628 rows.
      query.section === "metrics"
        ? readVocMetrics({
            manualMinutesPerRecord: ASSUMED_MANUAL_MINUTES_PER_RECORD,
          })
        : null,

      // Profiles are a GROUP BY now, not a pass over 3628 rows — and they carry the
      // query, so the same filters and search the ticket list uses narrow them too.
      query.section === "users" ? readProfiles("user", query) : EMPTY_PROFILES,
      query.section === "devices" ? readProfiles("device", query) : EMPTY_PROFILES,

      // Looked up separately because the lists above carry only repeat profiles: a
      // single-record identity would otherwise open to an empty page.
      query.userRef !== null
        ? readProfile("user", query.userRef)
        : query.deviceRef !== null
          ? readProfile("device", query.deviceRef)
          : null,

      // The filter selects need their option lists wherever they are rendered, which
      // is now the two profile lists as well. Not on a profile *detail* page: that
      // page is one identity's records and has no filter row.
      query.section === "tickets" ||
      query.section === "owners" ||
      (query.section === "users" && query.userRef === null) ||
      (query.section === "devices" && query.deviceRef === null)
        ? readFilterOptions()
        : NO_OPTIONS,

      // 人员管理 reads the routing table live from the Bitable — it is a handful of rows
      // and it is the source of truth the tagging pipeline itself reads, so mirroring it
      // would buy nothing and could disagree. Failing to read it is shown as "unavailable"
      // rather than as an empty routing table, which would look like "nobody is on call".
      query.section === "owners" ? readOwners() : EMPTY_OWNERS,
    ]);

  return (
    <WorkbenchConsole
      user={user}
      metrics={metrics}
      view={view}
      query={query}
      now={now}
      options={options}
      users={users}
      devices={devices}
      userCount={profileCounts.users}
      deviceCount={profileCounts.devices}
      owners={owners}
      selectedProfile={selectedProfile}
    />
  );
}
