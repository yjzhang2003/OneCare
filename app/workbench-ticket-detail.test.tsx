import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkbenchTicket } from "../src/features/workbench/data";
import {
  TicketDetailPageView,
  TicketDetailState,
} from "./workbench-ticket-detail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

const NOW = Date.parse("2026-08-13T08:00:00.000Z");

function ticket(overrides: Partial<WorkbenchTicket> = {}): WorkbenchTicket {
  return {
    recordId: "rec1",
    recordNumber: "VOC-20260813-001",
    feedbackAt: "2026-08-12T08:00:00.000Z",
    channel: "电商评价",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "报修后等了三天没人上门",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "用户反馈上门维修延迟三天",
    replies: [],
    severity: "中",
    state: "待跟进",
    ownerNames: ["张三"],
    retryCount: 0,
    hasOwner: true,
    hasWarRoom: false,
    sourceTicketNo: "CAS-1",
    userRef: "U-A",
    deviceRef: "D-A",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ticketOpenedAt: "2026-08-12T10:00:00.000Z",
    closedAt: null,
    durationHours: null,
    ...overrides,
  };
}

function renderDetail(overrides: Partial<WorkbenchTicket> = {}) {
  return render(
    <TicketDetailPageView
      user={{ openId: "ou_operator", name: "运营" }}
      ticket={ticket(overrides)}
      now={NOW}
      backHref="/?queue=all&sort=feedback_desc"
    />,
  );
}

describe("TicketDetailPageView", () => {
  it("renders the five anchored sections without the queue sider", () => {
    const { container } = renderDetail();
    for (const name of ["工单概览", "用户反馈", "AI 分析", "回复话术", "处理信息"])
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    for (const id of ["overview", "feedback", "analysis", "replies", "handling"])
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    expect(container.querySelector(".oc-ticket-detail__grid")).not.toBeNull();
    expect(container.querySelector(".oc-console__sider")).toBeNull();
  });

  it("exposes independently placeable overview, actions, body and key-field regions", () => {
    const { container } = renderDetail({ state: "待跟进", hasOwner: true });
    const selectors = [
      ".oc-ticket-detail__overview",
      ".oc-ticket-detail__actions",
      ".oc-ticket-detail__body",
      ".oc-ticket-detail__key-fields",
    ] as const;

    for (const selector of selectors) {
      expect(container.querySelectorAll(selector)).toHaveLength(1);
    }

    const overview = container.querySelector<HTMLElement>(selectors[0])!;
    const actions = container.querySelector<HTMLElement>(selectors[1])!;
    const body = container.querySelector<HTMLElement>(selectors[2])!;
    const keyFields = container.querySelector<HTMLElement>(selectors[3])!;

    expect(within(overview).getByText(/工单主题/)).toBeInTheDocument();
    expect(within(actions).getByText("当前处理")).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "开始跟进" })).toBeInTheDocument();
    for (const heading of ["用户反馈", "AI 分析", "回复话术", "处理信息"]) {
      expect(within(body).getByText(heading)).toBeInTheDocument();
    }
    expect(within(keyFields).getByText("关键字段")).toBeInTheDocument();
    expect(within(keyFields).getByText("VOC-20260813-001")).toBeInTheDocument();
  });

  it("shows facts but not a group id", () => {
    renderDetail({
      content: "冷藏室温度持续偏高",
      summary: "疑似传感器异常",
      replies: [{ tone: "安抚", text: "已记录问题。" }],
      hasWarRoom: true,
    });
    expect(screen.getByText("冷藏室温度持续偏高")).toBeInTheDocument();
    expect(screen.getByText("疑似传感器异常")).toBeInTheDocument();
    expect(screen.getByText("已记录问题。")).toBeInTheDocument();
    expect(screen.getByText("已建立")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("oc_");
    expect(document.body.textContent).not.toContain("ou_operator");
  });

  it("shows the existing categories and lifecycle times", () => {
    renderDetail({
      channel: "热线",
      category: "空调",
      model: "KFR-72LW",
      polarity: "中评",
      dimensions: ["产品质量", "维修时间"],
      severity: "高",
      feedbackAt: "2026-08-12T08:00:00.000Z",
      ticketOpenedAt: "2026-08-12T10:00:00.000Z",
      closedAt: "2026-08-13T02:00:00.000Z",
      durationHours: 16,
    });

    for (const value of [
      "热线 / 空调",
      "KFR-72LW",
      "中评",
      "产品质量、维修时间",
      "2026-08-12 16:00",
      "2026-08-12 18:00",
      "2026-08-13 10:00",
      "16 小时",
    ]) {
      expect(screen.getAllByText(value).length).toBeGreaterThan(0);
    }
  });

  it("reuses current action rules", () => {
    renderDetail({ state: "待跟进", hasOwner: true });
    expect(screen.getByRole("button", { name: "开始跟进" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认闭环" })).not.toBeInTheDocument();
    expect(screen.getByText(/只有负责人本人能做/)).toBeInTheDocument();
  });

  it("offers claiming only with no owner", () => {
    renderDetail({ hasOwner: false, ownerNames: [] });
    expect(screen.getByRole("button", { name: "我来跟进" })).toBeInTheDocument();
  });

  it("shows absent dwell and overdue values when no start time can be calculated", () => {
    const { container } = renderDetail({
      feedbackAt: "not a date",
      ticketOpenedAt: null,
    });
    const status = container.querySelector<HTMLElement>(
      ".oc-ticket-detail__status-grid",
    )!;

    expect(within(status).getByText("停留时长").nextElementSibling).toHaveTextContent("—");
    expect(within(status).getByText("超时标记").nextElementSibling).toHaveTextContent("—");
    expect(within(status).queryByText("未超时")).not.toBeInTheDocument();
    expect(within(status).queryByText(/已超时/)).not.toBeInTheDocument();
  });

  it.each(["已闭环", "无需跟进"] as const)(
    "explains that %s is terminal",
    (state) => {
      renderDetail({ state, hasOwner: true });
      expect(screen.getByText(`${state}是终态，没有后续动作。`)).toBeInTheDocument();
    },
  );

  it("explains when only the tagging pipeline can continue", () => {
    renderDetail({ state: "待分析", hasOwner: true });
    expect(
      screen.getByText("待分析下没有可由人执行的动作，等打标流水线处理。"),
    ).toBeInTheDocument();
  });
});

describe("TicketDetailState", () => {
  const common = {
    user: { openId: "ou_operator", name: "运营" },
    recordNumber: "VOC-404",
    backHref: "/?queue=all&sort=feedback_desc",
    retryHref: "/workbench/tickets/VOC-404?queue=all&sort=feedback_desc",
  } as const;

  it("shows a missing ticket without retry or business actions", () => {
    render(<TicketDetailState {...common} kind="not-found" />);

    expect(screen.getByText("万护 OneCare")).toBeInTheDocument();
    expect(screen.getByText("运营")).toBeInTheDocument();
    expect(screen.getByText("工单不存在或已被移除")).toBeInTheDocument();
    expect(screen.getByText("VOC-404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回工单列表" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "重试" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows retry and return when ticket data is unavailable", () => {
    render(<TicketDetailState {...common} kind="unavailable" />);

    expect(screen.getByText("万护 OneCare")).toBeInTheDocument();
    expect(screen.getByText("运营")).toBeInTheDocument();
    expect(screen.getByText("工单暂时无法加载")).toBeInTheDocument();
    expect(screen.queryByText("VOC-404")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "重试" })).toHaveAttribute(
      "href",
      common.retryHref,
    );
    expect(screen.getByRole("link", { name: "返回工单列表" })).toHaveAttribute(
      "href",
      common.backHref,
    );
  });
});
