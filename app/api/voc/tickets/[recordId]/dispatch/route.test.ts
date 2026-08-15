import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../../../../../../src/features/bitable/field-map";
import type { OwnerRuleRecord } from "../../../../../../src/features/voc/owner-rules";
import { createDispatchRoute, parseDispatch, type DispatchDependencies } from "./route";

const NOW = Date.parse("2026-08-15T02:00:00.000Z");

function record(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec-1",
    recordNumber: "VOC-a3cdc5",
    channel: "400 客服",
    category: "冰箱",
    model: "BCD-525",
    content: "报修后等了三天没人上门",
    rating: 2,
    feedbackAt: "2026-08-14T04:00:00.000Z",
    state: "待跟进",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "用户反馈上门维修延迟三天",
    replies: [],
    severity: "高",
    ownerOpenIds: ["ou_owner"],
    ownerNames: ["黄齐"],
    retryCount: 0,
    ticketOpenedAt: "2026-08-14T05:00:00.000Z",
    closedAt: null,
    warRoomChatId: "",
    engineerOpenIds: [],
    engineerNames: [],
    dispatchedAt: null,
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

const ROSTER: readonly OwnerRuleRecord[] = [
  {
    recordId: "own-1",
    scope: "400 客服",
    openId: "ou_owner",
    ownerName: "黄齐",
    fallback: true,
    role: "客服",
  },
  {
    recordId: "own-2",
    scope: "",
    openId: "ou_engineer",
    ownerName: "张睿哲",
    fallback: false,
    role: "工程师",
  },
  {
    recordId: "own-3",
    scope: "",
    openId: "ou_admin",
    ownerName: "张禹健",
    fallback: false,
    role: "管理员",
  },
];

function deps(overrides: Partial<DispatchDependencies> = {}): DispatchDependencies {
  return {
    session: async () => ({ openId: "ou_owner", name: "黄齐" }),
    getRecord: async () => record(),
    updateRecord: async () => {},
    listRoster: async () => ROSTER,
    deviceContext: async () => ({
      total: 7,
      open: 2,
      recurrence: {
        level: "高",
        headline: "7 次报修且集中在维修技术，建议按复发处理",
        actions: ["升级为换件评估"],
        producedBy: "规则引擎",
      },
    }),
    sendCard: async () => {},
    notify: async () => {},
    revalidate: () => {},
    now: () => NOW,
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request("https://example.test/api/voc/tickets/rec-1/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (recordId = "rec-1") => ({
  params: Promise.resolve({ recordId }),
});

describe("parseDispatch", () => {
  it("takes an open_id and refuses anything else", () => {
    expect(parseDispatch({ engineerOpenId: "ou_a" })).toBe("ou_a");
    expect(parseDispatch({ engineerOpenId: "" })).toBeNull();
    expect(parseDispatch({ engineerOpenId: 7 })).toBeNull();
    expect(parseDispatch(null)).toBeNull();
  });
});

describe("POST /api/voc/tickets/[recordId]/dispatch", () => {
  it("writes both columns and sends the engineer their task card", async () => {
    const updateRecord = vi.fn(async () => {});
    const sendCard = vi.fn(async () => {});
    const revalidate = vi.fn();

    const response = await createDispatchRoute(
      deps({ updateRecord, sendCard, revalidate }),
    )(post({ engineerOpenId: "ou_engineer" }), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ dispatched: true });
    expect(updateRecord).toHaveBeenCalledWith("rec-1", {
      上门工程师: [{ id: "ou_engineer" }],
      派工时间: NOW,
    });
    expect(sendCard).toHaveBeenCalledWith("ou_engineer", expect.anything());
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  // The card is the engineer's whole surface, so what it carries is worth asserting:
  // the machine, the customer's own words, and how many times this device came back.
  it("puts the device's history and the recurrence verdict on the card", async () => {
    let card: unknown = null;
    await createDispatchRoute(
      deps({ sendCard: async (_openId, sent) => void (card = sent) }),
    )(post({ engineerOpenId: "ou_engineer" }), params());

    const json = JSON.stringify(card);
    expect(json).toContain("BCD-525");
    expect(json).toContain("报修后等了三天没人上门");
    expect(json).toContain("共 7 条反馈，其中未闭环 2 条");
    expect(json).toContain("7 次报修且集中在维修技术");
    // Never presented as a model's judgement while it is a rule engine's.
    expect(json).toContain("规则引擎");
  });

  it("lets a 管理员 dispatch a ticket they do not own", async () => {
    const updateRecord = vi.fn(async () => {});
    const response = await createDispatchRoute(
      deps({ session: async () => ({ openId: "ou_admin", name: "张禹健" }), updateRecord }),
    )(post({ engineerOpenId: "ou_engineer" }), params());

    expect(response.status).toBe(200);
    expect(updateRecord).toHaveBeenCalled();
  });

  it("refuses someone who is neither the owner nor an admin", async () => {
    const updateRecord = vi.fn(async () => {});
    const response = await createDispatchRoute(
      deps({ session: async () => ({ openId: "ou_stranger", name: "路人" }), updateRecord }),
    )(post({ engineerOpenId: "ou_engineer" }), params());

    expect(response.status).toBe(403);
    expect(updateRecord).not.toHaveBeenCalled();
  });

  // Dispatching puts a colleague on a job. Only the people 人员管理 lists as 工程师 can
  // be put there, or the card arrives at someone nobody assigned.
  it("refuses a person who is not on the engineer roster", async () => {
    const updateRecord = vi.fn(async () => {});
    const response = await createDispatchRoute(deps({ updateRecord }))(
      post({ engineerOpenId: "ou_admin" }),
      params(),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("不是工程师");
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it("refuses to dispatch a closed ticket", async () => {
    const response = await createDispatchRoute(
      deps({ getRecord: async () => record({ state: "已闭环" }) }),
    )(post({ engineerOpenId: "ou_engineer" }), params());
    expect(response.status).toBe(422);
  });

  // A second click on the same engineer is not a second job — and must not be a second
  // card either.
  it("does nothing when the same engineer is already on the ticket", async () => {
    const sendCard = vi.fn(async () => {});
    const response = await createDispatchRoute(
      deps({
        getRecord: async () =>
          record({ engineerOpenIds: ["ou_engineer"], engineerNames: ["张睿哲"] }),
        sendCard,
      }),
    )(post({ engineerOpenId: "ou_engineer" }), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ dispatched: false });
    expect(sendCard).not.toHaveBeenCalled();
  });

  it("answers 404 for a record that is not there", async () => {
    const response = await createDispatchRoute(deps({ getRecord: async () => null }))(
      post({ engineerOpenId: "ou_engineer" }),
      params("rec-gone"),
    );
    expect(response.status).toBe(404);
  });

  it("refuses without a session", async () => {
    const response = await createDispatchRoute(deps({ session: async () => null }))(
      post({ engineerOpenId: "ou_engineer" }),
      params(),
    );
    expect(response.status).toBe(401);
  });

  it("reports a failed write rather than claiming the engineer was sent", async () => {
    const sendCard = vi.fn(async () => {});
    const response = await createDispatchRoute(
      deps({
        updateRecord: async () => {
          throw new Error("bitable down");
        },
        sendCard,
      }),
    )(post({ engineerOpenId: "ou_engineer" }), params());

    expect(response.status).toBe(502);
    expect(sendCard).not.toHaveBeenCalled();
  });

  // The write landed, so the dispatch happened. A card that did not send is a
  // notification to make by hand, not a reason to make the operator click again.
  it("still reports success when the card fails to send, and says to notify by hand", async () => {
    const response = await createDispatchRoute(
      deps({
        sendCard: async () => {
          throw new Error("feishu down");
        },
      }),
    )(post({ engineerOpenId: "ou_engineer" }), params());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("手动通知");
  });

  // A device with no history read still gets dispatched; the card just loses a block.
  it("dispatches even when the device context cannot be read", async () => {
    const sendCard = vi.fn(async () => {});
    const response = await createDispatchRoute(
      deps({
        deviceContext: async () => {
          throw new Error("neon down");
        },
        sendCard,
      }),
    )(post({ engineerOpenId: "ou_engineer" }), params());

    expect(response.status).toBe(200);
    expect(sendCard).toHaveBeenCalled();
  });
});
