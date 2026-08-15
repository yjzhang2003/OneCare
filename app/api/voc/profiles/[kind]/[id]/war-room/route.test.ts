import { describe, expect, it, vi } from "vitest";

import { RULE_ENGINE_LABEL } from "../../../../../../../src/features/profiles/insight";
import type { WorkbenchTicket } from "../../../../../../../src/features/workbench/data";
import type { IdentityProfile } from "../../../../../../../src/features/workbench/profiles";
import { createProfileInsightCard } from "../../../../../../../src/features/feishu-bot/cards";
import { createProfileWarRoomRoute } from "./route";
import { identityWarRoomName } from "../../../../../../../src/features/warroom/identity";

function profile(): IdentityProfile {
  return {
    id: "D-1",
    records: 3,
    categories: ["冰箱"],
    models: ["BCD-525"],
    channels: ["400 客服"],
    dimensions: ["维修技术"],
    severityHigh: 1,
    open: 2,
    closed: 1,
    firstFeedbackAt: "2026-08-10T04:00:00.000Z",
    lastFeedbackAt: "2026-08-14T04:00:00.000Z",
  };
}

function record(overrides: Partial<WorkbenchTicket> = {}): WorkbenchTicket {
  return {
    recordId: "rec1",
    recordNumber: "R-1",
    feedbackAt: "2026-08-14T04:00:00.000Z",
    channel: "400 客服",
    category: "冰箱",
    model: "BCD-525",
    content: "又坏了",
    polarity: "差评",
    dimensions: ["维修技术"],
    summary: "",
    replies: [],
    severity: "高",
    state: "待跟进",
    ownerNames: ["黄齐"],
    retryCount: 0,
    hasOwner: true,
    hasWarRoom: false,
    engineerNames: [],
    dispatchedAt: null,
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

function route(
  overrides: Partial<Parameters<typeof createProfileWarRoomRoute>[0]> = {},
) {
  const createChat = vi.fn(async () => "oc_chat_1");
  const sendCard = vi.fn(async (_chatId: string, _card: unknown) => {});
  const claimChat = vi.fn(async (_k: unknown, _i: unknown, chatId: string) => ({
    chatId,
    created: true,
  }));
  const existingChat = vi.fn(async () => null);
  const post = createProfileWarRoomRoute({
    session: async () => ({ openId: "ou_operator", name: "运营" }),
    getProfile: async () => profile(),
    getRecords: async () => [record(), record({ recordNumber: "R-2" })],
    getResponderOpenIds: async () => ["ou_owner"],
    provider: {
      name: RULE_ENGINE_LABEL,
      analyze: async () => ({
        kind: "device" as const,
        id: "D-1",
        labels: ["多次报修"],
        headline: "按复发处理",
        signals: ["3 次报修"],
        actions: ["换件评估"],
        level: "高" as const,
        producedBy: RULE_ENGINE_LABEL,
      }),
    },
    existingChat,
    createChat,
    claimChat,
    // The card is assembled by the caller now, so the shared war-room function can be
    // driven by a Feishu card action too. Here it stands in for the real one; what these
    // tests are about is who gets pulled in and what happens on a second click.
    buildCard: ({ kind, id, insight, openTicketNumbers }) =>
      createProfileInsightCard({
        kind,
        id,
        level: insight.level,
        headline: insight.headline,
        labels: insight.labels,
        signals: insight.signals,
        actions: insight.actions,
        producedBy: insight.producedBy,
        openTicketNumbers,
      }),
    sendCard,
    now: () => Date.parse("2026-08-15T12:00:00+08:00"),
    ...overrides,
  });
  return { post, createChat, sendCard, claimChat, existingChat };
}

function call(
  post: ReturnType<typeof createProfileWarRoomRoute>,
  kind = "device",
  id = "D-1",
) {
  return post(new Request("https://example.com", { method: "POST" }), {
    params: Promise.resolve({ kind, id }),
  });
}

describe("identityWarRoomName", () => {
  it("names the group after the identity and the finding", () => {
    expect(identityWarRoomName("user", "U-1", "高")).toBe("VOC-用户-U-1-高");
    expect(identityWarRoomName("device", "D-1", "中")).toBe("VOC-设备-D-1-中");
  });
});

describe("profile war room route", () => {
  it("creates the group, records it, and posts the analysis into it", async () => {
    const { post, createChat, sendCard, claimChat } = route();

    const response = await call(post);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { created: boolean; chatId: string };
    expect(body).toMatchObject({ created: true, chatId: "oc_chat_1" });

    // The operator plus whoever owns the unfinished work — those are the people who
    // would otherwise hear about the group second-hand.
    expect(createChat).toHaveBeenCalledWith("VOC-设备-D-1-高", [
      "ou_operator",
      "ou_owner",
    ]);
    expect(claimChat).toHaveBeenCalledWith("device", "D-1", "oc_chat_1", "ou_operator");
    expect(sendCard).toHaveBeenCalledTimes(1);
    const card = JSON.stringify(sendCard.mock.calls[0]![1]);
    expect(card).toContain("按复发处理");
    // Provenance travels with the finding: a group full of colleagues is exactly where
    // an unmarked machine judgement gets quoted as a model's.
    expect(card).toContain(RULE_ENGINE_LABEL);
    // The tickets in flight, so the group starts from the work rather than a search.
    expect(card).toContain("R-1");
  });

  // A second click must join the group that exists, never make another one with the
  // same name — the same property warRoomDecision gives the ticket path.
  it("does not create a second group when one already exists", async () => {
    const { post, createChat, sendCard } = route({
      existingChat: async () => "oc_chat_existing",
    });

    const response = await call(post);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      created: false,
      chatId: "oc_chat_existing",
    });
    expect(createChat).not.toHaveBeenCalled();
    expect(sendCard).not.toHaveBeenCalled();
  });

  // Two operators clicking at the same moment: the loser is told about the winner's
  // group instead of both posting into two different ones.
  it("defers to the winner when the claim was lost", async () => {
    const { post, sendCard } = route({
      claimChat: async () => ({ chatId: "oc_chat_winner", created: false }),
    });

    const body = (await (await call(post)).json()) as {
      created: boolean;
      chatId: string;
    };
    expect(body).toMatchObject({ created: false, chatId: "oc_chat_winner" });
    expect(sendCard).not.toHaveBeenCalled();
  });

  it("reports a failed group creation without recording anything", async () => {
    const { post, claimChat } = route({
      createChat: async () => {
        throw new Error("feishu said no");
      },
    });

    const response = await call(post);
    expect(response.status).toBe(502);
    expect((await response.json()).message).toBe("协同群创建失败，请稍后重试");
    expect(claimChat).not.toHaveBeenCalled();
  });

  // The group exists and is recorded by then; a failed post is cosmetic, so the operator
  // is told to share it rather than left wondering why the group is empty.
  it("still reports success when only the card failed", async () => {
    const { post } = route({
      sendCard: async (_chatId: string, _card: unknown) => {
        throw new Error("post failed");
      },
    });

    const response = await call(post);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { created: boolean; message: string };
    expect(body.created).toBe(true);
    expect(body.message).toContain("发送失败");
  });

  it("refuses an anonymous caller before touching Feishu", async () => {
    const createChat = vi.fn(async () => "oc_chat_1");
    const { post } = route({ session: async () => null, createChat });

    expect((await call(post)).status).toBe(401);
    expect(createChat).not.toHaveBeenCalled();
  });

  it("rejects a kind that is not user or device", async () => {
    const createChat = vi.fn(async () => "oc_chat_1");
    const { post } = route({ createChat });

    expect((await call(post, "ticket")).status).toBe(400);
    expect(createChat).not.toHaveBeenCalled();
  });

  it("answers 404 for an identity that does not exist", async () => {
    const createChat = vi.fn(async () => "oc_chat_1");
    const { post } = route({ getProfile: async () => null, createChat });

    expect((await call(post)).status).toBe(404);
    expect(createChat).not.toHaveBeenCalled();
  });

  // A closed ticket's owner is not pulled into a group about work that is finished, and
  // a closed record is not listed as in flight.
  it("counts only unfinished tickets as the work in flight", async () => {
    const { post, sendCard } = route({
      getRecords: async () => [
        record({ recordNumber: "R-open" }),
        record({
          recordNumber: "R-closed",
          state: "已闭环",
          closedAt: "2026-08-14T10:00:00.000Z",
        }),
      ],
    });

    await call(post);
    const card = JSON.stringify(sendCard.mock.calls[0]![1]);
    expect(card).toContain("R-open");
    expect(card).not.toContain("R-closed");
  });
});
