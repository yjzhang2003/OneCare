import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mocked rather than exercised for real: the readers reach for credentials this test
// environment does not have, and the cached ones use "use cache"/cacheLife from
// "next/cache", which assumes Next's own runtime — neither belongs in a plain
// component test. The mocks stand in for "no session" and "public metrics", which is
// all HomePage's anonymous branch needs.
vi.mock("../src/features/auth/current-session", () => ({
  getCurrentSession: vi.fn(async () => null),
}));

// vi.hoisted, because vi.mock's factory is hoisted above every other statement in the
// file: a plain const declared here is still uninitialised when the factory runs.
const { readVocMetrics } = vi.hoisted(() => ({
  readVocMetrics: vi.fn(async () => ({
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
  })),
}));

vi.mock("../src/features/store/workbench-query", () => ({ readVocMetrics }));

vi.mock("./api/voc/dashboard/route", () => ({
  ASSUMED_MANUAL_MINUTES_PER_RECORD: 3,
  // Both throw rather than returning a fixture, and for two different reasons.
  //
  // readWorkbenchCached is the gate task 15 added: an anonymous visitor's render must
  // never even call the reader that produces per-ticket detail, let alone show it.
  //
  // getVocDashboardMetrics is the Bitable full-table read the landing page used to
  // make. It cost a measured 2.5s warm and 40–60s cold in production, on the page an
  // outside visitor sees first; the numbers now come from the same Postgres aggregate
  // the console's 数据概览 uses. Throwing here fails loudly if that regresses, rather
  // than quietly getting slow again.
  readWorkbenchCached: vi.fn(async () => {
    throw new Error(
      "readWorkbenchCached must never be called for a visitor with no session",
    );
  }),
  getVocDashboardMetrics: vi.fn(async () => {
    throw new Error(
      "the landing page must read its metrics from Postgres, not the Bitable",
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

    // And its numbers came from the aggregate, not from a full-table read.
    expect(readVocMetrics).toHaveBeenCalledTimes(1);
  });
});
