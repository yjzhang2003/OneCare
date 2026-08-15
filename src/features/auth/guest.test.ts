import { describe, expect, it } from "vitest";

import { GUEST_USER, isGuest, refuseGuestWrite } from "./guest";

describe("guest sessions", () => {
  it("recognises a guest and nobody else", () => {
    expect(isGuest(GUEST_USER)).toBe(true);
    expect(isGuest({ openId: "ou_real", name: "黄齐" })).toBe(false);
    expect(isGuest({ openId: "ou_real", name: "黄齐", guest: false })).toBe(false);
    expect(isGuest(null)).toBe(false);
  });

  // The refusal says what the visitor can still do. A judge who clicks something that
  // writes should learn the boundary, not read an error.
  it("refuses a write with 403 and an explanation", async () => {
    const response = refuseGuestWrite();
    expect(response.status).toBe(403);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("只读");
    expect(body.message).toContain("查看");
  });
});
