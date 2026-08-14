import { describe, expect, it } from "vitest";

import type { WorkbenchTicket } from "../workbench/data";
import type { IdentityProfile } from "../workbench/profiles";
import {
  identitySignals,
  RULE_ENGINE_LABEL,
  ruleBasedInsight,
  ruleBasedProvider,
  warrantsWarRoom,
} from "./insight";

const NOW = Date.parse("2026-08-15T12:00:00+08:00");

function record(overrides: Partial<WorkbenchTicket> = {}): WorkbenchTicket {
  return {
    recordId: "rec1",
    recordNumber: "R-1",
    feedbackAt: "2026-08-14T04:00:00.000Z",
    channel: "400 客服",
    category: "冰箱",
    model: "BCD-525",
    content: "报修后等了三天没人上门",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "",
    replies: [],
    severity: "中",
    state: "待跟进",
    ownerNames: ["黄齐"],
    retryCount: 0,
    hasOwner: true,
    hasWarRoom: false,
    sourceTicketNo: "CAS-1",
    userRef: "U-1",
    deviceRef: "D-1",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ticketOpenedAt: "2026-08-14T06:00:00.000Z",
    closedAt: null,
    durationHours: null,
    ...overrides,
  };
}

function profile(overrides: Partial<IdentityProfile> = {}): IdentityProfile {
  return {
    id: "U-1",
    records: 1,
    categories: ["冰箱"],
    models: ["BCD-525"],
    channels: ["400 客服"],
    dimensions: ["维修时间"],
    severityHigh: 0,
    open: 1,
    closed: 0,
    firstFeedbackAt: "2026-08-14T04:00:00.000Z",
    lastFeedbackAt: "2026-08-14T04:00:00.000Z",
    ...overrides,
  };
}

describe("identitySignals", () => {
  it("counts polarity, recurring dimensions and off-hours feedback from the records", () => {
    const signals = identitySignals({
      kind: "user",
      now: NOW,
      profile: profile({ records: 3, dimensions: ["维修时间", "服务态度"] }),
      records: [
        record({ polarity: "差评", dimensions: ["维修时间"] }),
        // 23:30 Beijing — the hour someone writes because they are annoyed.
        record({
          polarity: "差评",
          dimensions: ["维修时间", "服务态度"],
          feedbackAt: "2026-08-14T15:30:00.000Z",
        }),
        record({ polarity: "好评", dimensions: [] }),
      ],
    });

    expect(signals.negative).toBe(2);
    expect(signals.positive).toBe(1);
    // 维修时间 appears twice, 服务态度 once.
    expect(signals.repeatedDimension).toBe("维修时间");
    expect(signals.offHours).toBe(1);
  });

  it("reports an untagged record as untagged rather than as neutral", () => {
    const signals = identitySignals({
      kind: "user",
      now: NOW,
      profile: profile({ records: 2 }),
      records: [record({ polarity: null }), record({ polarity: "中评" })],
    });

    expect(signals.untagged).toBe(1);
    expect(signals.neutral).toBe(1);
  });

  it("averages closure time over closed records only", () => {
    const signals = identitySignals({
      kind: "device",
      now: NOW,
      profile: profile({ records: 2 }),
      records: [
        record({
          ticketOpenedAt: "2026-08-10T00:00:00.000Z",
          closedAt: "2026-08-11T00:00:00.000Z",
        }),
        record({ ticketOpenedAt: "2026-08-12T00:00:00.000Z", closedAt: null }),
      ],
    });

    expect(signals.meanClosureHours).toBe(24);
  });
});

describe("用户画像 rules", () => {
  it("calls out a burst of negative feedback as escalating, and asks for a phone call", () => {
    const insight = ruleBasedInsight({
      kind: "user",
      now: NOW,
      profile: profile({
        records: 3,
        open: 3,
        firstFeedbackAt: "2026-08-14T02:00:00.000Z",
        lastFeedbackAt: "2026-08-14T20:00:00.000Z",
      }),
      records: [record(), record(), record()],
    });

    expect(insight.labels).toContain("强烈不满");
    expect(insight.labels).toContain("连续追问");
    expect(insight.headline).toContain("情绪正在升级");
    expect(insight.actions[0]).toContain("电话回访");
    expect(insight.level).toBe("高");
  });

  it("reads a satisfied, closed-out identity as low attention and a survey candidate", () => {
    const insight = ruleBasedInsight({
      kind: "user",
      now: NOW,
      profile: profile({
        records: 2,
        open: 0,
        closed: 2,
        dimensions: [],
        firstFeedbackAt: "2026-07-01T04:00:00.000Z",
        lastFeedbackAt: "2026-08-01T04:00:00.000Z",
      }),
      records: [
        record({ polarity: "好评", dimensions: [], state: "无需跟进" }),
        record({ polarity: "好评", dimensions: [], state: "已闭环" }),
      ],
    });

    expect(insight.labels).toContain("总体友好");
    expect(insight.level).toBe("低");
    expect(insight.actions.join()).toContain("满意度回访");
  });

  it("names the recurring dimension in both the headline and the action", () => {
    const insight = ruleBasedInsight({
      kind: "user",
      now: NOW,
      profile: profile({ records: 2, dimensions: ["服务态度"] }),
      records: [
        record({ dimensions: ["服务态度"] }),
        record({ dimensions: ["服务态度"] }),
      ],
    });

    expect(insight.headline).toContain("服务态度");
    expect(insight.actions.join()).toContain("服务态度");
    expect(insight.labels).toContain("聚焦服务态度");
  });

  // Every claim has to be checkable against the rows under it, so the evidence lines
  // carry the numbers rather than adjectives.
  it("states the counts it reasoned from", () => {
    const insight = ruleBasedInsight({
      kind: "user",
      now: NOW,
      profile: profile({ records: 2 }),
      records: [record(), record({ polarity: null })],
    });

    expect(insight.signals[0]).toContain("2 条反馈");
    expect(insight.signals[0]).toContain("未打标");
  });
});

describe("设备预警 rules", () => {
  it("treats three repairs inside a month as a recurrence worth escalating", () => {
    const insight = ruleBasedInsight({
      kind: "device",
      now: NOW,
      profile: profile({
        id: "D-1",
        records: 3,
        open: 1,
        firstFeedbackAt: "2026-07-25T04:00:00.000Z",
        lastFeedbackAt: "2026-08-14T04:00:00.000Z",
      }),
      records: [record(), record(), record()],
    });

    expect(insight.level).toBe("高");
    expect(insight.labels).toContain("多次报修");
    expect(insight.headline).toContain("按复发处理");
    expect(insight.actions.join()).toContain("换件");
  });

  it("flags a repeated repair dimension as work that did not hold", () => {
    const insight = ruleBasedInsight({
      kind: "device",
      now: NOW,
      profile: profile({ id: "D-1", records: 2, dimensions: ["维修技术"] }),
      records: [
        record({ dimensions: ["维修技术"] }),
        record({ dimensions: ["维修技术"] }),
      ],
    });

    expect(insight.labels).toContain("疑似维修未彻底");
    expect(insight.level).toBe("高");
    expect(insight.actions.join()).toContain("资深工程师");
  });

  it("routes a repeated 产品质量 dimension to batch sampling", () => {
    const insight = ruleBasedInsight({
      kind: "device",
      now: NOW,
      profile: profile({ id: "D-1", records: 2, dimensions: ["产品质量"] }),
      records: [
        record({ dimensions: ["产品质量"] }),
        record({ dimensions: ["产品质量"] }),
      ],
    });

    expect(insight.labels).toContain("疑似批次质量");
    expect(insight.actions.join()).toContain("批次");
  });

  it("does not invent a warning for a device seen once", () => {
    const insight = ruleBasedInsight({
      kind: "device",
      now: NOW,
      profile: profile({ id: "D-1", records: 1, open: 0, severityHigh: 0 }),
      records: [record({ state: "已闭环", closedAt: "2026-08-14T10:00:00.000Z" })],
    });

    expect(insight.level).toBe("低");
    expect(insight.headline).toContain("无预警");
    expect(insight.labels).not.toContain("多次报修");
  });
});

describe("provenance and the war-room gate", () => {
  it("labels every insight as rule-produced, never as a model", () => {
    for (const kind of ["user", "device"] as const) {
      const insight = ruleBasedInsight({
        kind,
        now: NOW,
        profile: profile(),
        records: [record()],
      });
      expect(insight.producedBy).toBe(RULE_ENGINE_LABEL);
      expect(insight.producedBy).not.toContain("AI");
    }
  });

  it("exposes the same rules behind the provider seam an aily skill would implement", async () => {
    const input = {
      kind: "user" as const,
      now: NOW,
      profile: profile(),
      records: [record()],
    };
    await expect(ruleBasedProvider.analyze(input)).resolves.toEqual(
      ruleBasedInsight(input),
    );
    expect(ruleBasedProvider.name).toBe(RULE_ENGINE_LABEL);
  });

  // The button offers a group when the analysis says the identity needs one, so the
  // rule and the control cannot drift apart.
  it("warrants a group on a high finding, or on unfinished work at medium", () => {
    const base = { kind: "user" as const, id: "U-1", labels: [], headline: "", signals: [], actions: [], producedBy: RULE_ENGINE_LABEL };
    expect(warrantsWarRoom({ ...base, level: "高" }, 0)).toBe(true);
    expect(warrantsWarRoom({ ...base, level: "中" }, 2)).toBe(true);
    expect(warrantsWarRoom({ ...base, level: "中" }, 0)).toBe(false);
    expect(warrantsWarRoom({ ...base, level: "低" }, 5)).toBe(false);
  });
});
