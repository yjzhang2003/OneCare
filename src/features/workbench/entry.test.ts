import { describe, expect, it } from "vitest";

import { shouldStartAuthorization } from "./entry";

describe("shouldStartAuthorization", () => {
  it("does not start a new authorization attempt when a session already exists", () => {
    expect(
      shouldStartAuthorization({ hasSession: true, alreadyTried: false }),
    ).toBe(false);
  });

  it("does not retry once an authorization attempt has already failed", () => {
    expect(
      shouldStartAuthorization({ hasSession: false, alreadyTried: true }),
    ).toBe(false);
  });

  it("starts authorization when there is no session and no prior attempt", () => {
    expect(
      shouldStartAuthorization({ hasSession: false, alreadyTried: false }),
    ).toBe(true);
  });

  it("stays false when both a session exists and a prior attempt failed", () => {
    expect(
      shouldStartAuthorization({ hasSession: true, alreadyTried: true }),
    ).toBe(false);
  });
});
