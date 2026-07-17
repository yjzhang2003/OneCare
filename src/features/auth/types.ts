export type AuthUser = {
  openId: string;
  name: string;
  avatarUrl?: string;
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
