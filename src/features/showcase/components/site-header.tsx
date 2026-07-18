import Link from "next/link";

import type { AuthUser } from "../../auth/types";
import { showcasePages, type ShowcasePageId } from "../navigation";

type SiteHeaderProps = {
  user: AuthUser | null;
  activePage?: ShowcasePageId;
  onNavigate?: (page: ShowcasePageId) => void;
};

export function SiteHeader({
  user,
  activePage = "home",
  onNavigate,
}: SiteHeaderProps) {
  return (
    <header className="site-header public-header">
      <Link className="wordmark" href="/" aria-label="万护 OneCare 首页">
        <span className="wordmark-mark" aria-hidden="true">
          1C
        </span>
        <span>
          万护 ONECARE
          <small>AI 用户服务闭环引擎</small>
        </span>
      </Link>

      <nav className="public-nav" aria-label="主页章节">
        {showcasePages.map((page) => (
          <a
            aria-current={page.id === activePage ? "page" : undefined}
            href={`#${page.id}`}
            key={page.id}
            onClick={(event) => {
              if (onNavigate) {
                event.preventDefault();
                onNavigate(page.id);
              }
            }}
          >
            {page.label}
          </a>
        ))}
      </nav>

      <a
        className="header-cta"
        href={user ? "/dashboard" : "/api/auth/feishu/start"}
      >
        {user ? "工作台" : "飞书登录"}
      </a>
    </header>
  );
}
