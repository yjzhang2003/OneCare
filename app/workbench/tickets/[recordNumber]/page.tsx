import { redirect } from "next/navigation";

import { getCurrentSession } from "../../../../src/features/auth/current-session";
import { listHref, ticketDetailHref } from "../../../../src/features/workbench/href";
import { parseWorkbenchQuery } from "../../../../src/features/workbench/query";
import {
  readProfileCounts,
  readQueueCounts,
  readTicketByNumber,
} from "../../../../src/features/store/workbench-query";
import { listAssignableMembers } from "../../../../src/features/directory/members";
import { createTenantTokenProvider } from "../../../../src/features/bitable/client";
import { readBotEnv } from "../../../../src/lib/env";
import {
  TicketDetailPageView,
  TicketDetailState,
} from "../../../workbench-ticket-detail";

type RawParams = Readonly<Record<string, string | string[] | undefined>>;

type Props = Readonly<{
  params: Promise<{ recordNumber: string }>;
  searchParams: Promise<RawParams>;
}>;

function currentTimestamp(): number {
  return Date.now();
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: Props) {
  const user = await getCurrentSession();
  if (!user) redirect("/enter");

  const [{ recordNumber }, rawQuery] = await Promise.all([
    params,
    searchParams,
  ]);
  const query = parseWorkbenchQuery(rawQuery);
  const now = currentTimestamp();

  // Three independent reads, dispatched together: the directory is a Feishu round
  // trip and the two count queries are Neon ones, so awaiting them in sequence would
  // add three latencies to a page that shows one record.
  //
  // Each failure is contained to what it feeds. A directory that cannot be read hides
  // the 改派 control; counts that cannot be read leave the sider's tags off. Neither
  // may take the whole ticket down with it, because everything else on this page
  // works without them.
  const [members, queueCounts, profileCounts] = await Promise.all([
    listAssignableMembers({
      tenantToken: () => {
        const botEnv = readBotEnv();
        return createTenantTokenProvider(botEnv.appId, botEnv.appSecret)();
      },
    }).catch((error: unknown) => {
      console.error(
        "Directory read failed:",
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }),
    readQueueCounts(now).catch((error: unknown) => {
      console.error(
        "Queue counts read failed:",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }),
    readProfileCounts().catch((error: unknown) => {
      console.error(
        "Profile counts read failed:",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }),
  ]);
  const backHref = listHref(query);
  const retryHref = ticketDetailHref(query, recordNumber);
  // One record by its number, not 3628 records filtered down to one. The read this
  // replaces cost a measured 6–7 seconds to render a single ticket.
  //
  // A thrown query — the database unreachable — is the "unavailable" state this page
  // already knows how to render, so it is caught rather than allowed to become an
  // opaque 500.
  let ticket: Awaited<ReturnType<typeof readTicketByNumber>>;
  try {
    ticket = await readTicketByNumber(recordNumber);
  } catch (error) {
    console.error(
      "Ticket detail read failed:",
      error instanceof Error ? error.message : String(error),
    );
    return (
      <TicketDetailState
        user={user}
        kind="unavailable"
        recordNumber={recordNumber}
        backHref={backHref}
        retryHref={retryHref}
      />
    );
  }
  if (!ticket) {
    return (
      <TicketDetailState
        user={user}
        kind="not-found"
        recordNumber={recordNumber}
        backHref={backHref}
        retryHref={retryHref}
      />
    );
  }

  return (
    <TicketDetailPageView
      user={user}
      ticket={ticket}
      members={members}
      now={now}
      backHref={backHref}
      query={query}
      queueCounts={queueCounts}
      userCount={profileCounts === null ? null : profileCounts.users}
      deviceCount={profileCounts === null ? null : profileCounts.devices}
    />
  );
}
