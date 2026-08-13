import { describe, expect, it } from "vitest";

import type { AuthUser } from "../../src/features/auth/types";
import { createEnterRoute } from "./route";

function sessionOf(user: AuthUser | null) {
  return async () => user;
}

describe("GET /enter", () => {
  it("starts authorization for a fresh, session-less visit", async () => {
    const handler = createEnterRoute({ session: sessionOf(null) });

    const response = await handler(
      new Request("https://onecare.example/enter"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://onecare.example/api/auth/feishu/start",
    );
  });

  it("sends an already-authenticated visitor straight to the landing page", async () => {
    const handler = createEnterRoute({
      session: sessionOf({ openId: "ou_operator", name: "运营" }),
    });

    const response = await handler(
      new Request("https://onecare.example/enter"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://onecare.example/",
    );
  });

  it("does not retry authorization once it has already been tried, and forwards the marker", async () => {
    const handler = createEnterRoute({ session: sessionOf(null) });

    const response = await handler(
      new Request("https://onecare.example/enter?auth=tried"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://onecare.example/?auth=tried",
    );
  });

  it("does not forward a stale tried marker for a visitor who now has a session", async () => {
    const handler = createEnterRoute({
      session: sessionOf({ openId: "ou_operator", name: "运营" }),
    });

    const response = await handler(
      new Request("https://onecare.example/enter?auth=tried"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://onecare.example/",
    );
  });
});
