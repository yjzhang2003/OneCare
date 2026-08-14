import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// An unclosed block in a stylesheet does not fail a build, a lint or a type check. It
// silently swallows every rule that follows it, and the symptom shows up somewhere
// unrelated — a chart with zero-width bars, a sider whose counts stopped lining up.
//
// That is not hypothetical: an `@media (max-width: 760px) {` shipped unclosed, so every
// rule appended to this file afterwards became mobile-only. The sider alignment
// regressed in production without anyone noticing, and the chart stylesheet added days
// later never applied at all. Both looked like CSS that had been written wrong.
const source = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

// Braces inside comments are not structure.
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("globals.css structure", () => {
  it("closes every block it opens", () => {
    const css = stripComments(source);
    let depth = 0;
    let line = 1;
    const unbalanced: string[] = [];

    for (const char of css) {
      if (char === "\n") line += 1;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth < 0) {
          unbalanced.push(`第 ${line} 行多出一个 }`);
          depth = 0;
        }
      }
    }

    expect(unbalanced).toEqual([]);
    expect(depth, `文件结束时仍有 ${depth} 个未闭合的块`).toBe(0);
  });

  // The specific shape that caused it: a file ending inside a media query means the
  // next person to append a rule gets a mobile-only rule and no warning.
  it("does not end inside a media query", () => {
    const css = stripComments(source);
    const lastMedia = css.lastIndexOf("@media");
    if (lastMedia === -1) return;

    let depth = 0;
    for (const char of css.slice(lastMedia)) {
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
    }
    expect(depth, "最后一个 @media 没有闭合").toBe(0);
  });
});
