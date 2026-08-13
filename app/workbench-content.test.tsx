import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VocMetrics } from "../src/features/voc/metrics";
import type { WorkbenchData, WorkbenchTicket } from "../src/features/workbench/data";
import {
  applyWorkbenchQuery,
  parseWorkbenchQuery,
} from "../src/features/workbench/query";
import {
  deviceProfiles,
  repeatOnly,
  userProfiles,
} from "../src/features/workbench/profiles";
import { WorkbenchConsole } from "./workbench-console";

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
    hasWarRoom: false,
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

// Renders the console directly, assembling its props with the same reference
// functions the server component uses. These assertions always described the
// console's rendering, not the fetching around it — WorkbenchContent was only ever
// a convenient fixture builder, and now that it awaits SQL it cannot be one.
// applyWorkbenchQuery stays in the loop here on purpose: it is where the triage
// semantics are defined, and scripts/equiv holds the SQL implementation to it.
function renderWorkbench(
  overrides: Partial<{
    tickets: readonly WorkbenchTicket[];
    metrics: WorkbenchData["metrics"];
    searchParams: Record<string, string | string[] | undefined>;
  }> = {},
) {
  const tickets = overrides.tickets ?? [ticket()];
  const query = parseWorkbenchQuery(overrides.searchParams ?? {});
  const users = userProfiles(tickets);
  const devices = deviceProfiles(tickets);
  const metrics = overrides.metrics ?? { status: "ok", metrics: emptyMetrics() };
  const selectedProfile =
    query.userRef !== null
      ? (users.find((profile) => profile.id === query.userRef) ?? null)
      : query.deviceRef !== null
        ? (devices.find((profile) => profile.id === query.deviceRef) ?? null)
        : null;

  const distinct = (values: readonly string[]) =>
    [...new Set(values.filter((value) => value.length > 0))].sort((a, b) =>
      a.localeCompare(b, "zh-Hans-CN"),
    );

  return render(
    <WorkbenchConsole
      user={{ openId: "ou_viewer", name: "张禹健" }}
      metrics={metrics.status === "ok" ? metrics.metrics : null}
      view={applyWorkbenchQuery(tickets, query, NOW)}
      query={query}
      now={NOW}
      options={{
        channel: distinct(tickets.map((t) => t.channel)),
        category: distinct(tickets.map((t) => t.category)),
        polarity: distinct(tickets.map((t) => t.polarity ?? "")),
        dimension: distinct(tickets.flatMap((t) => t.dimensions)),
        severity: distinct(tickets.map((t) => t.severity ?? "")),
        state: distinct(tickets.map((t) => t.state)),
        owner: distinct(tickets.flatMap((t) => t.ownerNames)),
        unit: distinct(tickets.map((t) => t.businessUnit)),
        level1: distinct(tickets.map((t) => t.categoryLevel1)),
      }}
      users={repeatOnly(users)}
      devices={repeatOnly(devices)}
      userTotal={users.length}
      deviceTotal={devices.length}
      selectedProfile={selectedProfile}
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
  it("links the record to the independent detail route", () => {
    renderWorkbench({
      tickets: [ticket({ recordNumber: "R # 001", severity: "高" })],
      searchParams: { queue: "all", severity: "高" },
    });

    const link = screen.getByRole("link", { name: "# 001" });
    expect(link).toHaveAttribute("title", "R # 001");
    expect(link).toHaveAttribute(
      "href",
      "/workbench/tickets/R%20%23%20001?queue=all&severity=%E9%AB%98&sort=feedback_desc",
    );
  });

  it("opens that route from the whole row", () => {
    renderWorkbench({
      tickets: [ticket({ recordNumber: "R-001" })],
      searchParams: { queue: "all", sort: "severity_desc" },
    });

    fireEvent.click(screen.getByRole("link", { name: "R-001" }).closest("tr")!);

    expect(push).toHaveBeenCalledWith(
      "/workbench/tickets/R-001?queue=all&sort=severity_desc",
    );
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

  it("ignores old ticket state and renders no drawer", () => {
    const { container } = renderWorkbench({
      tickets: [ticket({ recordNumber: "R-777" })],
      searchParams: { queue: "all", ticket: "R-777" },
    });

    expect(container.querySelector(".arco-drawer")).toBeNull();
    expect(screen.queryByText(/工单详情 ·/)).not.toBeInTheDocument();
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

  // Query evaluation stays on the server, and now stays in SQL: the ticket list is
  // one page plus five counts rather than 3628 rows filtered in memory, which is
  // what made a cold load cost 6–7 seconds. If this file became a client component
  // the whole table would ship to the browser on every load.
  it("keeps query evaluation on the server, in SQL", () => {
    expect(source).not.toContain("use client");
    expect(source).toContain("readWorkbenchPage");
    // The full-set read is still reachable for the profile and overview sections,
    // but it must not be what the ticket list depends on.
    expect(source).toContain("needsFullSet");
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

  it("keeps drawer state and actions out of the list console", () => {
    expect(console).not.toContain("Drawer");
    expect(console).not.toContain("TicketDrawer");
    expect(console).not.toContain("const selected =");
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


