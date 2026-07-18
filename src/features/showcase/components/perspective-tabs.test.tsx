import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { perspectives } from "../content";
import { PerspectiveTabs } from "./perspective-tabs";

afterEach(cleanup);

describe("PerspectiveTabs", () => {
  it("keeps four workspaces mounted and positions the selected role", () => {
    const { container } = render(
      <PerspectiveTabs perspectives={perspectives} />,
    );

    expect(screen.getByTestId("workspace-customer")).toHaveAttribute(
      "data-position",
      "active",
    );
    expect(screen.getByTestId("workspace-agent")).toHaveAttribute(
      "data-position",
      "after",
    );

    fireEvent.click(screen.getByRole("tab", { name: "工程师" }));

    expect(screen.getByTestId("workspace-customer")).toHaveAttribute(
      "data-position",
      "before",
    );
    expect(screen.getByTestId("workspace-engineer")).toHaveAttribute(
      "data-position",
      "active",
    );
    expect(screen.getByTestId("workspace-agent")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("workspace-agent")).toHaveAttribute("inert");
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(4);
  });

  it("supports directional, Home, and End keyboard navigation", () => {
    render(<PerspectiveTabs perspectives={perspectives} />);

    const customer = screen.getByRole("tab", { name: "客服" });
    customer.focus();
    fireEvent.keyDown(customer, { key: "ArrowRight" });

    const engineer = screen.getByRole("tab", { name: "工程师" });
    expect(engineer).toHaveAttribute("aria-selected", "true");
    expect(engineer).toHaveFocus();

    fireEvent.keyDown(engineer, { key: "End" });
    expect(screen.getByRole("tab", { name: "后台" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "后台" }), {
      key: "Home",
    });
    expect(screen.getByRole("tab", { name: "用户" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("preserves a workspace demo while switching roles", () => {
    render(<PerspectiveTabs perspectives={perspectives} />);

    fireEvent.click(screen.getByRole("button", { name: "饮料不够凉" }));
    fireEvent.click(screen.getByRole("tab", { name: "客服" }));
    fireEvent.click(screen.getByRole("tab", { name: "用户" }));

    expect(
      screen.getByText(
        "结合温度曲线，可能与冷藏温度传感器或风道密封有关。",
      ),
    ).toBeInTheDocument();
  });
});
