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
        name: "一次问题，四种角色，同一条服务上下文",
      }),
    );
    expect(screen.getByText("01 · 四个视角")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "五层引擎" })).toHaveAttribute(
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
    ["首页", "四个视角", "五层引擎", "团队"].forEach((label) => {
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
      "冰箱好像不太冷了",
    );

    fireEvent.click(screen.getByRole("tab", { name: "客服" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "一次理解，不再重复描述",
    );

    fireEvent.click(screen.getByRole("link", { name: "五层引擎" }));
    expect(screen.getByText("02 · 五层引擎")).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "万护 OneCare 五层服务蓝图" }),
    ).toBeInTheDocument();
    ["感知", "诊断", "编排", "服务", "学习"].forEach((name) => {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    });

    ["更短服务周期", "更低重复上门", "更高用户满意"].forEach(
      (outcome) => {
        expect(screen.getByText(outcome)).toBeInTheDocument();
      },
    );
    expect(container.querySelector("#architecture")).toContainElement(
      screen.getByText("更短服务周期"),
    );

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
