import { getCurrentSession } from "../src/features/auth/current-session";
import { getVocDashboardMetrics } from "./api/voc/dashboard/route";
import { LandingContent } from "./landing-content";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const [user, parameters, metrics] = await Promise.all([
    getCurrentSession(),
    searchParams,
    getVocDashboardMetrics(),
  ]);
  const authError = Array.isArray(parameters.auth_error)
    ? parameters.auth_error[0]
    : parameters.auth_error;

  return (
    <LandingContent authError={authError} metrics={metrics} user={user} />
  );
}
