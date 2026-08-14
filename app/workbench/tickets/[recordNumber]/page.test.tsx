import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkbenchTicket } from "../../../../src/features/workbench/data";

const {
  getCurrentSession,
  readTicketByNumber,
  readQueueCounts,
  readProfileCounts,
  refresh,
  push,
} = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  readTicketByNumber: vi.fn(),
  readQueueCounts: vi.fn(),
  readProfileCounts: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
  useRouter: () => ({ refresh, push, prefetch: vi.fn() }),
}));

vi.mock("../../../../src/features/auth/current-session", () => ({
  getCurrentSession,
}));

// The page reads one record by its number now, instead of pulling all 3628 and
// finding one of them. The seam moved; what these tests assert did not. The two count
// reads joined it when the ticket page grew a sider.
vi.mock("../../../../src/features/store/workbench-query", () => ({
  readTicketByNumber,
  readQueueCounts,
  readProfileCounts,
}));

import TicketDetailPage from "./page";

function ticket(overrides: Partial<WorkbenchTicket> = {}): WorkbenchTicket {
  return {
    recordId: "rec1",
    recordNumber: "VOC-001",
    feedbackAt: "2026-08-12T08:00:00.000Z",
    channel: "电商评价",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "报修后等了三天没人上门",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "用户反馈上门维修延迟三天",
    replies: [],
    severity: "高",
    state: "待跟进",
    ownerNames: ["张三"],
    retryCount: 0,
    hasOwner: true,
    hasWarRoom: false,
    sourceTicketNo: "CAS-1",
    userRef: "U-A",
    deviceRef: "D-A",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ticketOpenedAt: "2026-08-12T10:00:00.000Z",
    closedAt: null,
    durationHours: null,
    ...overrides,
  };
}


function renderPage(
  recordNumber: string,
  searchParams: Record<string, string | string[] | undefined> = {},
) {
  return TicketDetailPage({
    params: Promise.resolve({ recordNumber }),
    searchParams: Promise.resolve(searchParams),
  });
}

describe("TicketDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSession.mockResolvedValue({
      openId: "ou_operator",
      name: "运营",
    });
    readTicketByNumber.mockResolvedValue(null);
    readQueueCounts.mockResolvedValue({
      open: 12,
      overdue: 3,
      unassigned: 5,
      failed: 7,
      all: 3628,
    });
    readProfileCounts.mockResolvedValue({ users: 2772, devices: 41 });
  });

  it("redirects before reading VOC data", async () => {
    getCurrentSession.mockResolvedValue(null);

    await expect(renderPage("VOC-SECRET", { queue: "all" })).rejects.toThrow(
      "NEXT_REDIRECT:/enter",
    );
    expect(readTicketByNumber).not.toHaveBeenCalled();
  });

  it("renders a ticket with a validated back link", async () => {
    readTicketByNumber.mockResolvedValue(ticket());

    render(
      await renderPage("VOC-001", {
        queue: "overdue",
        severity: "高",
        page: "2",
        returnTo: "https://evil.example",
      }),
    );

    expect(screen.getByRole("link", { name: "← 返回工单列表" })).toHaveAttribute(
      "href",
      "/?queue=overdue&severity=%E9%AB%98&sort=feedback_desc&page=2",
    );
    expect(document.body.textContent).not.toContain("evil.example");
  });

  // Unavailable is now a thrown query rather than an aggregation status: the page
  // reads one record, so there is no metrics envelope to carry the failure.
  it("renders unavailable separately from not-found", async () => {
    readTicketByNumber.mockRejectedValue(new Error("database unreachable"));

    render(await renderPage("VOC-001"));

    expect(screen.getByText("工单暂时无法加载")).toBeInTheDocument();
    expect(screen.queryByText("工单不存在或已被移除")).not.toBeInTheDocument();
  });

  it("renders not-found only after a successful read", async () => {
    readTicketByNumber.mockResolvedValue(null);

    render(await renderPage("VOC-404"));

    expect(screen.getByText("工单不存在或已被移除")).toBeInTheDocument();
    expect(screen.queryByText("工单暂时无法加载")).not.toBeInTheDocument();
  });

  it("shows the sider counts it read", async () => {
    readTicketByNumber.mockResolvedValue(ticket());

    const { container } = render(await renderPage("VOC-001"));
    const sider = container.querySelector<HTMLElement>(".oc-console__sider")!;

    expect(within(sider).getByText("3628")).toBeInTheDocument();
    expect(within(sider).getByText("2772")).toBeInTheDocument();
    expect(within(sider).getByText("41")).toBeInTheDocument();
  });

  // The counts are chrome. A ticket that loaded must still render when they did not:
  // the sider loses its tags, not the page its content.
  it("renders the ticket when the count queries fail", async () => {
    readTicketByNumber.mockResolvedValue(ticket());
    readQueueCounts.mockRejectedValue(new Error("database unreachable"));
    readProfileCounts.mockRejectedValue(new Error("database unreachable"));

    const { container } = render(await renderPage("VOC-001"));

    expect(screen.getByText(/报修后等了三天没人上门/)).toBeInTheDocument();
    expect(
      container.querySelectorAll(".oc-console__sider .arco-tag"),
    ).toHaveLength(0);
  });
});
