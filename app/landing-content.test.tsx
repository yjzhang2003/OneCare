import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LandingContent } from "./landing-content";

afterEach(cleanup);

describe("LandingContent", () => {
  it("presents the Hisense showroom story with interactive perspectives", () => {
    const { container } = render(<LandingContent user={null} />);

    expect(
      screen.getByRole("heading", {
        name: "让每一次服务，都比问题更早一步",
      }),
    ).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "四个视角" })).toHaveAttribute(
      "href",
      "#perspectives",
    );
    expect(container.querySelector("#perspectives")).toContainElement(
      screen.getByRole("heading", {
        name: "一次问题，四种角色，同一条服务上下文",
      }),
    );
    expect(screen.getByRole("link", { name: "五层引擎" })).toHaveAttribute(
      "href",
      "#architecture",
    );
    expect(screen.getByRole("link", { name: "团队" })).toHaveAttribute(
      "href",
      "#team",
    );

    expect(
      screen.getByRole("tablist", { name: "OneCare 服务角色" }),
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

    expect(
      screen.getByRole("list", { name: "OneCare 五层服务蓝图" }),
    ).toBeInTheDocument();
    ["感知", "诊断", "编排", "服务", "学习"].forEach((name) => {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    });

    ["更短服务周期", "更低重复上门", "更高用户满意"].forEach(
      (outcome) => {
        expect(screen.getByText(outcome)).toBeInTheDocument();
      },
    );

    expect(screen.getByText("成员 01")).toBeInTheDocument();
    expect(screen.getByText("成员 02")).toBeInTheDocument();
    expect(screen.getByText("成员 03")).toBeInTheDocument();
    expect(screen.getByText(/成员信息待补充/)).toBeInTheDocument();

    const login = screen.getByRole("link", { name: "使用飞书登录" });
    expect(login).toHaveAttribute("href", "/api/auth/feishu/start");
    expect(
      screen.getByText(/尚未接入真实业务数据或 AI 服务/),
    ).toBeInTheDocument();
    expect(container.querySelector('a[href^="/experience/"]')).toBeNull();
    expect(container.querySelector(".role-card, .signal-flow")).toBeNull();
  });

  it("moves between perspective tabs with the keyboard", () => {
    render(<LandingContent user={null} />);

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

  it("returns signed-in visitors to the workspace", () => {
    render(
      <LandingContent
        user={{ openId: "ou_onecare", name: "服务运营员" }}
      />,
    );

    expect(screen.getByText("服务运营员，欢迎回来")).toBeInTheDocument();
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
