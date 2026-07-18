import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LandingContent } from "./landing-content";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

describe("LandingContent", () => {
  it("presents the Hisense showroom story with interactive perspectives", () => {
    const { container } = render(<LandingContent user={null} />);

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
    const login = screen.getByRole("link", { name: "使用飞书登录" });
    expect(login).toHaveAttribute("href", "/api/auth/feishu/start");

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
    expect(screen.getByText("降低 30%–50%")).toBeInTheDocument();
    expect(screen.getByText("降低 15%")).toBeInTheDocument();
    expect(screen.getByText(/测量口径待试点启动前确认/)).toBeInTheDocument();
    expect(container.querySelector("#architecture")).toContainElement(
      screen.getByText("降低 30%–50%"),
    );
    expect(screen.queryByText("感知")).not.toBeInTheDocument();
    expect(screen.queryByText("更高用户满意")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "团队" }));
    expect(screen.getByText("03 · 团队")).toBeInTheDocument();
    expect(screen.getByText("成员 01")).toBeInTheDocument();
    expect(screen.getByText("成员 02")).toBeInTheDocument();
    expect(screen.getByText("成员 03")).toBeInTheDocument();
    expect(screen.getByText(/成员信息待补充/)).toBeInTheDocument();

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
    render(<LandingContent user={null} />);
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
    const { container } = render(<LandingContent user={null} />);
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

  it("returns signed-in visitors to the workspace", () => {
    render(
      <LandingContent
        user={{ openId: "ou_onecare", name: "服务运营员" }}
      />,
    );

    expect(screen.queryByText("服务运营员，欢迎回来")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入工作台" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("renders only safe copy for a known authentication error", () => {
    render(<LandingContent user={null} authError="invalid_state" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "登录请求已失效，请重新发起。",
    );
  });
});
