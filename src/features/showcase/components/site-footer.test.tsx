import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";

afterEach(cleanup);

describe("SiteFooter", () => {
  it("groups brand navigation and prototype boundary into two clear rows", () => {
    const { container } = render(<SiteFooter />);
    const navigation = screen.getByRole("navigation", {
      name: "页尾导航",
    });

    expect(container.querySelector(".footer-top")).not.toBeNull();
    expect(container.querySelector(".footer-bottom")).not.toBeNull();
    expect(screen.getByText("万护 OneCare")).toBeInTheDocument();
    expect(
      screen.getByText("AI 用户服务全链路闭环引擎"),
    ).toBeInTheDocument();

    [
      ["首页", "#home"],
      ["四个视角", "#perspectives"],
      ["闭环架构", "#architecture"],
      ["团队", "#team"],
    ].forEach(([label, href]) => {
      expect(
        within(navigation).getByRole("link", { name: label }),
      ).toHaveAttribute("href", href);
    });

    expect(
      screen.getByText(/当前为万护 OneCare 方案原型/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回首页" })).toHaveAttribute(
      "href",
      "#home",
    );
    expect(screen.queryByText("Typeface: MiSans")).not.toBeInTheDocument();
  });
});
