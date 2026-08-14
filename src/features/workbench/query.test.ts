import { describe, expect, it } from "vitest";

import type { WorkbenchTicket } from "./data";
import {
  applyWorkbenchQuery,
  ASSUMED_SLA_HOURS,
  dwellHours,
  isOverdue,
  PAGE_SIZE,
  parseWorkbenchQuery,
} from "./query";

const NOW = Date.parse("2026-02-10T00:00:00.000Z");
const HOUR = 3_600_000;

function ticket(overrides: Partial<WorkbenchTicket> = {}): WorkbenchTicket {
  return {
    recordId: "rec1",
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
    recordNumber: "R-001",
    feedbackAt: "2026-02-09T00:00:00.000Z",
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
    ticketOpenedAt: "2026-02-09T00:00:00.000Z",
    closedAt: null,
    durationHours: null,
    ...overrides,
  };
}

describe("parseWorkbenchQuery", () => {
  it("defaults to the open queue, newest first, page one", () => {
    const query = parseWorkbenchQuery({});

    expect(query).toMatchObject({
      queue: "open",
      sort: "feedback_desc",
      page: 1,
      search: "",
      polarity: null,
    });
  });

  it("ignores values outside the enum instead of erroring or emptying the list", () => {
    // A stale bookmark or a hand-edited URL should show a slightly wider list,
    // never an error page and never a silently empty one an operator could read
    // as "nothing to do".
    const query = parseWorkbenchQuery({
      queue: "nonsense",
      polarity: "很差",
      dimension: "不存在的维度",
      severity: "特高",
      state: "已归档",
      sort: "random",
    });

    expect(query).toMatchObject({
      queue: "open",
      polarity: null,
      dimension: null,
      severity: null,
      state: null,
      sort: "feedback_desc",
    });
  });

  it("keeps free-text filters as given but trims and drops blanks", () => {
    expect(parseWorkbenchQuery({ channel: "  400 客服  " }).channel).toBe(
      "400 客服",
    );
    expect(parseWorkbenchQuery({ channel: "   " }).channel).toBeNull();
  });

  it("takes the first value when a parameter repeats", () => {
    expect(parseWorkbenchQuery({ queue: ["overdue", "all"] }).queue).toBe(
      "overdue",
    );
  });

  it("falls back to page one for junk, zero, negative and fractional pages", () => {
    for (const page of ["0", "-3", "abc", "2.5", ""]) {
      expect(parseWorkbenchQuery({ page }).page).toBe(1);
    }
    expect(parseWorkbenchQuery({ page: "4" }).page).toBe(4);
  });

  it("ignores the retired ticket parameter", () => {
    const query = parseWorkbenchQuery({
      queue: "all",
      ticket: "R-2",
      page: "2",
    });

    expect(query).not.toHaveProperty("ticket");
    expect(query.page).toBe(2);
  });
});
describe("dwellHours", () => {
  it("measures from the ticket open time when there is one", () => {
    expect(dwellHours(ticket(), NOW)).toBe(24);
  });

  it("measures from the feedback itself when no ticket exists yet", () => {
    // An untriaged complaint is aging too. Measuring only opened tickets would
    // hide the worst part of the backlog behind a blank.
    const hours = dwellHours(
      ticket({
        ticketOpenedAt: null,
        feedbackAt: "2026-02-05T00:00:00.000Z",
        state: "待分析",
      }),
      NOW,
    );

    expect(hours).toBe(120);
  });

  it("returns null once the record is finished", () => {
    for (const state of ["已闭环", "无需跟进"] as const) {
      expect(dwellHours(ticket({ state }), NOW)).toBeNull();
    }
  });

  it("returns null when both timestamps are absent or unparseable", () => {
    expect(
      dwellHours(ticket({ ticketOpenedAt: null, feedbackAt: null }), NOW),
    ).toBeNull();
    expect(dwellHours(ticket({ ticketOpenedAt: "not a date" }), NOW)).toBeNull();
  });

  it("clamps a future timestamp to zero rather than reporting negative dwell", () => {
    const hours = dwellHours(
      ticket({ ticketOpenedAt: "2026-03-01T00:00:00.000Z" }),
      NOW,
    );

    expect(hours).toBe(0);
  });

  it("treats the SLA threshold as exclusive", () => {
    const at = new Date(NOW - ASSUMED_SLA_HOURS * HOUR).toISOString();
    expect(isOverdue(ticket({ ticketOpenedAt: at }), NOW)).toBe(false);

    const older = new Date(NOW - (ASSUMED_SLA_HOURS + 1) * HOUR).toISOString();
    expect(isOverdue(ticket({ ticketOpenedAt: older }), NOW)).toBe(true);
  });

  it("never calls a closed record overdue however old it is", () => {
    const ancient = "2020-01-01T00:00:00.000Z";
    expect(
      isOverdue(ticket({ ticketOpenedAt: ancient, state: "已闭环" }), NOW),
    ).toBe(false);
  });
});

describe("applyWorkbenchQuery", () => {
  const rows = [
    ticket({ recordNumber: "A", state: "待跟进" }),
    ticket({ recordNumber: "B", state: "已闭环" }),
    ticket({ recordNumber: "C", state: "待分析", ticketOpenedAt: null }),
    ticket({ recordNumber: "D", state: "分析失败", ticketOpenedAt: null }),
    ticket({ recordNumber: "E", state: "跟进中", ownerNames: [] }),
    ticket({
      recordNumber: "F",
      state: "待闭环",
      ticketOpenedAt: "2026-01-01T00:00:00.000Z",
    }),
  ];

  const numbers = (result: { rows: readonly WorkbenchTicket[] }) =>
    result.rows.map((row) => row.recordNumber);

  it("puts each record in the queues it belongs to", () => {
    const of = (queue: string) =>
      numbers(
        applyWorkbenchQuery(rows, parseWorkbenchQuery({ queue }), NOW),
      ).sort();

    expect(of("open")).toEqual(["A", "E", "F"]);
    expect(of("unassigned")).toEqual(["E"]);
    expect(of("failed")).toEqual(["D"]);
    expect(of("overdue")).toEqual(["F"]);
    expect(of("all")).toHaveLength(6);
  });

  it("counts the queues over every record, not over the filtered list", () => {
    // A tab count that moved with the filters would mean "待处理 12" said
    // something different on every page.
    const result = applyWorkbenchQuery(
      rows,
      parseWorkbenchQuery({ queue: "all", state: "已闭环" }),
      NOW,
    );

    expect(numbers(result)).toEqual(["B"]);
    expect(result.queueCounts.open).toBe(3);
    expect(result.queueCounts.all).toBe(6);
  });

  it("composes filters", () => {
    const result = applyWorkbenchQuery(
      [
        ticket({ recordNumber: "A", channel: "400 客服", severity: "高" }),
        ticket({ recordNumber: "B", channel: "400 客服", severity: "低" }),
        ticket({ recordNumber: "C", channel: "社媒", severity: "高" }),
      ],
      parseWorkbenchQuery({ queue: "all", channel: "400 客服", severity: "高" }),
      NOW,
    );

    expect(numbers(result)).toEqual(["A"]);
  });

  it("matches a multi-select dimension by membership, not equality", () => {
    const result = applyWorkbenchQuery(
      [
        ticket({ recordNumber: "A", dimensions: ["服务态度", "维修时间"] }),
        ticket({ recordNumber: "B", dimensions: ["产品质量"] }),
      ],
      parseWorkbenchQuery({ queue: "all", dimension: "维修时间" }),
      NOW,
    );

    expect(numbers(result)).toEqual(["A"]);
  });

  it("searches content, model and record number, case-insensitively", () => {
    const pool = [
      ticket({ recordNumber: "A", content: "冰箱噪音很大", model: "" }),
      ticket({ recordNumber: "BCD-9", content: "无关", model: "" }),
      ticket({ recordNumber: "C", content: "无关", model: "hs-Ku50" }),
    ];
    const search = (term: string) =>
      numbers(
        applyWorkbenchQuery(
          pool,
          parseWorkbenchQuery({ queue: "all", search: term }),
          NOW,
        ),
      );

    expect(search("噪音")).toEqual(["A"]);
    expect(search("bcd")).toEqual(["BCD-9"]);
    expect(search("HS-KU50")).toEqual(["C"]);
  });

  it("does not fold the owner into free-text search", () => {
    // Otherwise searching a surname would return every ticket that person owns
    // and bury whatever the operator was actually looking for. The owner filter
    // covers that case explicitly.
    const result = applyWorkbenchQuery(
      [ticket({ recordNumber: "A", ownerNames: ["张三"], content: "无关" })],
      parseWorkbenchQuery({ queue: "all", search: "张三" }),
      NOW,
    );

    expect(result.matched).toBe(0);
  });

  it("filters by owner name exactly", () => {
    const result = applyWorkbenchQuery(
      [
        ticket({ recordNumber: "A", ownerNames: ["张三", "李四"] }),
        ticket({ recordNumber: "B", ownerNames: ["王五"] }),
      ],
      parseWorkbenchQuery({ queue: "all", owner: "李四" }),
      NOW,
    );

    expect(numbers(result)).toEqual(["A"]);
  });

  it("sorts by dwell time, severity and both feedback directions", () => {
    const pool = [
      ticket({
        recordNumber: "old",
        feedbackAt: "2026-01-01T00:00:00.000Z",
        ticketOpenedAt: "2026-01-01T00:00:00.000Z",
        severity: "低",
      }),
      ticket({
        recordNumber: "new",
        feedbackAt: "2026-02-09T00:00:00.000Z",
        ticketOpenedAt: "2026-02-09T00:00:00.000Z",
        severity: "高",
      }),
      ticket({ recordNumber: "undated", feedbackAt: null, severity: "中" }),
    ];
    const sorted = (sort: string) =>
      numbers(
        applyWorkbenchQuery(pool, parseWorkbenchQuery({ queue: "all", sort }), NOW),
      );

    expect(sorted("feedback_desc")).toEqual(["new", "old", "undated"]);
    // Undated still sorts last ascending: a blank timestamp must not
    // masquerade as the oldest, most urgent item in the queue.
    expect(sorted("feedback_asc")).toEqual(["old", "new", "undated"]);
    expect(sorted("dwell_desc")[0]).toBe("old");
    expect(sorted("severity_desc")[0]).toBe("new");
  });

  it("pages the result and clamps a page past the end", () => {
    const pool = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, index) =>
      ticket({ recordNumber: `R-${index}` }),
    );

    const first = applyWorkbenchQuery(
      pool,
      parseWorkbenchQuery({ queue: "all" }),
      NOW,
    );
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(first.matched).toBe(pool.length);
    expect(first.pageCount).toBe(3);

    const last = applyWorkbenchQuery(
      pool,
      parseWorkbenchQuery({ queue: "all", page: "3" }),
      NOW,
    );
    expect(last.rows).toHaveLength(3);

    const beyond = applyWorkbenchQuery(
      pool,
      parseWorkbenchQuery({ queue: "all", page: "99" }),
      NOW,
    );
    expect(beyond.page).toBe(3);
    expect(beyond.rows).toHaveLength(3);
  });

  it("reports one page and no rows for an empty match rather than page zero", () => {
    const result = applyWorkbenchQuery(
      rows,
      parseWorkbenchQuery({ queue: "all", channel: "不存在的渠道" }),
      NOW,
    );

    expect(result.matched).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(1);
  });

  it("returns no selected ticket", () => {
    const result = applyWorkbenchQuery(
      [ticket({ recordNumber: "R-1" })],
      parseWorkbenchQuery({ queue: "all" }),
      NOW,
    );

    expect(result).not.toHaveProperty("selected");
  });

  it("does not mutate the tickets it was given", () => {
    const pool = [ticket({ recordNumber: "A" }), ticket({ recordNumber: "B" })];
    const snapshot = JSON.stringify(pool);

    applyWorkbenchQuery(pool, parseWorkbenchQuery({ queue: "all", sort: "dwell_desc" }), NOW);

    expect(JSON.stringify(pool)).toBe(snapshot);
    expect(pool[0]?.recordNumber).toBe("A");
  });
});


