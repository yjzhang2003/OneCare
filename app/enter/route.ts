import { NextResponse } from "next/server";

import { getCurrentSession } from "../../src/features/auth/current-session";
import type { AuthUser } from "../../src/features/auth/types";
import { shouldStartAuthorization } from "../../src/features/workbench/entry";

// The Feishu app's web homepage points here, which is what makes this route
// the identity signal instead of a User-Agent guess: a request that arrived
// by tapping the app icon necessarily lands on this exact path. This must be
// a route handler, not a page — a bare `redirect()` inside a page component
// gets prerendered under this project's `cacheComponents` setting and turns
// into a 200 instead of a real HTTP redirect (the `/dashboard` incident this
// project already hit; see next.config.ts). A route handler runs on every
// request and is unaffected by that.
type EnterRouteDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
}>;

const defaultDependencies: EnterRouteDependencies = {
  session: getCurrentSession,
};

export function createEnterRoute(
  dependencies: EnterRouteDependencies = defaultDependencies,
) {
  return async function GET(request: Request): Promise<NextResponse> {
    const alreadyTried =
      new URL(request.url).searchParams.get("auth") === "tried";
    const user = await dependencies.session();

    if (shouldStartAuthorization({ hasSession: user !== null, alreadyTried })) {
      return NextResponse.redirect(
        new URL("/api/auth/feishu/start", request.url),
        302,
      );
    }

    const destination = new URL("/", request.url);
    // Only forward the marker when alreadyTried is the actual reason
    // authorization did not start — an already-authenticated visitor who
    // happens to carry a stale `auth=tried` from an earlier failed attempt
    // should not be shown a failure notice on the page they are about to see
    // signed in.
    if (user === null && alreadyTried) {
      destination.searchParams.set("auth", "tried");
    }
    return NextResponse.redirect(destination, 302);
  };
}

export const GET = createEnterRoute();
