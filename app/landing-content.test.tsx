import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LandingContent } from "./landing-content";

describe("LandingContent", () => {
  it("presents the product and real Feishu login to signed-out visitors", () => {
    render(<LandingContent user={null} />);

    expect(
      screen.getByRole("heading", {
        name: "让每一次产品定义，都听见真实用户",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("千万级数据洞察")).toBeInTheDocument();
    expect(screen.getByText("动态人群地图")).toBeInTheDocument();
    expect(screen.getByText("飞书协同")).toBeInTheDocument();

    const login = screen.getByRole("link", { name: "使用飞书登录" });
    expect(login).toHaveAttribute("href", "/api/auth/feishu/start");
    expect(
      screen.getByText(/企业内部应用演示，仅开放给应用所属企业成员/),
    ).toBeInTheDocument();
  });

  it("returns signed-in visitors to the workspace", () => {
    render(
      <LandingContent
        user={{ openId: "ou_auto_insight", name: "洞察研究员" }}
      />,
    );

    expect(screen.getByText("洞察研究员，欢迎回来")).toBeInTheDocument();
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
