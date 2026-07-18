import { describe, expect, it } from "vitest";

import type { OneCareCardAction, OneCareCardView } from "./card-types";
import { resolveCardAction } from "./card-actions";

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
