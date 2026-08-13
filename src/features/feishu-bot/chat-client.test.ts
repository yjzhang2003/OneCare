import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BotEnv } from "../../lib/env";
import { createBotOpenIdProvider, createWarRoomChat, listChatMessages } from "./chat-client";

const env: BotEnv = {
  appId: "cli_onecare",
  appSecret: "server-only-secret",
  verificationToken: "verification-token",
  encryptKey: "12345678901234567890123456789012",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// createWarRoomChat/listChatMessages get the tenant token from
// createTenantTokenProvider(env.appId, env.appSecret) — deliberately not
// given the `fetcher` under test, because that parameter is reserved for
// (and asserted on by) this file's own business call. The exchange still has
// to go somewhere, so it falls to the real `fetch` global; stubbing it here
// is what keeps that fallback from ever reaching the actual network while
// each test's own `fetcher` stays the single source of truth for the call
// under test.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({ code: 0, tenant_access_token: "test-tenant-token", expire: 7200 }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createWarRoomChat", () => {
  it("creates the chat with de-duplicated members and returns the chat id", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/im/v1/chats");
      expect(url).toContain("user_id_type=open_id");
      const body = JSON.parse(init?.body as string) as { name: string; user_id_list: string[] };
      expect(body.name).toBe("VOC-6af5df-冰箱-高");
      // The operator is usually one of the owners; sending a duplicate makes the
      // API reject the whole call rather than ignoring the repeat.
      expect(body.user_id_list).toEqual(["ou_owner", "ou_operator"]);
      return jsonResponse({ code: 0, data: { chat_id: "oc_new" } });
    });

    const chatId = await createWarRoomChat(
      { env, name: "VOC-6af5df-冰箱-高", memberOpenIds: ["ou_owner", "ou_operator", "ou_owner"] },
      fetcher as unknown as typeof fetch,
    );

    expect(chatId).toBe("oc_new");
  });

  it("strips blank open_ids in addition to de-duplicating", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { user_id_list: string[] };
      expect(body.user_id_list).toEqual(["ou_owner"]);
      return jsonResponse({ code: 0, data: { chat_id: "oc_new" } });
    });

    await createWarRoomChat(
      { env, name: "n", memberOpenIds: ["ou_owner", "", "  "] },
      fetcher as unknown as typeof fetch,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("throws with the Feishu code when creation fails", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 232002, msg: "no permission" }));

    await expect(
      createWarRoomChat({ env, name: "n", memberOpenIds: [] }, fetcher as unknown as typeof fetch),
    ).rejects.toThrow(/232002/);
  });
});

describe("listChatMessages", () => {
  it("reads group messages oldest first and keeps only text", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("container_id_type=chat");
      expect(url).toContain("container_id=oc_1");
      return jsonResponse({
        code: 0,
        data: {
          items: [
            { msg_type: "text", body: { content: JSON.stringify({ text: "第一条" }) } },
            { msg_type: "interactive", body: { content: "{}" } },
            { msg_type: "text", body: { content: JSON.stringify({ text: "第二条" }) } },
          ],
        },
      });
    });

    expect(
      await listChatMessages({ env, chatId: "oc_1" }, fetcher as unknown as typeof fetch),
    ).toEqual(["第一条", "第二条"]);
  });

  it("returns an empty list when the group has no readable text", async () => {
    // The closing summary must still be attempted on an empty conversation rather
    // than throwing and taking the closure down with it.
    const fetcher = vi.fn(async () => jsonResponse({ code: 0, data: { items: [] } }));

    expect(
      await listChatMessages({ env, chatId: "oc_1" }, fetcher as unknown as typeof fetch),
    ).toEqual([]);
  });

  // The given fixture's non-text "interactive" item is filtered out by
  // msg_type before JSON.parse ever runs on its body, so it never actually
  // exercises the parse-failure catch. This test targets that catch
  // directly: a "text" item whose body.content is not valid JSON at all.
  it("skips a text message whose body content is not valid JSON, keeping the rest", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          items: [
            { msg_type: "text", body: { content: "not json at all {" } },
            { msg_type: "text", body: { content: JSON.stringify({ text: "仍然可读" }) } },
          ],
        },
      }),
    );

    expect(
      await listChatMessages({ env, chatId: "oc_1" }, fetcher as unknown as typeof fetch),
    ).toEqual(["仍然可读"]);
  });

  // Reading the transcript must never take the closure down with it, even
  // when the upstream call itself fails outright (not just a malformed item).
  it("returns an empty list instead of throwing when the upstream call fails", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network unreachable");
    });

    await expect(
      listChatMessages({ env, chatId: "oc_1" }, fetcher as unknown as typeof fetch),
    ).resolves.toEqual([]);
  });
});

describe("createBotOpenIdProvider", () => {
  const token = async () => "tenant-token";

  it("resolves the bot's own open_id from bot/v3/info", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/bot/v3/info");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer tenant-token",
      );
      return jsonResponse({
        code: 0,
        bot: {
          activate_status: 2,
          app_name: "OneCare",
          avatar_url: "https://example.com/avatar.png",
          ip_white_list: [],
          open_id: "ou_bot_self",
        },
      });
    });

    const botOpenId = createBotOpenIdProvider(token, fetcher as unknown as typeof fetch);

    expect(await botOpenId()).toBe("ou_bot_self");
  });

  it("fetches once and caches the open_id forever, unlike the expiring token cache", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ code: 0, bot: { open_id: "ou_bot_self" } }),
    );

    const botOpenId = createBotOpenIdProvider(token, fetcher as unknown as typeof fetch);

    expect(await botOpenId()).toBe("ou_bot_self");
    expect(await botOpenId()).toBe("ou_bot_self");
    expect(await botOpenId()).toBe("ou_bot_self");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shares a single in-flight lookup across concurrent callers", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ code: 0, bot: { open_id: "ou_bot_self" } }),
    );

    const botOpenId = createBotOpenIdProvider(token, fetcher as unknown as typeof fetch);

    const results = await Promise.all([botOpenId(), botOpenId(), botOpenId()]);

    expect(results).toEqual(["ou_bot_self", "ou_bot_self", "ou_bot_self"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects on a non-zero business code and does not cache the failure", async () => {
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ code: 99991663, msg: "invalid access token" })
        : jsonResponse({ code: 0, bot: { open_id: "ou_bot_self" } });
    });

    const botOpenId = createBotOpenIdProvider(token, fetcher as unknown as typeof fetch);

    await expect(botOpenId()).rejects.toThrow(/99991663/);
    // A failed lookup is not remembered — the next message gets its own
    // attempt, which here succeeds.
    expect(await botOpenId()).toBe("ou_bot_self");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects when the response is missing bot.open_id", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 0, bot: {} }));

    const botOpenId = createBotOpenIdProvider(token, fetcher as unknown as typeof fetch);

    await expect(botOpenId()).rejects.toThrow(/open_id/);
  });

  it("rejects on a transport error", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    const botOpenId = createBotOpenIdProvider(token, fetcher as unknown as typeof fetch);

    await expect(botOpenId()).rejects.toThrow("socket hang up");
  });
});
