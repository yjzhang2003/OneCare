import type { BitableEnv } from "../../lib/env";
import { toVocRecord, VOC_FIELD_NAMES, type BitableFields, type VocRecord } from "./field-map";

const BASE_URL = "https://open.feishu.cn/open-apis";
const TOKEN_URL = `${BASE_URL}/auth/v3/tenant_access_token/internal`;
export const BITABLE_TIMEOUT_MS = 10_000;
const TOKEN_SAFETY_WINDOW_MS = 60_000;
const DEFAULT_MAX_PAGES = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type TenantTokenProvider = () => Promise<string>;

export function createTenantTokenProvider(
  appId: string,
  appSecret: string,
  fetcher: typeof fetch = fetch,
): TenantTokenProvider {
  // Cached at module scope by the caller: a card callback has a three second
  // budget and cannot afford a token exchange on every click.
  let cached: { token: string; expiresAt: number } | null = null;

  // Card callbacks are inherently concurrent — several owners can click at
  // once, or Feishu can redeliver the same callback. Checking `cached` and
  // then `await`-ing the exchange are two separate steps, so without this,
  // every concurrent caller sees an empty cache and starts its own exchange.
  // The in-flight exchange itself (not just its eventual result) is cached
  // here so concurrent callers share one network round trip. It is cleared
  // in `finally` so a failed exchange never wedges later calls onto the same
  // rejected promise.
  let pending: Promise<string> | null = null;

  async function exchange(): Promise<string> {
    const response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(BITABLE_TIMEOUT_MS),
    });

    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      payload.code !== 0 ||
      typeof payload.tenant_access_token !== "string"
    ) {
      const code = isRecord(payload) ? String(payload.code) : "unknown";
      throw new Error(`Failed to obtain tenant_access_token (code ${code})`);
    }

    const expire = typeof payload.expire === "number" ? payload.expire : 7200;
    cached = {
      token: payload.tenant_access_token,
      expiresAt: Date.now() + expire * 1000 - TOKEN_SAFETY_WINDOW_MS,
    };
    return cached.token;
  }

  return () => {
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.token);
    }

    if (!pending) {
      pending = exchange().finally(() => {
        pending = null;
      });
    }

    return pending;
  };
}

export type ListRecordsOptions = Readonly<{
  pageSize?: number;
  filter?: string;
  maxPages?: number;
}>;

export type BitableClient = Readonly<{
  getRecord(recordId: string): Promise<VocRecord | null>;
  listRecords(options?: ListRecordsOptions): Promise<readonly VocRecord[]>;
  updateRecord(recordId: string, fields: BitableFields): Promise<void>;
  listFieldNames(): Promise<readonly string[]>;
  findByWarRoomChatId(chatId: string): Promise<VocRecord | null>;
}>;

export function createBitableClient(
  env: BitableEnv,
  token: TenantTokenProvider,
  fetcher: typeof fetch = fetch,
): BitableClient {
  const recordsUrl = `${BASE_URL}/bitable/v1/apps/${env.appToken}/tables/${env.vocTableId}/records`;

  async function call(
    url: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const response = await fetcher(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json; charset=utf-8",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(BITABLE_TIMEOUT_MS),
    });

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      throw new Error("Bitable returned a non-object payload");
    }
    return payload;
  }

  function itemsToRecords(items: unknown): readonly VocRecord[] {
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      if (!isRecord(item) || typeof item.record_id !== "string") return [];
      const fields = isRecord(item.fields) ? item.fields : {};
      return [toVocRecord(fields, item.record_id)];
    });
  }

  return {
    async getRecord(recordId) {
      // user_id_type is explicit on purpose: without it, people fields may come
      // back in an id type that never matches event.operator.open_id, which
      // shows up as "authorized owner is always rejected".
      const payload = await call(
        `${recordsUrl}/${recordId}?user_id_type=open_id`,
      );

      if (payload.code !== 0) return null;

      const data = isRecord(payload.data) ? payload.data : {};
      const record = isRecord(data.record) ? data.record : null;
      if (!record || typeof record.record_id !== "string") return null;

      const fields = isRecord(record.fields) ? record.fields : {};
      return toVocRecord(fields, record.record_id);
    },

    async listRecords(options = {}) {
      const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
      const collected: VocRecord[] = [];
      let pageToken: string | undefined;

      for (let page = 0; page < maxPages; page += 1) {
        const params = new URLSearchParams({ user_id_type: "open_id" });
        if (options.pageSize) params.set("page_size", String(options.pageSize));
        if (options.filter) params.set("filter", options.filter);
        if (pageToken) params.set("page_token", pageToken);

        const payload = await call(`${recordsUrl}?${params.toString()}`);
        if (payload.code !== 0) {
          throw new Error(`Bitable list failed (code ${String(payload.code)})`);
        }

        const data = isRecord(payload.data) ? payload.data : {};
        collected.push(...itemsToRecords(data.items));

        if (data.has_more !== true || typeof data.page_token !== "string") {
          break;
        }
        pageToken = data.page_token;
      }

      return collected;
    },

    async updateRecord(recordId, fields) {
      const payload = await call(
        `${recordsUrl}/${recordId}?user_id_type=open_id`,
        { method: "PUT", body: JSON.stringify({ fields }) },
      );

      if (payload.code !== 0) {
        throw new Error(
          `Bitable update failed (code ${String(payload.code)})`,
        );
      }
    },

    async listFieldNames() {
      const payload = await call(
        `${BASE_URL}/bitable/v1/apps/${env.appToken}/tables/${env.vocTableId}/fields?page_size=200`,
      );

      if (payload.code !== 0) {
        throw new Error(`Bitable fields failed (code ${String(payload.code)})`);
      }

      const data = isRecord(payload.data) ? payload.data : {};
      if (!Array.isArray(data.items)) return [];
      return data.items.flatMap((item) =>
        isRecord(item) && typeof item.field_name === "string"
          ? [item.field_name]
          : [],
      );
    },

    async findByWarRoomChatId(chatId) {
      // Short-circuit before the network: most inbound traffic is not a war
      // room message, and a blank id would otherwise cost a cross-border
      // request to look up an empty string on every single one.
      const trimmed = chatId.trim();
      if (trimmed.length === 0) return null;

      const payload = await call(
        `${recordsUrl}/search?user_id_type=open_id&page_size=1`,
        {
          method: "POST",
          body: JSON.stringify({
            filter: {
              conjunction: "and",
              conditions: [
                {
                  field_name: VOC_FIELD_NAMES.warRoomChatId,
                  operator: "is",
                  value: [trimmed],
                },
              ],
            },
          }),
        },
      );

      if (payload.code !== 0) {
        throw new Error(`Bitable search failed (code ${String(payload.code)})`);
      }

      const data = isRecord(payload.data) ? payload.data : {};
      const records = itemsToRecords(data.items);
      return records[0] ?? null;
    },
  };
}
