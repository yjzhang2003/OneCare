import { describe, expect, test } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import type { VocState } from "../voc/service-event";
import {
  availableActions,
  resolveWorkbenchWrite,
  WORKBENCH_ACTIONS,
  type ActionSubject,
} from "./write-actions";

const NOW = 1_770_000_000_000;
const OWNER = "ou_owner";
const STRANGER = "ou_stranger";

// Spelled out in full rather than cast from a partial: `vitest run` does not
// typecheck, so a cast here passes the suite and fails `npm run typecheck`,
// which is exactly how this fixture was wrong the first time.
function record(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec1",
    recordNumber: "VOC-000001",
    channel: "400 客服",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "制冷不足",
    rating: 2,
    feedbackAt: "2026-01-24T00:00:00.000Z",
    state: "待跟进",
    polarity: "差评",
    dimensions: ["产品质量"],
    summary: "用户反馈冷藏室不制冷",
    replies: [],
    severity: "中",
    ownerOpenIds: [OWNER],
    ownerNames: ["张禹健"],
    retryCount: 0,
    ticketOpenedAt: null,
    closedAt: null,
    warRoomChatId: "",
    engineerOpenIds: [],
    engineerNames: [],
    dispatchedAt: null,
    sourceTicketNo: "CAS-42567239-Q7Q8Q",
    userRef: "U-3878645B",
    deviceRef: "D-91C2A70E",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ...overrides,
  };
}

// availableActions takes only what decides legality, so the fixture is that
// shape directly rather than a VocRecord run through actionSubject — the whole
// point of the narrow type is that a caller holding no VocRecord (the browser)
// can still ask the question.
function subject(overrides: Partial<ActionSubject> = {}): ActionSubject {
  return { state: "待跟进", retryCount: 0, hasOwner: true, ...overrides };
}

describe("availableActions", () => {
  test("offers only what the state machine allows from the current state", () => {
    expect(availableActions(subject({ state: "待跟进" }))).toEqual(["开始跟进"]);
    expect(availableActions(subject({ state: "跟进中" }))).toEqual([
      "提交跟进结果",
    ]);
    expect(availableActions(subject({ state: "已分析" }))).toEqual([
      "需建单",
      "无需建单",
    ]);
  });

  test("offers nothing from a terminal state", () => {
    expect(availableActions(subject({ state: "已闭环" }))).toEqual([]);
    expect(availableActions(subject({ state: "无需跟进" }))).toEqual([]);
  });

  // The retry ceiling is a real guard, not advice: a button that is going to be
  // refused must not be offered.
  test("hides 重试 once the retry ceiling is reached", () => {
    expect(
      availableActions(subject({ state: "分析失败", retryCount: 2 })),
    ).toEqual(["重试"]);
    expect(
      availableActions(subject({ state: "分析失败", retryCount: 3 })),
    ).toEqual([]);
  });

  // 需建单 needs an owner. Offering it on an unassigned ticket would produce a
  // button whose only possible outcome is an error message.
  test("hides 需建单 while the ticket has no owner", () => {
    expect(
      availableActions(subject({ state: "已分析", hasOwner: false })),
    ).toEqual(["无需建单"]);
  });

  // The tagging pipeline's own transitions are never a person's to click.
  test("never offers the tagging pipeline's actions", () => {
    for (const state of ["待分析", "分析失败", "已分析"] as const) {
      const offered = availableActions(subject({ state, retryCount: 1 }));
      expect(offered).not.toContain("打标成功");
      expect(offered).not.toContain("打标失败");
    }
    expect(WORKBENCH_ACTIONS).not.toContain("打标成功");
  });

});

describe("resolveWorkbenchWrite — stale views", () => {
  // The operator chose an action against the state they were shown. If that
  // state no longer holds, the action answers a question they did not ask, so
  // it is refused before anything else is evaluated.
  test("refuses when the record moved since the page was rendered", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "跟进中" }),
      OWNER,
      { kind: "transition", action: "开始跟进", seenState: "待跟进" },
      NOW,
    );
    expect(outcome).toEqual({
      kind: "conflict",
      actual: "跟进中",
      message: "这条工单已被改成「跟进中」，请刷新后再操作",
    });
  });

  test("the stale check runs before authorization", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "跟进中" }),
      STRANGER,
      { kind: "transition", action: "开始跟进", seenState: "待跟进" },
      NOW,
    );
    expect(outcome.kind).toBe("conflict");
  });

  test("a stale view blocks a claim too", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "跟进中", ownerOpenIds: [] }),
      STRANGER,
      { kind: "claim", seenState: "待跟进" },
      NOW,
    );
    expect(outcome.kind).toBe("conflict");
  });
});

describe("resolveWorkbenchWrite — transitions", () => {
  test("the owner may transition", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进" }),
      OWNER,
      { kind: "transition", action: "开始跟进", seenState: "待跟进" },
      NOW,
    );
    expect(outcome).toEqual({
      kind: "write",
      nextState: "跟进中",
      fields: { 流程状态: "跟进中" },
      message: "已流转到「跟进中」",
    });
  });

  // Verbatim the predicate and the wording resolveVocCardAction uses. The web
  // must not be more permissive than the card for the same action, or the same
  // transition has two different permission models.
  test("a non-owner may not transition", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进" }),
      STRANGER,
      { kind: "transition", action: "开始跟进", seenState: "待跟进" },
      NOW,
    );
    expect(outcome).toEqual({
      kind: "forbidden",
      message: "只有该记录的负责人可以操作",
    });
  });

  test("an illegal transition is refused by the state machine", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进" }),
      OWNER,
      { kind: "transition", action: "确认闭环", seenState: "待跟进", note: "x" },
      NOW,
    );
    expect(outcome.kind).toBe("rejected");
  });

  test("closing without a note is refused, with the reason", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待闭环" }),
      OWNER,
      { kind: "transition", action: "确认闭环", seenState: "待闭环", note: "  " },
      NOW,
    );
    expect(outcome).toEqual({ kind: "rejected", message: "闭环结论不能为空" });
  });

  test("closure writes the note and both closure columns", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待闭环" }),
      OWNER,
      {
        kind: "transition",
        action: "确认闭环",
        seenState: "待闭环",
        note: "已换新并致歉",
      },
      NOW,
    );
    expect(outcome).toEqual({
      kind: "write",
      nextState: "已闭环",
      fields: { 流程状态: "已闭环", 闭环结论: "已换新并致歉", 闭环时间: NOW },
      message: "已流转到「已闭环」",
    });
  });

  // Matching what the tagging pipeline writes when it opens a ticket
  // automatically: a hand-opened ticket must not be the only kind with no
  // 建单时间, or the 时长 column is present for some tickets and absent for
  // others depending on which path opened them.
  test("建单 stamps 建单时间", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "已分析" }),
      OWNER,
      { kind: "transition", action: "需建单", seenState: "已分析" },
      NOW,
    );
    expect(outcome).toEqual({
      kind: "write",
      nextState: "待跟进",
      fields: { 流程状态: "待跟进", 建单时间: NOW },
      message: "已流转到「待跟进」",
    });
  });
});

describe("resolveWorkbenchWrite — claiming", () => {
  test("anyone gated may claim an unowned ticket", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进", ownerOpenIds: [], ownerNames: [] }),
      STRANGER,
      { kind: "claim", seenState: "待跟进" },
      NOW,
    );
    expect(outcome).toEqual({
      kind: "write",
      nextState: "待跟进",
      fields: { 负责人: [{ id: STRANGER }] },
      message: "已认领，你是这条工单的负责人",
    });
  });

  // Claiming must never be usable to take a ticket off someone. It used to send them
  // to the Bitable, because its person picker was the only thing that could resolve a
  // name to an open_id; with contacts available it points at 改派 instead.
  test("a ticket that already has an owner cannot be claimed", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进" }),
      STRANGER,
      { kind: "claim", seenState: "待跟进" },
      NOW,
    );
    expect(outcome).toEqual({
      kind: "forbidden",
      message: "该工单已有负责人，请用「改派」指定新的负责人",
    });
  });

  test("claiming what you already own changes nothing", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进" }),
      OWNER,
      { kind: "claim", seenState: "待跟进" },
      NOW,
    );
    expect(outcome).toEqual({
      kind: "noop",
      message: "你已经是这条工单的负责人",
    });
  });

  // A person field is written as [{id}] — verified against the live Base while
  // seeding owners. Bitable reads people back keyed by `id`, not `open_id`.
  test("the person field is written as a list of id objects", () => {
    const outcome = resolveWorkbenchWrite(
      record({ ownerOpenIds: [] }),
      "ou_x",
      { kind: "claim", seenState: "待跟进" },
      NOW,
    );
    expect(outcome.kind === "write" && outcome.fields.负责人).toEqual([
      { id: "ou_x" },
    ]);
  });
});

describe("resolveWorkbenchWrite — replays", () => {
  test("re-running an already-applied transition is a noop, not a rewrite", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "跟进中" }),
      OWNER,
      { kind: "transition", action: "开始跟进", seenState: "跟进中" },
      NOW,
    );
    expect(outcome).toEqual({ kind: "noop", message: "当前已是跟进中" });
  });

  test("every workbench action is a real VocAction", () => {
    const states: readonly VocState[] = [
      "待分析",
      "分析失败",
      "已分析",
      "待跟进",
      "跟进中",
      "待闭环",
    ];
    for (const action of WORKBENCH_ACTIONS) {
      const reachable = states.some((state) =>
        availableActions(subject({ state, retryCount: 1 })).includes(action),
      );
      expect(reachable, `${action} is unreachable from every state`).toBe(true);
    }
  });
});

describe("resolveWorkbenchWrite — reassigning", () => {
  const HUANG = { assigneeOpenId: "ou_huang", assigneeName: "黄齐" };

  test("the current owner may hand a ticket to someone else", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进" }),
      OWNER,
      { kind: "assign", seenState: "待跟进", ...HUANG },
      NOW,
    );

    expect(outcome).toEqual({
      kind: "write",
      nextState: "待跟进",
      fields: { 负责人: [{ id: "ou_huang" }] },
      message: "已改派给黄齐",
    });
  });

  // An unowned ticket has no owner whose judgement could be overridden, so anyone
  // past the gate may route it — the same reasoning that lets anyone claim one.
  test("anyone may route an unassigned ticket to a colleague", () => {
    const outcome = resolveWorkbenchWrite(
      record({ ownerOpenIds: [], ownerNames: [] }),
      STRANGER,
      { kind: "assign", seenState: "待跟进", ...HUANG },
      NOW,
    );
    expect(outcome.kind).toBe("write");
  });

  // Without this, the gate alone would let any tenant member move a colleague's work.
  test("a bystander may not reassign someone else's ticket", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进" }),
      STRANGER,
      { kind: "assign", seenState: "待跟进", ...HUANG },
      NOW,
    );

    expect(outcome).toEqual({
      kind: "forbidden",
      message: "只有该工单的负责人可以改派",
    });
  });

  test("reassigning to the current owner changes nothing", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进" }),
      OWNER,
      {
        kind: "assign",
        seenState: "待跟进",
        assigneeOpenId: OWNER,
        assigneeName: "张禹健",
      },
      NOW,
    );
    expect(outcome).toEqual({
      kind: "noop",
      message: "张禹健已经是这条工单的负责人",
    });
  });

  // Claiming must stay the act of taking an unowned ticket. If it quietly reassigned,
  // someone could remove an owner without ever naming a replacement.
  test("claiming still refuses an owned ticket, and points at 改派", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进" }),
      STRANGER,
      { kind: "claim", seenState: "待跟进" },
      NOW,
    );
    expect(outcome).toEqual({
      kind: "forbidden",
      message: "该工单已有负责人，请用「改派」指定新的负责人",
    });
  });

  test("a stale view blocks a reassignment too", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "跟进中" }),
      OWNER,
      { kind: "assign", seenState: "待跟进", ...HUANG },
      NOW,
    );
    expect(outcome.kind).toBe("conflict");
  });
});

// 管理员 in 人员管理 means "拥有所有权限", and the only place that can be true is here:
// every other check on this path keys off ownership. The flag defaults to false, so a
// missing roster read leaves the old behaviour rather than opening the door.
describe("admin override", () => {
  test("lets an admin act on a ticket owned by someone else", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进", ownerOpenIds: ["ou_owner"], ownerNames: ["黄齐"] }),
      "ou_admin",
      { kind: "transition", action: "开始跟进", seenState: "待跟进" },
      NOW,
      true,
    );
    expect(outcome.kind).toBe("write");
  });

  test("still refuses a non-admin who is not the owner", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进", ownerOpenIds: ["ou_owner"], ownerNames: ["黄齐"] }),
      "ou_stranger",
      { kind: "transition", action: "开始跟进", seenState: "待跟进" },
      NOW,
      false,
    );
    expect(outcome.kind).toBe("forbidden");
  });

  test("lets an admin 改派 a ticket they do not own", () => {
    const outcome = resolveWorkbenchWrite(
      record({ state: "待跟进", ownerOpenIds: ["ou_owner"], ownerNames: ["黄齐"] }),
      "ou_admin",
      {
        kind: "assign",
        seenState: "待跟进",
        assigneeOpenId: "ou_new",
        assigneeName: "张睿哲",
      },
      NOW,
      true,
    );
    expect(outcome.kind).toBe("write");
  });
});
