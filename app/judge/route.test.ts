import { describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/features/auth/cookies";
import { verifySession } from "../../src/features/auth/session";
import { createJudgeRoute } from "./route";

const SECRET = "judge-route-test-secret-at-least-32-bytes";

describe("GET /judge", () => {
  it("hands out a read-only session and opens the console with the notice", async () => {
    const response = await createJudgeRoute(() => SECRET)(
      new Request("https://example.test/judge"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.test/?welcome=1");

    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie).toBeDefined();
    const user = verifySession(cookie!.value, SECRET);
    expect(user).toMatchObject({ name: "评委", guest: true });
  });

  // The flag is the whole safety story: it travels inside the signed session, so it
  // cannot be edited by whoever holds the cookie.
  it("signs the guest flag rather than trusting the client for it", async () => {
    const response = await createJudgeRoute(() => SECRET)(
      new Request("https://example.test/judge"),
    );
    const token = response.cookies.get(SESSION_COOKIE)!.value;

    const [payload, signature] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({
        ...(JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as object),
        user: { openId: "guest", name: "评委" },
      }),
      "utf8",
    ).toString("base64url");

    expect(verifySession(`${tampered}.${signature}`, SECRET)).toBeNull();
  });
});
