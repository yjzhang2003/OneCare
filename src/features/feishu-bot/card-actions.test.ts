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
  channel: "电商评价",
  category: "冰箱",
  content: "等了三天",
  rating: 2,
  state: "待跟进",
  polarity: "差评",
  dimensions: ["维修时间"],
  ownerOpenIds: ["ou_owner"],
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
      closingNote: "已处理",
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
      closingNote: "已处理",
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
