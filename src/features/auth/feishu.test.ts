import { describe, expect, it, vi } from "vitest";

import type { AuthEnv } from "../../lib/env";
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchFeishuUser,
} from "./feishu";

const env: AuthEnv = {
  appId: "cli_auto_insight",
  appSecret: "server-only-app-secret",
  redirectUri: "https://auto-insight.example/api/auth/feishu/callback",
  sessionSecret: "0123456789abcdef0123456789abcdef",
};

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as typeof fetch;
}

describe("buildAuthorizationUrl", () => {
  it("constructs the official authorization URL without a secret", () => {
    const url = buildAuthorizationUrl({
      appId: env.appId,
      redirectUri: env.redirectUri,
      state: "state-value",
    });

    expect(url.origin).toBe("https://accounts.feishu.cn");
    expect(url.pathname).toBe("/open-apis/authen/v1/authorize");
    expect(url.searchParams.get("client_id")).toBe(env.appId);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(env.redirectUri);
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.toString()).not.toContain(env.appSecret);
  });
});

describe("exchangeAuthorizationCode", () => {
  it("uses the official v3 endpoint and returns the user access token", async () => {
    const fetcher = fetchReturning({
      code: 0,
      access_token: "user-access-token",
      expires_in: 7_200,
      token_type: "Bearer",
    });

    await expect(
      exchangeAuthorizationCode({ code: "oauth-code", env }, fetcher),
    ).resolves.toBe("user-access-token");

    const [input, init] = vi.mocked(fetcher).mock.calls[0];
    expect(input).toBe("https://accounts.feishu.cn/oauth/v3/token");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json; charset=utf-8",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      grant_type: "authorization_code",
      client_id: env.appId,
      client_secret: env.appSecret,
      code: "oauth-code",
      redirect_uri: env.redirectUri,
    });
  });

  it.each([
    ["HTTP failure", fetchReturning({ message: env.appSecret }, 500)],
    ["Feishu error", fetchReturning({ code: 20_002, error: env.appSecret })],
    ["missing token", fetchReturning({ code: 0 })],
  ])("maps %s to a safe error", async (_label, fetcher) => {
    let thrown: unknown;

    try {
      await exchangeAuthorizationCode({ code: "oauth-code", env }, fetcher);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "token_exchange_failed",
      message: "token_exchange_failed",
    });
    expect(String(thrown)).not.toContain(env.appSecret);
  });
});

describe("fetchFeishuUser", () => {
  it("maps only stable identity and presentation fields", async () => {
    const fetcher = fetchReturning({
      code: 0,
      msg: "success",
      data: {
        open_id: "ou_auto_insight",
        name: "洞察研究员",
        avatar_url: "https://example.com/avatar.png",
        mobile: "+8613800000000",
        email: "private@example.com",
        tenant_key: "tenant-not-persisted",
      },
    });

    await expect(fetchFeishuUser("user-access-token", fetcher)).resolves.toEqual({
      openId: "ou_auto_insight",
      name: "洞察研究员",
      avatarUrl: "https://example.com/avatar.png",
    });

    const [input, init] = vi.mocked(fetcher).mock.calls[0];
    expect(input).toBe("https://open.feishu.cn/open-apis/authen/v1/user_info");
    expect(init?.headers).toEqual({
      Authorization: "Bearer user-access-token",
      "Content-Type": "application/json; charset=utf-8",
    });
  });

  it.each([
    ["HTTP failure", fetchReturning({ token: "user-access-token" }, 500)],
    ["Feishu error", fetchReturning({ code: 20_005, msg: "bad token" })],
    ["missing identity", fetchReturning({ code: 0, data: { name: "研究员" } })],
  ])("maps %s to a safe error", async (_label, fetcher) => {
    let thrown: unknown;

    try {
      await fetchFeishuUser("user-access-token", fetcher);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "user_info_failed",
      message: "user_info_failed",
    });
    expect(String(thrown)).not.toContain("user-access-token");
  });
});
