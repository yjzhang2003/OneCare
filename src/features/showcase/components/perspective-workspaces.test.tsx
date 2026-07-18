import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AgentWorkspace } from "./agent-workspace";
import { CustomerWorkspace } from "./customer-workspace";
import { EngineerWorkspace } from "./engineer-workspace";

afterEach(cleanup);

describe("perspective workspaces", () => {
  it("lets the customer complete and reset the phone service demo", () => {
    render(<CustomerWorkspace />);

    expect(screen.getByText("爱家服务助手")).toBeInTheDocument();
    expect(screen.getByText("静态交互 Demo")).toBeInTheDocument();
    expect(
      screen.getByText(
        "检测到冷藏室温度持续偏高，需要我帮你一起确认吗？",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "饮料不够凉" }));

    expect(
      screen.getByText(
        "结合温度曲线，可能与冷藏温度传感器或风道密封有关。",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "继续安排服务" }));
    expect(screen.getByRole("status")).toHaveTextContent("等待客服确认");

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
});
