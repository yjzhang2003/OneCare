import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // `_`-prefixed identifiers are this repo's established convention for
    // intentionally-unused bindings (e.g. mock signatures kept for accurate
    // `.mock.calls` typing). Declare that convention instead of deleting the
    // bindings it protects.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  globalIgnores([".next/**", ".vercel/**", ".worktrees/**", "next-env.d.ts"]),
]);
