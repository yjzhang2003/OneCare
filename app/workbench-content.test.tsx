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
  type IdentityProfile,
  type ProfilePage,
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
    engineerNames: [],
    dispatchedAt: null,
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

function profilePage(
  profiles: readonly IdentityProfile[],
  total: number,
): ProfilePage {
  return { profiles, matched: profiles.length, total, page: 1, pageCount: 1 };
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
      // The reference aggregation stands in for the SQL one, the same way
      // applyWorkbenchQuery stands in for the ticket page query. These fixtures are
      // small enough to be one page, so paging is not exercised here — the SQL's own
      // paging and filtering are held to profiles.ts by scripts/equiv.
      users={profilePage(repeatOnly(users), users.length)}
      devices={profilePage(repeatOnly(devices), devices.length)}
      // What the server reads for the sider on every section, which is why they are
      // props rather than derived from the two lists above: those are empty unless
      // their own section is the one being rendered.
      userCount={repeatOnly(users).length}
      deviceCount={repeatOnly(devices).length}
      owners={{ rules: [], members: [], unavailable: false }}
      selectedProfile={selectedProfile}
    />,
  );
}

describe("WorkbenchConsole", () => {
  // The sider moved into its own component so the ticket page could render the same
  // one. Arco detects a sider by looking for Layout.Sider among its *direct* children,
  // so a wrapper defeats it and the whole console lays out as a column: sider on top,
  // content at zero height. hasSider is what prevents that, and this is the assertion
  // that notices it going away.
  it("lays the shell out as a row despite the sider being a wrapper component", () => {
    const { container } = renderWorkbench();
    expect(container.querySelector(".oc-console")).toHaveClass(
      "arco-layout-has-sider",
    );
  });

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

  // The list answers "who has this" for both roles, so a dispatched ticket does not
  // look identical to one nobody has been sent to.
  it("names the 客服 owner and the engineer in the same column", () => {
    renderWorkbench({
      tickets: [ticket({ ownerNames: ["黄齐"], engineerNames: ["张睿哲"] })],
      searchParams: { queue: "all" },
    });
    expect(screen.getByText("客服 黄齐")).toBeInTheDocument();
    expect(screen.getByText("工程师 张睿哲")).toBeInTheDocument();
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

  // Reported inside 数据概览 and nowhere else. It used to appear on the main view on
  // the reasoning that a failed read emptied the ticket list too — true when both came
  // from one full-table read, and false once each section fetched its own data. The
  // banner then rendered on every section that simply had no metrics to fetch, which
  // is what put a permanent "读取失败" across the whole console.
  it("reports an unavailable aggregation inside the overview", () => {
    renderWorkbench({
      metrics: { status: "unavailable" },
      searchParams: { section: "metrics" },
    });

    expect(screen.getByText(/指标暂时读不出来/)).toBeInTheDocument();
  });

  it("says nothing about metrics on the sections that do not fetch them", () => {
    renderWorkbench({
      metrics: { status: "unavailable" },
      searchParams: { queue: "all" },
    });

    expect(screen.queryByText(/读不出来/)).not.toBeInTheDocument();
    expect(screen.queryByText(/失败/)).not.toBeInTheDocument();
  });

  // The profile lists had a table and nothing else: no way to narrow 600 users, and no
  // way to find one. They now carry the ticket list's own controls, because a profile
  // is an aggregation of records and every filterable field belongs to a record.
  it.each([
    ["users", "搜用户标识 / 原文 / 机型"],
    ["devices", "搜设备标识 / 原文 / 机型"],
  ] as const)("gives the %s list the same nine filters and a search", (section, placeholder) => {
    const { container } = renderWorkbench({ searchParams: { section } });

    const content = container.querySelector<HTMLElement>(".oc-console__content")!;
    expect(content.querySelectorAll(".arco-select")).toHaveLength(9);
    expect(
      within(content).getByPlaceholderText(placeholder),
    ).toBeInTheDocument();
    // Paged by the server like the ticket list, so a filter narrows the whole set
    // rather than whichever rows the browser happened to be given.
    expect(content.querySelector(".oc-console__pager")).not.toBeNull();
  });

  it("filters the profile list through the URL, not in the browser", () => {
    renderWorkbench({ searchParams: { section: "users" } });

    const input = screen.getByPlaceholderText("搜用户标识 / 原文 / 机型");
    fireEvent.change(input, { target: { value: "U-10774311" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("search=U-10774311"),
    );
    expect(push).toHaveBeenCalledWith(expect.stringContaining("section=users"));
  });

  // The bug this catches was reported from a screenshot: the sider counted 待处理 11
  // and the list showed 0 条. Clicking a sider destination while a user was open kept
  // `user` in the URL, so the ticket list was silently scoped to that identity — and
  // unlike the nine filters, an identity filter is invisible there, so the two numbers
  // just disagreed with no explanation. The same carry made 用户画像 a no-op: it
  // rebuilt the detail page already on screen instead of returning to the list.
  it.each([
    ["open", "待处理"],
    ["all", "全部"],
  ] as const)("drops an open identity when the sider goes to %s", (_queue, label) => {
    renderWorkbench({
      searchParams: { section: "users", user: "U-3878645B", queue: "all" },
    });

    within(screen.getByRole("menu")).getByText(label).click();

    expect(push).toHaveBeenCalledTimes(1);
    const href = push.mock.calls[0]![0] as string;
    expect(href).not.toContain("user=");
    expect(href).toContain("section=");
  });

  it("returns to the profile list rather than rebuilding the open profile", () => {
    renderWorkbench({
      searchParams: { section: "users", user: "U-3878645B", queue: "all" },
    });

    within(screen.getByRole("menu")).getByText("用户画像").click();

    const href = push.mock.calls[0]![0] as string;
    expect(href).not.toContain("user=");
    expect(href).toContain("section=users");
  });

  // The filters themselves are view state and do survive: they are visible, the
  // operator set them, and the profile lists now use the same nine.
  it("keeps the visible filters across a section switch", () => {
    renderWorkbench({
      searchParams: { section: "users", severity: "中", search: "噪音" },
    });

    within(screen.getByRole("menu")).getByText("全部").click();

    const href = push.mock.calls[0]![0] as string;
    expect(href).toContain("severity=");
    expect(href).toContain("search=");
  });

  // A profile detail page is one identity's records. Offering nine filters there would
  // invite narrowing a set of three rows, and the options behind them are not even
  // fetched for that page.
  it("leaves the filters off a profile detail page", () => {
    const { container } = renderWorkbench({
      searchParams: { section: "users", user: "U-3878645B", queue: "all" },
    });

    const content = container.querySelector<HTMLElement>(".oc-console__content")!;
    expect(content.querySelectorAll(".arco-select")).toHaveLength(0);
    expect(
      within(content).queryByPlaceholderText(/搜用户标识/),
    ).not.toBeInTheDocument();
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
    // No section pulls the whole table any more — the ticket list is a page query,
    // profiles are a GROUP BY and the overview is an aggregate. A reintroduced
    // readWorkbenchCached here would silently restore a 6–7 second read.
    expect(source).not.toContain("readWorkbenchCached");
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
    const adapter = console.indexOf("arco-runtime");
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


