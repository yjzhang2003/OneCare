import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { VocMetrics } from "../src/features/voc/metrics";
import type { WorkbenchTicket } from "../src/features/workbench/data";
import { WorkbenchContent } from "./workbench-content";

// A zeroed VocMetrics, spelled out field by field rather than cast, so adding a
// required field to VocMetrics breaks this file at typecheck instead of letting
// the workbench render an accidental undefined.
function emptyMetrics(): VocMetrics {
  return {
    total: 0,
    byPolarity: { 好评: 0, 中评: 0, 差评: 0 },
    dimensionTop: [],
    byChannel: [],
    negativeShare: 0,
    ticketsOpened: 0,
    ticketsClosed: 0,
    closureRate: 0,
    averageClosureHours: 0,
    taggingAttempted: 0,
    taggingSucceeded: 0,
    taggingFailed: 0,
    taggingPending: 0,
  };
}

const ticket: WorkbenchTicket = {
  recordNumber: "R-001",
  feedbackAt: "2026-01-23T02:00:00.000Z",
  channel: "电商评价",
  category: "冰箱",
  model: "BCD-525WNK1PU",
  content: "报修后等了三天没人上门",
  polarity: "差评",
  dimensions: ["维修时间"],
  severity: "中",
  state: "待跟进",
  ownerNames: ["张三"],
  ticketOpenedAt: "2026-01-23T02:00:00.000Z",
  closedAt: null,
  durationHours: null,
};

const user = { openId: "ou_a", name: "张三" };

// Mirrors LIST_LIMIT in workbench-content.tsx. Written out here rather than
// imported so that raising the cap has to be a deliberate two-file edit: the
// assertion below is about the page staying small, and a test that reads the
// constant it is checking would pass at any value.
const LIST_LIMIT_FOR_TEST = 200;

describe("WorkbenchContent", () => {
  it("renders the ticket's real content and owner", () => {
    render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [ticket] }}
        user={user}
      />,
    );

    expect(screen.getByText("报修后等了三天没人上门")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("待跟进")).toBeInTheDocument();
  });

  it("shows the unavailable state without any zero placeholders", () => {
    render(
      <WorkbenchContent data={{ metrics: { status: "unavailable" }, tickets: [] }} user={user} />,
    );

    expect(screen.getByText(/指标暂不可用/)).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("says so plainly when there are no tickets", () => {
    render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [] }}
        user={user}
      />,
    );

    expect(screen.getByText(/暂无工单/)).toBeInTheDocument();
  });

  it("offers no control that changes state — the loop runs in Feishu", () => {
    render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [ticket] }}
        user={user}
      />,
    );

    expect(screen.queryByRole("button", { name: /跟进|闭环|提交/ })).toBeNull();
  });

  it("renders no button at all, not merely none matching those words", () => {
    render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [ticket] }}
        user={user}
      />,
    );

    // The brief's assertion above only rules out three specific labels. The
    // property the design actually depends on is stronger: the web surface has
    // no write control of any kind, because the card path owns writes and the
    // two identity sources must not both drive one state machine.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("formats times at a fixed +08:00 rather than the host time zone", () => {
    render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [ticket] }}
        user={user}
      />,
    );

    // 02:00Z is 10:00 in China. Asserting the shifted value pins the offset:
    // a formatter that read the runner's time zone would print something else
    // here on a machine set to anything but UTC+8.
    expect(screen.getAllByText("2026-01-23 10:00").length).toBeGreaterThan(0);
  });

  it("marks an absent time or owner as unfilled instead of inventing a value", () => {
    render(
      <WorkbenchContent
        data={{
          metrics: { status: "ok", metrics: emptyMetrics() },
          tickets: [
            { ...ticket, feedbackAt: null, closedAt: null, ownerNames: [], severity: null },
          ],
        }}
        user={user}
      />,
    );

    // A blank cell reads as "nothing happened", and a dash reads as data.
    // Neither is true of a field the Base simply has not filled in yet. The
    // cells named here are exactly the ones the fixture left empty — asserting
    // "no 0 anywhere" would be wrong, since a genuinely zeroed metric above
    // must still print its 0.
    expect(screen.getAllByText("未填写").length).toBeGreaterThanOrEqual(4);
  });

  it("paints its own surface instead of inheriting the site's dark ground", () => {
    const { container } = render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [ticket] }}
        user={user}
      />,
    );

    // The first version of this component set a dark text colour and no
    // background, so it rendered dark-on-dark against the near-black body in
    // globals.css — every number present in the DOM and none of it legible.
    // jsdom computes no contrast, so no assertion about the rendered tree can
    // catch that. What can be checked is the invariant that produced it: a
    // surface must declare both its ground and its text, from the shared
    // palette rather than from literals that cannot know the theme.
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).toContain("background: var(--paper)");
    expect(css).toContain("color: var(--ink)");
    expect(container.querySelector("main")?.className).toContain(
      "dashboard-shell",
    );
  });

  it("keeps a corner route back to the showcase", () => {
    render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [ticket] }}
        user={user}
      />,
    );

    expect(screen.getByRole("link", { name: /方案展示厅/ })).toHaveAttribute(
      "href",
      "/?view=showcase",
    );
  });

  it("tallies process states from the very rows it renders", () => {
    render(
      <WorkbenchContent
        data={{
          metrics: { status: "ok", metrics: emptyMetrics() },
          tickets: [
            ticket,
            { ...ticket, recordNumber: "R-002", state: "已闭环" },
            { ...ticket, recordNumber: "R-003", state: "待跟进" },
          ],
        }}
        user={user}
      />,
    );

    // Counted from the rendered rows on purpose: VocMetrics has no per-state
    // breakdown, and a second pass over the records is how one page ends up
    // showing a tally that contradicts the list underneath it.
    expect(screen.getByText(/待跟进 2、已闭环 1/)).toBeInTheDocument();
    expect(screen.getByText(/共 3 条/)).toBeInTheDocument();
  });

  it("drops the channel/category separator when the category is blank", () => {
    render(
      <WorkbenchContent
        data={{
          metrics: { status: "ok", metrics: emptyMetrics() },
          tickets: [{ ...ticket, category: "" }],
        }}
        user={user}
      />,
    );

    // The source file mixes product lines with org units in one column, so a
    // record from 集团 or 中国区 has no product category at all. Rendering
    // "电商评价 / " with nothing after it reads as a bug in the page.
    expect(screen.getByText("电商评价")).toBeInTheDocument();
    expect(screen.queryByText("电商评价 /")).not.toBeInTheDocument();
  });

  it("windows a long list but keeps the counts over every record", () => {
    const many = Array.from({ length: 250 }, (_, index) => ({
      ...ticket,
      recordNumber: `R-${index}`,
      state: index === 249 ? ("已闭环" as const) : ("待跟进" as const),
    }));

    const { container } = render(
      <WorkbenchContent
        data={{ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: many }}
        user={user}
      />,
    );

    // The real dataset is 3628 records. The table is capped so the page does not
    // ship megabytes of HTML, but the totals must still describe everything —
    // a count that quietly shrank to the window size is a number that no longer
    // reconciles against the Base. The 250th row's state proves the tally read
    // past the window.
    //
    // Scoped to the ticket table rather than counting every row on the page: the
    // distribution panels have tables of their own, so a page-wide row count
    // would move whenever an unrelated panel gains a line.
    expect(
      container.querySelectorAll(".workbench__tickets tbody tr"),
    ).toHaveLength(LIST_LIMIT_FOR_TEST);
    expect(screen.getByText(/共 250 条/)).toBeInTheDocument();
    expect(screen.getByText(/最新的 200 条/)).toBeInTheDocument();
    expect(screen.getByText(/全部 250 条）：待跟进 249、已闭环 1/)).toBeInTheDocument();
  });
});
