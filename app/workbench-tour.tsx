"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import { Button, Space, Typography } from "@arco-design/web-react";
import { useCallback, useEffect, useState } from "react";

// 引导: five stops for someone who has never seen this console and has a few minutes.
//
// Written rather than installed: Arco has no Tour component, and the alternative — a
// tour library — would be a dependency carrying a lot of behaviour for five tooltips.
// Each step names a real element by `data-tour`, so a step whose target disappears is a
// step this component skips rather than an arrow pointing at nothing.
export type TourStep = Readonly<{
  target: string;
  title: string;
  body: string;
}>;

export const JUDGE_TOUR: readonly TourStep[] = [
  {
    target: "queues",
    title: "五个队列",
    body: "工单按「该看哪一批」分：待处理、超时风险、未分配、分析异常、全部。数字是全量统计，不是当前页。",
  },
  {
    target: "filters",
    title: "九类筛选 + 搜索",
    body: "可叠加，例如 冰箱 + 差评 + 维修时间。搜索认原文、机型、记录编号，也认 400 工单号。筛选状态全部写在 URL 里，链接发给别人打开就是同一屏。",
  },
  {
    target: "table",
    title: "点开任意一条",
    body: "详情页里有这条工单的全链路：AI 分析结论、回复话术、客服负责人与上门工程师、协同群状态。",
  },
  {
    target: "profiles",
    title: "用户画像 / 设备追踪",
    body: "把散落的记录按人、按机器聚起来：600 个多次反馈用户、206 台重复报修设备，用来回答「这个用户在升级吗」「这台机器是不是修不好」。",
  },
  {
    target: "owners",
    title: "人员管理",
    body: "决定工单去谁那里的路由表：客服按渠道接单、工程师可被派工、管理员不受负责人限制。",
  },
];

type Rect = Readonly<{ top: number; left: number; width: number; height: number }>;

function rectOf(target: string): Rect | null {
  const element = document.querySelector(`[data-tour="${target}"]`);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

export function WorkbenchTour({
  open,
  steps = JUDGE_TOUR,
  onClose,
}: Readonly<{ open: boolean; steps?: readonly TourStep[]; onClose: () => void }>) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const measure = useCallback(() => {
    if (!open) return;
    // A step whose element is not on this screen is skipped rather than drawn against
    // the viewport's top-left corner.
    let cursor = index;
    let found = rectOf(steps[cursor]?.target ?? "");
    while (found === null && cursor < steps.length - 1) {
      cursor += 1;
      found = rectOf(steps[cursor]?.target ?? "");
    }
    if (cursor !== index) setIndex(cursor);
    setRect(found);
  }, [index, open, steps]);

  useEffect(() => {
    if (!open) return;
    // Deferred a tick: the console renders its table after the first paint, and a
    // measurement taken before that lands on the wrong element.
    const first = setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(first);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, open]);

  if (!open) return null;
  const step = steps[index];
  if (!step) return null;

  // Below the target when there is room, above it otherwise; clamped so the card never
  // hangs off either edge.
  const cardWidth = 320;
  const below = rect ? rect.top + rect.height + 12 : 120;
  const room = typeof window !== "undefined" ? window.innerHeight : 900;
  const top = rect && below + 190 > room ? Math.max(12, rect.top - 200) : below;
  const left = rect
    ? Math.min(
        Math.max(12, rect.left),
        (typeof window !== "undefined" ? window.innerWidth : 1440) - cardWidth - 12,
      )
    : 24;

  return (
    <div className="oc-tour" role="dialog" aria-label="使用引导">
      {rect && (
        <div
          className="oc-tour__spot"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      <div className="oc-tour__card" style={{ top, left, width: cardWidth }}>
        <Typography.Text style={{ fontWeight: 600 }}>{step.title}</Typography.Text>
        <Typography.Paragraph style={{ margin: "6px 0 12px" }}>
          {step.body}
        </Typography.Paragraph>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Text type="secondary">
            {index + 1} / {steps.length}
          </Typography.Text>
          <Space size="small">
            <Button size="small" onClick={onClose}>
              跳过
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                if (index + 1 >= steps.length) onClose();
                else setIndex(index + 1);
              }}
            >
              {index + 1 >= steps.length ? "开始使用" : "下一步"}
            </Button>
          </Space>
        </Space>
      </div>
    </div>
  );
}
