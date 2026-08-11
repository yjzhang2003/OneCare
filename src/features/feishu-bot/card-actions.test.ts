import { describe, expect, it, vi } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import type { OneCareCardAction, OneCareCardView } from "./card-types";
import { resolveCardAction, resolveVocCardAction } from "./card-actions";

describe("resolveCardAction", () => {
  it.each([
    ["open_pending", "pending"],
    ["open_tasks", "tasks"],
    ["open_operations", "operations"],
    ["open_diagnosis", "diagnosis"],
    ["open_progress", "progress"],
    ["open_result", "result"],
  ] satisfies ReadonlyArray<readonly [OneCareCardAction, OneCareCardView]>) (
    "turns %s into a new %s card",
    (action, expectedView) => {
      const result = resolveCardAction(action);

      expect(result.kind).toBe("navigate");
      if (result.kind !== "navigate") return;
      expect(result.message.msgType).toBe("interactive");
      expect(result.message.content).toContain(`\"content\":\"${
        expectedView === "pending"
          ? "待确认服务"
          : expectedView === "tasks"
            ? "今日任务"
            : expectedView === "operations"
              ? "运营后台"
              : expectedView === "diagnosis"
                ? "AI 预诊与配件"
                : expectedView === "progress"
                  ? "服务进度"
                  : "提交服务结果"
      }\"`);
      expect(result.toast).toContain("已打开");
    },
  );

  it.each([
    ["create_ticket", "演示工单已创建", "创建完成"],
    ["confirm_parts", "配件准备已确认", "配件已确认"],
    ["submit_result", "服务结果已提交", "结果已提交"],
  ] satisfies ReadonlyArray<readonly [OneCareCardAction, string, string]>) (
    "turns %s into a completed replacement card",
    (action, title, disabledLabel) => {
      const result = resolveCardAction(action);

      expect(result.kind).toBe("update");
      if (result.kind !== "update") return;
      expect(result.response.toast).toEqual({
        type: "success",
        content: "操作已记录（演示）",
      });
      expect(result.response.card?.type).toBe("raw");
      expect(result.response.card?.data.schema).toBe("2.0");
      expect(JSON.stringify(result.response.card?.data)).toContain(title);
      expect(JSON.stringify(result.response.card?.data)).toContain(disabledLabel);
      expect(JSON.stringify(result.response.card?.data)).toContain(
        '"disabled":true',
      );
    },
  );
});

// Typed explicitly as VocRecord (rather than left to inference) so that a
// later reassignment of getRecord's mock with a different VocState literal
// (see "reports success without writing...") stays assignable — inference
// from the object literal alone would freeze `state` at the narrow "待跟进"
// literal type and reject any other valid VocState.
const record: VocRecord = {
  recordId: "rec1",
  recordNumber: "VOC-0001",
  channel: "电商评价",
  category: "冰箱",
  model: "BCD-525WNK1PU",
  content: "等了三天",
  rating: 2,
  feedbackAt: "2026-01-20T00:00:00.000Z",
  state: "待跟进",
  polarity: "差评",
  dimensions: ["维修时间"],
  summary: "用户反馈上门维修延迟三天",
  replies: [{ tone: "致歉安抚", text: "非常抱歉给您带来不便" }],
  severity: "中",
  ownerOpenIds: ["ou_owner"],
  ownerNames: [],
  retryCount: 0,
  ticketOpenedAt: "2026-01-23T02:00:00.000Z",
  closedAt: null,
};

function client(overrides: Partial<{ record: VocRecord | null }> = {}) {
  const updateRecord = vi.fn(
    async (_recordId: string, _fields: Record<string, unknown>) => undefined,
  );
  return {
    updateRecord,
    getRecord: vi.fn(async (_recordId: string) =>
      overrides.record === undefined ? record : overrides.record,
    ),
  };
}

describe("resolveVocCardAction", () => {
  it("advances the state for the assigned owner", async () => {
    const bitable = client();

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      note: "",
      bitable,
    });

    expect(result.kind).toBe("update");
    expect(bitable.updateRecord).toHaveBeenCalledWith("rec1", {
      流程状态: "跟进中",
    });
  });

  it("rejects an operator who is not the owner and writes nothing", async () => {
    const bitable = client();

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_stranger",
      note: "",
      bitable,
    });

    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.response.toast?.type).toBe("error");
    expect(result.response.toast?.content).toContain("负责人");
    expect(result.response.card).toBeUndefined();
    expect(bitable.updateRecord).not.toHaveBeenCalled();
  });

  it("rejects a missing record", async () => {
    const bitable = client({ record: null });

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "recGone",
      operatorOpenId: "ou_owner",
      note: "",
      bitable,
    });

    if (result.kind !== "update") throw new Error("expected update");
    expect(result.response.toast?.type).toBe("error");
    expect(bitable.updateRecord).not.toHaveBeenCalled();
  });

  it("rejects an illegal transition and writes nothing", async () => {
    const bitable = client();

    const result = await resolveVocCardAction({
      action: "voc_confirm_closure",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      note: "已处理",
      bitable,
    });

    if (result.kind !== "update") throw new Error("expected update");
    expect(result.response.toast?.type).toBe("error");
    expect(bitable.updateRecord).not.toHaveBeenCalled();
  });

  it("reports success without writing when the action already landed", async () => {
    const bitable = client();
    bitable.getRecord = vi.fn(async () => ({ ...record, state: "跟进中" as const }));

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      note: "",
      bitable,
    });

    if (result.kind !== "update") throw new Error("expected update");
    expect(result.response.toast?.type).toBe("info");
    expect(bitable.updateRecord).not.toHaveBeenCalled();
  });

  it("surfaces an error toast when the Base write fails", async () => {
    const bitable = client();
    bitable.updateRecord = vi.fn(async () => {
      throw new Error("bitable down");
    });

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      note: "",
      bitable,
    });

    if (result.kind !== "update") throw new Error("expected update");
    expect(result.response.toast?.type).toBe("error");
  });

  it("writes the closure timestamp as epoch milliseconds, not an ISO string", async () => {
    // Calibrated against the live Base (field-map.ts): a Bitable DateTime
    // field reads back as epoch milliseconds, and writing an ISO string
    // instead is silently rejected by the real API — updateRecord throws and
    // the whole confirm-closure step fails. Only a real-Base run surfaces
    // this; the mock alone would happily accept either shape.
    const bitable = client();
    bitable.getRecord = vi.fn(async () => ({ ...record, state: "待闭环" as const }));
    const before = Date.now();

    const result = await resolveVocCardAction({
      action: "voc_confirm_closure",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      note: "已处理",
      bitable,
    });

    const after = Date.now();
    expect(result.kind).toBe("update");
    expect(bitable.updateRecord).toHaveBeenCalledTimes(1);
    const [, fields] = bitable.updateRecord.mock.calls[0];
    expect(typeof fields.闭环时间).toBe("number");
    expect(fields.闭环时间 as number).toBeGreaterThanOrEqual(before);
    expect(fields.闭环时间 as number).toBeLessThanOrEqual(after);
  });
});

// `note` replaced an optional followUpNote/closingNote pair. These lock the
// action → column derivation, so a caller can no longer land follow-up text in
// the closure column (or write neither and still compile).
describe("resolveVocCardAction note handling", () => {
  it("writes 提交跟进结果's note into 跟进记录 only", async () => {
    const bitable = client();
    bitable.getRecord = vi.fn(async () => ({ ...record, state: "跟进中" as const }));

    await resolveVocCardAction({
      action: "voc_submit_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      note: "已联系用户，约定明天上门",
      bitable,
    });

    expect(bitable.updateRecord).toHaveBeenCalledWith("rec1", {
      流程状态: "待闭环",
      跟进记录: "已联系用户，约定明天上门",
    });
  });

  it("writes 确认闭环's note into 闭环结论 only", async () => {
    const bitable = client();
    bitable.getRecord = vi.fn(async () => ({ ...record, state: "待闭环" as const }));

    await resolveVocCardAction({
      action: "voc_confirm_closure",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      note: "已完成维修并完成回访",
      bitable,
    });

    const [, fields] = bitable.updateRecord.mock.calls[0];
    expect(fields.闭环结论).toBe("已完成维修并完成回访");
    expect(fields.跟进记录).toBeUndefined();
  });

  it("never writes a note column for an action that carries no note", async () => {
    const bitable = client();

    await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      // A stray note on a note-free action must not leak into the Base: the
      // column is chosen by the action, not by whatever the caller passed.
      note: "无关文本",
      bitable,
    });

    expect(bitable.updateRecord).toHaveBeenCalledWith("rec1", {
      流程状态: "跟进中",
    });
  });

  it.each([
    ["voc_submit_follow_up", "跟进中", "跟进记录不能为空"],
    ["voc_confirm_closure", "待闭环", "闭环结论不能为空"],
  ] as const)(
    "refuses %s with a blank note and writes nothing",
    async (action, state, reason) => {
      for (const note of ["", "   ", "\n\t"]) {
        const bitable = client();
        bitable.getRecord = vi.fn(async () => ({ ...record, state }));

        const result = await resolveVocCardAction({
          action,
          recordId: "rec1",
          operatorOpenId: "ou_owner",
          note,
          bitable,
        });

        if (result.kind !== "update") throw new Error("expected update");
        expect(result.response.toast?.content).toBe(reason);
        expect(result.response.card).toBeUndefined();
        expect(bitable.updateRecord).not.toHaveBeenCalled();
      }
    },
  );
});

// I4: a green toast on a card still showing the previous status tag and the
// button that was just used reads, in an unedited screen recording, as a frozen
// card next to a Base that moved.
describe("resolveVocCardAction card refresh", () => {
  it.each([
    ["voc_start_follow_up", "待跟进", "跟进中", "voc_submit_follow_up"],
    ["voc_submit_follow_up", "跟进中", "待闭环", "voc_confirm_closure"],
  ] as const)(
    "returns a card at the new state after %s",
    async (action, from, to, nextAction) => {
      const bitable = client();
      bitable.getRecord = vi.fn(async () => ({ ...record, state: from }));

      const result = await resolveVocCardAction({
        action,
        recordId: "rec1",
        operatorOpenId: "ou_owner",
        note: "已联系用户",
        bitable,
      });

      if (result.kind !== "update") throw new Error("expected update");
      expect(result.response.toast).toEqual({
        type: "success",
        content: `已更新为${to}`,
      });
      expect(result.response.card?.type).toBe("raw");

      const card = JSON.stringify(result.response.card?.data);
      expect(card).toContain(to);
      expect(card).not.toContain(from);
      // The card must offer whatever is legal next, so the loop can continue
      // from the card the owner is already looking at.
      expect(card).toContain(nextAction);
    },
  );

  it("returns a closed card with no further action after 确认闭环", async () => {
    const bitable = client();
    bitable.getRecord = vi.fn(async () => ({ ...record, state: "待闭环" as const }));

    const result = await resolveVocCardAction({
      action: "voc_confirm_closure",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      note: "已完成维修",
      bitable,
    });

    if (result.kind !== "update") throw new Error("expected update");
    const data = result.response.card?.data ?? {};
    expect((data.header as Record<string, unknown>).template).toBe("green");
    expect(JSON.stringify(data)).toContain("当前状态无需操作");
    expect(JSON.stringify(data)).not.toContain("voc_");
  });

  it("re-renders from the record already read, without a second getRecord", async () => {
    const bitable = client();

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      note: "",
      bitable,
    });

    expect(bitable.getRecord).toHaveBeenCalledTimes(1);
    if (result.kind !== "update") throw new Error("expected update");
    // The AI summary and reply suggestions survive the refresh: they are what
    // the owner writes the follow-up note from, and they only exist on the
    // record that single read returned.
    const card = JSON.stringify(result.response.card?.data);
    expect(card).toContain("用户反馈上门维修延迟三天");
    expect(card).toContain("【致歉安抚】非常抱歉给您带来不便");
  });

  it("renders a placeholder rather than crashing when the record has no polarity", async () => {
    const bitable = client();
    bitable.getRecord = vi.fn(async () => ({
      ...record,
      polarity: null,
      summary: "",
      replies: [],
    }));

    const result = await resolveVocCardAction({
      action: "voc_start_follow_up",
      recordId: "rec1",
      operatorOpenId: "ou_owner",
      note: "",
      bitable,
    });

    if (result.kind !== "update") throw new Error("expected update");
    expect(result.response.card?.type).toBe("raw");
    expect(JSON.stringify(result.response.card?.data)).not.toContain(
      "AI 回复话术建议",
    );
  });
});
