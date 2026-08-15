"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import { Badge, Button, Dropdown, Empty, Typography } from "@arco-design/web-react";
import { IconNotification } from "@arco-design/web-react/icon";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Item = Readonly<{
  id: number;
  kind: string;
  recordNumber: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
}>;

// 站内消息. The same events the bot sends to Feishu, kept where the work is done — an
// operator who is already in the console should not have to alt-tab to find out that a
// ticket landed on them.
//
// Polled rather than pushed: the console has no socket, and a 30-second delay on a
// notification whose other copy already arrived in Feishu is not worth one.
const POLL_MS = 30_000;

function ago(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`;
}

export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<readonly Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/voc/notifications");
      const payload: unknown = await response.json().catch(() => null);
      if (typeof payload !== "object" || payload === null) return;
      const body = payload as { items?: Item[]; unread?: number };
      setItems(Array.isArray(body.items) ? body.items : []);
      setUnread(typeof body.unread === "number" ? body.unread : 0);
      setNow(Date.now());
    } catch {
      // A failed poll leaves whatever was on screen. The bell is not the place to
      // report that the network blinked.
    }
  }, []);

  useEffect(() => {
    // Deferred by a tick rather than called straight from the effect body: the first
    // load sets state, and setting state synchronously inside an effect is what the
    // react-hooks lint rule (rightly) refuses — it makes the first paint depend on a
    // fetch that has not happened yet.
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function markRead(id: number | null) {
    try {
      await fetch("/api/voc/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id === null ? {} : { id }),
      });
    } finally {
      void load();
    }
  }

  function open(item: Item) {
    void markRead(item.id);
    // Same-origin path, taken from the stored href so the notification and its Feishu
    // twin point at exactly the same ticket.
    const path = item.href.replace(/^https?:\/\/[^/]+/, "");
    router.push(path.length > 0 ? path : `/workbench/tickets/${item.recordNumber}`);
  }

  const list = (
    <div className="oc-console__inbox">
      <div className="oc-console__inbox-head">
        <Typography.Text style={{ fontWeight: 600 }}>消息</Typography.Text>
        {unread > 0 && (
          <Button size="mini" type="text" onClick={() => void markRead(null)}>
            全部已读
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <Empty description="还没有消息" />
      ) : (
        <ul className="oc-console__inbox-list">
          {items.map((item) => (
            <li
              key={item.id}
              className={
                item.readAt === null
                  ? "oc-console__inbox-item oc-console__inbox-item--unread"
                  : "oc-console__inbox-item"
              }
              onClick={() => open(item)}
            >
              <div className="oc-console__inbox-title">
                <span>{item.title}</span>
                <span className="oc-console__inbox-time">{ago(item.createdAt, now)}</span>
              </div>
              <div className="oc-console__inbox-body">{item.body}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Dropdown droplist={list} trigger="click" position="br">
      <Badge count={unread} dot={false} maxCount={99}>
        <Button
          type="text"
          shape="circle"
          icon={<IconNotification />}
          aria-label="消息"
        />
      </Badge>
    </Dropdown>
  );
}
