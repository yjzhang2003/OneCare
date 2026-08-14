"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "@arco-design/web-react/lib/_util/react-19-adapter";
import "@arco-design/web-react/dist/css/arco.css";

import { Button, Card, Message, Space, Tag, Typography } from "@arco-design/web-react";
import { IconRobot, IconUserGroup } from "@arco-design/web-react/icon";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { ProfileInsight } from "../src/features/profiles/insight";

// 画像分析 / 设备预警 on an identity's page, plus the 拉群处理 the operator does with it.
//
// The analysis is produced by a rule engine, not a model, and the card says which —
// `producedBy` comes back from the route and is rendered rather than described. Until
// there is an aily skill for these two views, that label is the difference between a
// demo that can be shown to a judge and one that misrepresents what it does.
export type ProfileInsightPanelProps = Readonly<{
  kind: "user" | "device";
  id: string;
  // How many of this identity's records are still open, which is what makes 拉群 worth
  // offering before any analysis has been run.
  open: number;
}>;

const LEVEL_COLOR: Readonly<Record<string, string>> = {
  高: "red",
  中: "orange",
  低: "gray",
};

export function ProfileInsightPanel({ kind, id, open }: ProfileInsightPanelProps) {
  const router = useRouter();
  const [insight, setInsight] = useState<ProfileInsight | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [pulling, setPulling] = useState(false);
  // Refs, not the state above: a click dispatched before React re-renders would read the
  // state as false and fire a second request — for 拉群 that would mean a second Feishu
  // group. The same reason the ticket page's 立即分析 uses one.
  const analyzeInFlight = useRef(false);
  const pullInFlight = useRef(false);

  const isUser = kind === "user";
  const base = `/api/voc/profiles/${kind}/${encodeURIComponent(id)}`;

  async function post(url: string): Promise<unknown> {
    const response = await fetch(url, { method: "POST" });
    const payload: unknown = await response.json().catch(() => null);
    const message =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : null;
    if (!response.ok) {
      throw new Error(message ?? "操作失败，请稍后重试");
    }
    return payload;
  }

  async function analyze() {
    if (analyzeInFlight.current) return;
    analyzeInFlight.current = true;
    setAnalyzing(true);
    try {
      const payload = await post(`${base}/analyze`);
      const next = (payload as { insight?: ProfileInsight }).insight;
      if (!next) throw new Error("分析没有返回结果");
      setInsight(next);
    } catch (error) {
      Message.error(error instanceof Error ? error.message : "分析失败，请稍后重试");
    } finally {
      analyzeInFlight.current = false;
      setAnalyzing(false);
    }
  }

  async function pullGroup() {
    if (pullInFlight.current) return;
    pullInFlight.current = true;
    setPulling(true);
    try {
      const payload = await post(`${base}/war-room`);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "协同群已就绪";
      // A group that already existed is not a success to celebrate — the operator asked
      // for one and is being told where it is.
      const created = (payload as { created?: unknown }).created === true;
      if (created) Message.success(message);
      else Message.info(message);
      // The group id is not on screen anywhere yet; refreshing keeps this page honest if
      // the server starts showing it.
      router.refresh();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : "拉群失败，请稍后重试");
    } finally {
      pullInFlight.current = false;
      setPulling(false);
    }
  }

  return (
    <Card
      className="oc-profile-insight"
      title={isUser ? "画像分析" : "设备预警"}
      extra={
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<IconRobot />}
            loading={analyzing}
            onClick={() => void analyze()}
          >
            {insight ? "重新分析" : "立即分析"}
          </Button>
          <Button
            size="small"
            icon={<IconUserGroup />}
            loading={pulling}
            onClick={() => void pullGroup()}
          >
            拉群处理
          </Button>
        </Space>
      }
    >
      {insight === null ? (
        <Typography.Text type="secondary">
          {open > 0
            ? `还有 ${open} 条未闭环，点「立即分析」看${isUser ? "画像" : "预警"}结论`
            : `点「立即分析」看${isUser ? "画像" : "预警"}结论`}
        </Typography.Text>
      ) : (
        <Space direction="vertical" size="medium" style={{ width: "100%" }}>
          <Space wrap>
            <Tag color={LEVEL_COLOR[insight.level] ?? "gray"}>
              {isUser ? "关注度" : "预警等级"} {insight.level}
            </Tag>
            {insight.labels.map((label) => (
              <Tag key={label}>{label}</Tag>
            ))}
          </Space>

          <Typography.Text style={{ fontWeight: 600 }}>
            {insight.headline}
          </Typography.Text>

          {insight.signals.length > 0 && (
            <div className="oc-profile-insight__block">
              <Typography.Text type="secondary">依据</Typography.Text>
              <ul>
                {insight.signals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            </div>
          )}

          {insight.actions.length > 0 && (
            <div className="oc-profile-insight__block">
              <Typography.Text type="secondary">建议动作</Typography.Text>
              <ul>
                {insight.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Rendered from the response, not hardcoded: when an aily skill replaces the
              rule engine behind the route, this line changes with it. */}
          <Typography.Text type="secondary" className="oc-profile-insight__by">
            由 {insight.producedBy} 生成
          </Typography.Text>
        </Space>
      )}
    </Card>
  );
}
