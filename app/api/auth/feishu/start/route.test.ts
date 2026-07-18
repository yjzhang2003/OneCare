import { describe, expect, it } from "vitest";

import type { AuthEnv } from "../../../../../src/lib/env";
import { createStartHandler } from "./route";

const env: AuthEnv = {
  appId: "cli_auto_insight",
  appSecret: "server-only-secret",
  redirectUri: "https://auto-insight.example/api/auth/feishu/callback",
  sessionSecret: "0123456789abcdef0123456789abcdef",
};

describe("GET /api/auth/feishu/start", () => {
  it("sets a short-lived state cookie and redirects to Feishu", async () => {
    const handler = createStartHandler({
      readEnv: () => env,
      generateState: () => "fixed-oauth-state",
    });

    const response = await handler(
      new Request("https://auto-insight.example/api/auth/feishu/start"),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://accounts.feishu.cn");
    expect(location.searchParams.get("client_id")).toBe(env.appId);
    expect(location.searchParams.get("redirect_uri")).toBe(env.redirectUri);
    expect(location.searchParams.get("state")).toBe("fixed-oauth-state");

    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("auto_insight_oauth_state=fixed-oauth-state");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
  });

  it("returns a safe local configuration error", async () => {
    const handler = createStartHandler({
      readEnv: () => {
        throw new Error("secret value");
      },
      generateState: () => "unused",
    });

    const response = await handler(
      new Request("https://auto-insight.example/api/auth/feishu/start"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://auto-insight.example/login?auth_error=configuration_error",
    );
    expect(await response.text()).not.toContain("secret value");
  });
});
