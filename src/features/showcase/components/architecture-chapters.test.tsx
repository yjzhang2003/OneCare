import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  architectureLayers,
  closedLoopSteps,
  connectedSystems,
  decisionPaths,
  pilotTargets,
  rolloutStages,
  serviceIdentities,
} from "../content";
import { ArchitectureChapters } from "./architecture-chapters";

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderChapters() {
  return render(
    <ArchitectureChapters
      decisions={decisionPaths}
      identities={serviceIdentities}
      layers={architectureLayers}
      loopSteps={closedLoopSteps}
      stages={rolloutStages}
      systems={connectedSystems}
      targets={pilotTargets}
    />,
  );
}

describe("ArchitectureChapters", () => {
  it("renders all chapters on one global reading path", () => {
    renderChapters();

    expect(
      screen.getByRole("navigation", { name: "闭环架构章节" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "架构全景" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText("统一服务事件")).toBeInTheDocument();
    expect(screen.getByText("核心闭环")).toBeInTheDocument();
    expect(screen.getByText("6 个月试点目标")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-architecture-chapter]")).toHaveLength(3);
  });

  it("scrolls to chapters with pointer and keyboard controls", () => {
    renderChapters();

    fireEvent.click(screen.getByRole("button", { name: "闭环运行" }));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(screen.getByRole("button", { name: "闭环运行" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    const loopTab = screen.getByRole("button", { name: "闭环运行" });
    loopTab.focus();
    fireEvent.keyDown(loopTab, { key: "ArrowRight" });

    expect(screen.getByRole("button", { name: "试点落地" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "试点落地" }), {
      key: "Home",
    });
    expect(screen.getByRole("button", { name: "架构全景" })).toHaveFocus();
  });

  it("updates the active chapter while the global page scrolls", () => {
    const { container } = render(
      <div className="showcase-page">
        <ArchitectureChapters
          decisions={decisionPaths}
          identities={serviceIdentities}
          layers={architectureLayers}
          loopSteps={closedLoopSteps}
          stages={rolloutStages}
          systems={connectedSystems}
          targets={pilotTargets}
        />
      </div>,
    );
    const page = container.querySelector<HTMLElement>(".showcase-page");
    const sections = Array.from(
      container.querySelectorAll<HTMLElement>("[data-architecture-chapter]"),
    );
    expect(page).not.toBeNull();
    Object.defineProperty(page, "clientHeight", { configurable: true, value: 800 });
    page!.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    sections.forEach((section, index) => {
      section.getBoundingClientRect = () =>
        ({ top: [-800, 100, 900][index] }) as DOMRect;
    });

    fireEvent.scroll(page!);

    expect(screen.getByRole("button", { name: "闭环运行" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});
