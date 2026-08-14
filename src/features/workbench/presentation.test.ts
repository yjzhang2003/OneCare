import { describe, expect, it } from "vitest";

import {
  formatHours,
  formatShanghaiTime,
  shortRecordNumber,
  ticketTitle,
} from "./presentation";

describe("workbench presentation", () => {
  it("formats shared ticket presentation", () => {
    expect(shortRecordNumber("VOC-123456789")).toBe("456789");
    expect(formatShanghaiTime("2026-08-13T01:30:00.000Z")).toBe(
      "2026-08-13 09:30",
    );
    expect(formatShanghaiTime("bad")).toBeNull();
    expect(formatHours(6.24)).toBe("6.2");
    expect(formatHours(12.6)).toBe("13");
  });

  it("builds a deterministic 60-character title", () => {
    expect(ticketTitle({ summary: " AI 摘要 ", content: "原文" })).toBe("AI 摘要");
    expect(ticketTitle({ summary: "", content: " 原文 " })).toBe("原文");
    expect(ticketTitle({ summary: " ", content: " " })).toBe("未提供反馈内容");
    // Whole, however long. It used to be cut at 60 characters for a heading that no
    // longer exists; what the cut removed was the end of the sentence explaining the
    // ticket, which is the only reason the line is on screen.
    const long = "冰".repeat(180);
    expect(ticketTitle({ summary: long, content: "" })).toBe(long);
  });
});
