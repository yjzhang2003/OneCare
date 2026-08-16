import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../../../../../../src/features/bitable/field-map";
import { createTagEditRoute, type TagEditDependencies } from "./route";

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
    state: "跟进中",
    polarity: "中评",
    dimensions: ["售后服务"],
    summary: "",
    replies: [],
    severity: "中",
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

function deps(overrides: Partial<TagEditDependencies> = {}): TagEditDependencies {
  return {
    session: async () => ({ openId: "ou_owner", name: "黄齐" }),
    getRecord: async () => record(),
    updateRecord: async () => {},
    listAdmins: async () => ["ou_admin"],
    syncCards: async () => ({ patched: 0, failed: 0 }),
    revalidate: () => {},
    ...overrides,
  };
}

const EDIT = {
  polarity: "差评",
  dimensions: ["维修技术"],
  severity: "高",
  summary: "用户三次报修未解决，情绪强烈",
};

function patch(body: unknown): Request {
  return new Request("https://example.test/api/voc/tickets/rec-1/tags", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (recordId = "rec-1") => ({ params: Promise.resolve({ recordId }) });

describe("PATCH /api/voc/tickets/[recordId]/tags", () => {
  it("writes the correction and stamps who made it", async () => {
    const updateRecord = vi.fn(async () => {});
    const revalidate = vi.fn();
    const response = await createTagEditRoute(deps({ updateRecord, revalidate }))(
      patch(EDIT),
      params(),
    );

    expect(response.status).toBe(200);
    expect(updateRecord).toHaveBeenCalledWith("rec-1", {
      情绪极性: "差评",
      问题维度: ["维修技术"],
      严重度: "高",
      "AI 摘要": "用户三次报修未解决，情绪强烈",
      打标来源: "manual:黄齐",
    });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("lets an admin correct a ticket they do not own", async () => {
    const updateRecord = vi.fn(async () => {});
    const response = await createTagEditRoute(
      deps({ session: async () => ({ openId: "ou_admin", name: "张禹健" }), updateRecord }),
    )(patch(EDIT), params());

    expect(response.status).toBe(200);
    expect(updateRecord).toHaveBeenCalled();
  });

  // An unowned ticket has no owner's judgement to override, so correcting it is open —
  // the same reasoning that makes 认领 open to everyone.
  it("lets anyone correct an unassigned ticket", async () => {
    const response = await createTagEditRoute(
      deps({
        session: async () => ({ openId: "ou_stranger", name: "路人" }),
        getRecord: async () => record({ ownerOpenIds: [], ownerNames: [] }),
      }),
    )(patch(EDIT), params());
    expect(response.status).toBe(200);
  });

  it("refuses someone who is neither the owner nor an admin", async () => {
    const updateRecord = vi.fn(async () => {});
    const response = await createTagEditRoute(
      deps({
        session: async () => ({ openId: "ou_stranger", name: "路人" }),
        updateRecord,
      }),
    )(patch(EDIT), params());

    expect(response.status).toBe(403);
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it("refuses a value outside the enums", async () => {
    const updateRecord = vi.fn(async () => {});
    const response = await createTagEditRoute(deps({ updateRecord }))(
      patch({ ...EDIT, severity: "很高" }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it("answers 404 for a record that is gone", async () => {
    const response = await createTagEditRoute(deps({ getRecord: async () => null }))(
      patch(EDIT),
      params("rec-gone"),
    );
    expect(response.status).toBe(404);
  });

  it("refuses without a session", async () => {
    const response = await createTagEditRoute(deps({ session: async () => null }))(
      patch(EDIT),
      params(),
    );
    expect(response.status).toBe(401);
  });

  // An unreadable roster must not lock the owner out of their own ticket.
  it("still lets the owner correct when the roster cannot be read", async () => {
    const response = await createTagEditRoute(
      deps({
        listAdmins: async () => {
          throw new Error("bitable down");
        },
      }),
    )(patch(EDIT), params());
    expect(response.status).toBe(200);
  });

  it("reports a failed write instead of claiming it saved", async () => {
    const response = await createTagEditRoute(
      deps({
        updateRecord: async () => {
          throw new Error("bitable down");
        },
      }),
    )(patch(EDIT), params());
    expect(response.status).toBe(502);
  });
});
