import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FeishuExperienceBanner } from "./feishu-experience-banner";

afterEach(cleanup);

describe("FeishuExperienceBanner", () => {
  it("renders a centered pill link without an arrow", () => {
    const { container } = render(
      <FeishuExperienceBanner role="agent">
        在飞书接收转人工会话与 AI 预诊摘要
      </FeishuExperienceBanner>,
    );

    expect(screen.getByText("飞书")).toBeInTheDocument();
    expect(
      screen.getByText("在飞书接收转人工会话与 AI 预诊摘要"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "飞书登录" })).toHaveAttribute(
      "href",
      "/api/auth/feishu/start",
    );
    expect(container.textContent).not.toMatch(/[↗→]/);
  });

  // Every role's banner now starts authorization directly. The intermediate page that
  // used to receive ?from=<role> and tailor a sentence to it is gone: it was a screen
  // between a visitor and the only button on it.
  it.each(["agent", "engineer", "operations"] as const)(
    "sends every role straight into authorization",
    (role) => {
      render(
        <FeishuExperienceBanner role={role}>角色说明</FeishuExperienceBanner>,
      );

      expect(screen.getByRole("link", { name: "飞书登录" })).toHaveAttribute(
        "href",
        "/api/auth/feishu/start",
      );
    },
  );
});
