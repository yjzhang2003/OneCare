import type { ReactNode } from "react";

export function StatusTag({ children }: { children: ReactNode }) {
  return <span className="status-tag">{children}</span>;
}
