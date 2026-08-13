import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkbenchData, WorkbenchTicket } from "../../../../src/features/workbench/data";

const { getCurrentSession, readWorkbenchCached, refresh } = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  readWorkbenchCached: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
  useRouter: () => ({ refresh }),
}));

vi.mock("../../../../src/features/auth/current-session", () => ({
  getCurrentSession,
}));

vi.mock("../../../api/voc/dashboard/route", () => ({
  readWorkbenchCached,
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
    ticketOpenedAt: "2026-08-12T10:00:00.000Z",
    closedAt: null,
    durationHours: null,
    ...overrides,
  };
}

function workbenchData(tickets: readonly WorkbenchTicket[]): WorkbenchData {
  return {
    metrics: {
      status: "ok",
      metrics: {
        total: tickets.length,
        byPolarity: { 好评: 0, 中评: 0, 差评: tickets.length },
        dimensionTop: [],
        byChannel: [],
        negativeShare: tickets.length === 0 ? 0 : 1,
        ticketsOpened: tickets.length,
        ticketsClosed: 0,
        closureRate: 0,
        averageClosureHours: 0,
        taggingAttempted: tickets.length,
        taggingSucceeded: tickets.length,
        taggingFailed: 0,
        taggingPending: 0,
      },
    },
    tickets,
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
    readWorkbenchCached.mockResolvedValue(workbenchData([]));
  });

  it("redirects before reading VOC data", async () => {
    getCurrentSession.mockResolvedValue(null);

    await expect(renderPage("VOC-SECRET", { queue: "all" })).rejects.toThrow(
      "NEXT_REDIRECT:/enter",
    );
    expect(readWorkbenchCached).not.toHaveBeenCalled();
  });

  it("renders a ticket with a validated back link", async () => {
    readWorkbenchCached.mockResolvedValue(workbenchData([ticket()]));

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

  it("renders unavailable separately from not-found", async () => {
    readWorkbenchCached.mockResolvedValue({
      metrics: { status: "unavailable" },
      tickets: [],
    });

    render(await renderPage("VOC-001"));

    expect(screen.getByText("工单暂时无法加载")).toBeInTheDocument();
    expect(screen.queryByText("工单不存在或已被移除")).not.toBeInTheDocument();
  });

  it("renders not-found only after a successful read", async () => {
    readWorkbenchCached.mockResolvedValue(workbenchData([]));

    render(await renderPage("VOC-404"));

    expect(screen.getByText("工单不存在或已被移除")).toBeInTheDocument();
    expect(screen.queryByText("工单暂时无法加载")).not.toBeInTheDocument();
  });
});
