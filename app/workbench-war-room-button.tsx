"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import { Button, Message, Popconfirm, Tooltip } from "@arco-design/web-react";
import { IconUserGroup } from "@arco-design/web-react/icon";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// 拉群处理 on a ticket, the same move 用户画像 / 设备追踪 already offer on an identity.
//
// Until this existed, a ticket could only get a协同群 through the escalation card the
// tagging pipeline pushes when it judges 严重度 = 高 — which happens once, at the moment
// of tagging, and never again. Everything downstream of the click is unchanged; this is
// a second door onto the same chain.
export type WarRoomButtonProps = Readonly<{
  recordId: string;
  // Whether 协同群 ID already names a group. A ticket that has one has nothing to ask
  // for, so the button says where the group is instead of offering to make a second.
  hasWarRoom: boolean;
}>;

export function WarRoomButton({ recordId, hasWarRoom }: WarRoomButtonProps) {
  const router = useRouter();
  const [pulling, setPulling] = useState(false);
  // A ref, not the state above: two clicks dispatched before React re-renders would both
  // read it as false, and the second one would be a second real Feishu group.
  const inFlight = useRef(false);

  async function pull() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPulling(true);
    try {
      const response = await fetch(
        `/api/voc/tickets/${encodeURIComponent(recordId)}/war-room`,
        { method: "POST" },
      );
      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "拉群失败，请稍后重试";

      if (!response.ok) {
        Message.error({ content: message, duration: 6000 });
        return;
      }
      // "已存在" is not a success to celebrate — the operator asked for a group and is
      // being told where it already is.
      if ((payload as { created?: unknown }).created === true) Message.success(message);
      else Message.info(message);
      router.refresh();
    } catch {
      Message.error("网络异常，请检查连接后重试");
    } finally {
      inFlight.current = false;
      setPulling(false);
    }
  }

  if (hasWarRoom) {
    return (
      <Tooltip content="这条工单已经有协同群了，在飞书里打开即可">
        <Button size="small" icon={<IconUserGroup />} disabled>
          协同群已建
        </Button>
      </Tooltip>
    );
  }

  return (
    // Confirmed before it fires: a group is outward-facing — it appears in colleagues'
    // Feishu and cannot be deleted from here — so it is never one stray click away.
    <Popconfirm
      title="为这条工单建协同群？"
      content="会创建一个飞书群，拉入负责人和你，并把工单卡发进群。群建出来就删不掉了。"
      onOk={() => void pull()}
    >
      <Button size="small" icon={<IconUserGroup />} loading={pulling}>
        拉群处理
      </Button>
    </Popconfirm>
  );
}
