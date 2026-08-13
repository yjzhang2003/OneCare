import { NextResponse } from "next/server";

import {
  generateOAuthState,
  OAUTH_STATE_COOKIE,
  stateCookieOptions,
} from "../../../../../src/features/auth/cookies";
import { buildAuthorizationUrl } from "../../../../../src/features/auth/feishu";
import type { AuthEnv } from "../../../../../src/lib/env";
import { readAuthEnv } from "../../../../../src/lib/env";

type StartDependencies = {
  readEnv: () => AuthEnv;
  generateState: () => string;
};

const defaultDependencies: StartDependencies = {
  readEnv: () => readAuthEnv(),
  generateState: generateOAuthState,
};

export function createStartHandler(
  dependencies: StartDependencies = defaultDependencies,
) {
  return async function GET(request: Request): Promise<NextResponse> {
    try {
      const env = dependencies.readEnv();
      const state = dependencies.generateState();
      const authorizationUrl = buildAuthorizationUrl({
        appId: env.appId,
        redirectUri: env.redirectUri,
        state,
      });
      const response = NextResponse.redirect(authorizationUrl, 302);
      response.cookies.set(
        OAUTH_STATE_COOKIE,
        state,
        stateCookieOptions(),
      );
      return response;
    } catch {
      const errorUrl = new URL("/login", request.url);
      errorUrl.searchParams.set("auth_error", "configuration_error");
      return NextResponse.redirect(errorUrl, 302);
    }
  };
}

export const GET = createStartHandler();
