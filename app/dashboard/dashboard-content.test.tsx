import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardContent } from "./dashboard-content";

describe("DashboardContent", () => {
  it("shows the authenticated user and clearly labels framework features", () => {
    const { container } = render(
      <DashboardContent
        user={{
          openId: "ou_must_not_render",
          name: "服务运营员",
          avatarUrl: "https://example.com/avatar.png",
        }}
      />,
    );

    expect(screen.getByText("服务运营员")).toBeInTheDocument();
    expect(screen.getByText("飞书身份已验证")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "服务闭环指挥台" }),
    ).toBeInTheDocument();
    expect(screen.getByText("VOC 洞察")).toBeInTheDocument();
    expect(screen.getByText("智能预诊")).toBeInTheDocument();
    expect(screen.getByText("协同调度")).toBeInTheDocument();
    expect(screen.getByText("闭环追踪")).toBeInTheDocument();
    expect(screen.getAllByText("静态预览")).toHaveLength(4);
    expect(container).not.toHaveTextContent("ou_must_not_render");

    const logout = screen.getByRole("button", { name: "退出登录" });
    expect(logout.closest("form")).toHaveAttribute(
      "action",
      "/api/auth/logout",
    );
    expect(logout.closest("form")).toHaveAttribute("method", "post");
  });
});
