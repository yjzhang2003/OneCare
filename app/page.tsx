import { getCurrentSession } from "../src/features/auth/current-session";
import { getVocDashboardMetrics } from "./api/voc/dashboard/route";
import { LandingContent } from "./landing-content";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [user, parameters, metrics] = await Promise.all([
    getCurrentSession(),
    searchParams,
    getVocDashboardMetrics(),
  ]);

  const explicitAuthError = first(parameters.auth_error);
  // "tried" comes from app/enter/route.ts's loop guard (shouldStartAuthorization
  // in src/features/workbench/entry.ts): a visitor already went through
  // authorization once and it did not produce a session. The OAuth callback
  // (app/api/auth/feishu/callback/route.ts, untouched by this task) sets a
  // specific auth_error code alongside its own "auth=tried" on every failure,
  // so that more precise message always wins below — this generic fallback
  // only fires when "tried" shows up with no accompanying code.
  const authError =
    explicitAuthError ?? (first(parameters.auth) === "tried" ? "tried" : undefined);

  // Whatever `user` is, this render must never call redirect() toward
  // authorization. An external showroom visitor browsing the pitch has no
  // session and no reason to be pushed into a Feishu login — only a tenant
  // member choosing to enter the workbench (via /enter) starts that flow.
  // The identity split itself — signed-in members getting an operations
  // workbench with real per-ticket detail instead of the showcase — is the
  // next task's work, and it branches on this same `user` value. Writing
  // that branch here now would mean two arms returning byte-identical JSX.
  return <LandingContent authError={authError} metrics={metrics} user={user} />;
}
