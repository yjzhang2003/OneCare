import type { WorkbenchTicket } from "./data";

export const ABSENT = "—";

export function shortRecordNumber(recordNumber: string): string {
  return recordNumber.slice(-6);
}

export function formatShanghaiTime(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  const shifted = new Date(parsed + 8 * 3_600_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    ` ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}

export function formatHours(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

// Not truncated. It was cut at 60 characters because it rendered as a heading, and a
// heading that wraps to three lines looks broken — but the thing being cut is the one
// sentence saying what the ticket is about, and "…遇" is not that sentence. The line is
// body text now, so it can simply be complete.
export function ticketTitle(
  ticket: Pick<WorkbenchTicket, "summary" | "content">,
): string {
  return ticket.summary.trim() || ticket.content.trim() || "未提供反馈内容";
}

export const SEVERITY_COLOR: Readonly<Record<string, string>> = {
  高: "red",
  中: "orange",
  低: "gray",
};

export const STATE_COLOR: Readonly<Record<string, string>> = {
  待分析: "gray",
  分析失败: "red",
  已分析: "arcoblue",
  无需跟进: "gray",
  待跟进: "orange",
  跟进中: "arcoblue",
  待闭环: "purple",
  已闭环: "green",
};
