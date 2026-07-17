import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createSession, verifySession } from "./session";

const secret = "0123456789abcdef0123456789abcdef";
const issuedAt = new Date("2026-07-17T00:00:00Z");
const user = {
  openId: "ou_auto_insight",
  name: "洞察研究员",
  avatarUrl: "https://example.com/avatar.png",
};

function signPayload(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${signature}`;
}

describe("signed website sessions", () => {
  it("restores a user before the eight-hour expiry", () => {
    const token = createSession(user, secret, issuedAt);

    expect(
      verifySession(token, secret, new Date("2026-07-17T07:59:59Z")),
    ).toEqual(user);
  });

  it("rejects a session at its expiry boundary", () => {
    const token = createSession(user, secret, issuedAt);

    expect(
      verifySession(token, secret, new Date("2026-07-17T08:00:00Z")),
    ).toBeNull();
  });

  it("rejects a tampered payload or signature", () => {
    const token = createSession(user, secret, issuedAt);
    const [payload, signature] = token.split(".");

    expect(
      verifySession(`${payload}x.${signature}`, secret, issuedAt),
    ).toBeNull();
    expect(
      verifySession(`${payload}.${signature}x`, secret, issuedAt),
    ).toBeNull();
  });

  it("rejects malformed, unsupported, and incomplete payloads", () => {
    expect(verifySession("not-a-session", secret, issuedAt)).toBeNull();
    expect(
      verifySession(
        signPayload({
          version: 2,
          user,
          issuedAt: 1_768_521_600,
          expiresAt: 1_768_550_400,
        }),
        secret,
        issuedAt,
      ),
    ).toBeNull();
    expect(
      verifySession(
        signPayload({
          version: 1,
          user: { openId: "", name: "洞察研究员" },
          issuedAt: 1_768_521_600,
          expiresAt: 1_768_550_400,
        }),
        secret,
        issuedAt,
      ),
    ).toBeNull();
  });

  it("rejects configuration secrets shorter than 32 bytes", () => {
    expect(() => createSession(user, "too-short", issuedAt)).toThrow(
      "Session secret must contain at least 32 bytes",
    );
    expect(() => verifySession("value.signature", "too-short", issuedAt)).toThrow(
      "Session secret must contain at least 32 bytes",
    );
  });
});
