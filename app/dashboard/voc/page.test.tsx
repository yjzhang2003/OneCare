import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { VocMetrics, VocMetricsResult } from "../../../src/features/voc/metrics";
import { renderVocDashboard } from "./page";

const metrics: VocMetrics = {
  total: 204,
  byPolarity: { 好评: 40, 中评: 36, 差评: 128 },
  dimensionTop: [
    { dimension: "维修时间", count: 128 },
    { dimension: "服务态度", count: 76 },
  ],
  byChannel: [{ channel: "电商评价", count: 204 }],
  negativeShare: 0.8,
  ticketsOpened: 150,
  ticketsClosed: 129,
  closureRate: 0.86,
  averageClosureHours: 18,
  taggingAttempted: 204,
  taggingSucceeded: 190,
  taggingFailed: 8,
  taggingPending: 6,
  effort: { taggedRecords: 190, manualMinutesPerRecord: 5, savedHours: 15.8 },
};

describe("renderVocDashboard", () => {
  it("shows real numbers when the read succeeds", () => {
    const result: VocMetricsResult = { status: "ok", metrics };
    render(renderVocDashboard(result));

    expect(screen.getByText("VOC 闭环看板")).toBeInTheDocument();
    expect(screen.getByText("总量与情绪极性")).toBeInTheDocument();
    expect(screen.getAllByText("204").length).toBeGreaterThan(0);
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("86%")).toBeInTheDocument();
    expect(screen.getByText(/假设值/)).toBeInTheDocument();
    expect(screen.getByText("5 分钟")).toBeInTheDocument();
    expect(screen.queryByText("指标暂不可用")).not.toBeInTheDocument();
  });

  it("renders an explicit unavailable notice instead of throwing or showing zeros", () => {
    const result: VocMetricsResult = { status: "unavailable" };
    render(renderVocDashboard(result));

    expect(screen.getByText("VOC 闭环看板")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("指标暂不可用");

    // None of the numeric sections — and no bare "0" standing in for real
    // data — may appear once the read has failed.
    expect(screen.queryByText("总量与情绪极性")).not.toBeInTheDocument();
    expect(screen.queryByText("问题维度 Top")).not.toBeInTheDocument();
    expect(screen.queryByText("渠道分布")).not.toBeInTheDocument();
    expect(screen.queryByText("工单闭环")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 打标覆盖与成功率")).not.toBeInTheDocument();
    expect(screen.queryByText("人效估算")).not.toBeInTheDocument();
    expect(screen.queryByText("反馈总量")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
