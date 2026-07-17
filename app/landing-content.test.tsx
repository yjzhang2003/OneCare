import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LandingContent } from "./landing-content";

describe("LandingContent", () => {
  it("presents the product and real Feishu login to signed-out visitors", () => {
    render(<LandingContent user={null} />);

    expect(
      screen.getByRole("heading", {
        name: "让每一次服务，都比问题更早一步",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("VOC 智能分析")).toBeInTheDocument();
    expect(screen.getByText("智能预诊")).toBeInTheDocument();
    expect(screen.getByText("协同调度")).toBeInTheDocument();
    expect(screen.getByText("闭环追踪")).toBeInTheDocument();

    const login = screen.getByRole("link", { name: "使用飞书登录" });
    expect(login).toHaveAttribute("href", "/api/auth/feishu/start");
    expect(
      screen.getByText(/尚未接入真实业务数据或 AI 服务/),
    ).toBeInTheDocument();
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
