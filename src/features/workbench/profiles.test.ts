import { describe, expect, it } from "vitest";

import type { WorkbenchTicket } from "./data";
import { deviceProfiles, repeatOnly, userProfiles } from "./profiles";

function ticket(overrides: Partial<WorkbenchTicket> = {}): WorkbenchTicket {
  return {
    recordId: "rec1",
    recordNumber: "R-001",
    feedbackAt: "2026-01-24T00:00:00.000Z",
    channel: "400 客服",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "制冷不足",
    polarity: "差评",
    dimensions: ["产品质量"],
    summary: "",
    replies: [],
    severity: "中",
    state: "待跟进",
    ownerNames: [],
    retryCount: 0,
    hasOwner: false,
    hasWarRoom: false,
    engineerNames: [],
    dispatchedAt: null,
    followUpNote: "",
    closingNote: "",
    userRef: "U-A",
    deviceRef: "D-A",
    sourceTicketNo: "CAS-1",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ticketOpenedAt: null,
    closedAt: null,
    durationHours: null,
    ...overrides,
  };
}

describe("userProfiles", () => {
  it("groups records by the reconstructed user identity", () => {
    const profiles = userProfiles([
      ticket({ recordNumber: "R-1", userRef: "U-A" }),
      ticket({ recordNumber: "R-2", userRef: "U-A" }),
      ticket({ recordNumber: "R-3", userRef: "U-B" }),
    ]);

    expect(profiles.map((p) => [p.id, p.records])).toEqual([
      ["U-A", 2],
      ["U-B", 1],
    ]);
  });

  // The list answers "who is complaining most", so the heaviest profile is first.
  // 2772 synthetic ids in alphabetical order answer no question at all.
  it("orders by record count, with a stable tie-break", () => {
    const profiles = userProfiles([
      ticket({ recordNumber: "R-1", userRef: "U-Z" }),
      ticket({ recordNumber: "R-2", userRef: "U-A" }),
      ticket({ recordNumber: "R-3", userRef: "U-M" }),
      ticket({ recordNumber: "R-4", userRef: "U-M" }),
    ]);
    expect(profiles.map((p) => p.id)).toEqual(["U-M", "U-A", "U-Z"]);
  });

  // Grouping every unidentified record together would produce one enormous profile
  // that describes nothing.
  it("never groups records with a blank identity", () => {
    const profiles = userProfiles([
      ticket({ recordNumber: "R-1", userRef: "" }),
      ticket({ recordNumber: "R-2", userRef: "   " }),
      ticket({ recordNumber: "R-3", userRef: "U-A" }),
    ]);
    expect(profiles.map((p) => p.id)).toEqual(["U-A"]);
  });

  it("summarises the group's dimensions, channels and severity", () => {
    const [profile] = userProfiles([
      ticket({
        recordNumber: "R-1",
        channel: "400 客服",
        dimensions: ["产品质量"],
        severity: "高",
      }),
      ticket({
        recordNumber: "R-2",
        channel: "电商评价",
        dimensions: ["服务态度", "产品质量"],
        severity: "低",
      }),
    ]);

    expect(profile?.channels).toEqual(["400 客服", "电商评价"]);
    expect(profile?.dimensions).toEqual(["产品质量", "服务态度"]);
    expect(profile?.severityHigh).toBe(1);
  });

  it("counts open against terminal states", () => {
    const [profile] = userProfiles([
      ticket({ recordNumber: "R-1", state: "跟进中" }),
      ticket({ recordNumber: "R-2", state: "已闭环" }),
      ticket({ recordNumber: "R-3", state: "无需跟进" }),
    ]);
    expect(profile?.open).toBe(1);
    expect(profile?.closed).toBe(2);
  });

  it("spans the group's first and last feedback", () => {
    const [profile] = userProfiles([
      ticket({ recordNumber: "R-1", feedbackAt: "2026-01-28T00:00:00.000Z" }),
      ticket({ recordNumber: "R-2", feedbackAt: "2026-01-24T00:00:00.000Z" }),
      ticket({ recordNumber: "R-3", feedbackAt: null }),
    ]);
    expect(profile?.firstFeedbackAt).toBe("2026-01-24T00:00:00.000Z");
    expect(profile?.lastFeedbackAt).toBe("2026-01-28T00:00:00.000Z");
  });

  it("reports no dates when the group has none", () => {
    const [profile] = userProfiles([ticket({ feedbackAt: null })]);
    expect(profile?.firstFeedbackAt).toBeNull();
    expect(profile?.lastFeedbackAt).toBeNull();
  });
});

describe("deviceProfiles", () => {
  it("groups by device instance, not by model", () => {
    // Same model, two different device instances: 机型 alone would merge two
    // people's fridges into one "device" and invent a repeat failure.
    const profiles = deviceProfiles([
      ticket({ recordNumber: "R-1", deviceRef: "D-A", model: "BCD-525" }),
      ticket({ recordNumber: "R-2", deviceRef: "D-A", model: "BCD-525" }),
      ticket({ recordNumber: "R-3", deviceRef: "D-B", model: "BCD-525" }),
    ]);
    expect(profiles.map((p) => [p.id, p.records])).toEqual([
      ["D-A", 2],
      ["D-B", 1],
    ]);
  });

  // 1146 of 3628 records carry a model; the rest can have no device instance.
  it("skips records with no device identity", () => {
    const profiles = deviceProfiles([
      ticket({ recordNumber: "R-1", deviceRef: "" }),
      ticket({ recordNumber: "R-2", deviceRef: "D-A" }),
    ]);
    expect(profiles.map((p) => p.id)).toEqual(["D-A"]);
  });
});

describe("repeatOnly", () => {
  // For devices this filter is the whole view: a device reported more than once is
  // a batch-quality lead, and 648 of 854 single-report rows would bury the 206
  // that carry the signal.
  it("keeps only profiles with more than one record", () => {
    const profiles = userProfiles([
      ticket({ recordNumber: "R-1", userRef: "U-A" }),
      ticket({ recordNumber: "R-2", userRef: "U-A" }),
      ticket({ recordNumber: "R-3", userRef: "U-B" }),
    ]);
    expect(repeatOnly(profiles).map((p) => p.id)).toEqual(["U-A"]);
  });

  it("returns nothing when every profile is a singleton", () => {
    const profiles = userProfiles([
      ticket({ recordNumber: "R-1", userRef: "U-A" }),
      ticket({ recordNumber: "R-2", userRef: "U-B" }),
    ]);
    expect(repeatOnly(profiles)).toEqual([]);
  });
});
