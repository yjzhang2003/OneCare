import { NextResponse } from "next/server";

import { SESSION_COOKIE, sessionCookieOptions } from "../../src/features/auth/cookies";
import { GUEST_USER } from "../../src/features/auth/guest";
import { createSession } from "../../src/features/auth/session";
import { readAuthEnv } from "../../src/lib/env";

// 评委通道: the workbench without a Feishu account.
//
// Judges are not members of this tenant, so OAuth is not a door they can walk through —
// and a demo nobody can open is not a demo. This mints an ordinary session for one fixed
// read-only identity and drops them straight into the console.
//
// The session is the same signed cookie every other visitor gets, with `guest: true` on
// the user. That flag is what every write route checks: the UI hides those controls, but
// this link is on a public page and a browser is not a trust boundary.
//
// A route handler rather than a page for the reason app/enter/route.ts states: a
// redirect() inside a page is prerendered under this project's cacheComponents setting
// and turns into a 200 instead of a real redirect.
export function createJudgeRoute(
  sessionSecret: () => string = () => readAuthEnv().sessionSecret,
) {
  return async function GET(request: Request): Promise<NextResponse> {
    const token = createSession(GUEST_USER, sessionSecret());
    // ?welcome=1 is what the console reads to show the data-provenance dialog once. It
    // travels in the URL rather than in the cookie so that reloading the console later
    // does not reopen it, and so a judge can always get it back by using the link again.
    const response = NextResponse.redirect(new URL("/?welcome=1", request.url), 302);
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  };
}

export const GET = createJudgeRoute();
