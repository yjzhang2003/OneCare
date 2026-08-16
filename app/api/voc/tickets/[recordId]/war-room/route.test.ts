import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../../../../../../src/features/bitable/field-map";
import { DECLINED_MARKER } from "../../../../../../src/features/warroom/naming";
import {
  createTicketWarRoomRoute,
  type TicketWarRoomDependencies,
} from "./route";

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

function deps(
  overrides: Partial<TicketWarRoomDependencies> = {},
): TicketWarRoomDependencies {
  return {
    session: async () => ({ openId: "ou_owner", name: "黄齐" }),
    getRecord: async () => record(),
    updateRecord: async () => {},
    fallbackOpenIds: async () => ["ou_fallback"],
    createChat: async () => "oc_new",
    sendToChat: async () => {},
    revalidate: () => {},
    ...overrides,
  };
}

function params(recordId = "rec-1") {
  return { params: Promise.resolve({ recordId }) };
}

const request = () =>
  new Request("https://example.test/api/voc/tickets/rec-1/war-room", {
    method: "POST",
  });

describe("POST /api/voc/tickets/[recordId]/war-room", () => {
  it("creates the group, records it, and posts the ticket card", async () => {
    const createChat = vi.fn(async () => "oc_new");
    const updateRecord = vi.fn(async () => {});
    const sendToChat = vi.fn(async () => {});
    const revalidate = vi.fn();

    const response = await createTicketWarRoomRoute(
      deps({ createChat, updateRecord, sendToChat, revalidate }),
    )(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, created: true });
    // Named and populated by the same code the escalation card runs: the ticket's own
    // group name, its owner, and whoever clicked.
    expect(createChat).toHaveBeenCalledWith("VOC-a3cdc5-冰箱-高", ["ou_owner", "ou_owner"]);
    expect(updateRecord).toHaveBeenCalledWith("rec-1", { "协同群 ID": "oc_new" });
    expect(sendToChat).toHaveBeenCalledWith("oc_new", expect.anything(), expect.any(String),);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("lets the 兜底人 pull a group on a ticket they do not own", async () => {
    const createChat = vi.fn(async () => "oc_new");
    const response = await createTicketWarRoomRoute(
      deps({ session: async () => ({ openId: "ou_fallback", name: "张禹健" }), createChat }),
    )(request(), params());

    expect(response.status).toBe(200);
    expect(createChat).toHaveBeenCalledWith(expect.any(String), ["ou_owner", "ou_fallback"]);
  });

  it("refuses a stranger, the same predicate the card applies", async () => {
    const createChat = vi.fn(async () => "oc_new");
    const response = await createTicketWarRoomRoute(
      deps({ session: async () => ({ openId: "ou_stranger", name: "路人" }), createChat }),
    )(request(), params());

    expect(response.status).toBe(403);
    expect(createChat).not.toHaveBeenCalled();
  });

  // The idempotence record is the 协同群 ID column, so a second click cannot make a
  // second group — and is told where the first one is rather than being refused.
  it("does not create a second group for a ticket that already has one", async () => {
    const createChat = vi.fn(async () => "oc_new");
    const revalidate = vi.fn();
    const response = await createTicketWarRoomRoute(
      deps({ getRecord: async () => record({ warRoomChatId: "oc_old" }), createChat, revalidate }),
    )(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ created: false });
    expect(createChat).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  // The card path stops here ("此前已选择暂不需要"). On the web the click *is* the new
  // decision — the decline only ever meant "not automatically", and there is no second
  // proposal left to accept.
  it("supersedes an earlier 暂不需要 when someone asks for the group by hand", async () => {
    const createChat = vi.fn(async () => "oc_new");
    const response = await createTicketWarRoomRoute(
      deps({
        getRecord: async () => record({ warRoomChatId: DECLINED_MARKER }),
        createChat,
      }),
    )(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ created: true });
    expect(createChat).toHaveBeenCalled();
  });

  it("answers 404 for a record that is not there", async () => {
    const response = await createTicketWarRoomRoute(deps({ getRecord: async () => null }))(
      request(),
      params("rec-gone"),
    );
    expect(response.status).toBe(404);
  });

  it("refuses without a session", async () => {
    const getRecord = vi.fn(async () => record());
    const response = await createTicketWarRoomRoute(
      deps({ session: async () => null, getRecord }),
    )(request(), params());

    expect(response.status).toBe(401);
    expect(getRecord).not.toHaveBeenCalled();
  });

  // The three half-failures the card path can only report by direct message. Here they
  // are the response, because the operator is watching it.
  it("reports a failed chat create rather than claiming a group exists", async () => {
    const updateRecord = vi.fn(async () => {});
    const response = await createTicketWarRoomRoute(
      deps({
        createChat: async () => {
          throw new Error("feishu down");
        },
        updateRecord,
      }),
    )(request(), params());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ message: "协同群创建失败，请重试" });
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it("says so when the group exists but the record could not be updated", async () => {
    const revalidate = vi.fn();
    const response = await createTicketWarRoomRoute(
      deps({
        updateRecord: async () => {
          throw new Error("bitable down");
        },
        revalidate,
      }),
    )(request(), params());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      message: "协同群已创建但未记录，请重试",
    });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("says so when the group exists but the ticket card did not post", async () => {
    const response = await createTicketWarRoomRoute(
      deps({
        sendToChat: async () => {
          throw new Error("send failed");
        },
      }),
    )(request(), params());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      message: "协同群已创建，但工单卡片发送失败，请稍后在群内分享",
    });
  });

  it("answers 500 rather than an opaque throw when a dependency explodes", async () => {
    const response = await createTicketWarRoomRoute(
      deps({
        fallbackOpenIds: async () => {
          throw new Error("owner table down");
        },
      }),
    )(request(), params());
    expect(response.status).toBe(500);
  });
});
