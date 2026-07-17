import { NextRequest, NextResponse } from "next/server";

import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  statesMatch,
} from "../../../../../src/features/auth/cookies";
import {
  exchangeAuthorizationCode,
  fetchFeishuUser,
} from "../../../../../src/features/auth/feishu";
import { createSession } from "../../../../../src/features/auth/session";
import {
  AuthFlowError,
  type AuthErrorCode,
  type AuthUser,
} from "../../../../../src/features/auth/types";
import type { AuthEnv } from "../../../../../src/lib/env";
import { readAuthEnv } from "../../../../../src/lib/env";

export const runtime = "nodejs";

type CallbackDependencies = {
  readEnv: () => AuthEnv;
  exchangeCode: (input: { code: string; env: AuthEnv }) => Promise<string>;
  fetchUser: (accessToken: string) => Promise<AuthUser>;
  makeSession: (user: AuthUser, secret: string) => string;
};

const defaultDependencies: CallbackDependencies = {
  readEnv: () => readAuthEnv(),
  exchangeCode: (input) => exchangeAuthorizationCode(input),
  fetchUser: (accessToken) => fetchFeishuUser(accessToken),
  makeSession: (user, secret) => createSession(user, secret),
};

function errorResponse(request: Request, code: AuthErrorCode): NextResponse {
  const errorUrl = new URL("/", request.url);
  errorUrl.searchParams.set("auth_error", code);
  const response = NextResponse.redirect(errorUrl, 302);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export function createCallbackHandler(
  dependencies: CallbackDependencies = defaultDependencies,
) {
  return async function GET(request: NextRequest): Promise<NextResponse> {
    const receivedState = request.nextUrl.searchParams.get("state") ?? undefined;
    const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

    if (!statesMatch(receivedState, expectedState)) {
      return errorResponse(request, "invalid_state");
    }

    if (request.nextUrl.searchParams.get("error") === "access_denied") {
      return errorResponse(request, "access_denied");
    }

    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
      return errorResponse(request, "token_exchange_failed");
    }

    try {
      const env = dependencies.readEnv();
      const accessToken = await dependencies.exchangeCode({ code, env });
      const user = await dependencies.fetchUser(accessToken);
      const session = dependencies.makeSession(user, env.sessionSecret);
      const response = NextResponse.redirect(new URL("/dashboard", request.url), 302);
      response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
      response.cookies.delete(OAUTH_STATE_COOKIE);
      return response;
    } catch (error) {
      const errorCode =
        error instanceof AuthFlowError
          ? error.code
          : ("configuration_error" as const);
      return errorResponse(request, errorCode);
    }
  };
}

export const GET = createCallbackHandler();
