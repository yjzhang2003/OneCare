import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OwnerRuleRecord } from "../src/features/voc/owner-rules";
import { OwnersPane } from "./workbench-owners";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

const CHANNELS = ["400 客服", "电商评价", "小红书"] as const;
const CATEGORIES = ["冰箱", "洗衣机"] as const;

function rule(overrides: Partial<OwnerRuleRecord> = {}): OwnerRuleRecord {
  return {
    recordId: "rec-1",
    scope: "400 客服/冰箱",
    openId: "ou_a",
    ownerName: "黄齐",
    fallback: false,
    ...overrides,
  };
}

function pane(rules: readonly OwnerRuleRecord[], unavailable = false) {
  return render(
    <OwnersPane
      rules={rules}
      members={[{ openId: "ou_a", name: "黄齐" }]}
      channels={CHANNELS}
      categories={CATEGORIES}
      unavailable={unavailable}
    />,
  );
}

describe("OwnersPane", () => {
  it("shows a rule as its two halves, so a channel-wide rule reads as one", () => {
    pane([rule(), rule({ recordId: "rec-2", scope: "电商评价", ownerName: "张禹健" })]);

    expect(screen.getByText("400 客服")).toBeInTheDocument();
    expect(screen.getByText("冰箱")).toBeInTheDocument();
    expect(screen.getByText("黄齐")).toBeInTheDocument();
    expect(screen.getByText("全部品类")).toBeInTheDocument();
  });

  // The three states below are the reason the routing health sits above the table: none
  // of them is visible by reading the rows, and each one loses tickets quietly.
  it("says so when nothing is 兜底, because unmatched tickets then reach nobody", () => {
    pane([rule()]);
    expect(
      screen.getByText("没有兜底负责人——匹配不到规则的工单将无人接收。"),
    ).toBeInTheDocument();
  });

  it("names the channels that have no rule of their own", () => {
    pane([rule({ fallback: true })]);
    expect(screen.getByText(/电商评价、小红书 没有专属规则/)).toBeInTheDocument();
  });

  it("names a duplicated scope, which is dead the moment it is written", () => {
    pane([rule({ fallback: true }), rule({ recordId: "rec-2" })]);
    expect(screen.getByText(/重复范围：400 客服\/冰箱/)).toBeInTheDocument();
  });

  it("distinguishes an unreadable table from an empty one", () => {
    pane([], true);
    expect(screen.getByText("负责人表读不出来，请稍后重试。")).toBeInTheDocument();
    // No health claims are made about rules that were never read.
    expect(screen.queryByText(/没有兜底负责人/)).not.toBeInTheDocument();
  });

  it("opens the editor prefilled from the row, not empty", () => {
    pane([rule({ fallback: true })]);
    fireEvent.click(screen.getByText("编辑"));

    expect(screen.getByText("编辑路由规则")).toBeInTheDocument();
    expect(screen.getByText("设为兜底负责人（匹配不到任何规则的工单归他，只能有一个）"))
      .toBeInTheDocument();
  });

  it("cannot save a new rule until a channel and a person are chosen", () => {
    pane([rule({ fallback: true })]);
    fireEvent.click(screen.getByText("新增规则"));

    expect(screen.getByText("新增路由规则")).toBeInTheDocument();
    const ok = screen.getByRole("button", { name: "确定" });
    expect(ok).toBeDisabled();
  });
});
