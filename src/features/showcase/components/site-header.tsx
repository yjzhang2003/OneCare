import Link from "next/link";

import type { AuthUser } from "../../auth/types";

const navigation = [
  { href: "#perspectives", label: "角色视角" },
  { href: "#architecture", label: "五层架构" },
  { href: "#scenario", label: "方案路径" },
  { href: "#team", label: "团队" },
] as const;

export function SiteHeader({ user }: { user: AuthUser | null }) {
  return (
    <header className="site-header public-header">
      <Link className="wordmark" href="/" aria-label="OneCare 首页">
        <span className="wordmark-mark" aria-hidden="true">
          1C
        </span>
        <span>
          ONECARE
          <small>AI 用户服务闭环引擎</small>
        </span>
      </Link>

      <nav className="public-nav" aria-label="主页章节">
        {navigation.map((item) => (
          <a href={item.href} key={item.href}>
            {item.label}
          </a>
        ))}
      </nav>

      <a
        className="header-cta"
        href={user ? "/dashboard" : "/api/auth/feishu/start"}
      >
        {user ? "工作台" : "飞书登录"}
        <span aria-hidden="true">↗</span>
      </a>
    </header>
  );
}
