import type { AuthEnv } from "../../lib/env";
import { AuthFlowError, type AuthUser } from "./types";

const AUTHORIZE_URL =
  "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const TOKEN_URL = "https://accounts.feishu.cn/oauth/v3/token";
const USER_INFO_URL =
  "https://open.feishu.cn/open-apis/authen/v1/user_info";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

export function buildAuthorizationUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): URL {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url;
}

export async function exchangeAuthorizationCode(
  input: { code: string; env: AuthEnv },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  try {
    const response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: input.env.appId,
        client_secret: input.env.appSecret,
        code: input.code,
        redirect_uri: input.env.redirectUri,
      }),
    });

    if (!response.ok) {
      throw new AuthFlowError("token_exchange_failed");
    }

    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      payload.code !== 0 ||
      typeof payload.access_token !== "string" ||
      payload.access_token.length === 0
    ) {
      throw new AuthFlowError("token_exchange_failed");
    }

    return payload.access_token;
  } catch (error) {
    if (error instanceof AuthFlowError) {
      throw error;
    }
    throw new AuthFlowError("token_exchange_failed");
  }
}

export async function fetchFeishuUser(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<AuthUser> {
  try {
    const response = await fetcher(USER_INFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });

    if (!response.ok) {
      throw new AuthFlowError("user_info_failed");
    }

    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      payload.code !== 0 ||
      !isRecord(payload.data) ||
      typeof payload.data.open_id !== "string" ||
      payload.data.open_id.length === 0 ||
      typeof payload.data.name !== "string" ||
      payload.data.name.length === 0
    ) {
      throw new AuthFlowError("user_info_failed");
    }

    const user: AuthUser = {
      openId: payload.data.open_id,
      name: payload.data.name,
    };

    if (
      typeof payload.data.avatar_url === "string" &&
      payload.data.avatar_url.length > 0
    ) {
      user.avatarUrl = payload.data.avatar_url;
    }

    return user;
  } catch (error) {
    if (error instanceof AuthFlowError) {
      throw error;
    }
    throw new AuthFlowError("user_info_failed");
  }
}
