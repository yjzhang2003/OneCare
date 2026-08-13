import { redirect } from "next/navigation";

import { getCurrentSession } from "../../../../src/features/auth/current-session";
import { listHref, ticketDetailHref } from "../../../../src/features/workbench/href";
import { parseWorkbenchQuery } from "../../../../src/features/workbench/query";
import { readWorkbenchCached } from "../../../api/voc/dashboard/route";
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
  const data = await readWorkbenchCached();

  if (data.metrics.status === "unavailable") {
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

  const ticket = data.tickets.find(
    (item) => item.recordNumber === recordNumber,
  );
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
