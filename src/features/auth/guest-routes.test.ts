import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// 评委通道 hands a session to anyone who clicks a link on the public front page. The
// console hides every control that writes, but a hidden button is not a permission — so
// the rule this test defends is: every route that can change something, send something,
// or spend an aily call refuses a guest.
//
// A new write route added later fails here rather than silently accepting a visitor.
const API_ROOT = join(process.cwd(), "app", "api");

// Routes deliberately open to a guest, each for a stated reason.
const OPEN: Readonly<Record<string, string>> = {
  "voc/notifications/route.ts":
    "marks the caller's own inbox read; a guest has no notifications to mark",
  "voc/profiles/[kind]/[id]/analyze/route.ts":
    "computes the rule-engine insight and returns it; writes nothing",
  "feishu/events/route.ts": "Feishu's own webhook, signed, never a browser session",
  "auth/logout/route.ts": "clearing your own cookie",
  "voc/analyze/route.ts":
    "the Cron shard; gated on a bearer secret, never on a browser session",
};

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === "route.ts" ? [path] : [];
  });
}

describe("guest sessions cannot write", () => {
  it("every mutating API route refuses a guest", () => {
    const unguarded: string[] = [];

    for (const path of routeFiles(API_ROOT)) {
      const key = relative(API_ROOT, path);
      if (key in OPEN) continue;

      const source = readFileSync(path, "utf8");
      const mutates = /export const (POST|PATCH|PUT|DELETE)\b/.test(source);
      if (!mutates) continue;
      if (!source.includes("refuseGuestWrite")) unguarded.push(key);
    }

    expect(unguarded).toEqual([]);
  });
});
