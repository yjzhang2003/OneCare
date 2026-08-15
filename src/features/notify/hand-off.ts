// 谁该被这次流转告知。
//
// Two of the six notification kinds are not addressed to a person the actor chose — they
// are addressed to whoever the ticket just landed back on. That decision is the same
// whether the button was clicked in the console or on a Feishu card, so it lives here
// rather than in either route.
//
// The actor is always excluded: a 客服 who files their own follow-up does not need to be
// told that a follow-up was filed.

import type { NotificationKind } from "./messages";

export type HandOffInput = Readonly<{
  // The state machine's own action name, which both call sites already hold.
  action: string;
  operatorOpenId: string;
  ownerOpenIds: readonly string[];
  engineerOpenIds: readonly string[];
}>;

export type HandOff = Readonly<{ kind: NotificationKind; openId: string }>;

export function handOffNotifications(input: HandOffInput): readonly HandOff[] {
  const others = (ids: readonly string[]): readonly string[] =>
    [...new Set(ids)].filter(
      (id) => id.trim().length > 0 && id !== input.operatorOpenId,
    );

  // 提交跟进结果 moves the ticket to 待闭环 — out of whoever was working it and back to
  // the 客服 who has to decide whether it is done. When an engineer files it, that is
  // the hand-off the loop is named for.
  if (input.action === "提交跟进结果") {
    return others(input.ownerOpenIds).map((openId) => ({
      kind: "engineer_reported" as const,
      openId,
    }));
  }

  // 确认闭环 ends it. The engineer who went out is the one person with no other way to
  // learn that the visit landed.
  if (input.action === "确认闭环") {
    return others(input.engineerOpenIds).map((openId) => ({
      kind: "ticket_closed" as const,
      openId,
    }));
  }

  return [];
}
