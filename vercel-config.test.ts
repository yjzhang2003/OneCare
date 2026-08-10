import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

it("deploys the Feishu callback and every VOC route in Hong Kong, with analyze on a Cron", () => {
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
    crons: [{ path: "/api/voc/analyze", schedule: "* * * * *" }],
  });
  expect(config?.regions).toBeUndefined();
});
