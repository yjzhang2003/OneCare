import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { expect, it } from "vitest";

const ROOT = process.cwd();

// Anything that reaches the Bitable — directly, or through the cached readers in
// the dashboard route — pays cross-border latency on every call.
const BITABLE_MARKERS = [
  "createBitableClient",
  "getBitableClient",
  "readVocRecordsCached",
  "readWorkbenchCached",
  "getVocDashboardMetrics",
  // Runs the whole tagging shard for one record: an aily call, a Bitable write and a
  // Feishu push. A caller of it names no client of its own, so without this marker the
  // manual-analyze route looked region-neutral to this check while doing the most
  // cross-border work of anything in the repository.
  "analyzeOneRecord",
  // Creates a Feishu group and posts into it. Not a Bitable call, but the same
  // cross-border round trip this check exists to keep close to Hong Kong.
  "createWarRoomChat",
];

// Entry points Vercel turns into functions: route handlers and pages.
function entryPoints(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...entryPoints(path));
    } else if (/^(route|page)\.tsx?$/.test(name)) {
      found.push(relative(ROOT, path).split(sep).join("/"));
    }
  }
  return found;
}

function config() {
  const path = resolve(ROOT, "vercel.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as {
    regions?: string[];
    functions?: Record<string, { regions?: string[] }>;
    crons?: ReadonlyArray<{ path: string; schedule: string }>;
  };
}

// This assertion exists because the omission it catches actually shipped: the
// three API routes were pinned to hkg1 while `app/page.tsx` — which performs the
// heaviest Bitable call in the codebase, a full 3628-record scan — was left in
// the default region. From there, one page of that scan exceeded the client's
// per-request timeout and the whole read failed, so the deployed workbench showed
// "读取多维表格失败" with every count at zero.
//
// Derived from the filesystem rather than hardcoded, so the next entry point that
// talks to the Bitable and forgets its region fails here instead of in production.
it("pins every Bitable-touching entry point to Hong Kong", () => {
  const pinned = config()?.functions ?? {};

  const needsPinning = entryPoints(resolve(ROOT, "app")).filter((file) => {
    const source = readFileSync(resolve(ROOT, file), "utf8");
    return BITABLE_MARKERS.some((marker) => source.includes(marker));
  });

  expect(needsPinning.length).toBeGreaterThan(0);
  for (const file of needsPinning) {
    expect(pinned[file]?.regions, `${file} is not pinned to a region`).toEqual([
      "hkg1",
    ]);
  }
});

// The schedule is a legal once-a-day expression, not "* * * * *": the project's
// Vercel plan is Hobby (confirmed via api.vercel.com/v2/user, plan = "hobby"),
// and Hobby caps cron frequency at once per day — a more-frequent expression
// fails at deploy time, not silently at runtime. Manual/scripted invocation (with
// CRON_SECRET) is unaffected; only Vercel's own automatic scheduling is
// once-daily.
it("runs analyze on a once-daily Cron", () => {
  expect(config()?.crons).toEqual([
    { path: "/api/voc/analyze", schedule: "0 18 * * *" },
  ]);
});

// Left undefined deliberately: regions are declared per function above, and a
// top-level default would silently cover future functions that may not want it.
it("declares no top-level default region", () => {
  expect(config()?.regions).toBeUndefined();
});
