import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { AuthEnv } from "../../../../../src/lib/env";
import { OAUTH_STATE_COOKIE } from "../../../../../src/features/auth/cookies";
import type { AuthUser } from "../../../../../src/features/auth/types";
import { createCallbackHandler } from "./route";

const env: AuthEnv = {
  appId: "cli_auto_insight",
  appSecret: "server-only-secret",
  redirectUri: "https://auto-insight.example/api/auth/feishu/callback",
  sessionSecret: "0123456789abcdef0123456789abcdef",
};
const user: AuthUser = { openId: "ou_auto_insight", name: "洞察研究员" };

function callbackRequest(query: string, stateCookie = "expected-state") {
  return new NextRequest(
    `https://auto-insight.example/api/auth/feishu/callback?${query}`,
    {
      headers: {
        Cookie: `${OAUTH_STATE_COOKIE}=${stateCookie}`,
      },
    },
  );
}

function dependencies() {
  return {
    readEnv: vi.fn(() => env),
    exchangeCode: vi.fn(async () => "user-access-token"),
    fetchUser: vi.fn(async () => user),
    makeSession: vi.fn(() => "signed-session"),
  };
}

describe("GET /api/auth/feishu/callback", () => {
  it("rejects a missing or mismatched state before network calls", async () => {
    for (const request of [
      callbackRequest("code=oauth-code"),
      callbackRequest("code=oauth-code&state=wrong-state"),
    ]) {
      const deps = dependencies();
      const response = await createCallbackHandler(deps)(request);

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "https://auto-insight.example/?auth_error=invalid_state",
      );
      expect(response.headers.get("set-cookie")).toContain(
        "auto_insight_oauth_state=;",
      );
      expect(deps.exchangeCode).not.toHaveBeenCalled();
    }
  });

  it("maps a Feishu denial after validating state", async () => {
    const deps = dependencies();
    const response = await createCallbackHandler(deps)(
      callbackRequest("error=access_denied&state=expected-state"),
    );

    expect(response.headers.get("location")).toBe(
      "https://auto-insight.example/?auth_error=access_denied",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "auto_insight_oauth_state=;",
    );
    expect(deps.exchangeCode).not.toHaveBeenCalled();
  });

  it("exchanges a valid code and creates a private session", async () => {
    const deps = dependencies();
    const response = await createCallbackHandler(deps)(
      callbackRequest("code=oauth-code&state=expected-state"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://auto-insight.example/dashboard",
    );
    expect(deps.exchangeCode).toHaveBeenCalledWith({ code: "oauth-code", env });
    expect(deps.fetchUser).toHaveBeenCalledWith("user-access-token");
    expect(deps.makeSession).toHaveBeenCalledWith(
      user,
      env.sessionSecret,
    );

    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("auto_insight_session=signed-session");
    expect(cookie).toContain("Max-Age=28800");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("auto_insight_oauth_state=;");
  });
});
