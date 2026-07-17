import { describe, expect, it } from "vitest";

import { readAuthEnv } from "./env";

const validEnvironment = {
  FEISHU_APP_ID: "cli_test",
  FEISHU_APP_SECRET: "test-app-secret",
  FEISHU_REDIRECT_URI: "https://auto-insight.example/api/auth/feishu/callback",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("readAuthEnv", () => {
  it("maps complete server environment variables", () => {
    expect(readAuthEnv(validEnvironment)).toEqual({
      appId: "cli_test",
      appSecret: "test-app-secret",
      redirectUri: "https://auto-insight.example/api/auth/feishu/callback",
      sessionSecret: "0123456789abcdef0123456789abcdef",
    });
  });

  it("reports a missing variable by name without exposing values", () => {
    expect(() =>
      readAuthEnv({
        FEISHU_APP_ID: "cli_test",
      }),
    ).toThrow("Missing server environment variable: FEISHU_APP_SECRET");
  });

  it("rejects a session secret shorter than 32 bytes", () => {
    expect(() =>
      readAuthEnv({
        ...validEnvironment,
        SESSION_SECRET: "too-short",
      }),
    ).toThrow("Invalid server environment variable: SESSION_SECRET");
  });
});
