"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import { Avatar, Dropdown, Menu, Space } from "@arco-design/web-react";
import { IconExport } from "@arco-design/web-react/icon";

import type { AuthUser } from "../src/features/auth/types";

// Who is signed in, and the way out. A form post rather than a fetch: /api/auth/logout
// clears the cookie and redirects, and letting the browser follow that redirect is what
// makes the next page load see the session actually gone.
export function AccountMenu({ user }: Readonly<{ user: AuthUser }>) {
  return (
    <Dropdown
      // Click, not Arco's default hover: this menu's only item signs you out, and a
      // menu that opens because the pointer passed over the avatar is a menu that gets
      // opened by accident.
      trigger="click"
      position="br"
      droplist={
        <Menu>
          <Menu.Item key="logout">
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="oc-console__logout">
                <IconExport />
                <span>退出登录</span>
              </button>
            </form>
          </Menu.Item>
        </Menu>
      }
    >
      <Space size="small" align="center" className="oc-console__account">
        <span className="oc-console__user">{user.name}</span>
        {/* avatarUrl is optional on AuthUser — Feishu does not always return one — so
            the fallback is the name's first character rather than a broken image. */}
        <Avatar size={30} style={{ backgroundColor: "rgb(var(--primary-6))" }}>
          {user.avatarUrl ? (
            // A plain <img>, not next/image: the avatar host is whatever Feishu's OAuth
            // user-info returned, so it cannot be declared in images.remotePatterns at
            // build time.
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={user.name} src={user.avatarUrl} />
          ) : (
            (Array.from(user.name)[0] ?? "万")
          )}
        </Avatar>
      </Space>
    </Dropdown>
  );
}
