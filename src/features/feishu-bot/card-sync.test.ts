import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import type { TicketCard } from "../store/ticket-cards";
import { renderForAudience, syncTicketCards } from "./card-sync";

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
    state: "上门中",
    polarity: "差评",
    dimensions: ["维修技术"],
    summary: "反复漏水",
    replies: [],
    severity: "高",
    ownerOpenIds: ["ou_owner"],
    ownerNames: ["黄齐"],
    retryCount: 0,
    ticketOpenedAt: "2026-08-16T05:00:00.000Z",
    closedAt: null,
    warRoomChatId: "",
    engineerOpenIds: ["ou_engineer"],
    engineerNames: ["张睿哲"],
    dispatchedAt: "2026-08-16T06:00:00.000Z",
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

function card(overrides: Partial<TicketCard> = {}): TicketCard {
  return {
    messageId: "om_owner",
    recordId: "rec1",
    audience: "owner",
    payload: {},
    ...overrides,
  };
}

function deps(overrides: Partial<Parameters<typeof syncTicketCards>[1]> = {}) {
  return {
    listCards: async () => [card()],
    getRecord: async () => record(),
    patch: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("syncTicketCards", () => {
  // The whole point: one click, and every other surface holding this ticket is
  // redrawn at the state the click produced.
  it("redraws every registered card for the ticket", async () => {
    const patch = vi.fn(async () => {});
    const result = await syncTicketCards("rec1", {
      ...deps(),
      listCards: async () => [
        card({ messageId: "om_owner", audience: "owner" }),
        card({ messageId: "om_engineer", audience: "engineer" }),
        card({ messageId: "om_group", audience: "war_room" }),
      ],
      patch,
    });

    expect(result).toEqual({ patched: 3, failed: 0 });
    expect(patch.mock.calls.map((call) => call[0])).toEqual([
      "om_owner",
      "om_engineer",
      "om_group",
    ]);
  });

  it("skips the card the caller already redrew", async () => {
    const patch = vi.fn(async () => {});
    const result = await syncTicketCards(
      "rec1",
      {
        ...deps(),
        listCards: async () => [
          card({ messageId: "om_clicked" }),
          card({ messageId: "om_other", audience: "engineer" }),
        ],
        patch,
      },
      "om_clicked",
    );

    expect(result.patched).toBe(1);
    expect(patch).toHaveBeenCalledWith("om_other", expect.anything());
  });

  // A stale card is not a failed transition: the click already succeeded and was
  // already answered, so one unusable message id must not stop the others.
  it("keeps going when one card cannot be updated", async () => {
    const patch = vi.fn(async (messageId: string) => {
      if (messageId === "om_dead") throw new Error("message not found");
    });
    const result = await syncTicketCards("rec1", {
      ...deps(),
      listCards: async () => [
        card({ messageId: "om_dead" }),
        card({ messageId: "om_live", audience: "engineer" }),
      ],
      patch,
    });

    expect(result).toEqual({ patched: 1, failed: 1 });
  });

  it("does nothing when the ticket has no registered cards", async () => {
    const patch = vi.fn(async () => {});
    const result = await syncTicketCards("rec1", {
      ...deps(),
      listCards: async () => [],
      patch,
    });

    expect(result).toEqual({ patched: 0, failed: 0 });
    expect(patch).not.toHaveBeenCalled();
  });

  it("never throws when the record is gone", async () => {
    const patch = vi.fn(async () => {});
    await expect(
      syncTicketCards("rec1", { ...deps(), getRecord: async () => null, patch }),
    ).resolves.toEqual({ patched: 0, failed: 0 });
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("renderForAudience", () => {
  // The engineer's card must never grow a 确认闭环 button just because a redraw
  // rebuilt it — closing is the owner's call, and the task card is the surface
  // that has to keep saying so.
  it("redraws the engineer's task card with the dispatch context it was sent with", () => {
    const rendered = JSON.stringify(
      renderForAudience("engineer", record(), {
        dispatcherName: "黄齐",
        deviceTotal: 3,
        deviceOpen: 2,
      }),
    );

    expect(rendered).toContain("上门任务");
    expect(rendered).toContain("黄齐");
    expect(rendered).toContain("上门中");
    expect(rendered).not.toContain("voc_confirm_closure");
  });

  it("shows the current state on the owner's ticket card", () => {
    const rendered = JSON.stringify(
      renderForAudience("owner", record({ state: "已闭环" }), {}),
    );

    expect(rendered).toContain("已闭环");
  });
});
