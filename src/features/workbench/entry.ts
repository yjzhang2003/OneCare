// Deciding whether to send a visitor into the Feishu OAuth flow used to hinge
// on sniffing the User-Agent for the Feishu client (see the task-4 brief).
// That path was abandoned: there is no way to calibrate a UA substring
// without a real request to inspect, and this project has already paid for
// five separate "obvious" assumptions about external systems that turned out
// wrong. Instead, authorization starts from a route this app controls
// (app/enter/route.ts) and that is itself the identity signal — the Feishu
// app's web homepage points at it, so anything opened from the app icon
// necessarily lands here without needing to infer anything about the
// request. No UA string, no "Lark"/"Feishu" literal, appears in this module.

export type AuthorizationEntryInput = Readonly<{
  hasSession: boolean;
  alreadyTried: boolean;
}>;

// `alreadyTried` is the loop guard, and it is the whole reason this is a
// named function instead of an inline `!hasSession` check at the call site.
// A failed authorization sends the visitor back to a page that still has no
// session (see app/enter/route.ts and the untouched
// app/api/auth/feishu/callback/route.ts, which already marks failures with
// `auth=tried`). If the entry point does not recognise that marker, it
// re-attempts authorization immediately, which can fail the same way again —
// an infinite redirect loop. That failure mode is far harder to notice
// inside the Feishu client, which has no visible address bar or back
// button, than in an ordinary browser tab.
export function shouldStartAuthorization(
  input: AuthorizationEntryInput,
): boolean {
  if (input.hasSession) return false;
  if (input.alreadyTried) return false;
  return true;
}
