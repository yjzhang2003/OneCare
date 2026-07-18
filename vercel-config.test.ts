import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

it("deploys only the Feishu event callback in Hong Kong", () => {
  const path = resolve(process.cwd(), "vercel.json");
  const config = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as {
        regions?: string[];
        functions?: Record<string, { regions?: string[] }>;
      })
    : undefined;

  expect(config).toEqual({
    $schema: "https://openapi.vercel.sh/vercel.json",
    functions: {
      "app/api/feishu/events/route.ts": {
        regions: ["hkg1"],
      },
    },
  });
  expect(config?.regions).toBeUndefined();
});
