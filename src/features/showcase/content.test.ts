import { describe, expect, it } from "vitest";

import {
  architectureLayers,
  closedLoopSteps,
  connectedSystems,
  decisionPaths,
  pilotTargets,
  rolloutStages,
  serviceIdentities,
} from "./content";

describe("closed-loop architecture content", () => {
  it("defines one service event with Chinese-only identity labels", () => {
    expect(serviceIdentities.map((identity) => identity.label)).toEqual([
      "用户 ID",
      "设备 ID",
      "服务事件 ID",
    ]);
    expect(serviceIdentities.map((identity) => identity.label).join(" ")).not.toMatch(
      /USER|DEVICE|SERVICE EVENT/,
    );
    expect(connectedSystems.map((system) => system.label)).toEqual([
      "海信爱家",
      "400 客服",
      "IoT 平台",
      "工程师",
      "备件系统",
    ]);
  });

  it("keeps the three architecture layers distinct from the five-step loop", () => {
    expect(architectureLayers.map((layer) => layer.title)).toEqual([
      "数据与知识层",
      "智能编排层",
      "多角色应用层",
    ]);
    expect(closedLoopSteps.map((step) => step.title)).toEqual([
      "智能分流",
      "人工审核",
      "自动编排",
      "异常介入",
      "结果反馈与持续优化",
    ]);
  });

  it("requires human review for complex, low-confidence, or high-risk cases", () => {
    expect(decisionPaths).toHaveLength(2);
    expect(decisionPaths[0]).toMatchObject({ title: "AI 自助解决" });
    expect(decisionPaths[1]).toMatchObject({ title: "人工审核后执行" });
    expect(decisionPaths[1].criteria).toContain("复杂、低置信度或高风险");
    expect(decisionPaths[1].action).toContain("已完成操作");
  });

  it("records four unmeasured six-month pilot targets and the rollout order", () => {
    expect(pilotTargets.map((target) => [target.label, target.value])).toEqual([
      ["首次响应时间", "降低 30%–50%"],
      ["工单整理时间", "降低 40%"],
      ["平均服务周期", "缩短 20%"],
      ["重复上门率", "降低 15%"],
    ]);
    expect(pilotTargets.every((target) => target.status === "试点目标")).toBe(
      true,
    );
    expect(rolloutStages.map((stage) => stage.title)).toEqual([
      "API 轻量接入",
      "聚焦试点",
      "验证后推广",
    ]);
  });
});
