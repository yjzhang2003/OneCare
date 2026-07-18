import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShowcasePageContent } from "../navigation";
import { ShowcaseNavigator } from "./showcase-navigator";

const pages: ShowcasePageContent = {
  home: <h1 data-showcase-title>首页内容</h1>,
  perspectives: <h2 data-showcase-title>四个视角内容</h2>,
  architecture: <h2 data-showcase-title>五层引擎内容</h2>,
  team: <h2 data-showcase-title>团队内容</h2>,
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ShowcaseNavigator", () => {
  it("starts on the homepage and exposes the four canonical hashes", () => {
    render(<ShowcaseNavigator pages={pages} user={null} />);

    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute(
      "href",
      "#home",
    );
    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "四个视角" })).toHaveAttribute(
      "href",
      "#perspectives",
    );
    expect(screen.getByRole("link", { name: "五层引擎" })).toHaveAttribute(
      "href",
      "#architecture",
    );
    expect(screen.getByRole("link", { name: "团队" })).toHaveAttribute(
      "href",
      "#team",
    );

    expect(screen.getByTestId("page-home")).toHaveAttribute(
      "data-position",
      "active",
    );
    expect(screen.getByTestId("page-perspectives")).toHaveAttribute(
      "data-position",
      "after",
    );
    expect(screen.getByTestId("page-perspectives")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("page-perspectives")).toHaveAttribute("inert");
  });

  it("moves directly to a later page and records the hash", () => {
    render(<ShowcaseNavigator pages={pages} user={null} />);

    fireEvent.click(screen.getByRole("link", { name: "团队" }));

    expect(window.location.hash).toBe("#team");
    expect(screen.getByRole("link", { name: "团队" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("page-team")).toHaveAttribute(
      "data-position",
      "active",
    );
    expect(screen.getByTestId("page-home")).toHaveAttribute(
      "data-position",
      "before",
    );
    expect(screen.getByTestId("page-perspectives")).toHaveAttribute(
      "data-position",
      "before",
    );
  });

  it("restores a valid deep link without adding another history entry", async () => {
    window.history.replaceState(null, "", "/#architecture");
    const pushState = vi.spyOn(window.history, "pushState");

    render(<ShowcaseNavigator pages={pages} user={null} />);

    await waitFor(() => {
      expect(screen.getByTestId("page-architecture")).toHaveAttribute(
        "data-position",
        "active",
      );
    });
    expect(pushState).not.toHaveBeenCalled();
  });

  it("responds to browser history and falls back from an invalid hash", async () => {
    render(<ShowcaseNavigator pages={pages} user={null} />);

    window.history.replaceState(null, "", "/#perspectives");
    fireEvent(window, new PopStateEvent("popstate"));

    await waitFor(() => {
      expect(screen.getByTestId("page-perspectives")).toHaveAttribute(
        "data-position",
        "active",
      );
    });

    window.history.replaceState(null, "", "/#unknown");
    fireEvent(window, new HashChangeEvent("hashchange"));

    await waitFor(() => {
      expect(screen.getByTestId("page-home")).toHaveAttribute(
        "data-position",
        "active",
      );
    });
  });

  it("does not reset scrolling or history when selecting the active page", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const scrollTo = vi.spyOn(HTMLElement.prototype, "scrollTo");

    render(<ShowcaseNavigator pages={pages} user={null} />);
    fireEvent.click(screen.getByRole("link", { name: "首页" }));

    expect(pushState).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not move focus to the homepage title during initial restoration", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) =>
      window.clearTimeout(handle),
    );
    render(<ShowcaseNavigator pages={pages} user={null} />);

    await act(() => new Promise((resolve) => window.setTimeout(resolve, 50)));
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 650)));

    expect(focus).not.toHaveBeenCalled();
  });

  it("moves focus only when a page link is activated from the keyboard", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) =>
      window.clearTimeout(handle),
    );
    render(<ShowcaseNavigator pages={pages} user={null} />);
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 50)));

    fireEvent.click(screen.getByRole("link", { name: "团队" }), {
      detail: 1,
    });
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 650)));
    expect(focus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: "首页" }), {
      detail: 0,
    });
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 650)));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
