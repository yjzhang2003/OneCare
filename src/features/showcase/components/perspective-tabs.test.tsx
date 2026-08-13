import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { perspectives } from "../content";
import type { VocMetricsResult } from "../../voc/metrics";
import { PerspectiveTabs } from "./perspective-tabs";

// A real VocMetricsResult shape (task 14, fix round 1 added the
// "unavailable" branch): OperationsWorkspace reads this instead of the
// removed vocTopics fixture. These tests never assert on the VOC panel's
// own numbers, so any well-formed "ok" value works here.
const metrics: VocMetricsResult = {
  status: "ok",
  metrics: {
    total: 3,
    byPolarity: { 好评: 1, 中评: 1, 差评: 1 },
    dimensionTop: [
      { dimension: "维修时间", count: 2 },
      { dimension: "服务态度", count: 1 },
    ],
    byChannel: [{ channel: "电商评价", count: 3 }],
    negativeShare: 0.67,
    ticketsOpened: 2,
    ticketsClosed: 1,
    closureRate: 0.5,
    averageClosureHours: 12,
    taggingAttempted: 3,
    taggingSucceeded: 2,
    taggingFailed: 1,
    taggingPending: 0,
  },
};

afterEach(cleanup);

describe("PerspectiveTabs", () => {
  it("keeps four workspaces mounted and positions the selected role", () => {
    const { container } = render(
      <PerspectiveTabs metrics={metrics} perspectives={perspectives} />,
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
    render(<PerspectiveTabs metrics={metrics} perspectives={perspectives} />);

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
    render(<PerspectiveTabs metrics={metrics} perspectives={perspectives} />);

    fireEvent.click(screen.getByRole("button", { name: "饮料不够凉" }));
    fireEvent.click(screen.getByRole("tab", { name: "客服" }));
    fireEvent.click(screen.getByRole("tab", { name: "用户" }));

    expect(
      screen.getByText(
        "结合温度曲线，可能与冷藏温度传感器或风道密封有关。",
      ),
    ).toBeInTheDocument();
  });

  // task 14 fix round 1: this is the closest unit-level proxy to "the home
  // page must render its four perspectives even when the VOC metrics read
  // fails" — the strongest evidence for that claim is the hermetic build
  // check (`FEISHU_BITABLE_APP_TOKEN=bogus npm run build` exiting 0), but
  // this confirms the component boundary itself never throws or blanks out
  // any of the four tabs when handed an "unavailable" result.
  it("still renders all four workspaces when VOC metrics are unavailable", () => {
    const unavailable: VocMetricsResult = { status: "unavailable" };
    const { container } = render(
      <PerspectiveTabs metrics={unavailable} perspectives={perspectives} />,
    );

    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(4);
    ["用户", "客服", "工程师", "后台"].forEach((name) => {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: "后台" }));

    expect(screen.getByText("VOC 闭环驾驶舱")).toBeInTheDocument();
    expect(screen.getAllByText(/指标暂不可用/).length).toBeGreaterThan(0);
  });
});
