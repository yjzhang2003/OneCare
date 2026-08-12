import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mocked rather than exercised for real: getVocDashboardMetrics's real
// implementation reaches for Bitable credentials this test environment does
// not have, and readWorkbenchCached uses "use cache"/cacheLife from
// "next/cache", which assumes Next's own runtime — neither belongs in a
// plain component test. The mocks stand in for "no session" and "public
// metrics", which is all HomePage's anonymous branch needs.
vi.mock("../src/features/auth/current-session", () => ({
  getCurrentSession: vi.fn(async () => null),
}));

vi.mock("./api/voc/dashboard/route", () => ({
  getVocDashboardMetrics: vi.fn(async () => ({ status: "unavailable" as const })),
  // Throws rather than returning a fixture: this is the actual gate task 15
  // must not weaken. An anonymous visitor's render must never even call the
  // reader that produces per-ticket detail, let alone show it — this fails
  // the test loudly the moment that stops being true, instead of merely
  // failing a markup assertion further down.
  readWorkbenchCached: vi.fn(async () => {
    throw new Error(
      "readWorkbenchCached must never be called for a visitor with no session",
    );
  }),
}));

import HomePage from "./page";

describe("HomePage — anonymous visitor", () => {
  it("renders the public showcase, never the workbench, when there is no session", async () => {
    const element = await HomePage({ searchParams: Promise.resolve({}) });
    render(element);

    // None of the workbench's own markers leak onto the anonymous page.
    expect(
      screen.queryByText(/万护 OneCare 服务运营工作台/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/工单列表/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /工单详情/ }),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".workbench")).toBeNull();

    // The showcase actually rendered instead of an empty tree.
    expect(
      screen.getByRole("heading", { name: "让每一次服务，都比问题更早一步" }),
    ).toBeInTheDocument();
  });
});
