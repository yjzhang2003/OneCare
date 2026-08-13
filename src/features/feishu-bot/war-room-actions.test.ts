import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import { VOC_FIELD_NAMES } from "../bitable/field-map";
import { DECLINED_MARKER } from "../warroom/naming";
import { resolveWarRoomAction, type WarRoomActionInput } from "./war-room-actions";

// Mirrors card-actions.test.ts's fixture: a full VocRecord typed explicitly so
// later `{ ...record, warRoomChatId: "oc_existing" }` overrides stay assignable
// rather than freezing to the object literal's inferred narrow types.
const record: VocRecord = {
  recordId: "rec1",
  recordNumber: "VOC-0007",
  channel: "电商评价",
  category: "冰箱",
  model: "BCD-525WNK1PU",
  content: "冷藏室温度持续偏高，已反馈三次仍未解决",
  rating: 1,
  feedbackAt: "2026-01-20T00:00:00.000Z",
  state: "待跟进",
  polarity: "差评",
  dimensions: ["维修时间"],
  summary: "用户反馈冷藏室温度持续偏高",
  replies: [{ tone: "致歉安抚", text: "非常抱歉给您带来不便" }],
  severity: "高",
  ownerOpenIds: ["ou_owner"],
  ownerNames: ["张三"],
  retryCount: 0,
  ticketOpenedAt: "2026-01-23T02:00:00.000Z",
  closedAt: null,
  warRoomChatId: "",
  sourceTicketNo: "CAS-42567239-Q7Q8Q",
  userRef: "U-3878645B",
  deviceRef: "D-91C2A70E",
  sourceUrl: "",
  sourceDetail: "400投诉",
  businessUnit: "冰冷事业部",
  categoryLevel1: "安装调试",
};

// A notifyOperator fake that fails the test if it's ever called — used by
// every case below that must not reach the background half at all, so an
// accidental call surfaces as a test failure instead of passing silently.
const unusedNotifyOperator: WarRoomActionInput["notifyOperator"] = async () => {
  throw new Error("notifyOperator should not be called for this case");
};

describe("resolveWarRoomAction — synchronous section", () => {
  it("lets a fallback approver open the room even though they are not the owner, and returns no background yet", async () => {
    // Approving an escalation is the fallback's job, not the owner's. The four
    // status actions keep the strict owner check — changing state is the owner's
    // job, and this relaxation must not leak into them.
    const createChat = vi.fn(
      async (_name: string, _members: readonly string[]): Promise<string> => "oc_new",
    );
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room",
      recordId: "rec1",
      operatorOpenId: "ou_fallback",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async () => {},
      fallbackOpenIds: async () => ["ou_fallback"],
      createChat,
      sendToChat: async () => {},
      notifyOperator: unusedNotifyOperator,
    });

    // The synchronous section decided "create", so it must answer with an
    // interim toast and hand the actual creation to the background task —
    // never call createChat itself.
    expect(createChat).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome.result)).toContain("正在创建");
    expect(outcome.background).toBeTypeOf("function");
  });

  it("rejects a stranger who is neither owner nor fallback, and returns no background task", async () => {
    const createChat = vi.fn(async () => "oc_should_not_happen");
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_stranger",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async () => {}, fallbackOpenIds: async () => ["ou_fallback"],
      createChat, sendToChat: async () => {}, notifyOperator: unusedNotifyOperator,
    });

    expect(createChat).not.toHaveBeenCalled();
    expect(outcome.background).toBeUndefined();
    expect(JSON.stringify(outcome.result)).toMatch(/无权|不是/);
  });

  it("does not create a second group when one already exists, and returns no background task", async () => {
    const createChat = vi.fn(async () => "oc_second");
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "oc_existing" }),
      updateRecord: async () => {}, fallbackOpenIds: async () => [],
      createChat, sendToChat: async () => {}, notifyOperator: unusedNotifyOperator,
    });

    expect(createChat).not.toHaveBeenCalled();
    expect(outcome.background).toBeUndefined();
    expect(JSON.stringify(outcome.result)).toContain("已存在");
  });

  it("marks a declined escalation so it is not proposed again, synchronously, with no background task", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const outcome = await resolveWarRoomAction({
      action: "voc_decline_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async (_id, fields) => { writes.push(fields); },
      fallbackOpenIds: async () => [], createChat: async () => "x", sendToChat: async () => {},
      notifyOperator: unusedNotifyOperator,
    });

    expect(writes[0]?.[VOC_FIELD_NAMES.warRoomChatId]).toBe(DECLINED_MARKER);
    expect(outcome.background).toBeUndefined();
  });

  it("rejects a record id that does not exist, with no background task", async () => {
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec_gone", operatorOpenId: "ou_owner",
      getRecord: async () => null, updateRecord: async () => {},
      fallbackOpenIds: async () => [], createChat: async () => "x", sendToChat: async () => {},
      notifyOperator: unusedNotifyOperator,
    });

    expect(outcome.background).toBeUndefined();
    expect(JSON.stringify(outcome.result)).toMatch(/记录/);
  });

  // Beyond the brief's given cases: this pins down the load-bearing ordering
  // rule itself. If authorization ever moved after the idempotence check, a
  // stranger's toast on an already-created record would leak "a group exists"
  // to someone with no right to know that.
  it("checks authorization before the idempotence check, so a stranger learns nothing about an existing group", async () => {
    const createChat = vi.fn(async () => "oc_should_not_happen");
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_stranger",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "oc_existing" }),
      updateRecord: async () => {}, fallbackOpenIds: async () => ["ou_fallback"],
      createChat, sendToChat: async () => {}, notifyOperator: unusedNotifyOperator,
    });

    expect(createChat).not.toHaveBeenCalled();
    expect(outcome.background).toBeUndefined();
    expect(JSON.stringify(outcome.result)).toMatch(/无权|不是/);
    expect(JSON.stringify(outcome.result)).not.toContain("已存在");
  });

  it("tells the operator a prior decline stands, without creating a chat or a background task", async () => {
    const createChat = vi.fn(async () => "oc_should_not_happen");
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: DECLINED_MARKER }),
      updateRecord: async () => {}, fallbackOpenIds: async () => [],
      createChat, sendToChat: async () => {}, notifyOperator: unusedNotifyOperator,
    });

    expect(createChat).not.toHaveBeenCalled();
    expect(outcome.background).toBeUndefined();
    expect(JSON.stringify(outcome.result)).toContain("暂不需要");
  });
});

describe("resolveWarRoomAction — background section (createWarRoomInBackground)", () => {
  it("does not touch createChat/updateRecord/sendToChat until the returned background task is actually run", async () => {
    const createChat = vi.fn(async () => "oc_new");
    const updateRecord = vi.fn(async () => {});
    const sendToChat = vi.fn(async () => {});
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord, fallbackOpenIds: async () => [], createChat, sendToChat,
      notifyOperator: unusedNotifyOperator,
    });

    expect(createChat).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
    expect(sendToChat).not.toHaveBeenCalled();

    await outcome.background?.();

    expect(createChat).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(sendToChat).toHaveBeenCalledTimes(1);
  });

  it("writes the chat id and posts the ticket card into the new group once the background task runs", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const posts: string[] = [];
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async (_id, fields) => { writes.push(fields); },
      fallbackOpenIds: async () => [],
      createChat: async () => "oc_new",
      sendToChat: async (chatId) => { posts.push(chatId); },
      notifyOperator: unusedNotifyOperator,
    });

    await outcome.background?.();

    expect(writes[0]?.[VOC_FIELD_NAMES.warRoomChatId]).toBe("oc_new");
    expect(posts).toEqual(["oc_new"]);
  });

  it("DMs the operator that creation failed, and writes nothing, when the chat itself cannot be created", async () => {
    const updateRecord = vi.fn(async () => {});
    const notifyOperator = vi.fn(
      async (_openId: string, _text: string): Promise<void> => undefined,
    );
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord,
      fallbackOpenIds: async () => [],
      createChat: async () => { throw new Error("feishu down"); },
      sendToChat: async () => {},
      notifyOperator,
    });

    await outcome.background?.();

    expect(updateRecord).not.toHaveBeenCalled();
    expect(notifyOperator).toHaveBeenCalledTimes(1);
    const [openId, text] = notifyOperator.mock.calls[0];
    expect(openId).toBe("ou_owner");
    expect(text).toContain("创建失败");
  });

  it("DMs the operator that the group exists but was not recorded, when the write fails", async () => {
    // Creating then failing to record leaves a real group nobody can find
    // from the Base. Telling the operator directly is the only way they
    // learn to retry instead of assuming the click did nothing — the card
    // callback already answered with "正在创建" long before this runs.
    const notifyOperator = vi.fn(
      async (_openId: string, _text: string): Promise<void> => undefined,
    );
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async () => { throw new Error("bitable down"); },
      fallbackOpenIds: async () => [],
      createChat: async () => "oc_new",
      sendToChat: async () => {},
      notifyOperator,
    });

    await outcome.background?.();

    expect(notifyOperator).toHaveBeenCalledTimes(1);
    const [, text] = notifyOperator.mock.calls[0];
    expect(text).toContain("未记录");
  });

  it("DMs the operator that the card failed to send, but does not undo the already-created group", async () => {
    const updateRecord = vi.fn(async () => {});
    const notifyOperator = vi.fn(
      async (_openId: string, _text: string): Promise<void> => undefined,
    );
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord,
      fallbackOpenIds: async () => [],
      createChat: async () => "oc_new",
      sendToChat: async () => { throw new Error("send failed"); },
      notifyOperator,
    });

    await outcome.background?.();

    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(notifyOperator).toHaveBeenCalledTimes(1);
    const [, text] = notifyOperator.mock.calls[0];
    expect(text).toContain("发送失败");
  });

  it("swallows a failure from notifyOperator itself instead of rejecting the background task", async () => {
    const notifyOperator = vi.fn(async (): Promise<void> => {
      throw new Error("DM send also failed");
    });
    const outcome = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async () => {},
      fallbackOpenIds: async () => [],
      createChat: async () => { throw new Error("feishu down"); },
      sendToChat: async () => {},
      notifyOperator,
    });

    await expect(outcome.background?.()).resolves.toBeUndefined();
  });
});
