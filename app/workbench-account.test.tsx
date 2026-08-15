import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountMenu } from "./workbench-account";

describe("AccountMenu", () => {
  it("shows who is signed in", () => {
    render(<AccountMenu user={{ openId: "ou_a", name: "黄齐" }} />);
    expect(screen.getByText("黄齐")).toBeInTheDocument();
  });

  // A form post, not a fetch: the route clears the cookie and redirects, and letting the
  // browser follow that redirect is what makes the next page load see the session gone.
  it("logs out by posting to the route that clears the cookie", async () => {
    render(<AccountMenu user={{ openId: "ou_a", name: "黄齐" }} />);
    fireEvent.click(screen.getByText("黄齐"));

    // The droplist is a portal, rendered a tick after the click.
    const logout = await screen.findByRole("button", { name: /退出登录/ });
    expect(logout).toHaveAttribute("type", "submit");

    const form = logout.closest("form");
    expect(form).toHaveAttribute("action", "/api/auth/logout");
    expect(form).toHaveAttribute("method", "post");
  });

  it("falls back to the first character when there is no avatar", () => {
    render(<AccountMenu user={{ openId: "guest", name: "评委", guest: true }} />);
    expect(screen.getByText("评")).toBeInTheDocument();
  });
});
