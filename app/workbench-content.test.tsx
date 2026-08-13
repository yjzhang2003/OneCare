import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VocMetrics } from "../src/features/voc/metrics";
import type { WorkbenchData, WorkbenchTicket } from "../src/features/workbench/data";
import { WorkbenchContent } from "./workbench-content";

// The console navigates with router.push instead of rendering every control as a
// link, so useRouter has to exist. Assertions here are about what is rendered
// and what each control points at, never about navigation actually happening —
// href.test.ts owns the URLs those controls carry.
const push = vi.fn();

vi.mock("next/navigation", () => ({
  // prefetch is part of the surface the console uses: it warms all five queue
  // routes on mount. A mock missing it fails every test in this file with
  // "router.prefetch is not a function".
  useRouter: () => ({ push, refresh: () => {}, prefetch: () => {} }),
}));

beforeEach(() => {
  push.mockClear();
});

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
    sourceTicketNo: "CAS-42567239-Q7Q8Q",
    userRef: "U-3878645B",
    deviceRef: "D-91C2A70E",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
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

  // The row is the affordance now. A dedicated action column read as bolted on,
  // so what has to keep working is that clicking anywhere on a row opens it, and
  // that the record number is still a real link — otherwise the row is
  // unreachable by keyboard and its URL is not copyable.
  it("makes the record number a link to that ticket", () => {
    renderWorkbench({
      tickets: [ticket({ state: "待跟进" })],
      searchParams: { queue: "all" },
    });

    const link = screen.getByRole("link", { name: "R-001" });
    expect(link).toHaveAttribute("href", expect.stringContaining("ticket=R-001"));
  });

  it("opens the ticket when the row itself is clicked", () => {
    renderWorkbench({
      tickets: [ticket({ state: "待跟进" })],
      searchParams: { queue: "all" },
    });

    fireEvent.click(screen.getByRole("link", { name: "R-001" }).closest("tr")!);

    expect(push).toHaveBeenCalledWith(expect.stringContaining("ticket=R-001"));
  });

  // Nothing on the table may name an action any more, so the operator is never
  // shown a control whose only outcome would be a refusal.
  it("names no action in the table itself", () => {
    renderWorkbench({
      tickets: [ticket({ state: "待跟进", hasOwner: false, ownerNames: [] })],
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

// Arco renders no markdown, so a literal ** in a string shows up on screen as
// asterisks — which it did, in two places, until a screenshot caught it. This
// also catches the broader habit those strings came from: explaining the
// implementation's reasoning to whoever is using the product.
describe("console copy", () => {
  const source = readFileSync(
    resolve(process.cwd(), "app/workbench-console.tsx"),
    "utf8",
  );
  const rendered = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));

  it("never emits literal markdown emphasis", () => {
    expect(rendered.filter((line) => line.includes("**"))).toEqual([]);
  });

  it("does not explain its own implementation to the operator", () => {
    for (const leak of ["不渲染", "以免把", "免把读取"]) {
      expect(rendered.filter((line) => line.includes(leak))).toEqual([]);
    }
  });
});

// The three top-level destinations now live in the sider rather than in content
// tabs, and which one is showing comes from the URL.
describe("sections", () => {
  const rows = [
    ticket({ recordNumber: "R-1", userRef: "U-A", deviceRef: "D-A" }),
    ticket({ recordNumber: "R-2", userRef: "U-A", deviceRef: "D-A" }),
  ];

  it("shows the ticket table by default", () => {
    renderWorkbench({ tickets: rows, searchParams: { queue: "all" } });
    expect(screen.getByRole("columnheader", { name: /记录编号/ })).toBeInTheDocument();
  });

  it("shows the user profile table for section=users", () => {
    renderWorkbench({ tickets: rows, searchParams: { section: "users" } });
    expect(screen.getByRole("columnheader", { name: /用户标识/ })).toBeInTheDocument();
    expect(screen.getByText("U-A")).toBeInTheDocument();
  });

  it("shows the device table for section=devices", () => {
    renderWorkbench({ tickets: rows, searchParams: { section: "devices" } });
    expect(screen.getByRole("columnheader", { name: /设备标识/ })).toBeInTheDocument();
    expect(screen.getByText("D-A")).toBeInTheDocument();
  });

});

describe("profile subset disclosure", () => {
  // The lists show only the repeat profiles, which would otherwise read as "these
  // are all of them". Stated as a ratio rather than a sentence: the explanatory
  // paragraph this replaces was one of several that turned the console into a
  // commentary on its own implementation.
  it("shows how many of the total are listed", () => {
    renderWorkbench({
      tickets: [
        ticket({ recordNumber: "R-1", userRef: "U-A" }),
        ticket({ recordNumber: "R-2", userRef: "U-A" }),
        ticket({ recordNumber: "R-3", userRef: "U-B" }),
      ],
      searchParams: { section: "users" },
    });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });
});

describe("console copy discipline", () => {
  const source = readFileSync(
    resolve(process.cwd(), "app/workbench-console.tsx"),
    "utf8",
  );

  // The previous version of this guard enumerated three offending substrings, so it
  // caught those three and nothing else — and prose kept accumulating until a
  // screenshot showed a paragraph of design rationale sitting in the product.
  //
  // This checks the shape instead of the words: any long CJK string literal in
  // rendered code is prose, because real data reaches the screen as an expression
  // ({ticket.content}), never as a literal. Comments are exempt — that is where
  // reasoning belongs.
  it("contains no long prose literals", () => {
    const offenders: string[] = [];
    for (const line of source.split("\n")) {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) {
        continue;
      }
      for (const [, literal] of line.matchAll(/"([^"]{2,})"|`([^`]{2,})`/g)) {
        const text = literal ?? "";
        const cjk = (text.match(/[一-龥]/g) ?? []).length;
        if (cjk > 40) offenders.push(text.slice(0, 50));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("identity detail pages", () => {
  const rows = [
    ticket({ recordNumber: "R-1", userRef: "U-A", deviceRef: "D-A", state: "待跟进" }),
    ticket({ recordNumber: "R-2", userRef: "U-A", deviceRef: "D-A", state: "已闭环" }),
    ticket({ recordNumber: "R-3", userRef: "U-B", deviceRef: "D-B" }),
  ];

  it("opens a user's own page rather than the ticket list", () => {
    renderWorkbench({ tickets: rows, searchParams: { section: "users", user: "U-A", queue: "all" } });

    // Its aggregates, not the profile list: the list's header is gone.
    expect(screen.queryByRole("columnheader", { name: /用户标识/ })).not.toBeInTheDocument();
    expect(screen.getByText("U-A")).toBeInTheDocument();
    expect(screen.getByText("2 条反馈")).toBeInTheDocument();
    expect(screen.getByText("1 条未闭环")).toBeInTheDocument();
  });

  it("lists only that identity's records", () => {
    renderWorkbench({ tickets: rows, searchParams: { section: "users", user: "U-A", queue: "all" } });

    expect(screen.getByText("R-1")).toBeInTheDocument();
    expect(screen.getByText("R-2")).toBeInTheDocument();
    expect(screen.queryByText("R-3")).not.toBeInTheDocument();
  });

  it("opens a device's own page", () => {
    renderWorkbench({ tickets: rows, searchParams: { section: "devices", device: "D-A", queue: "all" } });
    expect(screen.getByText("D-A")).toBeInTheDocument();
    expect(screen.getByText("2 条反馈")).toBeInTheDocument();
  });

  // An id that matches nothing must say so rather than render an empty page that
  // looks like a profile with no history.
  it("reports an identity it cannot find", () => {
    renderWorkbench({ tickets: rows, searchParams: { section: "users", user: "U-NOPE", queue: "all" } });
    expect(screen.getByText(/找不到 U-NOPE/)).toBeInTheDocument();
  });

  it("offers a way back to the list", () => {
    renderWorkbench({ tickets: rows, searchParams: { section: "users", user: "U-A", queue: "all" } });
    const back = screen.getByRole("link", { name: /返回列表/ });
    expect(back).toHaveAttribute("href", expect.not.stringContaining("user="));
  });
});
