import Link from "next/link";

import type { AuthUser } from "../../auth/types";
import { showcasePages, type ShowcasePageId } from "../navigation";
import { OneCareLogo } from "./onecare-logo";

type SiteHeaderProps = {
  user: AuthUser | null;
  activePage: ShowcasePageId;
  onNavigate: (page: ShowcasePageId, focusContent?: boolean) => void;
};

export function SiteHeader({
  activePage,
  onNavigate,
}: SiteHeaderProps) {
  return (
    <header className="site-header public-header">
      <Link className="wordmark" href="/" aria-label="万护 OneCare 首页">
        <span className="wordmark-mark" aria-hidden="true">
          <OneCareLogo decorative size={30} tone="light" />
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
              event.preventDefault();
              onNavigate(page.id, event.detail === 0);
            }}
          >
            {page.label}
          </a>
        ))}
      </nav>

      <a
        className="header-cta"
        href="/login"
      >
        飞书体验
      </a>
    </header>
  );
}
