import { randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_STATE_COOKIE = "auto_insight_oauth_state";
export const SESSION_COOKIE = "auto_insight_session";

type AuthenticationCookieOptions = {
  httpOnly: true;
  maxAge: number;
  path: "/";
  sameSite: "lax";
  secure: boolean;
};

export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function statesMatch(
  received: string | undefined,
  expected: string | undefined,
): boolean {
  if (!received || !expected) {
    return false;
  }

  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

function cookieOptions(
  maxAge: number,
  isProduction: boolean,
): AuthenticationCookieOptions {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax",
    secure: isProduction,
  };
}

export function stateCookieOptions(
  isProduction = process.env.NODE_ENV === "production",
): AuthenticationCookieOptions {
  return cookieOptions(600, isProduction);
}

export function sessionCookieOptions(
  isProduction = process.env.NODE_ENV === "production",
): AuthenticationCookieOptions {
  return cookieOptions(28_800, isProduction);
}
