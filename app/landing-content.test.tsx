import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VocMetricsResult } from "../src/features/voc/metrics";
import { LandingContent } from "./landing-content";

// A real VocMetricsResult shape (task 14, fix round 1 added the "unavailable"
// branch): LandingContent now threads this to the operations workspace
// instead of that workspace reading a fabricated vocTopics fixture. The
// tests below only assert on markup unrelated to specific numbers, so any
// well-formed "ok" value works here.
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

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

describe("LandingContent", () => {
  it("presents the Hisense showroom story with interactive perspectives", () => {
    const { container } = render(
      <LandingContent metrics={metrics} user={null} />,
    );

    expect(
      screen.getByRole("heading", {
        name: "让每一次服务，都比问题更早一步",
      }),
    ).toBeInTheDocument();

    expect(screen.getByLabelText("万护 OneCare 首页")).toHaveTextContent(
      "万护 ONECARE",
    );
    expect(
      screen
        .getByLabelText("万护 OneCare 首页")
        .querySelector('[data-tone="light"]'),
    ).not.toBeNull();
    expect(screen.getAllByTestId("onecare-logo").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      screen.getByText(/万护 OneCare 面向海信智能家庭场景/),
    ).toBeInTheDocument();

    expect(screen.getByText("00 · 首页")).toBeInTheDocument();
    expect(screen.getByTestId("page-home")).toHaveAttribute(
      "data-position",
      "active",
    );
    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute(
      "href",
      "#home",
    );
    const login = screen.getByRole("link", { name: "使用飞书体验" });
    expect(login).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "飞书体验" })).toHaveAttribute(
      "href",
      "/login",
    );

    expect(screen.getByRole("link", { name: "四个视角" })).toHaveAttribute(
      "href",
      "#perspectives",
    );
    fireEvent.click(screen.getByRole("link", { name: "四个视角" }));
    expect(container.querySelector("#perspectives")).toContainElement(
      screen.getByRole("heading", {
        name: "一次问题，四种角色，一条完整服务链",
      }),
    );
    expect(
      screen.getByText(
        "从 AI 自助、客服建单到工程师服务和后台改善，点击查看同一个问题如何一步步闭环。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("01 · 四个视角")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "闭环架构" })).toHaveAttribute(
      "href",
      "#architecture",
    );
    expect(screen.getByRole("link", { name: "团队" })).toHaveAttribute(
      "href",
      "#team",
    );

    const topNavigation = screen.getByRole("navigation", {
      name: "主页章节",
    });
    ["首页", "四个视角", "闭环架构", "团队"].forEach((label) => {
      expect(topNavigation).toContainElement(
        screen.getAllByRole("link", { name: label })[0],
      );
    });

    expect(
      screen.getByRole("tablist", { name: "万护 OneCare 服务角色" }),
    ).toBeInTheDocument();

    const userTab = screen.getByRole("tab", { name: "用户" });
    expect(userTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "爱家服务助手",
    );

    fireEvent.click(screen.getByRole("tab", { name: "客服" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "智能服务坐席",
    );

    fireEvent.click(screen.getByRole("link", { name: "闭环架构" }));
    expect(screen.getByText("02 · 闭环架构")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "闭环架构章节" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "万护 OneCare 三层闭环架构" }),
    ).toBeInTheDocument();
    ["数据与知识层", "智能编排层", "多角色应用层"].forEach((name) => {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    });

    ["用户 ID", "设备 ID", "服务事件 ID"].forEach((identity) => {
      expect(screen.getByText(identity)).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "人工审核后执行" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "6 个月试点目标" })).toBeInTheDocument();
    expect(screen.getByText("相对降低 30%–50%")).toBeInTheDocument();
    expect(screen.getByText("承诺降低 35%")).toBeInTheDocument();
    expect(screen.getByText("拉伸至 40%")).toBeInTheDocument();
    expect(screen.getByText("承诺缩短 15%")).toBeInTheDocument();
    expect(screen.getByText("拉伸至 20%")).toBeInTheDocument();
    expect(screen.getByText("相对降低 15%")).toBeInTheDocument();
    expect(screen.getByText(/测量口径待试点启动前确认/)).toBeInTheDocument();
    expect(container.querySelector("#architecture")).toContainElement(
      screen.getByText("相对降低 30%–50%"),
    );
    expect(screen.queryByText("感知")).not.toBeInTheDocument();
    expect(screen.queryByText("更高用户满意")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "团队" }));
    expect(screen.getByText("03 · 团队")).toBeInTheDocument();
    expect(
      screen.getByText(
        "从 AI 工程、安全仿真到业务产品化，三种能力共同把服务创新变成可验证的方案。",
      ),
    ).toBeInTheDocument();

    const expectedMembers = [
      ["张禹健", "AI 工程与系统架构"],
      ["张睿哲", "安全仿真与算法研究"],
      ["黄齐", "AI 产品与业务洞察"],
    ] as const;

    expectedMembers.forEach(([name, role]) => {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
      expect(screen.getByText(role)).toBeInTheDocument();
    });

    [
      "南京大学软件工程硕士研究生",
      "南京邮电大学计算机科学与技术本科",
      "西安电子科技大学网络与信息安全硕士研究生",
      "南京邮电大学信息安全本科",
      "卡内基梅隆大学人工智能系统管理硕士研究生",
      "苏州大学物流管理本科",
    ].forEach((education) => {
      expect(screen.getByText(education)).toBeInTheDocument();
    });

    expect(screen.queryByText(/成员信息待补充/)).not.toBeInTheDocument();

    container.querySelectorAll(".team-card").forEach((card) => {
      expect(card.querySelector("img")).toBeNull();
    });

    expect(
      screen.getByText(/当前为万护 OneCare 方案原型/),
    ).toBeInTheDocument();
    expect(container.querySelector("#team")).toContainElement(
      screen.getByText(/当前为万护 OneCare 方案原型/),
    );
    expect(screen.queryByText("FIVE-LAYER ENGINE")).not.toBeInTheDocument();
    expect(screen.queryByText("TEAM CREDITS")).not.toBeInTheDocument();
    expect(screen.queryByText("03 / OUTCOME")).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="/experience/"]')).toBeNull();
    expect(container.querySelector(".role-card, .signal-flow")).toBeNull();
    expect(
      container.querySelector(".session-copy, .showroom-hero__case"),
    ).toBeNull();
    expect(
      screen.queryByText("方案原型 · 未接入真实业务数据"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("冰箱温控异常")).not.toBeInTheDocument();
    expect(screen.queryByText("−18°")).not.toBeInTheDocument();
    expect(screen.queryByText("04°")).not.toBeInTheDocument();
    expect(container.querySelector(".showroom-hero__pulse")).toBeNull();
  });

  it("moves between perspective tabs with the keyboard", () => {
    render(<LandingContent metrics={metrics} user={null} />);
    fireEvent.click(screen.getByRole("link", { name: "四个视角" }));

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
  });

  it("keeps text controls centered and free of decorative arrows", () => {
    const { container } = render(
      <LandingContent metrics={metrics} user={null} />,
    );
    fireEvent.click(screen.getByRole("link", { name: "团队" }));

    const textControls = container.querySelectorAll(
      ".header-cta, .primary-action, .secondary-action, .back-to-top",
    );

    expect(container.querySelector(".action-arrow")).toBeNull();
    textControls.forEach((control) => {
      expect(control.textContent).not.toMatch(/[↗↓↑]/);
    });
    expect(screen.getByRole("link", { name: "返回首页" })).toHaveAttribute(
      "href",
      "#home",
    );
  });

  it("returns signed-in visitors to the Feishu experience gateway", () => {
    render(
      <LandingContent
        metrics={metrics}
        user={{ openId: "ou_onecare", name: "服务运营员" }}
      />,
    );

    expect(screen.queryByText("服务运营员，欢迎回来")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "使用飞书体验" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "飞书体验" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("renders only safe copy for a known authentication error", () => {
    render(
      <LandingContent authError="invalid_state" metrics={metrics} user={null} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "登录请求已失效，请重新发起。",
    );
  });

  it("offers a manual entry into the workbench for a session-less visitor", () => {
    render(<LandingContent metrics={metrics} user={null} />);

    expect(screen.getByRole("link", { name: "进入工作台" })).toHaveAttribute(
      "href",
      "/enter",
    );
  });

  it("does not offer the workbench entry link to an already signed-in visitor", () => {
    render(
      <LandingContent
        metrics={metrics}
        user={{ openId: "ou_onecare", name: "服务运营员" }}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "进入工作台" }),
    ).not.toBeInTheDocument();
  });

  it("shows a safe, generic notice when a prior authorization attempt failed", () => {
    render(<LandingContent authError="tried" metrics={metrics} user={null} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("工作台授权未成功");
    expect(alert.textContent).not.toMatch(/error|exception|stack|token/i);
  });
});
