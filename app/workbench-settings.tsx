"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import { Button, Message, Modal, Space, Typography } from "@arco-design/web-react";
import { IconSettings } from "@arco-design/web-react/icon";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// 设置, and inside it the developer options a demo needs: the two triggers that start a
// chain without waiting for the nightly Cron or for a customer to complain.
const CANNED_TICKETS = [
  {
    channel: "400 客服",
    category: "电视",
    model: "海信 65E5Q-PRO",
    content:
      "电视买回来两个月黑屏三次，师傅上门两次都说是软件问题，今天又黑了，要求换机或者给个明确说法",
  },
  {
    channel: "电商评价",
    category: "冰箱",
    model: "容声 BCD-331WD11MP",
    content:
      "冰箱冷冻室不制冷，报修后等了四天才上门，师傅换了配件还是不行，第二次约的时间又没来人",
  },
  {
    channel: "社媒",
    category: "空调",
    model: "海信 KFR-35GW",
    content:
      "空调装完就漏水，联系客服推给安装队，安装队推给售后，来回三天没人管，天天在家等",
  },
] as const;

export function SettingsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<"ticket" | "device" | null>(null);
  const inFlight = useRef(false);
  const next = useRef(0);

  async function post(url: string, body?: unknown): Promise<unknown> {
    const response = await fetch(url, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const payload: unknown = await response.json().catch(() => null);
    const message =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : "操作失败，请稍后重试";
    if (!response.ok) throw new Error(message);
    Message.success(message);
    return payload;
  }

  async function generateTicket() {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning("ticket");
    try {
      const draft = CANNED_TICKETS[next.current % CANNED_TICKETS.length];
      next.current += 1;
      const payload = await post("/api/voc/tickets", {
        ...draft,
        userRef: "",
        deviceRef: "",
      });
      const recordNumber = (payload as { recordNumber?: unknown }).recordNumber;
      setOpen(false);
      if (typeof recordNumber === "string" && recordNumber.length > 0) {
        router.push(`/workbench/tickets/${encodeURIComponent(recordNumber)}`);
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : "生成失败");
    } finally {
      inFlight.current = false;
      setRunning(null);
    }
  }

  async function triggerDeviceAlert() {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning("device");
    try {
      const payload = await post("/api/voc/demo/device-alert");
      const href = (payload as { href?: unknown }).href;
      setOpen(false);
      if (typeof href === "string" && href.length > 0) router.push(href);
    } catch (error) {
      Message.error(error instanceof Error ? error.message : "推送失败");
    } finally {
      inFlight.current = false;
      setRunning(null);
    }
  }

  return (
    <>
      <button
        type="button"
        className="oc-console__sider-settings"
        onClick={() => setOpen(true)}
      >
        <IconSettings />
        <span>设置</span>
      </button>
      <Modal
        title="设置"
        visible={open}
        unmountOnExit
        footer={null}
        onCancel={() => setOpen(false)}
      >
        <Space direction="vertical" size="medium" style={{ width: "100%" }}>
          <Typography.Text style={{ fontWeight: 600 }}>开发者选项</Typography.Text>
          <Space size="small" wrap>
            <Button
              type="primary"
              loading={running === "ticket"}
              onClick={() => void generateTicket()}
            >
              生成演示工单
            </Button>
            <Button loading={running === "device"} onClick={() => void triggerDeviceAlert()}>
              触发设备异常预警
            </Button>
          </Space>
        </Space>
      </Modal>
    </>
  );
}
