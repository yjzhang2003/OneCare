import { describe, expect, it } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import {
  assignSlots,
  eligibleFor,
  fieldsOf,
  REHEARSAL_ROLES,
  resetTo,
} from "./rehearsal";

function record(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec1",
    recordNumber: "R-001",
    channel: "400 客服",
    category: "冰箱",
    model: "BCD-525",
    content: "报修后等了三天没人上门",
    rating: 2,
    feedbackAt: "2026-08-14T04:00:00.000Z",
    state: "待分析",
    polarity: null,
    dimensions: [],
    summary: "",
    replies: [],
    severity: null,
    ownerOpenIds: [],
    ownerNames: [],
    retryCount: 0,
    ticketOpenedAt: null,
    closedAt: null,
    warRoomChatId: "",
    engineerOpenIds: [],
    engineerNames: [],
    dispatchedAt: null,
    followUpNote: "",
    closingNote: "",
    userRef: "U-1",
    deviceRef: "D-1",
    sourceTicketNo: "CAS-1",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ...overrides,
  };
}

const openTicket = (overrides: Partial<VocRecord> = {}) =>
  record({
    state: "待跟进",
    ticketOpenedAt: "2026-08-14T06:00:00.000Z",
    ownerOpenIds: ["ou_owner"],
    ownerNames: ["黄齐"],
    ...overrides,
  });

describe("eligibleFor", () => {
  // The 19 rows the real aily skill tagged are the only genuine model output in the
  // dataset. Staging one would overwrite the thing the demo exists to show.
  it("never stages a row carrying real AI output", () => {
    const tagged = record({ summary: "用户反馈上门维修延迟三天" });
    for (const role of REHEARSAL_ROLES) {
      expect(eligibleFor(role.key, tagged)).toBe(false);
    }
  });

  it("takes a row that is already the kind of record the shot needs", () => {
    expect(eligibleFor("analyze", record({ state: "待分析" }))).toBe(true);
    expect(eligibleFor("flow", openTicket())).toBe(true);
    expect(eligibleFor("retry", record({ state: "分析失败" }))).toBe(true);
  });

  // Reopening a closed ticket is not a transition the product allows, so staging must not
  // invent one — the demo would then show a state the state machine cannot produce.
  it("never drags a finished ticket back open", () => {
    for (const state of ["已闭环", "无需跟进"] as const) {
      for (const role of REHEARSAL_ROLES) {
        expect(eligibleFor(role.key, record({ state }))).toBe(false);
      }
    }
  });

  it("will not stage the flow shot on a ticket with no owner", () => {
    expect(eligibleFor("flow", openTicket({ ownerOpenIds: [], ownerNames: [] }))).toBe(
      false,
    );
  });
});

describe("resetTo", () => {
  it("puts the analyze shot back to untagged and unrouted", () => {
    const before = fieldsOf(
      record({
        state: "待跟进",
        ownerOpenIds: ["ou_a"],
        ownerNames: ["黄齐"],
        ticketOpenedAt: "2026-08-14T06:00:00.000Z",
        warRoomChatId: "oc_chat",
        engineerOpenIds: [],
        engineerNames: [],
        dispatchedAt: null,
        followUpNote: "",
        closingNote: "",
      }),
    );

    const target = resetTo("analyze", before)!;
    expect(target.state).toBe("待分析");
    expect(target.ownerNames).toEqual([]);
    expect(target.ticketOpenedAt).toBeNull();
    expect(target.warRoomChatId).toBe("");
  });

  it("leaves the flow shot its owner and its ticket, only rewinding the state", () => {
    const before = fieldsOf(
      openTicket({ state: "已闭环", closedAt: "2026-08-14T20:00:00.000Z" }),
    );

    const target = resetTo("flow", before)!;
    expect(target.state).toBe("待跟进");
    expect(target.closedAt).toBeNull();
    // The ticket keeps who owned it and when it was opened — the shot is the follow-up,
    // not the routing.
    expect(target.ownerNames).toEqual(["黄齐"]);
    expect(target.ticketOpenedAt).toBe("2026-08-14T06:00:00.000Z");
  });

  it("gives the retry shot its retries back, so 立即分析 is offered rather than refused", () => {
    const before = fieldsOf(record({ state: "分析失败", retryCount: 3 }));
    expect(resetTo("retry", before)!.retryCount).toBe(0);
  });

  // A rehearsal that changes nothing should write nothing: two stores, one of them
  // cross-border, and a no-op write during filming is pure risk.
  it("returns null when the record is already in position", () => {
    expect(resetTo("analyze", fieldsOf(record({ state: "待分析" })))).toBeNull();
    expect(resetTo("flow", fieldsOf(openTicket()))).toBeNull();
    expect(resetTo("retry", fieldsOf(record({ state: "分析失败" })))).toBeNull();
  });
});

describe("assignSlots", () => {
  it("fills one slot per shot from the candidates", () => {
    const slots = assignSlots([
      record({ recordId: "a", recordNumber: "R-a", state: "待分析" }),
      openTicket({ recordId: "b", recordNumber: "R-b" }),
      record({ recordId: "c", recordNumber: "R-c", state: "分析失败" }),
    ]);

    expect(slots.map((slot) => slot.key)).toEqual(["analyze", "flow", "retry"]);
    expect(slots.map((slot) => slot.recordNumber)).toEqual(["R-a", "R-b", "R-c"]);
  });

  it("never uses one record for two shots", () => {
    // Only one candidate, eligible for the analyze shot alone.
    const slots = assignSlots([record({ recordId: "a", recordNumber: "R-a" })]);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.key).toBe("analyze");
  });

  // Two people preparing the same demo must get the same records, or the shot list and
  // the machine disagree about what to open.
  it("is deterministic in the record number", () => {
    const pool = [
      record({ recordId: "c", recordNumber: "R-c" }),
      record({ recordId: "a", recordNumber: "R-a" }),
      record({ recordId: "b", recordNumber: "R-b" }),
    ];
    expect(assignSlots(pool)[0]!.recordNumber).toBe("R-a");
    expect(assignSlots([...pool].reverse())[0]!.recordNumber).toBe("R-a");
  });

  it("reports nothing rather than a wrong record when a shot has no material", () => {
    const slots = assignSlots([record({ state: "已闭环" })]);
    expect(slots).toEqual([]);
  });
});
