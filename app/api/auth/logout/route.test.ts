import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  // Back to the front page, which is where signing in starts. It used to land on
  // /login — a page that only made sense to someone already signed out.
  it("clears the session and returns to the front page", async () => {
    const response = await POST(
      new Request("https://auto-insight.example/api/auth/logout", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://auto-insight.example/",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "auto_insight_session=;",
    );
  });
});
