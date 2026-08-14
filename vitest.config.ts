import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: [
      "node_modules",
      ".next",
      ".vercel",
      ".worktrees",
      // These need something `npm test` must not require: tests/runtime needs a built
      // app, tests/equiv needs the real database, tests/tools writes to it. Each
      // carries its own run command in its header.
      "tests/runtime",
      "tests/equiv",
      "tests/tools",
      // Scratch space for the browser MCP; anything in it is a one-off, not a test.
      ".playwright-mcp",
    ],
  },
});
