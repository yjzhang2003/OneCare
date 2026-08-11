import { getCurrentSession } from "../src/features/auth/current-session";
import { getVocDashboardMetrics, readWorkbenchCached } from "./api/voc/dashboard/route";
import { LandingContent } from "./landing-content";
import { WorkbenchContent } from "./workbench-content";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
    // readWorkbenchCached shares one cache entry with the public aggregation,
    // so the tallies here and a direct curl of /api/voc/dashboard cannot drift
    // apart. It never throws: a failed Bitable read arrives as an explicit
    // unavailable status the workbench renders as such.
    const data = await readWorkbenchCached();
    return <WorkbenchContent data={data} user={user} />;
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
  const metrics = await getVocDashboardMetrics();
  return <LandingContent authError={authError} metrics={metrics} user={user} />;
}
