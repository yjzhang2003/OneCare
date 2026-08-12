import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The detail panel's action island calls useRouter, which throws outside a
// mounted App Router ("invariant expected app router to be mounted"). Only
// refresh() is used, and only after a write returns — this file asserts which
// buttons render, never what clicking them does, so a stub is the whole need.
// Before the island existed this file needed no mock at all, which is why the
// gap only appeared once a non-terminal ticket was rendered.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import type { VocMetrics } from "../src/features/voc/metrics";
import type { WorkbenchData, WorkbenchTicket } from "../src/features/workbench/data";
import { ASSUMED_SLA_HOURS } from "../src/features/workbench/query";
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
  recordId: "rec1",
  retryCount: 0,
  hasOwner: true,
  recordNumber: "R-001",
  feedbackAt: "2026-01-23T02:00:00.000Z",
  channel: "电商评价",
  category: "冰箱",
  model: "BCD-525WNK1PU",
  content: "报修后等了三天没人上门",
  polarity: "差评",
  dimensions: ["维修时间"],
  summary: "",
  replies: [],
  severity: "中",
  state: "待跟进",
  ownerNames: ["张三"],
  ticketOpenedAt: "2026-01-23T02:00:00.000Z",
  closedAt: null,
  durationHours: null,
};

const user = { openId: "ou_a", name: "张三" };

// A fixed instant rather than Date.now(): dwell time and the overdue marker
// are computed from it, and a component that is a pure function of its props
// (including `now`) is the whole point of passing `now` in from the page
// instead of reading the wall clock inside the component (see the comment on
// WorkbenchContentProps in workbench-content.tsx).
const NOW = Date.parse("2026-02-10T00:00:00.000Z");
const HOUR = 3_600_000;

type RenderOverrides = Partial<{
  data: WorkbenchData;
  now: number;
  searchParams: Record<string, string | string[] | undefined>;
}>;

function renderWorkbench(overrides: RenderOverrides = {}) {
  const data =
    overrides.data ??
    ({ metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [ticket] } as WorkbenchData);

  return render(
    <WorkbenchContent
      data={data}
      user={user}
      now={overrides.now ?? NOW}
      searchParams={overrides.searchParams ?? {}}
    />,
  );
}

function hrefParams(el: HTMLElement): URLSearchParams {
  const href = el.getAttribute("href") ?? "";
  const [, qs = ""] = href.split("?");
  return new URLSearchParams(qs);
}

describe("WorkbenchContent", () => {
  it("renders the ticket's real content and owner", () => {
    renderWorkbench();

    expect(screen.getByText("报修后等了三天没人上门")).toBeInTheDocument();
    // getAllByText rather than getByText: "张三" now also appears as the
    // "负责人" filter pill, which is a legitimate second occurrence, not a
    // rendering bug.
    expect(screen.getAllByText("张三").length).toBeGreaterThanOrEqual(1);
    // Likewise ambiguous now: "待跟进" is both the ticket's state cell and a
    // "流程状态" filter pill.
    expect(screen.getAllByText("待跟进").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the unavailable state without any zero placeholders", () => {
    renderWorkbench({ data: { metrics: { status: "unavailable" }, tickets: [] } });

    expect(screen.getByText(/指标暂不可用/)).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("says so plainly when there are no tickets", () => {
    renderWorkbench({
      data: { metrics: { status: "ok", metrics: emptyMetrics() }, tickets: [] },
    });

    expect(screen.getByText(/暂无工单/)).toBeInTheDocument();
  });

  it("offers no control that changes state — the loop runs in Feishu", () => {
    renderWorkbench();

    expect(screen.queryByRole("button", { name: /跟进|闭环|提交/ })).toBeNull();
  });

  it("renders no button at all, not merely none matching those words", () => {
    renderWorkbench();

    // The brief's assertion above only rules out three specific labels. The
    // property the design actually depends on is stronger: the web surface has
    // no write control of any kind, because the card path owns writes and the
    // two identity sources must not both drive one state machine. The search
    // box added for triage (task 15) is a GET form with a single field and no
    // submit button — it relies on the browser's native "Enter submits a
    // lone text field" behaviour instead, which is exactly why it does not
    // show up here. `type="search"` also has its own ARIA role
    // ("searchbox"), not "textbox", so it does not trip the second assertion
    // either.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("formats times at a fixed +08:00 rather than the host time zone", () => {
    renderWorkbench();

    // 02:00Z is 10:00 in China. Asserting the shifted value pins the offset:
    // a formatter that read the runner's time zone would print something else
    // here on a machine set to anything but UTC+8.
    expect(screen.getAllByText("2026-01-23 10:00").length).toBeGreaterThan(0);
  });

  it("marks an absent time or owner as unfilled instead of inventing a value", () => {
    renderWorkbench({
      data: {
        metrics: { status: "ok", metrics: emptyMetrics() },
        tickets: [
          { ...ticket, feedbackAt: null, closedAt: null, ownerNames: [], severity: null },
        ],
      },
    });

    // A blank cell reads as "nothing happened", and a dash reads as data.
    // Neither is true of a field the Base simply has not filled in yet.
    expect(screen.getAllByText("未填写").length).toBeGreaterThanOrEqual(4);
  });

  it("paints its own surface instead of inheriting the site's dark ground", () => {
    const { container } = renderWorkbench();

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
    renderWorkbench();

    expect(screen.getByRole("link", { name: /方案展示厅/ })).toHaveAttribute(
      "href",
      "/?view=showcase",
    );
  });

  it("tallies process states from the full Base, not from the current queue or page", () => {
    renderWorkbench({
      data: {
        metrics: { status: "ok", metrics: emptyMetrics() },
        tickets: [
          ticket,
          { ...ticket, recordNumber: "R-002", state: "已闭环" },
          { ...ticket, recordNumber: "R-003", state: "待跟进" },
        ],
      },
    });

    expect(screen.getByText(/待跟进 2、已闭环 1/)).toBeInTheDocument();
    expect(screen.getByText(/Base 全量 3 条/)).toBeInTheDocument();
  });

  it("drops the channel/category separator when the category is blank", () => {
    renderWorkbench({
      data: {
        metrics: { status: "ok", metrics: emptyMetrics() },
        tickets: [{ ...ticket, category: "" }],
      },
    });

    // The source file mixes product lines with org units in one column, so a
    // record from 集团 or 中国区 has no product category at all. Rendering
    // "电商评价 / " with nothing after it reads as a bug in the page.
    // getAllByText rather than getByText: "电商评价" now also appears as the
    // "渠道" filter pill, a legitimate second occurrence.
    expect(screen.getAllByText("电商评价").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("电商评价 /")).not.toBeInTheDocument();
  });

  it("shows the true Base total and the real matched count now that the 200-row window is gone", () => {
    // LIST_LIMIT used to cap the table at 200 rows while the totals above it
    // still counted every record — the truncation lived only in what was
    // rendered. Pagination (PAGE_SIZE from query.ts) now does that job for
    // real: page one shows exactly PAGE_SIZE rows, and the total and matched
    // counts must still describe the whole 250-record set, not the page.
    const many = Array.from({ length: 250 }, (_, index) => ({
      ...ticket,
      recordNumber: `R-${index}`,
      state: index === 249 ? ("已闭环" as const) : ("待跟进" as const),
    }));

    renderWorkbench({
      data: { metrics: { status: "ok", metrics: emptyMetrics() }, tickets: many },
      searchParams: { queue: "all" },
    });

    expect(screen.getByText(/Base 全量 250 条/)).toBeInTheDocument();
    expect(screen.getByText(/当前筛选匹配 250 条/)).toBeInTheDocument();
    expect(
      screen.getByText(/全量 250 条）：待跟进 249、已闭环 1/),
    ).toBeInTheDocument();
    expect(screen.getByText(/第 1 \/ 5 页，共 250 条/)).toBeInTheDocument();
    expect(
      document.querySelectorAll(".workbench__tickets tbody tr"),
    ).toHaveLength(50);
  });

  it("renders all five queues as tabs, labelled with counts from queueCounts", () => {
    // Everything except F sits 24h before `now` — comfortably inside the 72h
    // assumed SLA — so only F is overdue. The shared `ticket` fixture's own
    // feedbackAt/ticketOpenedAt (2026-01-23) is over two weeks before `now`;
    // reusing it unmodified here would make every non-terminal row overdue
    // and defeat the point of this fixture.
    const recentAt = "2026-02-09T00:00:00.000Z";
    const rows: WorkbenchTicket[] = [
      { ...ticket, recordNumber: "A", state: "待跟进", feedbackAt: recentAt, ticketOpenedAt: recentAt },
      { ...ticket, recordNumber: "B", state: "已闭环", feedbackAt: recentAt, ticketOpenedAt: recentAt },
      { ...ticket, recordNumber: "C", state: "待分析", feedbackAt: recentAt, ticketOpenedAt: null },
      { ...ticket, recordNumber: "D", state: "分析失败", feedbackAt: recentAt, ticketOpenedAt: null },
      {
        ...ticket,
        recordNumber: "E",
        state: "跟进中",
        feedbackAt: recentAt,
        ticketOpenedAt: recentAt,
        ownerNames: [],
      },
      {
        ...ticket,
        recordNumber: "F",
        state: "待闭环",
        feedbackAt: recentAt,
        ticketOpenedAt: new Date(NOW - (ASSUMED_SLA_HOURS + 10) * HOUR).toISOString(),
      },
    ];

    renderWorkbench({
      data: { metrics: { status: "ok", metrics: emptyMetrics() }, tickets: rows },
      searchParams: { queue: "all" },
    });

    const expected: Record<string, number> = {
      待处理: 3,
      超时风险: 1,
      未分配: 1,
      分析异常: 1,
      全部: 6,
    };

    // Scoped to the queue nav rather than the whole page: every filter group
    // below also renders a "全部" clear-filter pill, and "queue" tab text is
    // otherwise ambiguous with those pills across the page.
    const queueNav = screen.getByRole("navigation", { name: "工单队列" });
    for (const [label, count] of Object.entries(expected)) {
      const tab = within(queueNav).getByRole("link", { name: new RegExp(label) });
      expect(tab.querySelector(".workbench__queue-count")).toHaveTextContent(
        String(count),
      );
    }

    expect(
      within(queueNav).getByRole("link", { name: /全部/ }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("queue tab links change only the queue, keeping the current search and filters", () => {
    renderWorkbench({ searchParams: { search: "报修", severity: "高" } });

    const overdueTab = screen.getByRole("link", { name: /超时风险/ });
    const params = hrefParams(overdueTab);

    expect(params.get("queue")).toBe("overdue");
    expect(params.get("search")).toBe("报修");
    expect(params.get("severity")).toBe("高");
  });

  it("derives channel, category and owner filter options from the tickets actually present", () => {
    const varied: WorkbenchTicket[] = [
      { ...ticket, recordNumber: "A", channel: "400 客服", category: "洗衣机", ownerNames: ["王五"] },
      { ...ticket, recordNumber: "B", channel: "社媒", category: "冰箱", ownerNames: ["赵六"] },
    ];

    renderWorkbench({
      data: { metrics: { status: "ok", metrics: emptyMetrics() }, tickets: varied },
      searchParams: { queue: "all" },
    });

    expect(screen.getByRole("link", { name: "400 客服" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "社媒" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "洗衣机" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "王五" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "赵六" })).toBeInTheDocument();
  });

  it("clicking a filter pill only ever changes that one filter, and resets to page one", () => {
    renderWorkbench({ searchParams: { queue: "all", search: "报修", page: "2" } });

    const link = screen.getByRole("link", { name: "高" });
    const params = hrefParams(link);

    expect(params.get("severity")).toBe("高");
    expect(params.get("queue")).toBe("all");
    expect(params.get("search")).toBe("报修");
    expect(params.has("page")).toBe(false);
  });

  it("submits the search as a GET form carrying the current queue and filters as hidden fields", () => {
    renderWorkbench({
      searchParams: { queue: "overdue", channel: "400 客服", severity: "高" },
    });

    const input = screen.getByLabelText(/搜索原始内容/);
    const form = input.closest("form");
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute("method", "get");

    const hiddenValue = (name: string): string | null =>
      form?.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)
        ?.value ?? null;

    expect(hiddenValue("queue")).toBe("overdue");
    expect(hiddenValue("channel")).toBe("400 客服");
    expect(hiddenValue("severity")).toBe("高");
    // Page and the open ticket are deliberately not carried forward: a new
    // search is a fresh look at the list, not a request to stay put.
    expect(hiddenValue("page")).toBeNull();
    expect(hiddenValue("ticket")).toBeNull();
  });

  it("shows no previous-page link on page one and no next-page link on the last page, as inert text instead of a dead link", () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...ticket,
      recordNumber: `R-${String(index).padStart(3, "0")}`,
    }));

    const { unmount } = renderWorkbench({
      data: { metrics: { status: "ok", metrics: emptyMetrics() }, tickets: many },
    });

    expect(screen.queryByRole("link", { name: "上一页" })).not.toBeInTheDocument();
    expect(screen.getByText("上一页")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下一页" })).toBeInTheDocument();
    expect(screen.getByText(/第 1 \/ 2 页，共 60 条/)).toBeInTheDocument();
    expect(
      document.querySelectorAll(".workbench__tickets tbody tr"),
    ).toHaveLength(50);
    unmount();

    renderWorkbench({
      data: { metrics: { status: "ok", metrics: emptyMetrics() }, tickets: many },
      searchParams: { page: "2" },
    });

    expect(screen.getByRole("link", { name: "上一页" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "下一页" })).not.toBeInTheDocument();
    expect(screen.getByText("下一页")).toBeInTheDocument();
    expect(screen.getByText(/第 2 \/ 2 页，共 60 条/)).toBeInTheDocument();
    expect(
      document.querySelectorAll(".workbench__tickets tbody tr"),
    ).toHaveLength(10);
  });

  it("flags an overdue ticket and never shows 0 for a ticket with no dwell time", () => {
    const overdueTicket: WorkbenchTicket = {
      ...ticket,
      recordNumber: "OVERDUE-1",
      ticketOpenedAt: new Date(NOW - (ASSUMED_SLA_HOURS + 5) * HOUR).toISOString(),
    };
    const closedTicket: WorkbenchTicket = {
      ...ticket,
      recordNumber: "CLOSED-1",
      state: "已闭环",
      closedAt: "2026-02-01T00:00:00.000Z",
    };

    renderWorkbench({
      data: {
        metrics: { status: "ok", metrics: emptyMetrics() },
        tickets: [overdueTicket, closedTicket],
      },
      searchParams: { queue: "all" },
    });

    expect(screen.getByText("超时")).toBeInTheDocument();

    const closedRow = screen
      .getAllByRole("row")
      .find((row) => within(row).queryByText("CLOSED-1"));
    expect(closedRow).toBeDefined();
    // durationHours and dwellHours are both null for a closed ticket, so this
    // row shows the unfilled marker at least once and never a literal 0.
    expect(
      within(closedRow!).getAllByText("未填写").length,
    ).toBeGreaterThanOrEqual(1);
    expect(within(closedRow!).queryByText(/0\.0 小时/)).not.toBeInTheDocument();
  });

  it("opens a ticket detail view with full content, AI summary and reply drafts, even when the current queue excludes it", () => {
    const detailTicket: WorkbenchTicket = {
      ...ticket,
      recordNumber: "R-777",
      state: "已闭环", // excluded from the default "open" queue
      closedAt: "2026-01-25T00:00:00.000Z",
      summary: "冰箱异响，用户要求上门检修",
      replies: [
        { tone: "安抚", text: "非常抱歉给您带来不便，我们会尽快安排上门。" },
        { tone: "解决方案", text: "已为您预约本周三上午的上门检修。" },
      ],
    };

    renderWorkbench({
      data: {
        metrics: { status: "ok", metrics: emptyMetrics() },
        tickets: [ticket, detailTicket],
      },
      searchParams: { queue: "open", ticket: "R-777" },
    });

    const heading = screen.getByRole("heading", { name: /工单详情.*R-777/ });
    const detail = heading.closest("section");
    expect(detail).not.toBeNull();

    expect(
      within(detail!).getByText("报修后等了三天没人上门"),
    ).toBeInTheDocument();
    expect(
      within(detail!).getByText("冰箱异响，用户要求上门检修"),
    ).toBeInTheDocument();
    expect(within(detail!).getByText(/【安抚】/)).toBeInTheDocument();
    expect(
      within(detail!).getByText("非常抱歉给您带来不便，我们会尽快安排上门。"),
    ).toBeInTheDocument();
    expect(within(detail!).getByText(/【解决方案】/)).toBeInTheDocument();

    // Excluded from the "open" queue's table (its state is terminal), but the
    // detail panel above the list still opened — exactly the property
    // applyWorkbenchQuery already guarantees for `selected`.
    expect(screen.queryByRole("link", { name: "R-777" })).not.toBeInTheDocument();

    const closeLink = within(detail!).getByRole("link", { name: /收起详情/ });
    const params = hrefParams(closeLink);
    expect(params.has("ticket")).toBe(false);
    expect(params.get("queue")).toBe("open");
  });

  function detailFor(overrides: Partial<WorkbenchTicket>) {
    const target: WorkbenchTicket = {
      ...ticket,
      recordNumber: "R-777",
      ...overrides,
    };
    renderWorkbench({
      data: {
        metrics: { status: "ok", metrics: emptyMetrics() },
        tickets: [target],
      },
      searchParams: { queue: "all", ticket: "R-777" },
    });
    return screen
      .getByRole("heading", { name: /工单详情.*R-777/ })
      .closest("section")!;
  }

  it("offers the transitions the current state allows", () => {
    const detail = detailFor({ state: "待跟进", hasOwner: true });

    expect(
      within(detail).getByRole("button", { name: "开始跟进" }),
    ).toBeInTheDocument();
    // 确认闭环 is legal from 待闭环 only. A button for it here would be a button
    // whose only outcome is an error.
    expect(
      within(detail).queryByRole("button", { name: "确认闭环" }),
    ).not.toBeInTheDocument();
  });

  it("offers a claim, and only a claim, on an unassigned ticket", () => {
    const detail = detailFor({ state: "已分析", hasOwner: false });

    expect(
      within(detail).getByRole("button", { name: "我来跟进" }),
    ).toBeInTheDocument();
    expect(
      within(detail).getByRole("button", { name: "无需建单" }),
    ).toBeInTheDocument();
    // 需建单 is guarded on having an owner: claim first, then it appears. Those
    // two clicks are the only way out of the 已分析 dead end.
    expect(
      within(detail).queryByRole("button", { name: "需建单" }),
    ).not.toBeInTheDocument();
  });

  it("hides the claim once a ticket has an owner", () => {
    const detail = detailFor({ state: "待跟进", hasOwner: true });
    expect(
      within(detail).queryByRole("button", { name: "我来跟进" }),
    ).not.toBeInTheDocument();
  });

  it("says a terminal state is terminal rather than showing an empty toolbar", () => {
    const detail = detailFor({ state: "已闭环", hasOwner: true });

    expect(within(detail).getByText(/已闭环是终态/)).toBeInTheDocument();
    expect(within(detail).queryAllByRole("button")).toHaveLength(0);
  });

  // The panel cannot know whether the viewer is the owner, so it must not imply
  // that every offered button will succeed.
  it("warns that only the owner may transition", () => {
    const detail = detailFor({ state: "待跟进", hasOwner: true });
    expect(
      within(detail).getByText(/只有负责人本人能做/),
    ).toBeInTheDocument();
  });
});

describe("WorkbenchContent source", () => {
  const source = readFileSync(
    resolve(process.cwd(), "app/workbench-content.tsx"),
    "utf8",
  );

  it("stays a server component with no client-side state", () => {
    expect(source).not.toContain("use client");
  });

  it("never hand-writes an internal <a> — every internal link goes through next/link", () => {
    expect(source).not.toMatch(/<a\s+href="\//);
  });
});
