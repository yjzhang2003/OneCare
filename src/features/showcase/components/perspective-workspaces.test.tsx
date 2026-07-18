import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  it("lets the customer complete and reset the phone service demo", () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    render(<CustomerWorkspace />);
    scrollTo.mockClear();

    expect(screen.getByText("爱家服务助手")).toBeInTheDocument();
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

    expect(scrollTo).toHaveBeenLastCalledWith({
      behavior: "auto",
      top: expect.any(Number),
    });
    expect(screen.getByLabelText("对话快捷操作")).toBe(controls);
    expect(
      within(controls).getByRole("button", { name: "继续安排服务" }),
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

    fireEvent.click(screen.getByRole("button", { name: "继续安排服务" }));
    expect(scrollTo).toHaveBeenLastCalledWith({
      behavior: "auto",
      top: expect.any(Number),
    });
    expect(screen.getByLabelText("对话快捷操作")).toBe(controls);
    expect(within(controls).getByText("服务已提交")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("等待客服确认");
    expect(
      screen.getByText(/已为你提交 14:30–15:30 上门服务/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "等待客服确认",
    );
    expect(
      screen.getByRole("button", { name: "饮料不够凉" }),
    ).toBeInTheDocument();
  });

  it("lets the service agent create and reset a routed work order", () => {
    render(<AgentWorkspace />);

    expect(screen.getByText("智能服务坐席")).toBeInTheDocument();
    expect(screen.getByText("预诊置信度 87%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成服务工单" }));

    expect(screen.getByRole("button", { name: "工单已生成" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("已分配给周启明");

    fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
    expect(
      screen.getByRole("button", { name: "生成服务工单" }),
    ).toBeEnabled();
  });

  it("requires the engineer to confirm parts before completing service", () => {
    render(<EngineerWorkspace />);

    const complete = screen.getByRole("button", {
      name: "完成本次服务",
    });
    expect(complete).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "确认携件" }));
    expect(complete).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("准备出发");

    fireEvent.click(complete);
    expect(screen.getByRole("status")).toHaveTextContent("首次上门完成");

    fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
    expect(
      screen.getByRole("button", { name: "完成本次服务" }),
    ).toBeDisabled();
  });

  it("lets operations inspect a VOC topic and create an improvement task", () => {
    render(<OperationsWorkspace />);

    expect(screen.getByText("VOC 闭环驾驶舱")).toBeInTheDocument();
    expect(screen.getByText("128 条相关声音")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "安装等待时间" }));
    expect(screen.getByText("76 条相关声音")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建改善任务" }));
    expect(screen.getByRole("status")).toHaveTextContent("已进入闭环");
    expect(screen.getByText("产品质量 × 服务运营")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
    expect(
      screen.getByRole("button", { name: "冷藏室温度偏高" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
