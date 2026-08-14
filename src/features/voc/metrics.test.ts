import { describe, expect, it } from "vitest";

import { aggregateVocMetrics, type VocMetricsInput } from "./metrics";

const records: readonly VocMetricsInput[] = [
  {
    state: "已闭环",
    polarity: "差评",
    dimensions: ["维修时间", "服务态度"],
    channel: "电商评价",
    ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    closedAt: "2026-01-24T02:00:00.000Z",
  },
  {
    state: "跟进中",
    polarity: "差评",
    dimensions: ["维修时间"],
    channel: "400 客服",
    ticketOpenedAt: "2026-01-24T02:00:00.000Z",
  },
  {
    state: "无需跟进",
    polarity: "好评",
    dimensions: [],
    channel: "电商评价",
  },
  { state: "待分析", polarity: null, dimensions: [], channel: "APP" },
  { state: "分析失败", polarity: null, dimensions: [], channel: "APP" },
];

describe("aggregateVocMetrics", () => {
  it("counts every record in the total", () => {
    expect(aggregateVocMetrics(records).total).toBe(5);
  });

  it("splits records by polarity and leaves untagged ones out", () => {
    expect(aggregateVocMetrics(records).byPolarity).toEqual({
      好评: 1,
      中评: 0,
      差评: 2,
    });
  });

  it("ranks dimensions by frequency", () => {
    expect(aggregateVocMetrics(records).dimensionTop).toEqual([
      { dimension: "维修时间", count: 2 },
      { dimension: "服务态度", count: 1 },
    ]);
  });

  it("counts records per channel", () => {
    // Equal counts order by channel name, not by which record appeared first —
    // the latter is unreproducible in SQL and was never a property worth promising.
    expect(aggregateVocMetrics(records).byChannel).toEqual([
      { channel: "APP", count: 2 },
      { channel: "电商评价", count: 2 },
      { channel: "400 客服", count: 1 },
    ]);
  });

  it("reports the negative-and-neutral share of tagged records", () => {
    expect(aggregateVocMetrics(records).negativeShare).toBeCloseTo(2 / 3, 5);
  });

  it("counts closure against tickets actually opened", () => {
    const metrics = aggregateVocMetrics(records);

    expect(metrics.ticketsOpened).toBe(2);
    expect(metrics.ticketsClosed).toBe(1);
    expect(metrics.closureRate).toBeCloseTo(0.5, 5);
  });

  it("averages closure duration in hours over closed tickets only", () => {
    expect(aggregateVocMetrics(records).averageClosureHours).toBeCloseTo(24, 5);
  });

  it("reports tagging coverage and success separately", () => {
    const metrics = aggregateVocMetrics(records);

    expect(metrics.taggingAttempted).toBe(5);
    expect(metrics.taggingSucceeded).toBe(3);
    expect(metrics.taggingFailed).toBe(1);
    expect(metrics.taggingPending).toBe(1);
  });

  it("derives saved hours from a caller-supplied baseline", () => {
    const metrics = aggregateVocMetrics(records, {
      manualMinutesPerRecord: 4,
    });

    expect(metrics.effort).toEqual({
      taggedRecords: 3,
      manualMinutesPerRecord: 4,
      savedHours: 0.2,
    });
  });

  it("omits the effort block when no baseline is supplied", () => {
    expect(aggregateVocMetrics(records).effort).toBeUndefined();
  });

  it("returns zeroed rates for an empty input instead of dividing by zero", () => {
    const metrics = aggregateVocMetrics([]);

    expect(metrics.total).toBe(0);
    expect(metrics.negativeShare).toBe(0);
    expect(metrics.closureRate).toBe(0);
    expect(metrics.averageClosureHours).toBe(0);
  });

  it("skips records with unparseable dates when computing average closure hours", () => {
    const testRecords: readonly VocMetricsInput[] = [
      {
        state: "已闭环",
        polarity: "差评",
        dimensions: [],
        channel: "电商评价",
        ticketOpenedAt: "not-a-real-date",
        closedAt: "also-not-a-date",
      },
      {
        state: "已闭环",
        polarity: "好评",
        dimensions: [],
        channel: "电商评价",
        ticketOpenedAt: "2026-01-23T02:00:00.000Z",
        closedAt: "2026-01-24T02:00:00.000Z",
      },
    ];

    const metrics = aggregateVocMetrics(testRecords);

    // Should compute average from the one valid record (24 hours)
    expect(metrics.averageClosureHours).toBeCloseTo(24, 5);
    expect(Number.isNaN(metrics.averageClosureHours)).toBe(false);
    // Still counts both as opened/closed by field presence
    expect(metrics.ticketsOpened).toBe(2);
    expect(metrics.ticketsClosed).toBe(2);
  });

  it("handles only closedAt unparseable, skips that record from average", () => {
    const testRecords: readonly VocMetricsInput[] = [
      {
        state: "已闭环",
        polarity: "差评",
        dimensions: [],
        channel: "电商评价",
        ticketOpenedAt: "2026-01-23T02:00:00.000Z",
        closedAt: "not-a-date",
      },
      {
        state: "已闭环",
        polarity: "好评",
        dimensions: [],
        channel: "电商评价",
        ticketOpenedAt: "2026-01-24T02:00:00.000Z",
        closedAt: "2026-01-25T02:00:00.000Z",
      },
    ];

    const metrics = aggregateVocMetrics(testRecords);

    // Average should be from the second record only (24 hours)
    expect(metrics.averageClosureHours).toBeCloseTo(24, 5);
    expect(Number.isNaN(metrics.averageClosureHours)).toBe(false);
    // Both counted as opened/closed
    expect(metrics.ticketsOpened).toBe(2);
    expect(metrics.ticketsClosed).toBe(2);
  });

  it("returns 0 for averageClosureHours when all dates are unparseable", () => {
    const testRecords: readonly VocMetricsInput[] = [
      {
        state: "已闭环",
        polarity: "差评",
        dimensions: [],
        channel: "电商评价",
        ticketOpenedAt: "bad-date",
        closedAt: "worse-date",
      },
      {
        state: "已闭环",
        polarity: "好评",
        dimensions: [],
        channel: "电商评价",
        ticketOpenedAt: "invalid",
        closedAt: "also-invalid",
      },
    ];

    const metrics = aggregateVocMetrics(testRecords);

    // No valid durations means average is 0
    expect(metrics.averageClosureHours).toBe(0);
    expect(Number.isNaN(metrics.averageClosureHours)).toBe(false);
    // Still counts as opened/closed by field presence
    expect(metrics.ticketsOpened).toBe(2);
    expect(metrics.ticketsClosed).toBe(2);
  });
});
