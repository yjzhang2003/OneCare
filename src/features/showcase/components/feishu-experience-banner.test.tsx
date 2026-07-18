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

    expect(screen.getByText("计划接入飞书")).toBeInTheDocument();
    expect(
      screen.getByText("在飞书接收转人工会话与 AI 预诊摘要"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登录体验" })).toHaveAttribute(
      "href",
      "/login?from=agent",
    );
    expect(container.textContent).not.toMatch(/[↗→]/);
  });

  it.each(["agent", "engineer", "operations"] as const)(
    "uses the closed %s source role",
    (role) => {
      render(
        <FeishuExperienceBanner role={role}>角色说明</FeishuExperienceBanner>,
      );

      expect(screen.getByRole("link", { name: "登录体验" })).toHaveAttribute(
        "href",
        `/login?from=${role}`,
      );
    },
  );
});
