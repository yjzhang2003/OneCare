import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../../../../../src/features/bitable/field-map";
import type { RehearsalFields } from "../../../../../src/features/demo/rehearsal";
import { createRehearsalRoute } from "./route";

function record(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec-a",
    recordNumber: "R-a",
    channel: "400 客服",
    category: "冰箱",
    model: "BCD-525",
    content: "报修后等了三天没人上门",
    rating: 2,
    feedbackAt: "2026-08-14T04:00:00.000Z",
    state: "待分析",
    polarity: null,
    dimensions: [],
    summary: "",
    replies: [],
    severity: null,
    ownerOpenIds: [],
    ownerNames: [],
    retryCount: 0,
    ticketOpenedAt: null,
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

const POOL: readonly VocRecord[] = [
  // Already in position for its shot.
  record({ recordId: "rec-a", recordNumber: "R-a", state: "待分析" }),
  // A closed ticket that has to be rewound for the flow shot.
  record({
    recordId: "rec-b",
    recordNumber: "R-b",
    state: "待跟进",
    ticketOpenedAt: "2026-08-14T06:00:00.000Z",
    ownerOpenIds: ["ou_owner"],
    ownerNames: ["黄齐"],
  }),
  record({
    recordId: "rec-c",
    recordNumber: "R-c",
    state: "分析失败",
    retryCount: 3,
  }),
];

function route(
  overrides: Partial<Parameters<typeof createRehearsalRoute>[0]> = {},
) {
  const applyFields = vi.fn(async (_id: string, _fields: RehearsalFields) => {});
  const write = vi.fn(async () => {});
  const clear = vi.fn(async () => {});
  const revalidate = vi.fn();
  const post = createRehearsalRoute({
    session: async () => ({ openId: "ou_operator", name: "运营" }),
    candidates: async () => POOL,
    getRecord: async (id) => POOL.find((r) => r.recordId === id) ?? null,
    applyFields,
    readSnapshots: async () => [],
    writeSnapshots: write,
    clearSnapshots: clear,
    revalidate,
    ...overrides,
  });
  return { post, applyFields, write, clear, revalidate };
}

const call = (post: ReturnType<typeof createRehearsalRoute>, action = "") =>
  post(
    new Request(
      `https://example.com/api/voc/demo/rehearsal${action ? `?do=${action}` : ""}`,
      { method: "POST" },
    ),
  );

describe("rehearsal route", () => {
  // The default is a dry run. An endpoint that rewrites demo data must not do it because
  // someone curled it to see what it does.
  it("plans without writing anything when no action is given", async () => {
    const { post, applyFields, write } = route();

    const body = (await (await call(post)).json()) as {
      action: string;
      slots: { shot: string; recordNumber: string; href: string }[];
      missing: string[];
    };

    expect(body.action).toBe("plan");
    expect(body.slots.map((s) => s.recordNumber)).toEqual(["R-a", "R-b", "R-c"]);
    // Each slot carries the page to open when the camera rolls.
    expect(body.slots[0]!.href).toContain("/workbench/tickets/R-a");
    expect(body.missing).toEqual([]);
    expect(applyFields).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("stages only the records that are not already in position", async () => {
    const { post, applyFields, revalidate } = route();

    const body = (await (await call(post, "prepare")).json()) as {
      staged: string[];
    };

    // R-a is already 待分析; R-c needs its retries back.
    expect(body.staged).toEqual(["R-c"]);
    expect(applyFields).toHaveBeenCalledTimes(1);
    expect(applyFields.mock.calls[0]![1].retryCount).toBe(0);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  // The snapshot covers every slot, including untouched ones: restore has to put back
  // what was found, not only what was changed.
  it("snapshots every slot, not only the ones it changed", async () => {
    const { post, write } = route();
    await call(post, "prepare");

    const [snapshots, takenBy] = write.mock.calls[0] as unknown as [
      { recordNumber: string; before: RehearsalFields }[],
      string,
    ];
    expect(snapshots.map((s) => s.recordNumber)).toEqual(["R-a", "R-b", "R-c"]);
    expect(snapshots[2]!.before.retryCount).toBe(3);
    expect(takenBy).toBe("ou_operator");
  });

  it("does not revalidate when nothing was staged", async () => {
    const { post, revalidate, applyFields } = route({
      candidates: async () => [POOL[0]!],
    });

    const body = (await (await call(post, "prepare")).json()) as {
      message: string;
    };
    expect(applyFields).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
    expect(body.message).toContain("没有改动");
  });

  it("names the shots it could not find material for", async () => {
    const { post } = route({ candidates: async () => [POOL[0]!] });

    const body = (await (await call(post, "plan")).json()) as {
      missing: string[];
      message: string;
    };
    expect(body.missing).toEqual(["flow", "retry"]);
    expect(body.message).toContain("缺少素材");
  });

  it("restores from the snapshot and clears it", async () => {
    const before: RehearsalFields = {
      state: "已闭环",
      ownerOpenIds: ["ou_owner"],
      ownerNames: ["黄齐"],
      ticketOpenedAt: "2026-08-14T06:00:00.000Z",
      closedAt: "2026-08-14T20:00:00.000Z",
      warRoomChatId: "",
      retryCount: 1,
    };
    const { post, applyFields, clear } = route({
      readSnapshots: async () => [
        {
          recordId: "rec-b",
          recordNumber: "R-b",
          role: "flow",
          before,
          takenAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    });

    const body = (await (await call(post, "restore")).json()) as {
      restored: string[];
      message: string;
    };

    expect(body.restored).toEqual(["R-b"]);
    expect(applyFields).toHaveBeenCalledWith("rec-b", before);
    expect(clear).toHaveBeenCalledTimes(1);
    // The one thing restore cannot undo, said every time.
    expect(body.message).toContain("飞书群不会被删除");
  });

  it("says so plainly when there is nothing to restore", async () => {
    const { post, applyFields } = route();

    const body = (await (await call(post, "restore")).json()) as {
      restored: string[];
      message: string;
    };
    expect(body.restored).toEqual([]);
    expect(body.message).toContain("先调用");
    expect(applyFields).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller before reading anything", async () => {
    const candidates = vi.fn(async () => POOL);
    const { post } = route({ session: async () => null, candidates });

    expect((await call(post, "prepare")).status).toBe(401);
    expect(candidates).not.toHaveBeenCalled();
  });

  it("rejects an action it does not know", async () => {
    const { post, applyFields } = route();

    const response = await call(post, "destroy");
    expect(response.status).toBe(400);
    expect(applyFields).not.toHaveBeenCalled();
  });
});
