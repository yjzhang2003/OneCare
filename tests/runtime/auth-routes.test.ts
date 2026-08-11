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
    // A failed callback now lands on "/" with both auth_error and the
    // auth=tried loop-guard marker (app/api/auth/feishu/callback/route.ts,
    // commit 90e0b5e — "land logins on /"; see also that route's own
    // route.test.ts, which already asserts this). This assertion used to say
    // "/login" and had drifted out of sync with the actual implementation
    // ever since — caught here, not by `vitest run`, because tests/runtime
    // is the only suite that boots the real built server and follows the
    // real redirect chain.
    expect(errorLocation.pathname).toBe("/");
    expect(errorLocation.searchParams.get("auth_error")).toBe("invalid_state");
    expect(errorLocation.searchParams.get("auth")).toBe("tried");
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

    // `/dashboard` is now a route-level redirect (`redirects()` in
    // next.config.ts), not a rendered page calling `redirect()`. Under
    // `cacheComponents`, the old page-level version got prerendered as
    // static output and its redirect was baked into the RSC payload as a
    // client-side navigation instead of a real HTTP redirect — a non-JS
    // caller (this fetch with `redirect: "manual"`, same as curl) saw 200,
    // not 307. A config-level redirect resolves before any route matching or
    // rendering, so it is unaffected by that and always answers with a real
    // HTTP redirect. 307 (not 308) matches next.config.ts's `permanent:
    // false`, chosen because this is a legacy compatibility path, not a
    // permanent URL-scheme decision, and 308/301 would let clients and
    // crawlers cache the redirect past the point it could be undone.
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

  it("leaves the public VOC dashboard reachable after the /dashboard redirect change", async () => {
    // next.config.ts's redirects() source is the exact path "/dashboard",
    // not a prefix or wildcard, so it must not swallow this sibling route —
    // the one page a competition judge can verify unaided. A regression here
    // would mean the /dashboard fix silently broke the more important page.
    const response = await fetch(`${baseUrl}/dashboard/voc`, {
      redirect: "manual",
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("VOC 闭环看板");
    // Not a substring assertion on `原始内容` or any record_id shape: this
    // only proves the page rendered real content (its own heading), not that
    // it withheld anything — that guarantee is covered by
    // app/dashboard/voc/page.test.tsx's contract on the metrics type itself.
  });

  it("makes /enter a real dynamic redirect, not a prerendered 200", async () => {
    // The exact regression class this project already hit once: a page whose
    // body is a bare redirect() gets prerendered as static output under
    // cacheComponents, and a non-JS caller sees 200 instead of a real HTTP
    // redirect (see next.config.ts's comment on the old /dashboard page).
    // /enter is a route handler specifically to avoid that, and this is the
    // one check `vitest run` cannot perform — it never boots the built
    // server. Anonymous, no cookies: the fresh visit falls through to
    // starting authorization.
    const response = await fetch(`${baseUrl}/enter`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(
      new URL(response.headers.get("location")!, baseUrl).pathname,
    ).toBe("/api/auth/feishu/start");
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
