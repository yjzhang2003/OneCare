import { createHmac, timingSafeEqual } from "node:crypto";

import type { AuthUser } from "./types";

const SESSION_DURATION_SECONDS = 28_800;

type SessionPayload = {
  version: 1;
  user: AuthUser;
  issuedAt: number;
  expiresAt: number;
};

function assertSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Session secret must contain at least 32 bytes");
  }
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.openId === "string" &&
    candidate.openId.length > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    (candidate.avatarUrl === undefined ||
      typeof candidate.avatarUrl === "string") &&
    (candidate.guest === undefined || typeof candidate.guest === "boolean")
  );
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.version === 1 &&
    isAuthUser(candidate.user) &&
    Number.isInteger(candidate.issuedAt) &&
    Number.isInteger(candidate.expiresAt) &&
    (candidate.expiresAt as number) > (candidate.issuedAt as number)
  );
}

export function createSession(
  user: AuthUser,
  secret: string,
  now = new Date(),
): string {
  assertSecret(secret);

  if (!isAuthUser(user)) {
    throw new Error("Cannot create a session without a valid user");
  }

  const issuedAt = Math.floor(now.getTime() / 1_000);
  const payload: SessionPayload = {
    version: 1,
    user,
    issuedAt,
    expiresAt: issuedAt + SESSION_DURATION_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );

  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifySession(
  token: string,
  secret: string,
  now = new Date(),
): AuthUser | null {
  assertSecret(secret);

  try {
    const parts = token.split(".");
    if (parts.length !== 2) {
      return null;
    }

    const [encodedPayload, encodedSignature] = parts;
    const suppliedSignature = Buffer.from(encodedSignature, "base64url");
    const expectedSignature = Buffer.from(
      sign(encodedPayload, secret),
      "base64url",
    );

    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null;
    }

    const payload: unknown = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );

    if (!isSessionPayload(payload)) {
      return null;
    }

    const nowSeconds = Math.floor(now.getTime() / 1_000);
    if (nowSeconds >= payload.expiresAt) {
      return null;
    }

    return { ...payload.user };
  } catch {
    return null;
  }
}
