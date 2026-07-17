import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LandingContent } from "./landing-content";

describe("LandingContent", () => {
  it("presents one continuous service journey without card-wall patterns", () => {
    const { container } = render(<LandingContent user={null} />);

    expect(
      screen.getByRole("heading", {
        name: "让每一次服务，都比问题更早一步",
      }),
    ).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "服务旅程" })).toHaveAttribute(
      "href",
      "#journey",
    );
    expect(screen.getByRole("link", { name: "五层引擎" })).toHaveAttribute(
      "href",
      "#architecture",
    );
    expect(screen.getByRole("link", { name: "团队" })).toHaveAttribute(
      "href",
      "#team",
    );

    [
      "冰箱好像不太冷了",
      "一次理解，不再重复描述",
      "一次带对",
      "一次解决，持续学习",
    ].forEach((statement) => {
      expect(screen.getByText(statement)).toBeInTheDocument();
    });

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
    expect(
      container.querySelector(".role-card, .signal-flow, .team-card"),
    ).toBeNull();
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
