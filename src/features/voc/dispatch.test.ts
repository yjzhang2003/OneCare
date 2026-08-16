import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import type { OwnerRuleRecord } from "./owner-rules";
import { dispatchTicket } from "./dispatch";

const OWNER = "ou_owner";
const ENGINEER = "ou_engineer";
const ADMIN = "ou_admin";
const NOW = Date.parse("2026-08-16T10:00:00+08:00");

function record(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec1",
    recordNumber: "R-1",
    channel: "400 客服",
    category: "冰箱",
    model: "BCD-525",
    content: "装了三次还是漏水",
    rating: null,
    feedbackAt: "2026-08-16T04:00:00.000Z",
    state: "跟进中",
    polarity: "差评",
    dimensions: ["维修技术"],
    summary: "反复漏水",
    replies: [],
    severity: "高",
    ownerOpenIds: [OWNER],
    ownerNames: ["黄齐"],
    retryCount: 0,
    ticketOpenedAt: "2026-08-16T05:00:00.000Z",
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
  } as VocRecord;
}

const roster: readonly OwnerRuleRecord[] = [
  { recordId: "o1", scope: "400 客服", openId: OWNER, ownerName: "黄齐", fallback: true, role: "客服" },
  { recordId: "o2", scope: "", openId: ENGINEER, ownerName: "张睿哲", fallback: false, role: "工程师" },
  { recordId: "o3", scope: "", openId: ADMIN, ownerName: "张禹健", fallback: false, role: "管理员" },
];

function deps(overrides: Partial<Parameters<typeof dispatchTicket>[1]> = {}) {
  return {
    getRecord: async () => record(),
    listRoster: async () => roster,
    updateRecord: vi.fn(async () => {}),
    sendTaskCard: vi.fn(async () => true),
    now: () => NOW,
    ...overrides,
  };
}

const input = {
  recordId: "rec1",
  engineerOpenId: ENGINEER,
  operatorOpenId: OWNER,
  operatorName: "黄齐",
};

describe("dispatchTicket", () => {
  // 派工 is a transition now, so the ticket has to say where it is: 上门中, not a
  // 跟进中 that could equally mean the 客服 is still on the phone.
  it("moves the ticket to 上门中 and records the engineer", async () => {
    const dependencies = deps();
    const outcome = await dispatchTicket(input, dependencies);

    expect(outcome.kind).toBe("dispatched");
    if (outcome.kind !== "dispatched") return;
    expect(outcome.record.state).toBe("上门中");
    expect(outcome.engineerName).toBe("张睿哲");
    expect(dependencies.updateRecord).toHaveBeenCalledWith("rec1", {
      流程状态: "上门中",
      上门工程师: [{ id: ENGINEER }],
      派工时间: NOW,
    });
  });

  it("dispatches straight from 待跟进 without a pointless 开始跟进 first", async () => {
    const outcome = await dispatchTicket(input, deps({
      getRecord: async () => record({ state: "待跟进" }),
    }));

    expect(outcome.kind).toBe("dispatched");
    if (outcome.kind !== "dispatched") return;
    expect(outcome.record.state).toBe("上门中");
  });

  // 管理员 rows mean "can act on any ticket"; anyone else touching someone else's
  // ticket is the case this refuses.
  it("lets an admin dispatch a ticket they do not own", async () => {
    const outcome = await dispatchTicket(
      { ...input, operatorOpenId: ADMIN },
      deps(),
    );

    expect(outcome.kind).toBe("dispatched");
  });

  it("refuses a stranger", async () => {
    const dependencies = deps();
    const outcome = await dispatchTicket(
      { ...input, operatorOpenId: "ou_someone_else" },
      dependencies,
    );

    expect(outcome.kind).toBe("forbidden");
    expect(dependencies.updateRecord).not.toHaveBeenCalled();
  });

  // A free-text open id would put a colleague on a rota nobody added them to.
  it("refuses someone 人员管理 does not list as 工程师", async () => {
    const dependencies = deps();
    const outcome = await dispatchTicket(
      { ...input, engineerOpenId: ADMIN },
      dependencies,
    );

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") return;
    expect(outcome.message).toContain("工程师");
    expect(dependencies.updateRecord).not.toHaveBeenCalled();
  });

  it("refuses a finished ticket", async () => {
    const dependencies = deps({ getRecord: async () => record({ state: "已闭环" }) });
    const outcome = await dispatchTicket(input, dependencies);

    expect(outcome.kind).toBe("rejected");
    expect(dependencies.updateRecord).not.toHaveBeenCalled();
  });

  // Double-tapping the card's own button must not send a second task card.
  it("says so instead of re-dispatching the same engineer", async () => {
    const dependencies = deps({
      getRecord: async () => record({ state: "上门中", engineerOpenIds: [ENGINEER] }),
    });
    const outcome = await dispatchTicket(input, dependencies);

    expect(outcome.kind).toBe("already");
    expect(dependencies.updateRecord).not.toHaveBeenCalled();
    expect(dependencies.sendTaskCard).not.toHaveBeenCalled();
  });

  // The record already says who is going, so a card that fails to send is a
  // notification problem — never a dispatch that has to be undone.
  it("keeps the dispatch when the task card cannot be sent", async () => {
    const outcome = await dispatchTicket(input, deps({
      sendTaskCard: vi.fn(async () => false),
    }));

    expect(outcome.kind).toBe("dispatched");
    if (outcome.kind !== "dispatched") return;
    expect(outcome.cardSent).toBe(false);
  });

  it("reports a failed write rather than pretending it dispatched", async () => {
    const dependencies = deps({
      updateRecord: vi.fn(async () => {
        throw new Error("bitable said no");
      }),
    });
    const outcome = await dispatchTicket(input, dependencies);

    expect(outcome.kind).toBe("write_failed");
    expect(dependencies.sendTaskCard).not.toHaveBeenCalled();
  });
});
