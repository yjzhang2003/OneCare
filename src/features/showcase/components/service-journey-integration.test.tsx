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
});
