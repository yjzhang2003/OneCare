"use client";

import { useEffect, useRef, useState } from "react";

import type { AuthUser } from "../../auth/types";
import {
  parseShowcaseHash,
  showcasePages,
  type ShowcasePageContent,
  type ShowcasePageId,
} from "../navigation";
import { SiteHeader } from "./site-header";

type ShowcaseNavigatorProps = {
  user: AuthUser | null;
  authError?: string;
  pages: ShowcasePageContent;
};

export function ShowcaseNavigator({
  user,
  authError,
  pages,
}: ShowcaseNavigatorProps) {
  const [activePage, setActivePage] = useState<ShowcasePageId>("home");
  const [isReady, setIsReady] = useState(false);
  const activePageRef = useRef<ShowcasePageId>("home");
  const pageElements = useRef<Partial<Record<ShowcasePageId, HTMLElement | null>>>(
    {},
  );

  function activate(nextPage: ShowcasePageId, resetScroll = true) {
    if (nextPage === activePageRef.current) {
      return;
    }

    if (resetScroll) {
      pageElements.current[nextPage]?.scrollTo({ behavior: "auto", top: 0 });
    }
    activePageRef.current = nextPage;
    setActivePage(nextPage);
  }

  function navigate(nextPage: ShowcasePageId) {
    if (nextPage === activePageRef.current) {
      return;
    }

    window.history.pushState(null, "", `#${nextPage}`);
    activate(nextPage);
  }

  useEffect(() => {
    const syncFromLocation = () => {
      activate(parseShowcaseHash(window.location.hash));
    };

    syncFromLocation();
    setIsReady(true);
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);

    return () => {
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      pageElements.current[activePage]
        ?.querySelector<HTMLElement>("[data-showcase-title]")
        ?.focus({ preventScroll: true });
    }, 600);

    return () => window.clearTimeout(focusTimer);
  }, [activePage, isReady]);

  const activeIndex = showcasePages.findIndex((page) => page.id === activePage);

  return (
    <>
      <SiteHeader
        activePage={activePage}
        onNavigate={navigate}
        user={user}
      />

      {authError ? (
        <div className="auth-notice" role="alert">
          <span>登录提示</span>
          {authError}
        </div>
      ) : null}

      <main
        className="showcase-viewport"
        data-ready={isReady ? "true" : "false"}
      >
        {showcasePages.map((page, index) => {
          const isActive = page.id === activePage;
          const position = isActive
            ? "active"
            : index < activeIndex
              ? "before"
              : "after";

          return (
            <section
              aria-hidden={isActive ? undefined : true}
              aria-label={page.label}
              className="showcase-page"
              data-page={page.id}
              data-position={position}
              data-testid={`page-${page.id}`}
              id={page.id}
              inert={isActive ? undefined : true}
              key={page.id}
              ref={(node) => {
                pageElements.current[page.id] = node;
              }}
            >
              {pages[page.id]}
            </section>
          );
        })}
      </main>
    </>
  );
}
