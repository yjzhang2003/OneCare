import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import { VOC_FIELD_NAMES } from "../bitable/field-map";
import { DECLINED_MARKER } from "../warroom/naming";
import { resolveWarRoomAction } from "./war-room-actions";

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
};

describe("resolveWarRoomAction", () => {
  it("lets a fallback approver open the room even though they are not the owner", async () => {
    // Approving an escalation is the fallback's job, not the owner's. The four
    // status actions keep the strict owner check — changing state is the owner's
    // job, and this relaxation must not leak into them.
    const created: string[] = [];
    const result = await resolveWarRoomAction({
      action: "voc_open_war_room",
      recordId: "rec1",
      operatorOpenId: "ou_fallback",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async () => {},
      fallbackOpenIds: async () => ["ou_fallback"],
      createChat: async (name, members) => { created.push(name); expect(members).toContain("ou_owner"); expect(members).toContain("ou_fallback"); return "oc_new"; },
      sendToChat: async () => {},
    });

    expect(created).toHaveLength(1);
    expect(JSON.stringify(result)).toContain("已创建");
  });

  it("rejects a stranger who is neither owner nor fallback, and creates nothing", async () => {
    const createChat = vi.fn(async () => "oc_should_not_happen");
    const result = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_stranger",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async () => {}, fallbackOpenIds: async () => ["ou_fallback"],
      createChat, sendToChat: async () => {},
    });

    expect(createChat).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toMatch(/无权|不是/);
  });

  it("does not create a second group when one already exists", async () => {
    const createChat = vi.fn(async () => "oc_second");
    await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "oc_existing" }),
      updateRecord: async () => {}, fallbackOpenIds: async () => [],
      createChat, sendToChat: async () => {},
    });

    expect(createChat).not.toHaveBeenCalled();
  });

  it("writes the chat id and posts the ticket card into the new group", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const posts: string[] = [];
    await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async (_id, fields) => { writes.push(fields); },
      fallbackOpenIds: async () => [],
      createChat: async () => "oc_new",
      sendToChat: async (chatId) => { posts.push(chatId); },
    });

    expect(writes[0]?.[VOC_FIELD_NAMES.warRoomChatId]).toBe("oc_new");
    expect(posts).toEqual(["oc_new"]);
  });

  it("says the group exists but was not recorded when the write fails", async () => {
    // Creating then failing to record leaves a real group nobody can find from the
    // Base. Saying so is the only way the operator knows to retry rather than
    // assume the click did nothing.
    const result = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async () => { throw new Error("bitable down"); },
      fallbackOpenIds: async () => [],
      createChat: async () => "oc_new",
      sendToChat: async () => {},
    });

    expect(JSON.stringify(result)).toMatch(/未记录/);
  });

  it("marks a declined escalation so it is not proposed again", async () => {
    const writes: Array<Record<string, unknown>> = [];
    await resolveWarRoomAction({
      action: "voc_decline_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord: async (_id, fields) => { writes.push(fields); },
      fallbackOpenIds: async () => [], createChat: async () => "x", sendToChat: async () => {},
    });

    expect(writes[0]?.[VOC_FIELD_NAMES.warRoomChatId]).toBe(DECLINED_MARKER);
  });

  it("rejects a record id that does not exist", async () => {
    const result = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec_gone", operatorOpenId: "ou_owner",
      getRecord: async () => null, updateRecord: async () => {},
      fallbackOpenIds: async () => [], createChat: async () => "x", sendToChat: async () => {},
    });

    expect(JSON.stringify(result)).toMatch(/记录/);
  });

  // Beyond the brief's given cases: this pins down the load-bearing ordering
  // rule itself. If authorization ever moved after the idempotence check, a
  // stranger's toast on an already-created record would leak "a group exists"
  // to someone with no right to know that.
  it("checks authorization before the idempotence check, so a stranger learns nothing about an existing group", async () => {
    const createChat = vi.fn(async () => "oc_should_not_happen");
    const result = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_stranger",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "oc_existing" }),
      updateRecord: async () => {}, fallbackOpenIds: async () => ["ou_fallback"],
      createChat, sendToChat: async () => {},
    });

    expect(createChat).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toMatch(/无权|不是/);
    expect(JSON.stringify(result)).not.toContain("已存在");
  });

  it("tells the operator a prior decline stands, without creating a chat", async () => {
    const createChat = vi.fn(async () => "oc_should_not_happen");
    const result = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: DECLINED_MARKER }),
      updateRecord: async () => {}, fallbackOpenIds: async () => [],
      createChat, sendToChat: async () => {},
    });

    expect(createChat).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain("暂不需要");
  });

  it("reports creation failure and writes nothing when the chat itself cannot be created", async () => {
    const updateRecord = vi.fn(async () => {});
    const result = await resolveWarRoomAction({
      action: "voc_open_war_room", recordId: "rec1", operatorOpenId: "ou_owner",
      getRecord: async () => ({ ...record, ownerOpenIds: ["ou_owner"], warRoomChatId: "" }),
      updateRecord,
      fallbackOpenIds: async () => [],
      createChat: async () => { throw new Error("feishu down"); },
      sendToChat: async () => {},
    });

    expect(updateRecord).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toMatch(/创建失败/);
  });
});
