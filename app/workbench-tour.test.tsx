import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JUDGE_TOUR, WorkbenchTour } from "./workbench-tour";

function anchor(target: string) {
  const element = document.createElement("div");
  element.setAttribute("data-tour", target);
  // jsdom gives every element a zero rect; the component treats that as "not on this
  // screen", so a stub is what lets these tests be about the stepping logic.
  element.getBoundingClientRect = () =>
    ({ top: 100, left: 40, width: 200, height: 50 }) as DOMRect;
  document.body.appendChild(element);
  return element;
}

describe("WorkbenchTour", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<WorkbenchTour open={false} onClose={() => {}} />);
    expect(container.querySelector(".oc-tour")).toBeNull();
  });

  it("walks the stops in order and ends on 开始使用", () => {
    for (const step of JUDGE_TOUR) anchor(step.target);
    const onClose = vi.fn();
    render(<WorkbenchTour open onClose={onClose} />);

    expect(screen.getByText(JUDGE_TOUR[0]!.title)).toBeInTheDocument();
    expect(screen.getByText(`1 / ${JUDGE_TOUR.length}`)).toBeInTheDocument();

    for (let step = 1; step < JUDGE_TOUR.length; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "下一步" }));
      expect(screen.getByText(JUDGE_TOUR[step]!.title)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can be skipped at any point", () => {
    for (const step of JUDGE_TOUR) anchor(step.target);
    const onClose = vi.fn();
    render(<WorkbenchTour open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // A stop whose element is not on this screen would otherwise draw a ring around the
  // viewport's corner.
  it("skips a stop whose target is not on the page", async () => {
    anchor("second");
    render(
      <WorkbenchTour
        open
        steps={[
          { target: "missing", title: "不该出现", body: "" },
          { target: "second", title: "应该出现", body: "" },
        ]}
        onClose={() => {}}
      />,
    );

    // The skip happens on the first measurement, a tick after mount — the console
    // renders its table after the first paint, and measuring before that lands on the
    // wrong element.
    expect(await screen.findByText("应该出现")).toBeInTheDocument();
    expect(screen.queryByText("不该出现")).not.toBeInTheDocument();
  });
});
