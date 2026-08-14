"use client";

// Must precede every Arco import: Arco reads createRoot off the "react-dom" root
// export, where React 19 no longer puts it, and silently falls back to the deleted
// ReactDOM.render. src/features/workbench/arco-react19.test.tsx fails if it goes away.
import "@arco-design/web-react/lib/_util/react-19-adapter";
import "@arco-design/web-react/dist/css/arco.css";

import { Layout, Menu, Tag } from "@arco-design/web-react";
import {
  IconApps,
  IconBug,
  IconClockCircle,
  IconDashboard,
  IconDesktop,
  IconFile,
  IconList,
  IconUser,
  IconUserAdd,
} from "@arco-design/web-react/icon";
import Link from "next/link";

import { filterHref, type QueryPatch } from "../src/features/workbench/href";
import {
  QUEUES,
  type QueueKey,
  type WorkbenchQuery,
} from "../src/features/workbench/query";

// One icon per queue, so the sider is scannable by shape before it is read. Keyed by
// QueueKey rather than by position: a reordered QUEUES array must not silently
// reassign every icon.
const QUEUE_ICON: Readonly<Record<QueueKey, React.ReactNode>> = {
  open: <IconList />,
  overdue: <IconClockCircle />,
  unassigned: <IconUserAdd />,
  failed: <IconBug />,
  all: <IconApps />,
};

export type ConsoleSiderProps = Readonly<{
  // Carried through every destination so the nine filters, the search and the sort
  // survive a section switch, and so the detail page's sider links land back on the
  // list the operator came from rather than on a default view. The record-scoped
  // drill-downs are the exception — see `destination` below.
  query: WorkbenchQuery;
  // Null when the page could not read them. A missing count renders as no tag at
  // all, never as 0: "no overdue tickets" and "we don't know" are different facts,
  // and 0 is the one that reads as good news.
  queueCounts: Readonly<Record<QueueKey, number>> | null;
  userCount: number | null;
  deviceCount: number | null;
  // Null on the ticket detail page: a ticket is not one of these five destinations,
  // and highlighting one would claim the operator is somewhere they are not.
  selectedKey: string | null;
  // How the host page navigates. The console wraps this in a transition so its own
  // Spin can cover the wait; the detail page pushes and lets the route change.
  navigate: (href: string) => void;
}>;

// The console's left column, shared by the list view and the ticket detail page.
// Extracted when the detail page grew a sider: a second hand-written copy of these
// nine destinations would have started drifting from this one immediately.
export function ConsoleSider({
  query,
  queueCounts,
  userCount,
  deviceCount,
  selectedKey,
  navigate,
}: ConsoleSiderProps) {
  const count = (value: number | null) =>
    value === null ? null : <Tag size="small">{value}</Tag>;

  // Every destination drops the three record-scoped drill-downs. They are not view
  // state like the nine filters, the search or the sort — each one narrows the data to
  // a single identity or a single source case, set by clicking into one, and carrying
  // that into a top-level destination produced the worst kind of wrong screen: 待处理
  // counted 11 in this sider and listed 0 rows, with nothing visible to explain it,
  // because the identity filter is invisible on the ticket list. The same bug made
  // 用户画像 a no-op while a user was open — it rebuilt the page already on screen
  // instead of returning to the list.
  const destination = (patch: QueryPatch) =>
    filterHref(query, { user: null, device: null, ticketNo: null, ...patch });

  return (
    <Layout.Sider width={200} className="oc-console__sider">
      <div className="oc-console__brand">万护 OneCare</div>
      {/* Three top-level destinations, with the queues nested one level under 工单.
          An earlier version had no group heading at all, on the reasoning that a
          second group would never exist — which lasted exactly until these two
          arrived. The indentation that reasoning was really about belongs on level
          two, which is where it now is. */}
      <Menu
        selectedKeys={selectedKey === null ? [] : [selectedKey]}
        defaultOpenKeys={["tickets"]}
        style={{ width: "100%" }}
      >
        <Menu.Item
          key="metrics"
          onClick={() => navigate(destination({ section: "metrics" }))}
        >
          <IconDashboard />
          <span className="oc-console__nav-label">数据概览</span>
        </Menu.Item>

        <Menu.SubMenu
          key="tickets"
          title={
            <>
              <IconFile />
              <span className="oc-console__nav-label">工单</span>
            </>
          }
        >
          {QUEUES.map((queue) => (
            <Menu.Item
              key={queue.key}
              onClick={() =>
                navigate(destination({ section: "tickets", queue: queue.key }))
              }
            >
              {QUEUE_ICON[queue.key]}
              <span className="oc-console__nav-label">{queue.label}</span>
              {count(queueCounts === null ? null : queueCounts[queue.key])}
            </Menu.Item>
          ))}
        </Menu.SubMenu>

        <Menu.Item
          key="users"
          onClick={() => navigate(destination({ section: "users" }))}
        >
          <IconUser />
          <span className="oc-console__nav-label">用户画像</span>
          {count(userCount)}
        </Menu.Item>

        <Menu.Item
          key="devices"
          onClick={() => navigate(destination({ section: "devices" }))}
        >
          <IconDesktop />
          <span className="oc-console__nav-label">设备追踪</span>
          {count(deviceCount)}
        </Menu.Item>
      </Menu>

      {/* Pinned to the bottom of the sider by the flex rule on
          .arco-layout-sider-children: it is navigation, so it belongs in the
          navigation column, and it is the one destination that leaves the
          workbench, so it belongs at the far end of it. */}
      <div className="oc-console__sider-footer">
        <Link href="/?view=showcase">方案展示厅 →</Link>
      </div>
    </Layout.Sider>
  );
}
