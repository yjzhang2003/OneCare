"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import { Button, Message, Select, Space, Tag, Typography } from "@arco-design/web-react";
import { IconSend } from "@arco-design/web-react/icon";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { formatShanghaiTime } from "../src/features/workbench/presentation";

// 派工: who goes on site, chosen from the 工程师 rows in 人员管理 and nobody else.
//
// The engineer never opens this console — what this control produces is a card in their
// Feishu with the machine, the customer's words, and this device's history on it. The
// panel itself stays bare: the button's own label says what it does, and a paragraph
// under a control explaining the control is documentation on the wrong surface.
export type DispatchPanelProps = Readonly<{
  recordId: string;
  // Names only — the engineer's open_id never reaches the browser for display, it is
  // only ever posted back as the choice.
  engineers: readonly Readonly<{ openId: string; name: string }>[];
  engineerNames: readonly string[];
  dispatchedAt: string | null;
  // Terminal tickets are not dispatched; the panel says so instead of offering it.
  state: string;
}>;

const TERMINAL = new Set(["已闭环", "无需跟进"]);

export function DispatchPanel({
  recordId,
  engineers,
  engineerNames,
  dispatchedAt,
  state,
}: DispatchPanelProps) {
  const router = useRouter();
  const [choice, setChoice] = useState<string>("");
  const [sending, setSending] = useState(false);
  // A ref, not the state: a double click before React re-renders would send the
  // engineer two task cards for the same ticket.
  const inFlight = useRef(false);

  async function dispatch() {
    if (inFlight.current || choice.length === 0) return;
    inFlight.current = true;
    setSending(true);
    try {
      const response = await fetch(
        `/api/voc/tickets/${encodeURIComponent(recordId)}/dispatch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engineerOpenId: choice }),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "派工失败，请稍后重试";

      if (!response.ok) {
        Message.error({ content: message, duration: 6000 });
        return;
      }
      Message.success(message);
      setChoice("");
      router.refresh();
    } catch {
      Message.error("网络异常，请检查连接后重试");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  const assigned = engineerNames.length > 0;

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      {assigned ? (
        <Space size="small" wrap>
          <Tag color="green">上门工程师 {engineerNames.join("、")}</Tag>
          <Typography.Text type="secondary">
            派工于 {formatShanghaiTime(dispatchedAt) ?? "—"}
          </Typography.Text>
        </Space>
      ) : (
        <Typography.Text type="secondary">还没有派工</Typography.Text>
      )}

      {TERMINAL.has(state) ? (
        <Typography.Text type="secondary">{state}的工单不再派工。</Typography.Text>
      ) : engineers.length === 0 ? (
        <Typography.Text type="secondary">
          人员管理里还没有工程师，先去加一个再派工。
        </Typography.Text>
      ) : (
        <Space size="small">
          <Select
            placeholder={assigned ? "改派给别的工程师" : "选择上门工程师"}
            style={{ width: 180 }}
            size="small"
            value={choice || undefined}
            options={engineers.map((engineer) => ({
              label: engineer.name || engineer.openId,
              value: engineer.openId,
            }))}
            onChange={(value) => setChoice(value as string)}
          />
          <Button
            size="small"
            type="primary"
            icon={<IconSend />}
            loading={sending}
            disabled={choice.length === 0}
            onClick={() => void dispatch()}
          >
            派工
          </Button>
        </Space>
      )}
    </Space>
  );
}
