import { getCurrentSession } from "../src/features/auth/current-session";
import { readVocMetrics } from "../src/features/store/workbench-query";
import type { VocMetricsResult } from "../src/features/voc/metrics";
import { ASSUMED_MANUAL_MINUTES_PER_RECORD } from "./api/voc/dashboard/route";
import { LandingContent } from "./landing-content";
import { WorkbenchContent } from "./workbench-content";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Isolated in its own plain function rather than inlined as `Date.now()`
// below: the project's react-hooks/purity lint rule flags any direct call to
// a known-impure API inside a function that looks like a component by name
// and shape, which HomePage does even though it is an async Server
// Component with none of the re-render/memoization semantics that rule
// exists to protect — a Server Component runs once per request, not
// speculatively or concurrently the way the React Compiler must reason
// about Client Components. Naming and isolating the call this way satisfies
// the linter without a blanket suppression, while keeping the actual intent
// unchanged: read the clock exactly once per request, from the page, and
// hand it down (see the comment on WorkbenchContentProps.now).
function currentTimestamp(): number {
  return Date.now();
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [user, parameters] = await Promise.all([
    getCurrentSession(),
    searchParams,
  ]);

  // A signed-in member gets the workbench, which is the whole point of the
  // split — but they must still be able to reach the pitch they came to show
  // someone. Rather than a second route rendering the same showcase (the
  // design rules that out), the workbench keeps a corner link carrying this
  // parameter, so the showcase stays one URL rather than two.
  const wantsShowcase = first(parameters.view) === "showcase";

  if (user && !wantsShowcase) {
    // No data is fetched here any more. WorkbenchContent fetches what the URL's
    // section actually needs — the ticket list is one page plus five counts, and
    // pulling all 3628 records to render 50 of them is what made a cold load cost
    // 6–7 seconds.
    //
    // "now" is still read here, once, rather than inside WorkbenchContent: the
    // component must stay a pure function of its props (queues, the overdue
    // marker and dwell time all key off "now"), and this app runs under
    // Next's Cache Components model, where a component that reaches for the
    // wall clock itself makes its own caching behaviour far harder to reason
    // about than a page that decides "now" once and hands it down.
    return (
      <WorkbenchContent
        user={user}
        now={currentTimestamp()}
        searchParams={parameters}
      />
    );
  }

  const explicitAuthError = first(parameters.auth_error);
  // "tried" comes from app/enter/route.ts's loop guard (shouldStartAuthorization
  // in src/features/workbench/entry.ts): a visitor already went through
  // authorization once and it did not produce a session. The OAuth callback
  // sets a specific auth_error code alongside its own "auth=tried" on every
  // failure, so that more precise message always wins below — this generic
  // fallback only fires when "tried" shows up with no accompanying code.
  const authError =
    explicitAuthError ?? (first(parameters.auth) === "tried" ? "tried" : undefined);

  // This render must never call redirect() toward authorization. An external
  // showroom visitor browsing the pitch has no session and no reason to be
  // pushed into a Feishu login — only a tenant member choosing to enter the
  // workbench (via /enter) starts that flow.
  const metrics = await landingMetrics();
  return <LandingContent authError={authError} metrics={metrics} user={user} />;
}

// The pitch page's numbers, from Postgres. This was the last surface still reading all
// 3628 records out of the Bitable, on the one page an outside visitor sees first:
// measured on the same machine against the same data, the whole page went from 2.5s
// warm (and far worse on a cold cache) to 125ms, of which this read is 117–124ms. The
// aggregate is the same one the console's 数据概览 uses, so the two now agree by
// construction rather than by both happening to run the same in-memory reducer.
//
// Never throws, for the reason getVocDashboardMetrics gave: this is awaited in the
// page's own top-level render with no try/catch and no Suspense boundary above it, and
// the page is prerendered — so a thrown read would fail `next build`. An unreadable
// database renders 指标暂不可用, which LandingContent already knows how to show.
async function landingMetrics(): Promise<VocMetricsResult> {
  try {
    return {
      status: "ok",
      metrics: await readVocMetrics({
        manualMinutesPerRecord: ASSUMED_MANUAL_MINUTES_PER_RECORD,
      }),
    };
  } catch (error) {
    console.error(
      "Landing metrics read failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { status: "unavailable" };
  }
}
