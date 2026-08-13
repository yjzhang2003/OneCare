import type { VocRecord } from "../bitable/field-map";
import type { VocReply } from "../tagging/contracts";
import {
  aggregateVocMetrics,
  type VocMetricsInput,
  type VocMetricsResult,
} from "../voc/metrics";
import type { VocDimension, VocPolarity, VocSeverity } from "../voc/triage";
import type { VocState } from "../voc/service-event";

// Still deliberately omits ownerOpenIds: an open_id names a person, the row
// objects are serialized into the page payload, and nothing an operator reads
// needs it — so a stray console.log or a view-source cannot turn into a roster
// of colleagues' identifiers.
//
// recordId used to be excluded for the same reason and is now included, because
// the write path has to address a row: it is the URL the workbench POSTs an
// action to. It is a Bitable row handle, not a person, and every action on that
// row is gated by the session and then by the owner check, so holding it grants
// nothing that clicking the row did not already grant.
export type WorkbenchTicket = Readonly<{
  recordId: string;
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
  // AI-authored, read-only. Added for the ticket detail drill-down (task 15):
  // an operator opening one record needs the summary and drafted replies
  // right there, not a second navigation to the Feishu card that has them.
  summary: string;
  // Same {tone, text} shape the card renders "【语气】正文" from. Read-only here
  // too — this page has no write path, so these are reference text only.
  replies: readonly VocReply[];
  severity: VocSeverity | null;
  state: VocState;
  ownerNames: readonly string[];
  // Both exist so the detail panel can decide which actions to offer without
  // seeing anyone's open_id: retryCount drives the 重试 ceiling, and hasOwner
  // decides between "claim this" and "this is someone's". Booleans and counters
  // are viewer-independent, so they stay safely inside the shared cache entry —
  // unlike "is the viewer the owner", which must never be cached per-viewer and
  // is therefore left to the route handler to answer.
  retryCount: number;
  hasOwner: boolean;
  hasWarRoom: boolean;
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
    recordId: record.recordId,
    recordNumber: record.recordNumber,
    feedbackAt: record.feedbackAt,
    channel: record.channel,
    category: record.category,
    model: record.model,
    content: record.content,
    polarity: record.polarity,
    dimensions: record.dimensions,
    summary: record.summary,
    replies: record.replies,
    severity: record.severity,
    state: record.state,
    ownerNames: record.ownerNames,
    retryCount: record.retryCount,
    hasOwner: record.ownerOpenIds.length > 0,
    hasWarRoom: record.warRoomChatId.trim().length > 0,
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
