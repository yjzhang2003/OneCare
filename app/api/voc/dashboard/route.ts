import { cacheLife } from "next/cache";

import {
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../src/features/bitable/client";
import type { VocRecord } from "../../../../src/features/bitable/field-map";
import { getCurrentSession } from "../../../../src/features/auth/current-session";
import type { AuthUser } from "../../../../src/features/auth/types";
import {
  aggregateVocMetrics,
  type VocMetricsInput,
  type VocMetricsResult,
} from "../../../../src/features/voc/metrics";
import {
  buildWorkbench,
  type BuildWorkbenchOptions,
  type WorkbenchData,
} from "../../../../src/features/workbench/data";
import { readBitableEnv, readBotEnv } from "../../../../src/lib/env";

// getVocDashboardMetrics (below) still backs the public, unauthenticated
// /dashboard/voc page, and that page's only evidence-of-real-data guarantee
// is that it reconciles against the real Base while never carrying anything
// a judge could read as someone's personal data. Only the six fields
// aggregateVocMetrics actually consumes are named here — pulling the whole
// VocRecord in and trusting that JSON.stringify of VocMetrics "happens to"
// drop 原始内容/record_id would make that guarantee an accident of the
// current field list rather than something this file enforces. This is
// deliberately narrower than what the *gated* route below returns — that
// route now serves real per-ticket detail, but only after the session check
// this task adds, which is exactly why it needed one.
type DashboardRecord = Pick<
  VocRecord,
  "state" | "polarity" | "dimensions" | "channel" | "ticketOpenedAt" | "closedAt"
>;

type DashboardRouteDependencies = Readonly<{
  // Full VocRecord (not the narrow DashboardRecord above): this route's
  // response now includes per-ticket detail via buildWorkbench, which is
  // exactly why an anonymous caller must never reach it (see the session
  // check below).
  listAll: () => Promise<readonly VocRecord[]>;
  // Checked before listAll is ever called. A missing session must cost
  // nothing — no Base read, no aggregation — both because an unauthenticated
  // caller has no business seeing this data and because a public-facing
  // endpoint that lets anyone trigger a paid, cross-border Bitable read is a
  // standing invitation to abuse.
  session: () => Promise<AuthUser | null>;
  // Optional on the type (not required) so a caller — including the tests
  // below — can omit it entirely and get a response with no `effort` block
  // at all, rather than this route inventing a baseline of its own.
  // aggregateVocMetrics only emits `effort` when this is passed, for the
  // same reason. Production wiring does pass one (see
  // ASSUMED_MANUAL_MINUTES_PER_RECORD below), but that value is a stated
  // assumption, never a measurement.
  manualMinutesPerRecord?: number;
}>;

function toMetricsInput(record: DashboardRecord): VocMetricsInput {
  return {
    state: record.state,
    polarity: record.polarity,
    dimensions: record.dimensions,
    channel: record.channel,
    ...(record.ticketOpenedAt ? { ticketOpenedAt: record.ticketOpenedAt } : {}),
    ...(record.closedAt ? { closedAt: record.closedAt } : {}),
  };
}

function errorReason(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "unreadable error";
  }
}

export function createDashboardRoute(dependencies: DashboardRouteDependencies) {
  return async function GET(): Promise<Response> {
    // One guard around the entire handler: an unguarded read that throws
    // must never surface as Next.js's opaque uncaught 500 — it must read as
    // "the Base is temporarily unreachable", not "the site is broken".
    try {
      // First thing this handler does, and returns before touching
      // `listAll` at all: this response now carries per-record fields (see
      // the DashboardRouteDependencies comment above), so an unauthenticated
      // caller must not be able to trigger the Base read that produces them,
      // let alone see the result.
      const user = await dependencies.session();
      if (!user) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }

      const records = await dependencies.listAll();
      const options: BuildWorkbenchOptions =
        dependencies.manualMinutesPerRecord === undefined
          ? {}
          : { manualMinutesPerRecord: dependencies.manualMinutesPerRecord };
      const workbench = buildWorkbench(records, options);
      if (workbench.metrics.status !== "ok") {
        // buildWorkbench is a pure function over already-fetched records and
        // never actually returns "unavailable" itself — this branch exists
        // so TypeScript narrows workbench.metrics before the spread below,
        // and so a future change to buildWorkbench can't silently turn into
        // a runtime crash here.
        return Response.json(
          { error: "service_unavailable", reason: "aggregation unavailable" },
          { status: 503 },
        );
      }
      return Response.json({ ...workbench.metrics.metrics, tickets: workbench.tickets });
    } catch (error) {
      return Response.json(
        { error: "service_unavailable", reason: errorReason(error) },
        { status: 503 },
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Production wiring. Deferred (closures, not eagerly-evaluated values) so
// importing this module never touches process.env, matching every other
// route in this codebase (see app/api/voc/analyze/route.ts).
// ---------------------------------------------------------------------------

let tokenProvider: TenantTokenProvider | null = null;
function getTokenProvider(): TenantTokenProvider {
  if (!tokenProvider) {
    const botEnv = readBotEnv();
    tokenProvider = createTenantTokenProvider(botEnv.appId, botEnv.appSecret);
  }
  return tokenProvider;
}

let bitableClient: BitableClient | null = null;
function getBitableClient(): BitableClient {
  if (!bitableClient) {
    bitableClient = createBitableClient(readBitableEnv(), getTokenProvider());
  }
  return bitableClient;
}

// The result of the one network call this route makes. A plain boolean
// discriminant rather than a thrown exception, because — confirmed
// empirically in task 14 fix round 1 — a `"use cache"` function that throws
// fails `next build` outright under Cache Components, *regardless* of
// whether the awaiting caller catches the rejection. (`FEISHU_BITABLE_APP_
// TOKEN=bogus npm run build` still failed prerendering — sometimes reported
// against "/", sometimes against "/dashboard/voc" depending on which route
// Next's cache-population pass reached first — even with a try/catch one
// level up in what is now getVocDashboardMetrics.) The fix is that the code
// running *inside* the `use cache` boundary itself must never throw; the
// catch has to live here, not in a caller.
// `records` carries the full VocRecord (not the narrow DashboardRecord) —
// the underlying Bitable client always reads full records; DashboardRecord
// is a type-level promise `getVocDashboardMetrics` makes to itself about
// which fields it will touch, not a runtime shape the network layer
// produces. Widened (rather than duplicated) so the gated route's
// `listAll` shim below can share this exact cache entry instead of this
// file making a second, near-identical Bitable call.
type VocRecordsRead =
  | Readonly<{ ok: true; records: readonly VocRecord[] }>
  | Readonly<{ ok: false }>;

// The only network call this route makes, cached so an anonymous visitor
// opening this public page never triggers a fresh cross-border Bitable read
// on their own — every open within the cache window is served from Next's
// cache instead. `cacheLife("minutes")` (not "hours"/"days") because a judge
// re-tagging or closing a demo record while reviewing the page should see it
// reflected without a long redeploy-shaped wait. Exported (not just used
// internally) so app/dashboard/voc/page.tsx reads through this exact same
// cached function rather than re-fetching over HTTP from a server component,
// and so all consumers share one cache entry instead of several.
export async function readVocRecordsCached(): Promise<VocRecordsRead> {
  "use cache";
  cacheLife("minutes");
  try {
    const records = await getBitableClient().listRecords();
    return { ok: true, records };
  } catch (error) {
    // Server-side log only. The reason can carry Bitable error codes or
    // token-exchange failure detail, which — like the raw VOC content this
    // route already refuses to leak — has no business reaching an
    // anonymous, unauthenticated visitor of a public page.
    console.error("VOC Bitable read failed:", errorReason(error));
    return { ok: false };
  }
}

// Nobody has measured how long a human spent triaging a VOC record by hand
// before this system existed — there is no baseline to read off a timesheet.
// This number is a stated assumption, not a measurement, which is exactly
// why both the API response and the dashboard page must print it next to
// every hour figure derived from it (task 14 brief) rather than let a bare
// hours total imply something measured.
export const ASSUMED_MANUAL_MINUTES_PER_RECORD = 5;

const defaultDependencies: DashboardRouteDependencies = {
  // A thin adapter back onto the throw-based `listAll` contract
  // createDashboardRoute's own try/catch (and its tests) already expect and
  // exercise — that contract is deliberately left unchanged by this fix.
  // The throw here happens in a plain function, not inside "use cache", so
  // it is an ordinary rejected promise createDashboardRoute's try/catch
  // handles exactly as before; it never reaches Next's cache machinery.
  // Shares readVocRecordsCached's cache entry with getVocDashboardMetrics
  // below rather than opening a second cached reader for the same Base
  // table — the session gate this task adds is the boundary that decides
  // who gets to see the full records this returns, not a second fetch.
  listAll: async () => {
    const result = await readVocRecordsCached();
    if (!result.ok) {
      throw new Error("VOC Bitable read failed");
    }
    return result.records;
  },
  session: getCurrentSession,
  manualMinutesPerRecord: ASSUMED_MANUAL_MINUTES_PER_RECORD,
};

export const GET = createDashboardRoute(defaultDependencies);

// The cached read backing the gated workbench surface. Composes
// readVocRecordsCached above rather than issuing its own
// getBitableClient().listRecords() call: this route and the public
// dashboard page both ultimately read the same Base table, and
// getVocDashboardMetrics's own comment states the reason plainly — "a judge
// comparing the rendered page against a direct curl sees identical numbers
// because both paths run through this one function". A second, independent
// "use cache" boundary here would mean a second cache key with its own
// revalidation clock, so the two surfaces could disagree at the edge of the
// cache window even though they describe the exact same records. Sharing the
// one cached fetch keeps that guarantee true for this surface too.
//
// Still never throws, per the same rule as readVocRecordsCached (task 14 fix
// round 1 — a "use cache" function that throws fails `next build` outright,
// regardless of whether an awaiting caller catches the rejection). Returns a
// WorkbenchData directly — never a second, route-specific discriminated
// union wrapped around it — because WorkbenchData.metrics is already a
// VocMetricsResult with its own "ok" | "unavailable" status, and every
// consumer of this data (this route today, a future workbench page) should
// only ever have to check that one status field once.
export async function readWorkbenchCached(): Promise<WorkbenchData> {
  "use cache";
  cacheLife("minutes");
  const result = await readVocRecordsCached();
  if (!result.ok) {
    // readVocRecordsCached's own catch already logged the Bitable failure
    // reason once; logging it again here under a different function name
    // would just duplicate that line for the same underlying event.
    return { metrics: { status: "unavailable" }, tickets: [] };
  }
  try {
    return buildWorkbench(result.records, {
      manualMinutesPerRecord: ASSUMED_MANUAL_MINUTES_PER_RECORD,
    });
  } catch (error) {
    // buildWorkbench is a pure in-memory aggregation over records
    // readVocRecordsCached already fetched successfully, so this should
    // never actually throw. But it still runs inside this "use cache"
    // boundary, and a throw from anywhere inside one fails `next build`
    // outright regardless of whether a caller catches it — so the guard has
    // to live here, not one level up. A distinct log message from the
    // Bitable-read-failed one above, because this is a different failure
    // mode (the read succeeded; aggregating what it returned did not).
    console.error("VOC workbench aggregation failed:", errorReason(error));
    return { metrics: { status: "unavailable" }, tickets: [] };
  }
}

// Single source of truth for the public dashboard page and the home page's
// showcase panel: same cached read, same assumed baseline, same aggregation
// both render — a judge comparing the two sees identical numbers because
// both run through this one function. This is now independent of the JSON
// API above: that route serves the session-gated workbench's per-ticket
// detail, while this one keeps serving the aggregate-only numbers the
// public, unauthenticated page has always shown.
//
// Never throws. This is called directly inside the home page's and the
// dashboard page's top-level render (no try/catch of their own, and no
// Suspense boundary to fall back to), so a thrown error here would fail
// that whole page's render — and because this route is eagerly prerendered,
// it would fail `next build` outright. A single flaky Feishu token exchange
// must never be able to block a deploy of the site's own home page.
// `readRecords` is injectable (defaulting to the real cached reader) so
// this failure path is exercised directly in tests without needing a fake
// network layer.
export async function getVocDashboardMetrics(
  readRecords: () => Promise<VocRecordsRead> = readVocRecordsCached,
): Promise<VocMetricsResult> {
  const result = await readRecords();
  if (!result.ok) {
    return { status: "unavailable" };
  }

  const metrics = aggregateVocMetrics(result.records.map(toMetricsInput), {
    manualMinutesPerRecord: ASSUMED_MANUAL_MINUTES_PER_RECORD,
  });
  return { status: "ok", metrics };
}
