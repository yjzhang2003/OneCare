import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initialServiceJourneyState } from "../service-journey";
import { AgentWorkspace } from "./agent-workspace";
import { CustomerWorkspace } from "./customer-workspace";
import { EngineerWorkspace } from "./engineer-workspace";
import { OperationsWorkspace } from "./operations-workspace";

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

  it("lets operations inspect a VOC topic and create an improvement task", () => {
    const onCreateImprovementTask = vi.fn();
    const onReset = vi.fn();
    const { rerender } = render(
      <OperationsWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "serviceCompleted" }}
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
    expect(screen.getByText("128 条相关声音")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "安装等待时间" }));
    expect(screen.getByText("76 条相关声音")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建改善任务" }));
    expect(onCreateImprovementTask).toHaveBeenCalledOnce();

    rerender(
      <OperationsWorkspace
        journey={{ customerReply: "饮料不够凉", stage: "improvementCreated" }}
        onCreateImprovementTask={onCreateImprovementTask}
        onReset={onReset}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("已进入闭环");
    expect(screen.getByText("产品质量 × 服务运营")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
