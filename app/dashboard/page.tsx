import { redirect } from "next/navigation";

import { getCurrentSession } from "../../src/features/auth/current-session";
import { DashboardContent } from "./dashboard-content";

export default async function DashboardPage() {
  const user = await getCurrentSession();

  if (!user) {
    redirect("/");
  }

  return <DashboardContent user={user} />;
}
