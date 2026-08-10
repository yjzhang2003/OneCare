import { cacheLife } from "next/cache";

import {
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../src/features/bitable/client";
import type { VocRecord } from "../../../../src/features/bitable/field-map";
import {
  aggregateVocMetrics,
  type VocMetricsInput,
  type VocMetricsResult,
} from "../../../../src/features/voc/metrics";
import { readBitableEnv, readBotEnv } from "../../../../src/lib/env";

// This page is the only evidence a judge can verify unaided (public repo, no
// login), so the response must reconcile against the real Base while never
// carrying anything a judge could read as someone's personal data. Only the
// six fields aggregateVocMetrics actually consumes are named here — pulling
// the whole VocRecord in and trusting that JSON.stringify of VocMetrics
// "happens to" drop 原始内容/record_id would make that guarantee an accident
// of the current field list rather than something this file enforces.
type DashboardRecord = Pick<
  VocRecord,
  "state" | "polarity" | "dimensions" | "channel" | "ticketOpenedAt" | "closedAt"
>;

type DashboardRouteDependencies = Readonly<{
  listAll: () => Promise<readonly DashboardRecord[]>;
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
    // One guard around the entire handler: this is a public, unauthenticated
    // page a competition judge opens directly, so an unguarded read that
    // throws must never surface as Next.js's opaque uncaught 500 — it must
    // read as "the Base is temporarily unreachable", not "the site is
    // broken".
    try {
      const records = await dependencies.listAll();
      const options =
        dependencies.manualMinutesPerRecord === undefined
          ? {}
          : { manualMinutesPerRecord: dependencies.manualMinutesPerRecord };
      const metrics = aggregateVocMetrics(records.map(toMetricsInput), options);
      return Response.json(metrics);
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
type VocRecordsRead =
  | Readonly<{ ok: true; records: readonly DashboardRecord[] }>
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
  listAll: async () => {
    const result = await readVocRecordsCached();
    if (!result.ok) {
      throw new Error("VOC Bitable read failed");
    }
    return result.records;
  },
  manualMinutesPerRecord: ASSUMED_MANUAL_MINUTES_PER_RECORD,
};

export const GET = createDashboardRoute(defaultDependencies);

// Single source of truth for the page: same cached read, same assumed
// baseline, same aggregation the JSON API uses — a judge comparing the
// rendered page against a direct `curl /api/voc/dashboard` sees identical
// numbers because both paths run through this one function.
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
