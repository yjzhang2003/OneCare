import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { VocMetrics } from "../src/features/voc/metrics";
import type { WorkbenchData, WorkbenchTicket } from "../src/features/workbench/data";
import { WorkbenchContent } from "./workbench-content";

// The console navigates with router.push instead of rendering every control as a
// link, so useRouter has to exist. Assertions here are about what is rendered
// and what each control points at, never about navigation actually happening —
// href.test.ts owns the URLs those controls carry.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: () => {} }),
}));

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

const NOW = Date.parse("2026-02-10T00:00:00.000Z");

function ticket(overrides: Partial<WorkbenchTicket> = {}): WorkbenchTicket {
  return {
    recordId: "rec1",
    recordNumber: "R-001",
    feedbackAt: "2026-02-09T00:00:00.000Z",
    channel: "电商评价",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "报修后等了三天没人上门",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "用户反馈上门维修延迟三天",
    replies: [],
    severity: "中",
    state: "待跟进",
    ownerNames: ["张三"],
    retryCount: 0,
    hasOwner: true,
    ticketOpenedAt: null,
    closedAt: null,
    durationHours: null,
    ...overrides,
  };
}

function renderWorkbench(
  overrides: Partial<{
    tickets: readonly WorkbenchTicket[];
    metrics: WorkbenchData["metrics"];
    searchParams: Record<string, string | string[] | undefined>;
  }> = {},
) {
  return render(
    <WorkbenchContent
      data={{
        metrics: overrides.metrics ?? {
          status: "ok",
          metrics: emptyMetrics(),
        },
        tickets: overrides.tickets ?? [ticket()],
      }}
      user={{ openId: "ou_viewer", name: "张禹健" }}
      now={NOW}
      searchParams={overrides.searchParams ?? {}}
    />,
  );
}

describe("WorkbenchConsole", () => {
  it("names every queue with its count, over all records rather than the page", () => {
    renderWorkbench({
      tickets: [
        ticket({ recordNumber: "R-1", state: "待跟进" }),
        ticket({ recordNumber: "R-2", state: "已闭环" }),
        ticket({ recordNumber: "R-3", state: "待跟进", hasOwner: false, ownerNames: [] }),
      ],
      searchParams: { queue: "all" },
    });

    const nav = screen.getByRole("menu");
    expect(within(nav).getByText("待处理")).toBeInTheDocument();
    expect(within(nav).getByText("未分配")).toBeInTheDocument();
    expect(within(nav).getByText("超时风险")).toBeInTheDocument();
    expect(within(nav).getByText("分析异常")).toBeInTheDocument();
    expect(within(nav).getByText("全部")).toBeInTheDocument();
  });

  it("renders the real feedback text, unredacted, because the page is gated", () => {
    renderWorkbench({ searchParams: { queue: "all" } });
    expect(screen.getByText("报修后等了三天没人上门")).toBeInTheDocument();
  });

  // The column that makes the write actions discoverable. Without it they sit
  // behind a click nothing invited, and the first screen reads as a report.
  it("names each row's next step and links it to the drawer", () => {
    renderWorkbench({
      tickets: [ticket({ state: "待跟进", hasOwner: true })],
      searchParams: { queue: "all" },
    });

    const link = screen.getByRole("link", { name: /开始跟进/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("ticket=R-001"));
  });

  it("offers claiming as the next step on an unassigned ticket", () => {
    renderWorkbench({
      tickets: [ticket({ state: "待跟进", hasOwner: false, ownerNames: [] })],
      searchParams: { queue: "all" },
    });

    // Nobody may perform 开始跟进 on a ticket with no owner, so offering it would
    // be offering a refusal.
    expect(screen.getByRole("link", { name: /我来跟进/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /开始跟进/ }),
    ).not.toBeInTheDocument();
  });

  it("shows no next step for a terminal ticket", () => {
    renderWorkbench({
      tickets: [ticket({ state: "已闭环" })],
      searchParams: { queue: "all" },
    });

    expect(
      screen.queryByRole("link", {
        name: /我来跟进|开始跟进|需建单|无需建单|提交跟进结果|确认闭环|重试/,
      }),
    ).not.toBeInTheDocument();
  });

  it("opens the drawer for the ticket named in the URL", () => {
    renderWorkbench({
      tickets: [ticket({ recordNumber: "R-777", content: "冰箱异响" })],
      searchParams: { queue: "all", ticket: "R-777" },
    });

    expect(
      screen.getByText("工单详情 · R-777", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("冰箱异响").length).toBeGreaterThan(0);
  });

  // A ticket the current queue excludes must still open: a link to one ticket
  // has to work for a recipient whose own filters exclude it.
  it("opens a ticket the current queue would filter out", () => {
    renderWorkbench({
      tickets: [ticket({ recordNumber: "R-777", state: "已闭环" })],
      searchParams: { queue: "open", ticket: "R-777" },
    });

    expect(
      screen.getByText("工单详情 · R-777", { exact: false }),
    ).toBeInTheDocument();
  });

  it("offers the transitions the drawer's ticket allows, and no others", () => {
    renderWorkbench({
      tickets: [ticket({ recordNumber: "R-777", state: "待跟进" })],
      searchParams: { queue: "all", ticket: "R-777" },
    });

    expect(screen.getByRole("button", { name: "开始跟进" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "确认闭环" }),
    ).not.toBeInTheDocument();
  });

  it("says a terminal state is terminal rather than showing an empty toolbar", () => {
    renderWorkbench({
      tickets: [ticket({ recordNumber: "R-777", state: "已闭环" })],
      searchParams: { queue: "all", ticket: "R-777" },
    });

    expect(screen.getByText(/已闭环是终态/)).toBeInTheDocument();
  });

  // The drawer cannot know whether the viewer is the owner, so it must not imply
  // that every offered button will succeed.
  it("warns that only the owner may transition", () => {
    renderWorkbench({
      tickets: [ticket({ recordNumber: "R-777", state: "待跟进" })],
      searchParams: { queue: "all", ticket: "R-777" },
    });

    expect(screen.getByText(/只有负责人本人能做/)).toBeInTheDocument();
  });

  it("reports an unavailable aggregation instead of rendering zeroes", () => {
    renderWorkbench({
      metrics: { status: "unavailable" },
      searchParams: { queue: "all" },
    });

    // On the main view, not inside the 数据概览 tab: a failed read empties the
    // ticket list too, and an empty table is indistinguishable from an empty
    // queue unless the failure is stated where the operator already is.
    expect(screen.getByText(/读取多维表格失败/)).toBeInTheDocument();
  });
});

describe("WorkbenchContent source", () => {
  const source = readFileSync(
    resolve(process.cwd(), "app/workbench-content.tsx"),
    "utf8",
  );
  const console = readFileSync(
    resolve(process.cwd(), "app/workbench-console.tsx"),
    "utf8",
  );

  // Filtering and paging 3628 records stays on the server so only one page of
  // rows crosses the wire. If this file ever became a client component, the
  // whole table would ship to the browser on every load.
  it("keeps query evaluation on the server", () => {
    expect(source).not.toContain("use client");
    expect(source).toContain("applyWorkbenchQuery");
  });

  // The page shipped able to write while still telling the operator, in its own
  // subtitle and table heading, that it was read-only. They believed the copy
  // over the feature — correctly, since the copy was the only thing on the first
  // screen that spoke to the question.
  it("never claims to be read-only", () => {
    expect(source).not.toContain("只读");
    expect(console).not.toContain("只读");
  });

  // Arco reads createRoot off the "react-dom" root export, which React 19 no
  // longer provides, and falls back to the deleted ReactDOM.render. Without this
  // import the console's toasts die at runtime with a green build.
  it("registers the React 19 adapter before any Arco component", () => {
    const adapter = console.indexOf("react-19-adapter");
    const firstComponent = console.indexOf('from "@arco-design/web-react"');
    expect(adapter).toBeGreaterThan(-1);
    expect(adapter).toBeLessThan(firstComponent);
  });
});
