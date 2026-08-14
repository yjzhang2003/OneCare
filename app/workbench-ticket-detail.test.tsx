import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkbenchTicket } from "../src/features/workbench/data";
import {
  parseWorkbenchQuery,
  type QueueKey,
} from "../src/features/workbench/query";
import {
  TicketDetailPageView,
  TicketDetailState,
} from "./workbench-ticket-detail";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push, prefetch: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

const NOW = Date.parse("2026-08-13T08:00:00.000Z");

const QUEUE_COUNTS = {
  open: 12,
  overdue: 3,
  unassigned: 5,
  failed: 7,
  all: 3628,
} as const;

function ticket(overrides: Partial<WorkbenchTicket> = {}): WorkbenchTicket {
  return {
    recordId: "rec1",
    recordNumber: "VOC-20260813-001",
    feedbackAt: "2026-08-12T08:00:00.000Z",
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

function renderDetail(
  overrides: Partial<WorkbenchTicket> = {},
  members: readonly { openId: string; name: string }[] = [
    { openId: "ou_huang", name: "黄齐" },
  ],
  counts: Readonly<{
    queueCounts: Readonly<Record<QueueKey, number>> | null;
    userCount: number | null;
    deviceCount: number | null;
  }> = { queueCounts: QUEUE_COUNTS, userCount: 2772, deviceCount: 41 },
) {
  return render(
    <TicketDetailPageView
      user={{ openId: "ou_operator", name: "运营" }}
      members={members}
      engineers={[{ openId: "ou_zhang", name: "张睿哲" }]}
      ticket={ticket(overrides)}
      now={NOW}
      backHref="/?queue=all&sort=feedback_desc"
      query={parseWorkbenchQuery({ queue: "all", sort: "feedback_desc" })}
      {...counts}
    />,
  );
}

describe("TicketDetailPageView", () => {
  // The anchors this replaces were five links to five headings already on screen, in
  // the column where the console's own navigation belongs — so opening a ticket meant
  // leaving the workbench. The sider is the point: a ticket is a page *in* the
  // console, structured like the profile pages, not a place you escape from.
  it("keeps the console sider, with its counts, and no same-page anchors", () => {
    const { container } = renderDetail();
    const sider = container.querySelector<HTMLElement>(".oc-console__sider")!;

    expect(sider).not.toBeNull();
    for (const label of ["数据概览", "工单", "用户画像", "设备追踪", "待处理"]) {
      expect(within(sider).getByText(label)).toBeInTheDocument();
    }
    for (const count of ["3628", "2772", "41"]) {
      expect(within(sider).getByText(count)).toBeInTheDocument();
    }

    // The headings are still there; what is gone is a link to each of them.
    for (const name of ["用户反馈", "AI 分析", "回复话术", "处理信息"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
    expect(container.querySelector(".oc-ticket-detail__anchors")).toBeNull();
    expect(container.querySelector(".oc-ticket-detail__grid")).not.toBeNull();
  });

  // Arco decides a Layout is a row by looking for Layout.Sider among its *direct*
  // children, and ours is wrapped in ConsoleSider — so it finds a function component
  // and lays the page out as a column instead. That shipped for exactly as long as it
  // took to open the page: the sider took the full viewport height and the content
  // column got zero. The class is the whole difference, so it is asserted.
  it("lays the shell out as a row despite the sider being a wrapper component", () => {
    const { container } = renderDetail();
    expect(container.querySelector(".oc-console")).toHaveClass(
      "arco-layout-has-sider",
    );
  });

  // The sider's destinations carry this ticket's list query, so the operator lands
  // back on the list they were filtering rather than on a default view.
  it("navigates to the sider's destinations from the list query it was opened with", () => {
    renderDetail();
    const sider = document.querySelector<HTMLElement>(".oc-console__sider")!;

    within(sider).getByText("用户画像").click();
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("section=users"),
    );
    expect(push).toHaveBeenCalledWith(expect.stringContaining("sort=feedback_desc"));
  });

  // Highlighting the queue this ticket came from would say the operator is looking at
  // that list. They are looking at one record.
  it("marks no sider item as the current page", () => {
    const { container } = renderDetail();
    expect(
      container.querySelectorAll(".oc-console__sider .arco-menu-selected"),
    ).toHaveLength(0);
  });

  // A count that could not be read is left out rather than shown as 0: "no overdue
  // tickets" and "we could not count them" are different facts, and 0 is the one that
  // reads as good news.
  it("omits sider counts it could not read", () => {
    const { container } = renderDetail({}, [], {
      queueCounts: null,
      userCount: null,
      deviceCount: null,
    });
    const sider = container.querySelector<HTMLElement>(".oc-console__sider")!;

    expect(within(sider).getByText("待处理")).toBeInTheDocument();
    expect(sider.querySelectorAll(".arco-tag")).toHaveLength(0);
  });

  it("exposes independently placeable overview, actions, body and key-field regions", () => {
    const { container } = renderDetail({ state: "待跟进", hasOwner: true });
    const selectors = [
      ".oc-ticket-detail__overview",
      ".oc-ticket-detail__actions",
      ".oc-ticket-detail__body",
      ".oc-ticket-detail__key-fields",
    ] as const;

    for (const selector of selectors) {
      expect(container.querySelectorAll(selector)).toHaveLength(1);
    }

    const overview = container.querySelector<HTMLElement>(selectors[0])!;
    const actions = container.querySelector<HTMLElement>(selectors[1])!;
    const body = container.querySelector<HTMLElement>(selectors[2])!;
    const keyFields = container.querySelector<HTMLElement>(selectors[3])!;

    expect(within(overview).getByText(/工单主题/)).toBeInTheDocument();
    expect(within(actions).getByText("当前处理")).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "开始跟进" })).toBeInTheDocument();
    for (const heading of ["用户反馈", "AI 分析", "回复话术", "处理信息"]) {
      expect(within(body).getByText(heading)).toBeInTheDocument();
    }
    expect(within(keyFields).getByText("关键字段")).toBeInTheDocument();
    expect(within(keyFields).getByText("VOC-20260813-001")).toBeInTheDocument();
  });

  it("shows facts but not a group id", () => {
    renderDetail({
      content: "冷藏室温度持续偏高",
      summary: "疑似传感器异常",
      replies: [{ tone: "安抚", text: "已记录问题。" }],
      hasWarRoom: true,
      engineerNames: [],
      dispatchedAt: null,
    });
    expect(screen.getByText("冷藏室温度持续偏高")).toBeInTheDocument();
    // Twice on purpose: the subject line at the top is the summary, in full, and
    // AI 摘要 further down is the same sentence. It used to appear once because the
    // subject was cut at 60 characters, so the duplication was hidden rather than
    // absent.
    expect(screen.getAllByText("疑似传感器异常")).toHaveLength(2);
    expect(screen.getByText("已记录问题。")).toBeInTheDocument();
    expect(screen.getByText("已建立")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("oc_");
    expect(document.body.textContent).not.toContain("ou_operator");
  });

  it("shows the existing categories and lifecycle times", () => {
    renderDetail({
      channel: "热线",
      category: "空调",
      model: "KFR-72LW",
      polarity: "中评",
      dimensions: ["产品质量", "维修时间"],
      severity: "高",
      feedbackAt: "2026-08-12T08:00:00.000Z",
      ticketOpenedAt: "2026-08-12T10:00:00.000Z",
      closedAt: "2026-08-13T02:00:00.000Z",
      durationHours: 16,
    });

    for (const value of [
      "热线 / 空调",
      "KFR-72LW",
      "中评",
      "产品质量、维修时间",
      "2026-08-12 16:00",
      "2026-08-12 18:00",
      "2026-08-13 10:00",
      "16 小时",
    ]) {
      expect(screen.getAllByText(value).length).toBeGreaterThan(0);
    }
  });

  it("reuses current action rules", () => {
    renderDetail({ state: "待跟进", hasOwner: true });
    expect(screen.getByRole("button", { name: "开始跟进" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认闭环" })).not.toBeInTheDocument();
    // 改派 replaces the note that used to send operators to the Bitable. It was the
    // only way to name anyone but yourself while the contacts API was closed; with it
    // open, reassignment is a control rather than an instruction to leave.
    expect(screen.getByRole("button", { name: "改派" })).toBeInTheDocument();
  });

  // The picker is only offered when there is somebody to pick. A directory read that
  // failed leaves it out rather than opening an empty dialog.
  it("hides 改派 when the directory is empty", () => {
    renderDetail({ state: "待跟进", hasOwner: true }, []);
    expect(screen.queryByRole("button", { name: "改派" })).not.toBeInTheDocument();
  });

  it("offers claiming only with no owner", () => {
    renderDetail({ hasOwner: false, ownerNames: [] });
    expect(screen.getByRole("button", { name: "我来跟进" })).toBeInTheDocument();
  });

  it("shows absent dwell and overdue values when no start time can be calculated", () => {
    const { container } = renderDetail({
      feedbackAt: "not a date",
      ticketOpenedAt: null,
    });
    const status = container.querySelector<HTMLElement>(
      ".oc-ticket-detail__status-grid",
    )!;

    expect(within(status).getByText("停留时长").nextElementSibling).toHaveTextContent("—");
    expect(within(status).getByText("超时标记").nextElementSibling).toHaveTextContent("—");
    expect(within(status).queryByText("未超时")).not.toBeInTheDocument();
    expect(within(status).queryByText(/已超时/)).not.toBeInTheDocument();
  });

  it.each(["已闭环", "无需跟进"] as const)(
    "explains that %s is terminal",
    (state) => {
      renderDetail({ state, hasOwner: true });
      expect(screen.getByText(`${state}是终态，没有后续动作。`)).toBeInTheDocument();
    },
  );

  it("explains when only the tagging pipeline can continue", () => {
    renderDetail({ state: "待分析", hasOwner: true });
    expect(
      screen.getByText("待分析下没有可由人执行的动作，等打标流水线处理。"),
    ).toBeInTheDocument();
  });

  // Until this button existed, "等打标流水线处理" meant waiting for the 02:00 Cron — a
  // 分析失败 record could be pushed back to 待分析 by 重试 and then sat there all day.
  it.each(["待分析", "分析失败"] as const)(
    "offers 立即分析 on a %s ticket, in the card it fills in",
    (state) => {
      const { container } = renderDetail({ state, retryCount: 1 });
      const analysis = container.querySelector<HTMLElement>(
        ".oc-ticket-detail__analysis",
      )!;

      expect(
        within(analysis).getByRole("button", { name: /立即分析/ }),
      ).toBeInTheDocument();
      // The wait is stated rather than left to a spinner: one record through the live
      // aily skill takes roughly 23 seconds.
      expect(within(analysis).getByText(/大约需要 20 秒/)).toBeInTheDocument();
    },
  );

  it("replaces the button with its reason once a ticket has been tagged", () => {
    const { container } = renderDetail({ state: "跟进中" });
    const analysis = container.querySelector<HTMLElement>(
      ".oc-ticket-detail__analysis",
    )!;

    expect(
      within(analysis).queryByRole("button", { name: /立即分析/ }),
    ).not.toBeInTheDocument();
    expect(
      within(analysis).getByText(/跟进中的工单已经打过标/),
    ).toBeInTheDocument();
  });
});

describe("TicketDetailState", () => {
  const common = {
    user: { openId: "ou_operator", name: "运营" },
    recordNumber: "VOC-404",
    backHref: "/?queue=all&sort=feedback_desc",
    retryHref: "/workbench/tickets/VOC-404?queue=all&sort=feedback_desc",
  } as const;

  it("shows a missing ticket without retry or business actions", () => {
    render(<TicketDetailState {...common} kind="not-found" />);

    expect(screen.getByText("万护 OneCare")).toBeInTheDocument();
    expect(screen.getByText("运营")).toBeInTheDocument();
    expect(screen.getByText("工单不存在或已被移除")).toBeInTheDocument();
    expect(screen.getByText("VOC-404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回工单列表" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "重试" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows retry and return when ticket data is unavailable", () => {
    render(<TicketDetailState {...common} kind="unavailable" />);

    expect(screen.getByText("万护 OneCare")).toBeInTheDocument();
    expect(screen.getByText("运营")).toBeInTheDocument();
    expect(screen.getByText("工单暂时无法加载")).toBeInTheDocument();
    expect(screen.queryByText("VOC-404")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "重试" })).toHaveAttribute(
      "href",
      common.retryHref,
    );
    expect(screen.getByRole("link", { name: "返回工单列表" })).toHaveAttribute(
      "href",
      common.backHref,
    );
  });
});
