import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoginContent } from "./login-content";

describe("LoginContent", () => {
  it("is a login page: join the org, sign in, land in the workbench", () => {
    render(<LoginContent user={null} />);

    expect(
      screen.getByRole("heading", { name: "用飞书登录万护 OneCare" }),
    ).toBeInTheDocument();
    expect(screen.getByText("加入 OneCare 组织")).toBeInTheDocument();
    // Twice on purpose: step 02 names it, and the button does it.
    expect(screen.getAllByText("用飞书登录")).toHaveLength(2);
    expect(screen.getByText("进入工作台")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "用飞书登录" })).toHaveAttribute(
      "href",
      "/api/auth/feishu/start",
    );
    expect(
      screen.getByRole("img", {
        name: "加入 OneCare 组织的飞书二维码",
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

  // Signed in, this page has exactly one thing left to offer: the way into the console.
  it("shows who is signed in and the way into the workbench", () => {
    render(
      <LoginContent
        user={{ openId: "ou_test", name: "服务体验员" }}
      />,
    );

    expect(screen.getByText("服务体验员")).toBeInTheDocument();
    expect(screen.getByText("已登录")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入工作台" })).toHaveAttribute(
      "href",
      "/enter",
    );
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
