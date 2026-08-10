import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

// The schedule is a legal once-a-day expression, not "* * * * *": the
// project's Vercel plan is Hobby (confirmed via api.vercel.com/v2/user,
// plan = "hobby"), and Hobby caps cron frequency at once per day — a
// more-frequent expression fails at deploy time, not silently at runtime.
// Manual/scripted invocation (with CRON_SECRET) is unaffected; only
// Vercel's own automatic scheduling is once-daily.
it("deploys the Feishu callback and every VOC route in Hong Kong, with analyze on a once-daily Cron", () => {
  const path = resolve(process.cwd(), "vercel.json");
  const config = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as {
        regions?: string[];
        functions?: Record<string, { regions?: string[] }>;
        crons?: ReadonlyArray<{ path: string; schedule: string }>;
      })
    : undefined;

  expect(config).toEqual({
    $schema: "https://openapi.vercel.sh/vercel.json",
    functions: {
      "app/api/feishu/events/route.ts": {
        regions: ["hkg1"],
      },
      "app/api/voc/analyze/route.ts": {
        regions: ["hkg1"],
      },
      "app/api/voc/dashboard/route.ts": {
        regions: ["hkg1"],
      },
    },
    crons: [{ path: "/api/voc/analyze", schedule: "0 18 * * *" }],
  });
  expect(config?.regions).toBeUndefined();
});
