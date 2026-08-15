import { describe, expect, it, vi } from "vitest";

import { notify } from "./deliver";
import type { NotificationSubject } from "./messages";

const SUBJECT: NotificationSubject = {
  recordNumber: "VOC-a3cdc5",
  channel: "400 客服",
  category: "冰箱",
  summary: "用户反馈上门维修延迟三天",
  content: "报修后等了三天没人上门",
  severity: "高",
  state: "待跟进",
  actorName: "张禹健",
};

function deps(overrides: Partial<Parameters<typeof notify>[1]> = {}) {
  return {
    insert: vi.fn(async (_input: Parameters<Parameters<typeof notify>[1]["insert"]>[0]) => {}),
    send: vi.fn(
      async (
        _openId: string,
        _message: Parameters<Parameters<typeof notify>[1]["send"]>[1],
      ) => {},
    ),
    ticketHref: (recordNumber: string) => `https://example.test/workbench/tickets/${recordNumber}`,
    ...overrides,
  };
}

describe("notify", () => {
  it("writes the inbox row and sends the same copy to Feishu", async () => {
    const send = vi.fn(
      async (
        _openId: string,
        _message: Parameters<Parameters<typeof notify>[1]["send"]>[1],
      ) => {},
    );
    const dependencies = deps({ send });
    await notify(
      {
        kind: "ticket_reassigned",
        openId: "ou_new_owner",
        recordId: "rec-1",
        sendFeishuText: true,
        subject: SUBJECT,
      },
      dependencies,
    );

    expect(dependencies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        openId: "ou_new_owner",
        kind: "ticket_reassigned",
        recordNumber: "VOC-a3cdc5",
        title: "工单改派给你",
        href: "https://example.test/workbench/tickets/VOC-a3cdc5",
      }),
    );
    // A card, not a paragraph with a URL in it: the title, the copy, and the link on a
    // button the reader can press.
    const [, message] = send.mock.calls[0]!;
    expect(message.title).toBe("工单改派给你");
    expect(message.body).toContain("张禹健改派给你");
    expect(message.url).toBe("https://example.test/workbench/tickets/VOC-a3cdc5");
    expect(message.buttonLabel).toBe("打开工单");
  });

  // 建单 and 派工 already push a card. A second plain-text copy would give the recipient
  // two messages for one event and one of them does less.
  it("skips the Feishu text when a card for the same event already went", async () => {
    const dependencies = deps();
    await notify(
      {
        kind: "engineer_dispatched",
        openId: "ou_engineer",
        recordId: "rec-1",
        sendFeishuText: false,
        subject: SUBJECT,
      },
      dependencies,
    );

    expect(dependencies.insert).toHaveBeenCalled();
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("does nothing at all when there is nobody to tell", async () => {
    const dependencies = deps();
    await notify(
      {
        kind: "ticket_assigned",
        openId: "",
        recordId: "rec-1",
        sendFeishuText: true,
        subject: SUBJECT,
      },
      dependencies,
    );
    expect(dependencies.insert).not.toHaveBeenCalled();
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  // The work already happened. A failed notification must never become a failed request
  // that invites the operator to hand the ticket over a second time.
  it("never throws, and one channel failing does not stop the other", async () => {
    const dependencies = deps({
      insert: vi.fn(async () => {
        throw new Error("neon down");
      }),
    });
    await expect(
      notify(
        {
          kind: "ticket_assigned",
          openId: "ou_owner",
          recordId: "rec-1",
          sendFeishuText: true,
          subject: SUBJECT,
        },
        dependencies,
      ),
    ).resolves.toBeUndefined();
    expect(dependencies.send).toHaveBeenCalled();
  });
});
