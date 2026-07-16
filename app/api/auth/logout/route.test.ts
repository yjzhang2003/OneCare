import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  it("clears the website session and redirects home", async () => {
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
