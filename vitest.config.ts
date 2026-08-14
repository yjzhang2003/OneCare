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
      // Both need something `npm test` must not require: tests/runtime needs a built
      // app, tests/equiv needs the real database. Each carries its own run command.
      "tests/runtime",
      "tests/equiv",
      // Scratch space for the browser MCP; anything in it is a one-off, not a test.
      ".playwright-mcp",
    ],
  },
});
