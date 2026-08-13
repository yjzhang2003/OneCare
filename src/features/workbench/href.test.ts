import { describe, expect, test } from "vitest";

import { filterHref, pageHref, ticketHref, toPatch } from "./href";
import { parseWorkbenchQuery, type WorkbenchQuery } from "./query";

// Round-tripping through parseWorkbenchQuery rather than asserting on raw query
// strings: what matters is that a URL these functions build parses back into the
// query the caller asked for. A string assertion would pass while the parameter
// name silently stopped matching what the parser reads.
function parse(href: string): WorkbenchQuery {
  const params = Object.fromEntries(
    new URL(href, "http://localhost").searchParams.entries(),
  );
  return parseWorkbenchQuery(params);
}

function query(overrides: Partial<WorkbenchQuery> = {}): WorkbenchQuery {
  return {
    queue: "open",
    channel: null,
    category: null,
    polarity: null,
    dimension: null,
    severity: null,
    state: null,
    owner: null,
    search: "",
    sort: "feedback_desc",
    page: 1,
    ticket: null,
    ...overrides,
  };
}

describe("filterHref", () => {
  test("carries every unrelated part of the query through unchanged", () => {
    const before = query({
      queue: "overdue",
      channel: "400 客服",
      severity: "高",
      search: "制冷",
      sort: "dwell_desc",
      ticket: "VOC-000001",
    });

    const after = parse(filterHref(before, toPatch("category", "冰箱")));

    expect(after.queue).toBe("overdue");
    expect(after.channel).toBe("400 客服");
    expect(after.severity).toBe("高");
    expect(after.search).toBe("制冷");
    expect(after.sort).toBe("dwell_desc");
    expect(after.ticket).toBe("VOC-000001");
    expect(after.category).toBe("冰箱");
  });

  // The matched set just changed, so whatever "page 3" described a moment ago no
  // longer exists. Staying on page 3 is how an operator lands on an empty screen
  // after narrowing a filter and concludes there are no results.
  test("any filter change returns to page one", () => {
    const before = query({ page: 4 });
    expect(parse(filterHref(before, toPatch("severity", "高"))).page).toBe(1);
    expect(parse(filterHref(before, { queue: "unassigned" })).page).toBe(1);
    expect(parse(filterHref(before, { sort: "severity_desc" })).page).toBe(1);
    expect(parse(filterHref(before, { search: "冰箱" })).page).toBe(1);
  });

  test("clearing a filter removes it rather than sending an empty value", () => {
    const before = query({ severity: "高" });
    const href = filterHref(before, toPatch("severity", null));

    expect(href).not.toContain("severity");
    expect(parse(href).severity).toBeNull();
  });

  test("an empty search drops the parameter entirely", () => {
    const href = filterHref(query({ search: "制冷" }), { search: null });
    expect(href).not.toContain("search");
  });
});

describe("pageHref", () => {
  test("page one is the absence of a page parameter, not page=1", () => {
    expect(pageHref(query({ page: 3 }), 1)).not.toContain("page");
  });

  test("keeps the filters while moving between pages", () => {
    const after = parse(
      pageHref(query({ queue: "failed", severity: "高", search: "异响" }), 3),
    );
    expect(after.page).toBe(3);
    expect(after.queue).toBe("failed");
    expect(after.severity).toBe("高");
    expect(after.search).toBe("异响");
  });
});

describe("ticketHref", () => {
  // Opening a ticket is orthogonal to browsing: it must not reset the page or
  // drop a filter, or closing the drawer would land the operator somewhere else
  // than where they opened it from.
  test("opening a ticket preserves the page and the filters", () => {
    const before = query({ page: 5, queue: "overdue", severity: "高" });
    const after = parse(ticketHref(before, "VOC-000042"));

    expect(after.ticket).toBe("VOC-000042");
    expect(after.page).toBe(5);
    expect(after.queue).toBe("overdue");
    expect(after.severity).toBe("高");
  });

  test("closing a ticket removes only the ticket", () => {
    const before = query({ page: 5, ticket: "VOC-000042", severity: "高" });
    const after = parse(ticketHref(before, null));

    expect(after.ticket).toBeNull();
    expect(after.page).toBe(5);
    expect(after.severity).toBe("高");
  });
});

describe("the default view", () => {
  // Every default omitted, so the plain workbench URL is "/" — the thing an
  // operator bookmarks and the thing a shared link degrades to.
  test("a query with no choices in it produces a bare path", () => {
    expect(filterHref(query(), {})).toBe("/?queue=open&sort=feedback_desc");
  });
});
