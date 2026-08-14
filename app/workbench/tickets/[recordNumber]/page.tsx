import { redirect } from "next/navigation";

import { getCurrentSession } from "../../../../src/features/auth/current-session";
import { listHref, ticketDetailHref } from "../../../../src/features/workbench/href";
import { parseWorkbenchQuery } from "../../../../src/features/workbench/query";
import { readTicketByNumber } from "../../../../src/features/store/workbench-query";
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

  // A directory that cannot be read hides the 改派 control; it must not take the whole
  // ticket down with it, because everything else on this page still works without it.
  const members = await listAssignableMembers({
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
  });
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
      now={currentTimestamp()}
      backHref={backHref}
    />
  );
}
