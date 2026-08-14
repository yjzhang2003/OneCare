// Rebuilds the demo dataset's time axis and processing state so the console shows a
// believable operation instead of the artefact the import left behind.
//
// What the import actually produced, measured on 2026-08-14 over all 3628 rows:
//
//   反馈时间   10 distinct dates (2026-01-22 … 2026-01-31), and exactly ONE distinct
//              time of day — 00:00 — because the enterprise's weekly export carries
//              dates without clock times.
//   停留时长   4679–4895 hours for 3612 rows, because that window is six months behind
//              "now"; every one of them therefore reads 已超时 against the assumed
//              72-hour SLA. 超时风险 counted 3612 of 3628.
//   状态       3594 rows still 待分析, so 情绪极性/问题维度/严重度 were empty on 99% of
//              the table and every chart and queue was empty or absurd.
//
// So two things are synthesized here, and this file is the only place either happens:
//
//   1. The time axis. The ten days keep their exact shape — which day, how many rows
//      on it, the gaps between them — and the whole block slides forward so the last
//      day ends just before `now`. A time of day is invented per row (the export never
//      had one), weighted toward daytime.
//   2. The processing state, for most rows: polarity, 问题维度, 严重度, the state
//      machine's position, an owner, and the ticket/closure timestamps.
//
// Rules this holds itself to, because a demo that contradicts the product's own logic
// is worse than an obviously empty one:
//
//   - The real triage() decides whether a row becomes a ticket. Nothing here invents a
//     ticket for a 好评 row, and nothing marks 无需跟进 on a row triage would escalate.
//   - Only enum values that already exist on the Base's fields are ever written. The
//     Bitable auto-creates any select option it is handed and deleting the row does not
//     remove it, so an invented value permanently pollutes the enterprise's schema.
//   - 反馈时间 ≤ 建单时间 ≤ 闭环时间, always.
//   - AI 摘要 and AI 回复话术 are left alone. They are model output; an excerpt of the
//     customer's own text presented under a label that says AI would be a lie a judge
//     could catch by reading two rows. The 19 rows tagged by the real aily skill keep
//     theirs, and 立即分析 produces a real one on demand.
//   - Every synthesized row is stamped 打标来源 = "demo-seed", so which rows are real
//     is answerable from the Base itself rather than from memory.
//   - Deterministic: the same record number always produces the same result, so the
//     seeding can be re-run, reviewed, and reasoned about.

import {
  triage,
  VOC_DIMENSIONS,
  type VocDimension,
  type VocPolarity,
  type VocSeverity,
} from "../voc/triage";
import { ASSUMED_SLA_HOURS } from "../workbench/query";
import type { VocState } from "../voc/service-event";

export const DEMO_TAG_SOURCE = "demo-seed";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type SeedInput = Readonly<{
  recordId: string;
  recordNumber: string;
  // The row's own feedback date, as imported. Only its position in the sorted list of
  // distinct dates is used, so the output preserves the original day structure.
  feedbackAt: string | null;
  // What the row already carries. A non-null polarity means the real pipeline tagged
  // this row — nothing else in this codebase writes that column — so its state, tags,
  // owner, AI 摘要 and 回复话术 are genuine output and are kept. Only its timeline is
  // rebuilt, because its 反馈时间 came from the same import as everyone else's while its
  // 建单时间 was created this week, which after the shift would put the ticket before
  // the feedback that caused it.
  existing?: Readonly<{
    state: VocState;
    polarity: VocPolarity | null;
    dimensions: readonly VocDimension[];
    severity: VocSeverity | null;
    ownerOpenIds: readonly string[];
    ownerNames: readonly string[];
  }>;
}>;

export type SeedOutcome = Readonly<{
  recordId: string;
  feedbackAt: string;
  state: VocState;
  polarity: VocPolarity | null;
  dimensions: readonly VocDimension[];
  severity: VocSeverity | null;
  ownerOpenIds: readonly string[];
  ownerNames: readonly string[];
  ticketOpenedAt: string | null;
  closedAt: string | null;
  // False for a row whose tags came from the real pipeline: only its three timestamps
  // were rebuilt, and the writer must leave every other field — including 打标来源 and
  // the AI text — exactly as it found them.
  synthesized: boolean;
  // Set only on synthesized rows, which is how a reader of the Base tells them from the
  // rows the real pipeline produced. Empty on preserved rows so their real 打标来源
  // survives.
  tagSource: string;
}>;

export type Assignee = Readonly<{ openId: string; name: string }>;

export type SeedOptions = Readonly<{
  now: number;
  // Who can own a ticket. Resolved from the Feishu directory by the caller — this file
  // never invents a person.
  assignees: readonly Assignee[];
}>;

// A stable 32-bit hash of the record number. Not cryptographic and not trying to be:
// it needs to spread evenly and give the same answer next week.
function hash(seed: string, salt: string): number {
  let h = 2166136261;
  const text = `${salt}:${seed}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// The time of day the export never carried. Weighted toward daytime with a dip over
// lunch, because customer feedback arrives when people are awake and using the thing:
// a uniform 24-hour spread would look as synthetic as a single 00:00.
const HOUR_WEIGHTS: readonly number[] = [
  // 00  01  02  03  04  05  06  07  08  09  10  11
  4, 2, 1, 1, 1, 2, 6, 14, 30, 55, 72, 78,
  // 12  13  14  15  16  17  18  19  20  21  22  23
  52, 60, 74, 76, 70, 62, 58, 66, 70, 54, 30, 12,
];

function timeOfDay(seed: string): number {
  const total = HOUR_WEIGHTS.reduce((sum, w) => sum + w, 0);
  let target = hash(seed, "hour") * total;
  let hourOfDay = 0;
  for (const [index, weight] of HOUR_WEIGHTS.entries()) {
    target -= weight;
    if (target <= 0) {
      hourOfDay = index;
      break;
    }
  }
  const minute = Math.floor(hash(seed, "minute") * 60);
  const second = Math.floor(hash(seed, "second") * 60);
  return hourOfDay * HOUR + minute * 60_000 + second * 1000;
}

// Where the ten imported days land. The newest day ends two hours before `now` so the
// freshest rows read as "just came in" without any row sitting in the future.
export function shiftedDayStarts(
  distinctDays: readonly string[],
  now: number,
): ReadonlyMap<string, number> {
  const sorted = [...distinctDays].sort();
  const newest = sorted.at(-1);
  const shifted = new Map<string, number>();
  if (newest === undefined) return shifted;

  const newestStart = Date.parse(`${newest}T00:00:00+08:00`);
  // The last day's window has to fit inside "up to two hours ago", so the block is
  // anchored by the start of the newest day rather than by its end.
  const target = now - 2 * HOUR - DAY;
  const offset = target - newestStart;
  for (const day of sorted) {
    shifted.set(day, Date.parse(`${day}T00:00:00+08:00`) + offset);
  }
  return shifted;
}

// How the table divides up. Percentages of the whole, chosen to read as one week and a
// half of a real operation rather than to flatter the product:
//
//   - 待分析 is the freshest slice, because a daily pipeline has not seen today yet.
//   - 分析失败 is a thin tail across all days: real extraction fails sometimes, and the
//     分析异常 queue is only meaningful if it has something in it.
//   - Everything else is tagged, and triage() alone decides ticket vs 无需跟进.
const PENDING_SHARE = 0.14;
const FAILED_SHARE = 0.007;

// Polarity mix. Skewed positive because most of this corpus is e-commerce review text,
// which is where the 好评 in the real tagged sample came from.
const POLARITY_BANDS: readonly (readonly [VocPolarity, number])[] = [
  ["好评", 0.6],
  ["中评", 0.24],
  ["差评", 0.16],
];

function polarityFor(seed: string): VocPolarity {
  let roll = hash(seed, "polarity");
  for (const [polarity, share] of POLARITY_BANDS) {
    if (roll < share) return polarity;
    roll -= share;
  }
  return "好评";
}

// 问题维度 only means something on feedback that names a problem. A 好评 row gets none;
// a 差评 row gets one or two, which is also what decides 严重度 through triage().
function dimensionsFor(seed: string, polarity: VocPolarity): readonly VocDimension[] {
  if (polarity === "好评") return [];

  const first = VOC_DIMENSIONS[
    Math.floor(hash(seed, "dim1") * VOC_DIMENSIONS.length)
  ] as VocDimension;

  // 中评 carries a dimension only about half the time, which is exactly the difference
  // triage() reads as "worth a ticket" versus "logged and left".
  if (polarity === "中评") {
    return hash(seed, "dim-mid") < 0.55 ? [first] : [];
  }

  if (hash(seed, "dim2") < 0.38) {
    const second = VOC_DIMENSIONS[
      Math.floor(hash(seed, "dim2-pick") * VOC_DIMENSIONS.length)
    ] as VocDimension;
    if (second !== first) return [first, second];
  }
  return [first];
}

// Closure rate by age. Older tickets are mostly done; the last two days are mostly in
// flight. This is the single knob that keeps 超时风险 a minority instead of everything:
// an overdue row must be non-terminal AND older than the assumed SLA, and the old ones
// have largely closed.
function closedShareByAge(ageDays: number): number {
  if (ageDays >= 7) return 0.95;
  if (ageDays >= 5) return 0.88;
  if (ageDays >= 3) return 0.7;
  if (ageDays >= 2) return 0.42;
  if (ageDays >= 1) return 0.2;
  return 0.05;
}

// Where a still-open ticket sits. Weighted toward the earlier stages, because that is
// what a backlog looks like: more waiting than nearly-done.
function openTicketState(seed: string): VocState {
  const roll = hash(seed, "open-state");
  if (roll < 0.45) return "待跟进";
  if (roll < 0.8) return "跟进中";
  return "待闭环";
}

export function seedRecord(
  input: SeedInput,
  dayStarts: ReadonlyMap<string, number>,
  options: SeedOptions,
): SeedOutcome {
  const seed = input.recordNumber || input.recordId;
  const day = (input.feedbackAt ?? "").slice(0, 10);
  // A row whose date the map does not know keeps its position at the oldest day rather
  // than being dropped or dated today.
  const dayStart =
    dayStarts.get(day) ?? [...dayStarts.values()].sort((a, b) => a - b)[0] ?? options.now - 10 * DAY;
  const feedbackMs = dayStart + timeOfDay(seed);
  const ageDays = (options.now - feedbackMs) / DAY;

  const feedbackAt = new Date(feedbackMs).toISOString();

  // A ticket opens some hours after the feedback arrives — the pipeline runs, then
  // triage routes it — and never before the feedback or in the future.
  const openedAt = () => {
    const delay = (0.5 + hash(seed, "open-delay") * 7.5) * HOUR;
    return Math.min(feedbackMs + delay, options.now - HOUR);
  };
  // Between four hours and three days of handling, capped so a closure cannot land in
  // the future either.
  const closedAt = (openedMs: number) =>
    Math.min(openedMs + (4 + hash(seed, "handling") * 68) * HOUR, options.now - 5 * 60_000);

  // Rows the real pipeline tagged keep everything it decided; only the timeline moves.
  if (input.existing && input.existing.polarity !== null) {
    const state = input.existing.state;
    const terminalWithoutTicket = state === "无需跟进";
    const untriaged = state === "待分析" || state === "分析失败";
    const opened = terminalWithoutTicket || untriaged ? null : openedAt();
    return {
      recordId: input.recordId,
      feedbackAt,
      state,
      polarity: input.existing.polarity,
      dimensions: input.existing.dimensions,
      severity: input.existing.severity,
      ownerOpenIds: input.existing.ownerOpenIds,
      ownerNames: input.existing.ownerNames,
      ticketOpenedAt: opened === null ? null : new Date(opened).toISOString(),
      closedAt:
        opened !== null && state === "已闭环"
          ? new Date(closedAt(opened)).toISOString()
          : null,
      synthesized: false,
      tagSource: "",
    };
  }

  const untagged: Omit<SeedOutcome, "state" | "tagSource" | "synthesized"> = {
    recordId: input.recordId,
    feedbackAt,
    polarity: null,
    dimensions: [],
    severity: null,
    ownerOpenIds: [],
    ownerNames: [],
    ticketOpenedAt: null,
    closedAt: null,
  };

  // The freshest rows are the ones a daily pipeline has not reached. Keyed off age
  // rather than a random draw, so 待分析 forms a coherent recent block instead of
  // freckling the whole ten days.
  const pendingCutoffDays = 10 * PENDING_SHARE;
  const marker = { synthesized: true, tagSource: DEMO_TAG_SOURCE } as const;
  if (ageDays < pendingCutoffDays) {
    return { ...untagged, state: "待分析", ...marker };
  }

  if (hash(seed, "failed") < FAILED_SHARE / (1 - PENDING_SHARE)) {
    return { ...untagged, state: "分析失败", ...marker };
  }

  const polarity = polarityFor(seed);
  const dimensions = dimensionsFor(seed, polarity);
  const { createTicket, severity } = triage({ polarity, dimensions });

  const tagged = { ...untagged, polarity, dimensions, severity };

  if (!createTicket) {
    // 无需跟进 is terminal and carries no ticket: nothing was opened, so nothing can
    // have been closed, and the row must never show a dwell time.
    return { ...tagged, state: "无需跟进", ...marker };
  }

  const openedMs = openedAt();

  if (hash(seed, "closed") < closedShareByAge(ageDays)) {
    return {
      ...tagged,
      state: "已闭环",
      ...assignOwner(seed, options.assignees, true),
      ticketOpenedAt: new Date(openedMs).toISOString(),
      closedAt: new Date(closedAt(openedMs)).toISOString(),
      ...marker,
    };
  }

  return {
    ...tagged,
    state: openTicketState(seed),
    ...assignOwner(seed, options.assignees, false),
    ticketOpenedAt: new Date(openedMs).toISOString(),
    closedAt: null,
    ...marker,
  };
}

// Owners come from the directory the caller resolved. A few open tickets deliberately
// have none, because 未分配 is one of the five queues and a queue that is always empty
// teaches an operator to ignore it. A closed ticket always has one — somebody closed it.
function assignOwner(
  seed: string,
  assignees: readonly Assignee[],
  closed: boolean,
): Readonly<{ ownerOpenIds: readonly string[]; ownerNames: readonly string[] }> {
  if (assignees.length === 0) return { ownerOpenIds: [], ownerNames: [] };
  if (!closed && hash(seed, "unowned") < 0.04) {
    return { ownerOpenIds: [], ownerNames: [] };
  }
  const picked = assignees[Math.floor(hash(seed, "owner") * assignees.length)]!;
  return { ownerOpenIds: [picked.openId], ownerNames: [picked.name] };
}

// What the console will show, computed the way the console computes it. Used by the
// seeding run to report the outcome and to fail loudly if the shape came out wrong.
export function summarize(
  outcomes: readonly SeedOutcome[],
  now: number,
): Readonly<{
  states: Readonly<Record<string, number>>;
  polarities: Readonly<Record<string, number>>;
  withTicket: number;
  closed: number;
  unassignedOpen: number;
  overdue: number;
  distinctTimesOfDay: number;
  dwellRange: readonly [number, number];
}> {
  const states: Record<string, number> = {};
  const polarities: Record<string, number> = {};
  const times = new Set<string>();
  let withTicket = 0;
  let closed = 0;
  let unassignedOpen = 0;
  let overdue = 0;
  let minDwell = Infinity;
  let maxDwell = -Infinity;

  for (const row of outcomes) {
    states[row.state] = (states[row.state] ?? 0) + 1;
    if (row.polarity) polarities[row.polarity] = (polarities[row.polarity] ?? 0) + 1;
    times.add(new Date(row.feedbackAt).toISOString().slice(11, 19));
    if (row.ticketOpenedAt) withTicket += 1;
    if (row.closedAt) closed += 1;
    if (row.ticketOpenedAt && !row.closedAt && row.ownerNames.length === 0) {
      unassignedOpen += 1;
    }

    const terminal = row.state === "已闭环" || row.state === "无需跟进";
    if (terminal) continue;
    const start = Date.parse(row.ticketOpenedAt ?? row.feedbackAt);
    const dwell = Math.max(0, (now - start) / HOUR);
    minDwell = Math.min(minDwell, dwell);
    maxDwell = Math.max(maxDwell, dwell);
    if (dwell > ASSUMED_SLA_HOURS) overdue += 1;
  }

  return {
    states,
    polarities,
    withTicket,
    closed,
    unassignedOpen,
    overdue,
    distinctTimesOfDay: times.size,
    dwellRange: [
      Number.isFinite(minDwell) ? Math.round(minDwell) : 0,
      Number.isFinite(maxDwell) ? Math.round(maxDwell) : 0,
    ],
  };
}
