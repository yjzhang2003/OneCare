import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OneCareLogo } from "./onecare-logo";

afterEach(cleanup);

describe("OneCareLogo", () => {
  it("selects the light brand mark for a dark surface", () => {
    render(<OneCareLogo tone="light" />);

    expect(
      screen.getByRole("img", { name: "万护 OneCare" }),
    ).toHaveAttribute("data-tone", "light");
  });

  it("can be decorative on a light surface", () => {
    render(<OneCareLogo decorative tone="dark" />);

    expect(screen.getByTestId("onecare-logo")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("onecare-logo")).toHaveAttribute(
      "data-tone",
      "dark",
    );
  });
});
