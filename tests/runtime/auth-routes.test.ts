import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: ChildProcess | undefined;
let baseUrl = "";
let serverOutput = "";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not allocate a runtime smoke-test port"));
        return;
      }

      const { port } = address;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server?.exitCode !== null) {
      throw new Error(`next start exited early:\n${serverOutput}`);
    }

    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status === 200) {
        return;
      }
    } catch {
      // The server has not started listening yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`next start did not become ready:\n${serverOutput}`);
}

beforeAll(async () => {
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );

  server = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FEISHU_APP_ID: "cli_runtime_smoke",
        FEISHU_APP_SECRET: "runtime-smoke-server-only-secret",
        FEISHU_REDIRECT_URI: `${baseUrl}/api/auth/feishu/callback`,
        FEISHU_EVENT_VERIFICATION_TOKEN: "runtime-verification-token",
        FEISHU_EVENT_ENCRYPT_KEY: "12345678901234567890123456789012",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout?.on("data", (chunk) => {
    serverOutput += String(chunk);
  });
  server.stderr?.on("data", (chunk) => {
    serverOutput += String(chunk);
  });

  await waitForServer(baseUrl);
});

afterAll(() => {
  server?.kill("SIGTERM");
});

describe("built Next.js authentication routes", () => {
  it("handles an invalid OAuth callback with a safe redirect", async () => {
    const response = await fetch(
      `${baseUrl}/api/auth/feishu/callback?code=test-code&state=test-state`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    const errorLocation = new URL(response.headers.get("location")!);
    expect(errorLocation.pathname).toBe("/login");
    expect(errorLocation.searchParams.get("auth_error")).toBe("invalid_state");
    expect(response.headers.get("set-cookie")).toContain(
      "auto_insight_oauth_state=;",
    );
  });

  it("starts OAuth with the production route contract", async () => {
    const response = await fetch(`${baseUrl}/api/auth/feishu/start`, {
      redirect: "manual",
    });
    const location = response.headers.get("location");
    const authorizationUrl = location ? new URL(location) : null;

    expect(response.status).toBe(302);
    expect(authorizationUrl?.origin).toBe("https://accounts.feishu.cn");
    expect(authorizationUrl?.pathname).toBe(
      "/open-apis/authen/v1/authorize",
    );
    expect(authorizationUrl?.searchParams.get("client_id")).toBe(
      "cli_runtime_smoke",
    );
    expect(authorizationUrl?.searchParams.get("state")).toBeTruthy();
    expect(response.headers.get("set-cookie")).toContain(
      "auto_insight_oauth_state=",
    );
  });

  it("protects the dashboard and handles logout in the built runtime", async () => {
    const dashboard = await fetch(`${baseUrl}/dashboard`, {
      redirect: "manual",
    });
    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      redirect: "manual",
    });

    expect(dashboard.status).toBe(307);
    expect(
      new URL(dashboard.headers.get("location")!, baseUrl).pathname,
    ).toBe("/login");
    expect(logout.status).toBe(302);
    expect(new URL(logout.headers.get("location")!).pathname).toBe("/login");
    expect(logout.headers.get("set-cookie")).toContain(
      "auto_insight_session=;",
    );
  });

  it("answers Feishu URL verification in the built runtime", async () => {
    const response = await fetch(`${baseUrl}/api/feishu/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "url_verification",
        token: "runtime-verification-token",
        challenge: "runtime-challenge",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "runtime-challenge",
    });
  });
});
