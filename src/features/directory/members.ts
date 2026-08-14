// Who can be assigned a ticket, resolved from Feishu's contacts API.
//
// This module exists because a constraint was lifted. For most of this project the
// contacts endpoints returned 99991672 (not enabled), so the app could not turn a name
// into an open_id at all — which is why owners could only ever be picked in the
// Bitable's person picker, why the web could only "claim to self", and why owner names
// were read back out of the Bitable's resolved people field rather than looked up.
// The permission was granted on 2026-08-14 and all of that is now avoidable.
//
// Scope, stated plainly: `contact/v3/scopes` returns the members visible to this app,
// which is the app's availability range rather than the whole enterprise. That is the
// correct list for an assignment picker — offering someone the app cannot see would
// produce a write the Bitable would reject.

export type Member = Readonly<{
  openId: string;
  name: string;
}>;

export type DirectoryEnv = Readonly<{
  tenantToken: () => Promise<string>;
  fetcher?: typeof fetch;
}>;

const BASE = "https://open.feishu.cn/open-apis";

// Same 10s ceiling the Bitable client uses. A directory read sits in front of a person
// picker, so a hung request is a hung UI.
const TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function call(
  env: DirectoryEnv,
  path: string,
): Promise<Record<string, unknown>> {
  const fetcher = env.fetcher ?? fetch;
  const response = await fetcher(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${await env.tenantToken()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error("Contacts returned a non-object payload");
  return payload;
}

// The open_ids this app can see. Paged, because the endpoint pages even when a small
// tenant returns everything at once — a picker that silently showed the first 50 of
// 200 colleagues would be worse than one that showed none.
async function visibleOpenIds(env: DirectoryEnv): Promise<readonly string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({
      user_id_type: "open_id",
      page_size: "50",
    });
    if (pageToken) query.set("page_token", pageToken);

    const payload = await call(env, `/contact/v3/scopes?${query.toString()}`);
    if (payload.code !== 0) {
      throw new Error(`Contacts scopes failed (code ${String(payload.code)})`);
    }
    const data = isRecord(payload.data) ? payload.data : {};
    if (Array.isArray(data.user_ids)) {
      ids.push(...data.user_ids.filter((id): id is string => typeof id === "string"));
    }
    if (data.has_more !== true || typeof data.page_token !== "string") break;
    pageToken = data.page_token;
  }

  return ids;
}

// Names for those ids. Split from the id lookup because they are two endpoints, and
// because a batch read caps at 50 ids per call.
async function namesFor(
  env: DirectoryEnv,
  openIds: readonly string[],
): Promise<readonly Member[]> {
  const members: Member[] = [];

  for (let offset = 0; offset < openIds.length; offset += 50) {
    const chunk = openIds.slice(offset, offset + 50);
    const query = new URLSearchParams({ user_id_type: "open_id" });
    for (const id of chunk) query.append("user_ids", id);

    const payload = await call(env, `/contact/v3/users/batch?${query.toString()}`);
    if (payload.code !== 0) {
      throw new Error(`Contacts batch failed (code ${String(payload.code)})`);
    }
    const data = isRecord(payload.data) ? payload.data : {};
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      const openId = item.open_id;
      const name = item.name;
      // A member with no readable name is skipped rather than shown as a raw id: the
      // picker exists so a person can choose a colleague, and an open_id is not a
      // colleague. Before the permission landed, every record looked like this.
      if (typeof openId !== "string" || typeof name !== "string" || name.length === 0) {
        continue;
      }
      members.push({ openId, name });
    }
  }

  return members;
}

export async function listAssignableMembers(
  env: DirectoryEnv,
): Promise<readonly Member[]> {
  const ids = await visibleOpenIds(env);
  if (ids.length === 0) return [];
  const members = await namesFor(env, ids);
  return [...members].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}
