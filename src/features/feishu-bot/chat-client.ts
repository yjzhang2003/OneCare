import type { BotEnv } from "../../lib/env";
import { createTenantTokenProvider } from "../bitable/client";

const BASE_URL = "https://open.feishu.cn/open-apis";
export const CHAT_TIMEOUT_MS = 15_000;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CreateWarRoomChatInput = Readonly<{
  env: BotEnv;
  name: string;
  memberOpenIds: readonly string[];
}>;

export async function createWarRoomChat(
  input: CreateWarRoomChatInput,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  // Deliberately not given `fetcher`: that parameter is reserved for the
  // business call this function makes (asserted on by its own tests), while
  // the tenant token exchange is a separate concern with its own dedicated
  // coverage in bitable/client.test.ts, exactly as `listOwnerRules` and
  // `getTokenProvider()` keep the two apart elsewhere in this codebase.
  const token = createTenantTokenProvider(input.env.appId, input.env.appSecret);

  // De-duplicated (and blanks stripped) before the call: the operator
  // approving the escalation is usually also one of the ticket's owners, and
  // Feishu rejects the whole request on a repeated open_id rather than
  // ignoring the repeat.
  const memberIds = [...new Set(input.memberOpenIds)].filter((id) => id.trim().length > 0);

  const response = await fetcher(`${BASE_URL}/im/v1/chats?user_id_type=open_id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ name: input.name, user_id_list: memberIds }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  });

  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.code !== 0) {
    const code = isRecord(payload) ? String(payload.code) : "unknown";
    throw new Error(`Feishu chat create failed (code ${code})`);
  }

  const data = isRecord(payload.data) ? payload.data : {};
  if (typeof data.chat_id !== "string") {
    throw new Error("Feishu chat create response missing chat_id");
  }

  return data.chat_id;
}

export type ListChatMessagesInput = Readonly<{
  env: BotEnv;
  chatId: string;
  limit?: number;
}>;

function extractText(item: unknown): string | null {
  if (!isRecord(item) || item.msg_type !== "text") return null;

  const body = isRecord(item.body) ? item.body : null;
  if (!body || typeof body.content !== "string") return null;

  try {
    const parsed: unknown = JSON.parse(body.content);
    if (isRecord(parsed) && typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch {
    // Fall through: a single unparseable message is skipped rather than
    // failing the whole read — this feeds the closing summary, and a summary
    // failure must never be able to take the closure itself down.
  }

  return null;
}

export async function listChatMessages(
  input: ListChatMessagesInput,
  fetcher: typeof fetch = fetch,
): Promise<readonly string[]> {
  // This whole function is best-effort input to a closing summary, never a
  // gate on the closure itself — the most important rule in this design is
  // that a summary failure can never take the closure down with it. So every
  // failure mode here (network error, a non-zero Feishu code, an empty group,
  // an unrecognized item shape) resolves to an empty transcript instead of
  // rejecting, and a single unparseable message is skipped rather than
  // failing the whole read.
  try {
    // Same split as createWarRoomChat: `fetcher` is reserved for this
    // function's own business call, the token exchange is a separate concern.
    const token = createTenantTokenProvider(input.env.appId, input.env.appSecret);
    const pageSize = input.limit ?? DEFAULT_MESSAGE_PAGE_SIZE;

    const params = new URLSearchParams({
      container_id_type: "chat",
      container_id: input.chatId,
      page_size: String(pageSize),
      sort_type: "ByCreateTimeAsc",
    });

    const response = await fetcher(`${BASE_URL}/im/v1/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${await token()}` },
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });

    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.code !== 0) {
      return [];
    }

    const data = isRecord(payload.data) ? payload.data : {};
    if (!Array.isArray(data.items)) return [];

    return data.items.flatMap((item) => {
      const text = extractText(item);
      return text === null ? [] : [text];
    });
  } catch {
    return [];
  }
}
