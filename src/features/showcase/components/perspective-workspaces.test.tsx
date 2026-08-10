import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initialServiceJourneyState } from "../service-journey";
import type { VocMetrics, VocMetricsResult } from "../../voc/metrics";
import { AgentWorkspace } from "./agent-workspace";
import { CustomerWorkspace } from "./customer-workspace";
import { EngineerWorkspace } from "./engineer-workspace";
import { OperationsWorkspace } from "./operations-workspace";

// A real VocMetrics shape (task 14): OperationsWorkspace now renders this
// instead of the removed vocTopics fixture. Two dimensionTop entries so the
// "inspect a VOC topic" test below can click between them like it did with
// the old two-topic fixture.
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
};

// task 14 fix round 1: a live Bitable/token failure must render an explicit
// "unavailable" state, never throw and never show 0s that could pass for
// real data. `metricsOk`/`metricsUnavailable` name the two VocMetricsResult
// branches every metrics-consuming component must now handle.
const metricsOk: VocMetricsResult = { status: "ok", metrics };
const metricsUnavailable: VocMetricsResult = { status: "unavailable" };

const scrollToDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();

  if (scrollToDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollTo",
      scrollToDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  }
});

describe("perspective workspaces", () => {
  it("lets the customer choose AI self-help or request a human", () => {
    const scrollTo = vi.fn();
    const onAnswerDiagnosis = vi.fn();
    const onMarkSelfResolved = vi.fn();
    const onRequestHumanService = vi.fn();
    const onReset = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    const { rerender } = render(
      <CustomerWorkspace
        journey={initialServiceJourneyState}
        onAnswerDiagnosis={onAnswerDiagnosis}
        onMarkSelfResolved={onMarkSelfResolved}
        onRequestHumanService={onRequestHumanService}
        onReset={onReset}
      />,
    );
    scrollTo.mockClear();

    expect(screen.getByText("爱家服务助手")).toBeInTheDocument();
    expect(screen.queryByText("计划接入飞书")).not.toBeInTheDocument();
    expect(screen.getByText("静态交互 Demo")).toBeInTheDocument();
    expect(
      screen.getByText(
        "检测到冷藏室温度持续偏高，需要我帮你一起确认吗？",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("万护助手")).toBeInTheDocument();
    expect(screen.getByText("刚刚")).toBeInTheDocument();
    const meta = screen.getByText("刚刚");
    expect(meta.parentElement).toHaveClass("customer-message__body");
    expect(
      meta.parentElement?.querySelector(".customer-message__bubble"),
    ).not.toBeNull();
    expect(screen.getByLabelText("AI 服务对话")).toHaveAttribute(
      "aria-live",
      "polite",
    );

    const controls = screen.getByLabelText("对话快捷操作");
    expect(within(controls).getAllByRole("button")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "饮料不够凉" }));
    expect(onAnswerDiagnosis).toHaveBeenCalledWith("饮料不够凉");

    rerender(
      <CustomerWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "selfHelp" }}
        onAnswerDiagnosis={onAnswerDiagnosis}
        onMarkSelfResolved={onMarkSelfResolved}
        onRequestHumanService={onRequestHumanService}
        onReset={onReset}
      />,
    );
    expect(scrollTo).toHaveBeenLastCalledWith({
      behavior: "auto",
      top: expect.any(Number),
    });
    expect(screen.getByLabelText("对话快捷操作")).toBe(controls);
    expect(
      within(controls).getByRole("button", { name: "问题已解决" }),
    ).toBeInTheDocument();
    expect(
      within(controls).getByRole("button", { name: "仍需人工服务" }),
    ).toBeInTheDocument();

    const customerMessage = screen.getByText("饮料不够凉").closest("article");
    const assistantDiagnosis = screen
      .getByText(
        "结合温度曲线，可能与冷藏温度传感器或风道密封有关。",
      )
      .closest("article");
    expect(customerMessage).toHaveAttribute("data-sender", "customer");
    expect(assistantDiagnosis).toHaveAttribute("data-sender", "assistant");
    expect(screen.getByText("已送达")).toBeInTheDocument();
    expect(screen.getByText("知识库建议")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "问题已解决" }));
    expect(onMarkSelfResolved).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "仍需人工服务" }));
    expect(onRequestHumanService).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("lets the service agent create and reset a routed work order", () => {
    const onCreateWorkOrder = vi.fn();
    const onReset = vi.fn();
    const { rerender } = render(
      <AgentWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "serviceRequested" }}
        onCreateWorkOrder={onCreateWorkOrder}
        onReset={onReset}
      />,
    );

    expect(screen.getByText("智能服务坐席")).toBeInTheDocument();
    expect(
      screen.getByText("在飞书接收转人工会话与 AI 预诊摘要"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登录体验" })).toHaveAttribute(
      "href",
      "/login?from=agent",
    );
    expect(screen.getByText("预诊置信度 87%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成服务工单" }));
    expect(onCreateWorkOrder).toHaveBeenCalledOnce();

    rerender(
      <AgentWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "workOrderCreated" }}
        onCreateWorkOrder={onCreateWorkOrder}
        onReset={onReset}
      />,
    );
    expect(screen.getByRole("button", { name: "工单已生成" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("已分配给周启明");

    fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("requires the engineer to confirm parts before completing service", () => {
    const onConfirmParts = vi.fn();
    const onCompleteService = vi.fn();
    const onReset = vi.fn();
    const { rerender } = render(
      <EngineerWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "workOrderCreated" }}
        onCompleteService={onCompleteService}
        onConfirmParts={onConfirmParts}
        onReset={onReset}
      />,
    );

    const complete = screen.getByRole("button", {
      name: "完成本次服务",
    });
    expect(
      screen.getByText("在飞书接收工单、配件与上门提醒"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登录体验" })).toHaveAttribute(
      "href",
      "/login?from=engineer",
    );
    expect(complete).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "确认携件" }));
    expect(onConfirmParts).toHaveBeenCalledOnce();

    rerender(
      <EngineerWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "partsConfirmed" }}
        onCompleteService={onCompleteService}
        onConfirmParts={onConfirmParts}
        onReset={onReset}
      />,
    );
    expect(complete).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("准备出发");

    fireEvent.click(complete);
    expect(onCompleteService).toHaveBeenCalledOnce();

    rerender(
      <EngineerWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "serviceCompleted" }}
        onCompleteService={onCompleteService}
        onConfirmParts={onConfirmParts}
        onReset={onReset}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("首次上门完成");

    fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("lets operations inspect a VOC dimension and create an improvement task", () => {
    const onCreateImprovementTask = vi.fn();
    const onReset = vi.fn();
    const { rerender } = render(
      <OperationsWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "serviceCompleted" }}
        metrics={metricsOk}
        onCreateImprovementTask={onCreateImprovementTask}
        onReset={onReset}
      />,
    );

    expect(screen.getByText("VOC 闭环驾驶舱")).toBeInTheDocument();
    expect(
      screen.getByText("在飞书接收 VOC 异常与闭环任务"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登录体验" })).toHaveAttribute(
      "href",
      "/login?from=operations",
    );

    // task 14 fix round 1: the top summary row used to mix real numbers with
    // hardcoded demo tiles (e.g. an invented "重复上门风险" with no basis in
    // VocMetrics) side by side, with no way to tell which was which. Every
    // tile is now derived from the same real fixture (150 opened - 129
    // closed = 21 pending; 8 tagging failures; 2 dimensions; 86% closure).
    expect(screen.getByText("待闭环")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("打标失败")).toBeInTheDocument();
    expect(screen.getByText("高频问题维度数")).toBeInTheDocument();
    expect(screen.getByText("闭环达成率")).toBeInTheDocument();
    expect(screen.getByText("86%")).toBeInTheDocument();
    expect(screen.queryByText("重复上门风险")).not.toBeInTheDocument();

    expect(screen.getByText("128 条相关反馈")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "服务态度" }));
    expect(screen.getByText("76 条相关反馈")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建改善任务" }));
    expect(onCreateImprovementTask).toHaveBeenCalledOnce();

    rerender(
      <OperationsWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "improvementCreated" }}
        metrics={metricsOk}
        onCreateImprovementTask={onCreateImprovementTask}
        onReset={onReset}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("已进入闭环");
    expect(screen.getByText("产品质量 × 服务运营")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  // task 14 fix round 1: a live Bitable/token failure must never crash this
  // panel and must never render 0s or any other number that could pass for
  // real data — it must show an explicit, honest "unavailable" notice.
  it("shows an explicit unavailable notice instead of zeros when metrics failed to load", () => {
    const onCreateImprovementTask = vi.fn();
    const onReset = vi.fn();

    render(
      <OperationsWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "serviceCompleted" }}
        metrics={metricsUnavailable}
        onCreateImprovementTask={onCreateImprovementTask}
        onReset={onReset}
      />,
    );

    expect(screen.getByText("VOC 闭环驾驶舱")).toBeInTheDocument();
    expect(screen.getAllByText(/指标暂不可用/).length).toBeGreaterThan(0);

    // None of the real-data-shaped content from the "ok" fixture may appear.
    expect(screen.queryByText("维修时间")).not.toBeInTheDocument();
    expect(screen.queryByText("服务态度")).not.toBeInTheDocument();
    expect(screen.queryByText(/条相关反馈/)).not.toBeInTheDocument();
    expect(screen.queryByText("反馈总量")).not.toBeInTheDocument();
    expect(screen.queryByText("待闭环")).not.toBeInTheDocument();
    expect(screen.queryByText("打标失败")).not.toBeInTheDocument();
    expect(screen.queryByText("闭环达成率")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();

    // The journey-driven closure panel is unrelated to VOC metrics and must
    // keep working exactly as before.
    fireEvent.click(screen.getByRole("button", { name: "创建改善任务" }));
    expect(onCreateImprovementTask).toHaveBeenCalledOnce();
  });
});
