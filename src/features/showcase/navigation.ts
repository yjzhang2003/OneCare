import type { ReactNode } from "react";

export const showcasePages = [
  { id: "home", label: "首页", index: "00" },
  { id: "perspectives", label: "四个视角", index: "01" },
  { id: "architecture", label: "五层引擎", index: "02" },
  { id: "team", label: "团队", index: "03" },
] as const;

export type ShowcasePageId = (typeof showcasePages)[number]["id"];
export type ShowcasePageContent = Record<ShowcasePageId, ReactNode>;

export function parseShowcaseHash(hash: string): ShowcasePageId {
  const candidate = hash.replace(/^#/, "");
  return showcasePages.some((page) => page.id === candidate)
    ? (candidate as ShowcasePageId)
    : "home";
}
