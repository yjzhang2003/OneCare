import { describe, expect, it } from "vitest";

import {
  generateOAuthState,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  stateCookieOptions,
  statesMatch,
} from "./cookies";

describe("OAuth state", () => {
  it("generates independent cryptographically sized values", () => {
    const first = generateOAuthState();
    const second = generateOAuthState();

    expect(first).toHaveLength(43);
    expect(second).toHaveLength(43);
    expect(first).not.toBe(second);
  });

  it("matches only identical state values", () => {
    const state = generateOAuthState();

    expect(statesMatch(state, state)).toBe(true);
    expect(statesMatch(state, `${state}x`)).toBe(false);
    expect(statesMatch(state, generateOAuthState())).toBe(false);
    expect(statesMatch(undefined, state)).toBe(false);
  });
});

describe("authentication cookies", () => {
  it("uses stable private cookie names", () => {
    expect(OAUTH_STATE_COOKIE).toBe("auto_insight_oauth_state");
    expect(SESSION_COOKIE).toBe("auto_insight_session");
  });

  it("limits production OAuth state cookies to ten minutes", () => {
    expect(stateCookieOptions(true)).toEqual({
      httpOnly: true,
      maxAge: 600,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  it("limits production session cookies to eight hours", () => {
    expect(sessionCookieOptions(true)).toEqual({
      httpOnly: true,
      maxAge: 28_800,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  it("allows local HTTP development without weakening production", () => {
    expect(stateCookieOptions(false).secure).toBe(false);
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});
