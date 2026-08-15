export type AuthUser = {
  openId: string;
  name: string;
  avatarUrl?: string;
  // 评委通道: a session nobody signed in for. Judges have no account in this tenant, so
  // the alternative to letting them in unauthenticated is not letting them in at all —
  // but a visitor without an identity must not be able to write: every write here names
  // a real colleague, sends them a message, or changes a record somebody is working.
  // Read-only is enforced at each write route, not only in the UI.
  guest?: boolean;
};

export type AuthErrorCode =
  | "configuration_error"
  | "access_denied"
  | "invalid_state"
  | "token_exchange_failed"
  | "user_info_failed";

export class AuthFlowError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthFlowError";
  }
}
