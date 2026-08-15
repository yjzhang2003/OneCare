import { describe, expect, it } from "vitest";

import { handOffNotifications } from "./hand-off";

const BASE = {
  operatorOpenId: "ou_engineer",
  ownerOpenIds: ["ou_owner"],
  engineerOpenIds: ["ou_engineer"],
};

describe("handOffNotifications", () => {
  // The hand-off the whole loop is named for: the engineer files what happened on site,
  // and the ticket is back in the 客服's court with nothing else to announce it.
  it("tells the 客服 owner when the engineer files their report", () => {
    expect(handOffNotifications({ ...BASE, action: "提交跟进结果" })).toEqual([
      { kind: "engineer_reported", openId: "ou_owner" },
    ]);
  });

  it("tells the engineer when the owner confirms closure", () => {
    expect(
      handOffNotifications({
        ...BASE,
        operatorOpenId: "ou_owner",
        action: "确认闭环",
      }),
    ).toEqual([{ kind: "ticket_closed", openId: "ou_engineer" }]);
  });

  // Nobody needs a notification about their own click.
  it("never notifies the person who acted", () => {
    expect(
      handOffNotifications({
        ...BASE,
        operatorOpenId: "ou_owner",
        action: "提交跟进结果",
      }),
    ).toEqual([]);
    expect(
      handOffNotifications({
        ...BASE,
        engineerOpenIds: [],
        operatorOpenId: "ou_owner",
        action: "确认闭环",
      }),
    ).toEqual([]);
  });

  it("says nothing for the transitions that hand the ticket to nobody", () => {
    for (const action of ["开始跟进", "无需建单", "重试", ""]) {
      expect(handOffNotifications({ ...BASE, action })).toEqual([]);
    }
  });

  it("de-duplicates recipients", () => {
    expect(
      handOffNotifications({
        ...BASE,
        ownerOpenIds: ["ou_owner", "ou_owner"],
        action: "提交跟进结果",
      }),
    ).toHaveLength(1);
  });
});
