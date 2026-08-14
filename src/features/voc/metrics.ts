import type { VocState } from "./service-event";
import type { VocDimension, VocPolarity } from "./triage";

export type VocMetricsInput = Readonly<{
  state: VocState;
  polarity: VocPolarity | null;
  dimensions: readonly VocDimension[];
  channel: string;
  ticketOpenedAt?: string;
  closedAt?: string;
}>;

export type VocMetrics = Readonly<{
  total: number;
  byPolarity: Readonly<Record<VocPolarity, number>>;
  dimensionTop: ReadonlyArray<{ dimension: VocDimension; count: number }>;
  byChannel: ReadonlyArray<{ channel: string; count: number }>;
  negativeShare: number;
  ticketsOpened: number;
  ticketsClosed: number;
  closureRate: number;
  averageClosureHours: number;
  taggingAttempted: number;
  taggingSucceeded: number;
  taggingFailed: number;
  taggingPending: number;
  effort?: Readonly<{
    taggedRecords: number;
    manualMinutesPerRecord: number;
    savedHours: number;
  }>;
}>;

export type VocMetricsOptions = Readonly<{
  manualMinutesPerRecord?: number;
}>;

// Every UI surface that reads VOC metrics (the public dashboard, the home
// page's showcase) sits behind a live, cross-border Bitable read that can
// fail transiently. None of them may let that failure become a build error
// or a page crash, and none may render 0s that look like real data when the
// read failed — so the result of "try to get metrics" is a first-class,
// explicit value instead of a thrown exception a caller might forget to
// catch. Deliberately carries no error detail: this travels all the way to
// a public, unauthenticated page, and an infrastructure error string is not
// something to hand an anonymous visitor.
export type VocMetricsResult =
  | Readonly<{ status: "ok"; metrics: VocMetrics }>
  | Readonly<{ status: "unavailable" }>;

const TAGGED_STATES: ReadonlySet<VocState> = new Set<VocState>([
  "已分析",
  "无需跟进",
  "待跟进",
  "跟进中",
  "待闭环",
  "已闭环",
]);

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function countBy<T extends string>(
  values: readonly T[],
): ReadonlyArray<{ key: T; count: number }> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  // Ties break on the key, so the order is total. Previously equal counts kept Map
  // insertion order — "whichever record happened to come first" — which is fine in
  // isolation and impossible to reproduce in SQL, and therefore impossible to hold a
  // SQL implementation to.
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function aggregateVocMetrics(
  records: readonly VocMetricsInput[],
  options: VocMetricsOptions = {},
): VocMetrics {
  const byPolarity: Record<VocPolarity, number> = {
    好评: 0,
    中评: 0,
    差评: 0,
  };
  for (const record of records) {
    if (record.polarity) byPolarity[record.polarity] += 1;
  }

  const taggedCount = records.filter((r) => TAGGED_STATES.has(r.state)).length;
  const opened = records.filter((r) => r.ticketOpenedAt);
  const closed = opened.filter((r) => r.closedAt);

  const closureHours = closed
    .map((record) => {
      const from = new Date(record.ticketOpenedAt as string).getTime();
      const to = new Date(record.closedAt as string).getTime();
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        return null;
      }
      return (to - from) / 3_600_000;
    })
    .filter((h): h is number => h !== null);

  const dimensionTop = countBy(
    records.flatMap((record) => [...record.dimensions]),
  ).map(({ key, count }) => ({ dimension: key, count }));

  const byChannel = countBy(records.map((record) => record.channel)).map(
    ({ key, count }) => ({ channel: key, count }),
  );

  const taggedTotal = byPolarity.好评 + byPolarity.中评 + byPolarity.差评;

  const metrics: VocMetrics = {
    total: records.length,
    byPolarity,
    dimensionTop,
    byChannel,
    negativeShare: ratio(byPolarity.差评 + byPolarity.中评, taggedTotal),
    ticketsOpened: opened.length,
    ticketsClosed: closed.length,
    closureRate: ratio(closed.length, opened.length),
    averageClosureHours: ratio(
      closureHours.reduce((sum, hours) => sum + hours, 0),
      closureHours.length,
    ),
    taggingAttempted: records.length,
    taggingSucceeded: taggedCount,
    taggingFailed: records.filter((r) => r.state === "分析失败").length,
    taggingPending: records.filter((r) => r.state === "待分析").length,
  };

  if (options.manualMinutesPerRecord === undefined) {
    return metrics;
  }

  return {
    ...metrics,
    effort: {
      taggedRecords: taggedCount,
      manualMinutesPerRecord: options.manualMinutesPerRecord,
      savedHours: (taggedCount * options.manualMinutesPerRecord) / 60,
    },
  };
}
