import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { perspectives } from "../content";
import { PerspectiveTabs } from "./perspective-tabs";

const scrollToDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();

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

describe("linked service journey", () => {
  it("offers knowledge help before the customer can request a human", () => {
    render(<PerspectiveTabs perspectives={perspectives} />);
    const customer = within(screen.getByTestId("workspace-customer"));

    fireEvent.click(
      customer.getByRole("button", { name: "饮料不够凉" }),
    );

    expect(customer.getByText("知识库建议")).toBeInTheDocument();
    expect(
      customer.getByText("确认冰箱门体已完全闭合"),
    ).toBeInTheDocument();
    expect(
      customer.getByRole("button", { name: "问题已解决" }),
    ).toBeEnabled();
    expect(
      customer.getByRole("button", { name: "仍需人工服务" }),
    ).toBeEnabled();

    fireEvent.click(
      customer.getByRole("button", { name: "仍需人工服务" }),
    );
    expect(customer.getByRole("status")).toHaveTextContent(
      "等待客服建单",
    );
  });

  it("updates customer and engineer views when the agent creates a work order", () => {
    render(<PerspectiveTabs perspectives={perspectives} />);
    const customer = within(screen.getByTestId("workspace-customer"));
    const agent = within(screen.getByTestId("workspace-agent"));
    const engineer = within(screen.getByTestId("workspace-engineer"));

    expect(
      agent.getByRole("button", { hidden: true, name: "生成服务工单" }),
    ).toBeDisabled();
    expect(
      engineer.getByRole("button", { hidden: true, name: "确认携件" }),
    ).toBeDisabled();

    fireEvent.click(
      customer.getByRole("button", { name: "饮料不够凉" }),
    );
    fireEvent.click(
      customer.getByRole("button", { name: "仍需人工服务" }),
    );

    expect(agent.getByText("用户自助未解决")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /客服/ }));
    expect(
      agent.getByRole("button", { name: "生成服务工单" }),
    ).toBeEnabled();

    fireEvent.click(agent.getByRole("button", { name: "生成服务工单" }));

    expect(customer.getByText(/OC-WO-037/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /工程师/ }));
    expect(
      engineer.getByRole("button", { name: "确认携件" }),
    ).toBeEnabled();

    fireEvent.click(engineer.getByRole("button", { name: "确认携件" }));
    expect(
      engineer.getByRole("button", { name: "完成本次服务" }),
    ).toBeEnabled();
  });
});
