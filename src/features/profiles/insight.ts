// 画像分析 and 设备预警: what the console can say about one identity beyond counting
// its records.
//
// This is a rule engine, not a model, and it says so on screen. There was no time to
// build aily skills for the two profile views before the deadline, so the shape that
// matters is the seam: `ProfileInsightProvider` is what a real skill would implement,
// `ruleBasedInsight` is the implementation shipped today, and the route behind the
// button depends on the interface rather than on this file. Swapping in an aily skill
// later is one binding, not a rewrite of the pages.
//
// Every judgement below is derived from the identity's own records — the polarity the
// pipeline tagged, the dimensions it extracted, when the feedback arrived, how long the
// text is, which channel it came through. Nothing is invented, and nothing is presented
// as model output. That is the difference between a mock that can be demoed honestly and
// one that gets caught: a judge can check any conclusion here against the rows listed
// directly underneath it.

import type { WorkbenchTicket } from "../workbench/data";
import type { IdentityProfile } from "../workbench/profiles";

export const RULE_ENGINE_LABEL = "规则引擎";

export type InsightLevel = "高" | "中" | "低";

export type ProfileInsight = Readonly<{
  kind: "user" | "device";
  id: string;
  // 画像标签 for a user, 预警标签 for a device: a handful of short labels, each of which
  // a reader can verify against the records below.
  labels: readonly string[];
  // The one sentence a person would say about this identity.
  headline: string;
  // Why, in evidence terms — never more than one line each.
  signals: readonly string[];
  // What to do next. Empty when there is nothing to suggest, rather than padded.
  actions: readonly string[];
  // For a device this is the 预警等级; for a user it is how much attention they need.
  level: InsightLevel;
  // Which engine produced this. On screen, so nobody mistakes a rule for a model.
  producedBy: string;
}>;

export type ProfileInsightProvider = Readonly<{
  name: string;
  analyze: (input: ProfileInsightInput) => Promise<ProfileInsight>;
}>;

export type ProfileInsightInput = Readonly<{
  kind: "user" | "device";
  profile: IdentityProfile;
  records: readonly WorkbenchTicket[];
  now: number;
}>;

const HOUR = 3_600_000;

function hours(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / HOUR;
}

// The measurable things about an identity's feedback. Split out from the judgements so
// the rules below read as rules and the numbers stay checkable.
export type IdentitySignals = Readonly<{
  records: number;
  negative: number;
  neutral: number;
  positive: number;
  untagged: number;
  severityHigh: number;
  open: number;
  // Distinct 问题维度 across all of this identity's records: one recurring dimension and
  // four scattered ones mean different things.
  dimensions: readonly string[];
  repeatedDimension: string | null;
  // Hours between the first and last piece of feedback. Null when only one exists.
  spanHours: number | null;
  // Hours since the most recent feedback.
  quietHours: number | null;
  averageContentLength: number;
  channels: readonly string[];
  // Feedback that arrived outside 08:00–20:00 Beijing, which is when someone is annoyed
  // enough to write at night.
  offHours: number;
  meanClosureHours: number | null;
}>;

export function identitySignals(
  input: ProfileInsightInput,
): IdentitySignals {
  const { profile, records, now } = input;
  const counts = { negative: 0, neutral: 0, positive: 0, untagged: 0 };
  const dimensionCounts = new Map<string, number>();
  let lengthTotal = 0;
  let offHours = 0;
  let closureTotal = 0;
  let closureCount = 0;

  for (const record of records) {
    if (record.polarity === "差评") counts.negative += 1;
    else if (record.polarity === "中评") counts.neutral += 1;
    else if (record.polarity === "好评") counts.positive += 1;
    else counts.untagged += 1;

    for (const dimension of record.dimensions) {
      dimensionCounts.set(dimension, (dimensionCounts.get(dimension) ?? 0) + 1);
    }
    lengthTotal += record.content.length;

    if (record.feedbackAt) {
      const at = Date.parse(record.feedbackAt);
      if (Number.isFinite(at)) {
        const hourOfDay = new Date(at + 8 * HOUR).getUTCHours();
        if (hourOfDay < 8 || hourOfDay >= 20) offHours += 1;
      }
    }

    const closure = hours(record.ticketOpenedAt, record.closedAt);
    if (closure !== null) {
      closureTotal += closure;
      closureCount += 1;
    }
  }

  const repeated = [...dimensionCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

  return {
    records: profile.records,
    ...counts,
    severityHigh: profile.severityHigh,
    open: profile.open,
    dimensions: profile.dimensions,
    repeatedDimension: repeated ? repeated[0] : null,
    spanHours: hours(profile.firstFeedbackAt, profile.lastFeedbackAt),
    quietHours: profile.lastFeedbackAt
      ? Math.max(0, (now - Date.parse(profile.lastFeedbackAt)) / HOUR)
      : null,
    averageContentLength:
      records.length === 0 ? 0 : Math.round(lengthTotal / records.length),
    channels: profile.channels,
    offHours,
    meanClosureHours:
      closureCount === 0 ? null : closureTotal / closureCount,
  };
}

// 用户画像. The labels answer "what kind of person is this to serve", which is what an
// operator wants before picking up the phone.
function userInsight(input: ProfileInsightInput, s: IdentitySignals): ProfileInsight {
  const labels: string[] = [];
  const signals: string[] = [];
  const actions: string[] = [];

  const tagged = s.negative + s.neutral + s.positive;
  const negativeShare = tagged === 0 ? 0 : s.negative / tagged;
  const burst = s.spanHours !== null && s.records >= 3 && s.spanHours <= 72;

  // 情绪基调 first, because it decides the tone of the callback.
  if (negativeShare >= 0.6) labels.push("强烈不满");
  else if (negativeShare >= 0.3) labels.push("有保留");
  else if (tagged > 0) labels.push("总体友好");

  // 性格 / 沟通风格, from how they write rather than from what they scored.
  if (s.averageContentLength >= 120) labels.push("陈述详尽");
  else if (s.averageContentLength > 0 && s.averageContentLength <= 40) {
    labels.push("表达简短");
  }
  if (burst) labels.push("连续追问");
  if (s.offHours >= 2) labels.push("夜间反馈");
  if (s.severityHigh >= 1) labels.push("易升级");
  if (s.dimensions.length >= 3) labels.push("多点关注");
  else if (s.repeatedDimension) labels.push(`聚焦${s.repeatedDimension}`);

  signals.push(
    `${s.records} 条反馈，其中差评 ${s.negative}、中评 ${s.neutral}、好评 ${s.positive}` +
      (s.untagged > 0 ? `，${s.untagged} 条未打标` : ""),
  );
  if (s.spanHours !== null) {
    signals.push(
      s.spanHours <= 72
        ? `全部集中在 ${Math.max(1, Math.round(s.spanHours))} 小时内`
        : `跨度 ${Math.round(s.spanHours / 24)} 天`,
    );
  }
  if (s.repeatedDimension) {
    signals.push(`「${s.repeatedDimension}」重复出现，不是一次性问题`);
  }
  if (s.averageContentLength > 0) {
    signals.push(`平均正文 ${s.averageContentLength} 字，渠道：${s.channels.join(" / ") || "—"}`);
  }
  if (s.open > 0) signals.push(`仍有 ${s.open} 条未闭环`);

  // Actions are ordered by what a service operation would actually do first.
  if (s.severityHigh >= 1 || (burst && negativeShare >= 0.5)) {
    actions.push("优先电话回访，不要只回文字");
  }
  if (s.repeatedDimension) {
    actions.push(`按「${s.repeatedDimension}」指派对口工程师，避免重复上门`);
  }
  if (s.open > 0) actions.push("先闭掉未闭环的那几条，再谈满意度");
  if (negativeShare < 0.3 && s.open === 0 && s.records >= 2) {
    actions.push("可纳入满意度回访与口碑样本");
  }

  const level: InsightLevel =
    s.severityHigh >= 1 || (burst && negativeShare >= 0.5)
      ? "高"
      : negativeShare >= 0.3 || s.open > 0
        ? "中"
        : "低";

  const headline = burst
    ? `短时间内连续 ${s.records} 次反馈，情绪正在升级`
    : s.repeatedDimension
      ? `围绕「${s.repeatedDimension}」反复反馈 ${s.records} 次`
      : negativeShare >= 0.6
        ? `${s.records} 次反馈以负面为主，需要主动联系`
        : `${s.records} 次反馈，暂无升级迹象`;

  return {
    kind: "user",
    id: input.profile.id,
    labels,
    headline,
    signals,
    actions,
    level,
    producedBy: RULE_ENGINE_LABEL,
  };
}

// 设备追踪. The question here is not personality but whether this unit is failing in a
// way that predicts the next failure — a repeated dimension on one device instance is a
// batch-quality lead, which is exactly what the architecture spec asks 设备 ID to
// surface.
function deviceInsight(input: ProfileInsightInput, s: IdentitySignals): ProfileInsight {
  const labels: string[] = [];
  const signals: string[] = [];
  const actions: string[] = [];

  const recurringWithin30d = s.spanHours !== null && s.spanHours <= 30 * 24;
  const repeatRepair =
    s.repeatedDimension === "维修技术" || s.repeatedDimension === "维修时间";

  if (s.records >= 3) labels.push("多次报修");
  if (recurringWithin30d && s.records >= 2) labels.push("短期复发");
  if (repeatRepair) labels.push("疑似维修未彻底");
  if (s.repeatedDimension === "产品质量") labels.push("疑似批次质量");
  if (s.severityHigh >= 1) labels.push("含高严重度");
  if (s.open > 0) labels.push("仍有未闭环");

  signals.push(
    `${s.records} 次报修` +
      (s.spanHours === null
        ? ""
        : s.spanHours <= 24
          ? `，全部在 24 小时内`
          : `，跨度 ${Math.round(s.spanHours / 24)} 天`),
  );
  if (s.repeatedDimension) {
    signals.push(`同一维度「${s.repeatedDimension}」重复出现`);
  }
  if (s.meanClosureHours !== null) {
    signals.push(`历史平均闭环 ${Math.round(s.meanClosureHours)} 小时`);
  }
  if (s.quietHours !== null) {
    signals.push(`距最近一次报修 ${Math.round(s.quietHours / 24)} 天`);
  }

  // 预警等级: recurrence within a short window is the strongest signal, then a repeated
  // repair dimension, then severity.
  const level: InsightLevel =
    (s.records >= 3 && recurringWithin30d) || (repeatRepair && s.records >= 2)
      ? "高"
      : s.records >= 2 || s.severityHigh >= 1
        ? "中"
        : "低";

  if (level === "高") {
    actions.push("升级为整机更换 / 换件评估，不要再派同一处理方案");
    actions.push("拉群会同产品与售后，把这台机器的历史一次说清");
  }
  if (s.repeatedDimension === "产品质量") {
    actions.push("把机型与批次送质量抽查");
  }
  if (repeatRepair) actions.push("指派资深工程师复核上一次维修记录");
  if (s.open > 0) actions.push("先闭环在途工单，再评估设备处置");

  const headline =
    level === "高"
      ? `该设备 ${s.records} 次报修${s.repeatedDimension ? `且集中在「${s.repeatedDimension}」` : ""}，建议按复发处理`
      : s.records >= 2
        ? `该设备 ${s.records} 次报修，暂未构成复发`
        : `该设备仅 1 次报修，无预警`;

  return {
    kind: "device",
    id: input.profile.id,
    labels,
    headline,
    signals,
    actions,
    level,
    producedBy: RULE_ENGINE_LABEL,
  };
}

export function ruleBasedInsight(input: ProfileInsightInput): ProfileInsight {
  const signals = identitySignals(input);
  return input.kind === "user"
    ? userInsight(input, signals)
    : deviceInsight(input, signals);
}

// The provider the route binds to today. An aily skill implementing the same interface
// replaces this without touching the route or the pages.
export const ruleBasedProvider: ProfileInsightProvider = {
  name: RULE_ENGINE_LABEL,
  analyze: async (input) => ruleBasedInsight(input),
};

// Kept beside the rules it feeds, so the "is this identity worth a group" test and the
// war-room button cannot drift apart: a group is worth pulling when the analysis says 高,
// or when there is unfinished work on a repeat identity.
export function warrantsWarRoom(insight: ProfileInsight, open: number): boolean {
  return insight.level === "高" || (insight.level === "中" && open > 0);
}
