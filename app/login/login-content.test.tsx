import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoginContent } from "./login-content";

describe("LoginContent", () => {
  it("guides a visitor through joining, verifying and opening Feishu", () => {
    render(<LoginContent user={null} />);

    expect(
      screen.getByRole("heading", { name: "在飞书里体验万护" }),
    ).toBeInTheDocument();
    expect(screen.getByText("加入体验组织")).toBeInTheDocument();
    expect(screen.getByText("验证飞书身份")).toBeInTheDocument();
    expect(screen.getByText("在飞书开始体验")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "使用飞书验证身份" }),
    ).toHaveAttribute("href", "/api/auth/feishu/start");
    expect(
      screen.getByRole("img", {
        name: "加入 OneCare 体验组织的飞书二维码",
      }),
    ).toHaveAttribute(
      "src",
      expect.stringContaining("onecare-enterprise-invite-2026-08-29.png"),
    );
    expect(
      screen.getByText("二维码有效期至 2026 年 8 月 29 日"),
    ).toBeInTheDocument();
    expect(screen.getByText("仅支持 +86 手机号")).toBeInTheDocument();
  });

  it("shows the verified identity without rendering a second dashboard", () => {
    render(
      <LoginContent
        user={{ openId: "ou_test", name: "服务体验员" }}
      />,
    );

    expect(screen.getByText("服务体验员")).toBeInTheDocument();
    expect(screen.getByText("飞书身份已验证")).toBeInTheDocument();
    expect(
      screen.getByText("打开飞书，在顶部搜索「OneCare」开始体验"),
    ).toBeInTheDocument();
    expect(screen.getByText("机器人配置中")).toBeInTheDocument();
    expect(screen.queryByText("服务闭环指挥台")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("renders only safe authentication error copy", () => {
    render(
      <LoginContent
        authError="登录请求已失效，请重新发起。"
        user={null}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "登录请求已失效，请重新发起。",
    );
  });

  it("uses only the closed role source map", () => {
    const { rerender } = render(
      <LoginContent sourceRole="engineer" user={null} />,
    );

    expect(screen.getByText(/从工程师视角继续/)).toBeInTheDocument();

    rerender(<LoginContent user={null} />);
    expect(screen.queryByText(/从工程师视角继续/)).not.toBeInTheDocument();
  });

  it("keeps text actions free of arrows", () => {
    const { container } = render(<LoginContent user={null} />);

    expect(container.textContent).not.toMatch(/[↗→]/);
  });
});
