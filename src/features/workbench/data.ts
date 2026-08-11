import type { VocRecord } from "../bitable/field-map";
import {
  aggregateVocMetrics,
  type VocMetricsInput,
  type VocMetricsResult,
} from "../voc/metrics";
import type { VocDimension, VocPolarity, VocSeverity } from "../voc/triage";
import type { VocState } from "../voc/service-event";

// Deliberately omits recordId and ownerOpenIds. Both are identifiers rather
// than information an operator reads, and the row objects are serialized into
// the page payload — keeping them out means a stray console.log or a view-source
// never turns into an identifier leak.
export type WorkbenchTicket = Readonly<{
  recordNumber: string;
  feedbackAt: string | null;
  channel: string;
  category: string;
  // Included so an operator can search by product model — "show me every
  // complaint about this fridge" is a real question, and 2482 of the 3628
  // imported records leave it blank, which the absent-value rendering handles.
  // Unlike recordId it identifies a product, not a person or a row.
  model: string;
  content: string;
  polarity: VocPolarity | null;
  dimensions: readonly VocDimension[];
  severity: VocSeverity | null;
  state: VocState;
  ownerNames: readonly string[];
  ticketOpenedAt: string | null;
  closedAt: string | null;
  durationHours: number | null;
}>;

export type WorkbenchData = Readonly<{
  metrics: VocMetricsResult;
  tickets: readonly WorkbenchTicket[];
}>;

export type BuildWorkbenchOptions = Readonly<{
  manualMinutesPerRecord?: number;
}>;

function hours(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (end - start) / 3_600_000;
}

export function toWorkbenchTicket(record: VocRecord): WorkbenchTicket {
  return {
    recordNumber: record.recordNumber,
    feedbackAt: record.feedbackAt,
    channel: record.channel,
    category: record.category,
    model: record.model,
    content: record.content,
    polarity: record.polarity,
    dimensions: record.dimensions,
    severity: record.severity,
    state: record.state,
    ownerNames: record.ownerNames,
    ticketOpenedAt: record.ticketOpenedAt,
    closedAt: record.closedAt,
    durationHours: hours(record.ticketOpenedAt, record.closedAt),
  };
}

function toMetricsInput(record: VocRecord): VocMetricsInput {
  return {
    state: record.state,
    polarity: record.polarity,
    dimensions: record.dimensions,
    channel: record.channel,
    ...(record.ticketOpenedAt ? { ticketOpenedAt: record.ticketOpenedAt } : {}),
    ...(record.closedAt ? { closedAt: record.closedAt } : {}),
  };
}

// A record with no feedback time sorts last instead of being dropped: an
// operator who cannot see it also cannot fix it, and a silently shorter list is
// exactly the kind of number that stops reconciling against the Base.
function feedbackRank(ticket: WorkbenchTicket): number {
  if (!ticket.feedbackAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(ticket.feedbackAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function buildWorkbench(
  records: readonly VocRecord[],
  options: BuildWorkbenchOptions,
): WorkbenchData {
  const metrics = aggregateVocMetrics(
    records.map(toMetricsInput),
    options.manualMinutesPerRecord === undefined
      ? {}
      : { manualMinutesPerRecord: options.manualMinutesPerRecord },
  );

  const tickets = records
    .map(toWorkbenchTicket)
    .sort((a, b) => feedbackRank(b) - feedbackRank(a));

  return { metrics: { status: "ok", metrics }, tickets };
}
