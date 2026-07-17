import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LandingContent } from "./landing-content";

describe("LandingContent", () => {
  it("presents the multi-page service story without dead perspective links", () => {
    const { container } = render(<LandingContent user={null} />);

    expect(
      screen.getByRole("heading", {
        name: "让每一次服务，都比问题更早一步",
      }),
    ).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "角色视角" })).toHaveAttribute(
      "href",
      "#perspectives",
    );
    expect(screen.getByRole("link", { name: "五层架构" })).toHaveAttribute(
      "href",
      "#architecture",
    );
    expect(screen.getByRole("link", { name: "方案路径" })).toHaveAttribute(
      "href",
      "#scenario",
    );
    expect(screen.getByRole("link", { name: "团队" })).toHaveAttribute(
      "href",
      "#team",
    );

    ["用户视角", "客服视角", "工程师视角", "后台视角"].forEach(
      (name) => {
        expect(screen.getByRole("heading", { name })).toBeInTheDocument();
      },
    );
    ["感知", "诊断", "编排", "服务", "学习"].forEach((name) => {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    });

    expect(
      screen.getByRole("heading", { name: "冰箱温控异常" }),
    ).toBeInTheDocument();
    expect(screen.getByText("成员 01")).toBeInTheDocument();
    expect(screen.getByText("成员 02")).toBeInTheDocument();
    expect(screen.getByText("成员 03")).toBeInTheDocument();
    expect(screen.getAllByText("成员信息待补充")).toHaveLength(3);

    const login = screen.getByRole("link", { name: "使用飞书登录" });
    expect(login).toHaveAttribute("href", "/api/auth/feishu/start");
    expect(
      screen.getByText(/尚未接入真实业务数据或 AI 服务/),
    ).toBeInTheDocument();
    expect(container.querySelector('a[href^="/experience/"]')).toBeNull();
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
