import { redirect } from "next/navigation";

import { getCurrentSession } from "../../../../src/features/auth/current-session";
import { listHref, ticketDetailHref } from "../../../../src/features/workbench/href";
import { parseWorkbenchQuery } from "../../../../src/features/workbench/query";
import { readTicketByNumber } from "../../../../src/features/store/workbench-query";
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
      now={currentTimestamp()}
      backHref={backHref}
    />
  );
}
