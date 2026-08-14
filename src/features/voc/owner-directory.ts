// Read and write the Bitable's 负责人表 — the routing table 人员管理 manages.
//
// Its own module rather than a method on BitableClient because that client addresses the
// VOC table exclusively: every one of its URLs is built from `vocTableId`, and widening
// it to take a table id would make every existing call site say which table it means for
// no benefit. This one addresses `ownerTableId` and nothing else.
//
// It is also the first place in this repository that **creates and deletes** Bitable
// records. The VOC table deliberately has no create path — records get there by an
// operator importing the enterprise's own export, and a create method would be a way to
// put rows into the enterprise's data that no reviewer asked for. A routing rule is the
// opposite: it is ours, it is small, and managing it in the Bitable UI is exactly the
// detour 人员管理 exists to remove.

import { BITABLE_TIMEOUT_MS, type TenantTokenProvider } from "../bitable/client";
import { openIds, text } from "../bitable/field-map";
import type { BitableEnv } from "../../lib/env";
import { toOwnerRole, type OwnerRole, type OwnerRuleRecord } from "./owner-rules";

const BASE_URL = "https://open.feishu.cn/open-apis";

// The three columns the routing table actually has, named once. The pipeline's own reader
// (listOwnerRules) uses the same three strings; a rename in the Base has to change both,
// and that is why they are stated in one place per module rather than inlined.
export const OWNER_FIELDS = {
  scope: "负责范围",
  owner: "负责人",
  fallback: "兜底",
  role: "角色",
} as const;

export type OwnerDirectoryEnv = Readonly<{
  bitable: BitableEnv;
  token: TenantTokenProvider;
  fetcher?: typeof fetch;
}>;

export type OwnerRuleInput = Readonly<{
  scope: string;
  openId: string;
  fallback: boolean;
  role: OwnerRole;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function call(
  env: OwnerDirectoryEnv,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const fetcher = env.fetcher ?? fetch;
  const response = await fetcher(
    `${BASE_URL}/bitable/v1/apps/${env.bitable.appToken}/tables/${env.bitable.ownerTableId}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${await env.token()}`,
        "Content-Type": "application/json; charset=utf-8",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(BITABLE_TIMEOUT_MS),
    },
  );

  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new Error("Bitable owner table returned a non-object payload");
  }
  return payload;
}

function fieldsFor(input: OwnerRuleInput): Record<string, unknown> {
  return {
    [OWNER_FIELDS.scope]: input.scope,
    // A people field takes objects, not bare ids — the same shape every other write in
    // this repository uses for 负责人.
    [OWNER_FIELDS.owner]: input.openId ? [{ id: input.openId }] : [],
    [OWNER_FIELDS.fallback]: input.fallback,
    [OWNER_FIELDS.role]: input.role,
  };
}

// The display name comes back on the people field itself, so the management table can
// show who a rule points at without a second contacts round trip. An unreadable name is
// left empty rather than replaced by the raw open_id: the page shows the gap.
function nameOf(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const first = value[0];
  return isRecord(first) && typeof first.name === "string" ? first.name : "";
}

export async function listOwnerRuleRecords(
  env: OwnerDirectoryEnv,
): Promise<readonly OwnerRuleRecord[]> {
  // user_id_type=open_id for the same reason every other people-field read in this
  // repository sets it: without it the ids come back in a type that never matches an
  // event's operator open_id.
  const payload = await call(env, `/records?user_id_type=open_id&page_size=200`);
  if (payload.code !== 0) {
    throw new Error(`Bitable owner list failed (code ${String(payload.code)})`);
  }

  const data = isRecord(payload.data) ? payload.data : {};
  const items = Array.isArray(data.items) ? data.items : [];

  return items.flatMap((item) => {
    if (!isRecord(item) || typeof item.record_id !== "string") return [];
    const fields = isRecord(item.fields) ? item.fields : {};
    return [
      {
        recordId: item.record_id,
        scope: text(fields[OWNER_FIELDS.scope]),
        openId: openIds(fields[OWNER_FIELDS.owner])[0] ?? "",
        ownerName: nameOf(fields[OWNER_FIELDS.owner]),
        fallback: fields[OWNER_FIELDS.fallback] === true,
        role: toOwnerRole(fields[OWNER_FIELDS.role]),
      },
    ];
  });
}

export async function createOwnerRule(
  env: OwnerDirectoryEnv,
  input: OwnerRuleInput,
): Promise<string> {
  const payload = await call(env, `/records?user_id_type=open_id`, {
    method: "POST",
    body: JSON.stringify({ fields: fieldsFor(input) }),
  });
  if (payload.code !== 0) {
    throw new Error(`Bitable owner create failed (code ${String(payload.code)})`);
  }

  const data = isRecord(payload.data) ? payload.data : {};
  const record = isRecord(data.record) ? data.record : {};
  if (typeof record.record_id !== "string") {
    throw new Error("Bitable owner create returned no record_id");
  }
  return record.record_id;
}

export async function updateOwnerRule(
  env: OwnerDirectoryEnv,
  recordId: string,
  input: OwnerRuleInput,
): Promise<void> {
  const payload = await call(env, `/records/${recordId}?user_id_type=open_id`, {
    method: "PUT",
    body: JSON.stringify({ fields: fieldsFor(input) }),
  });
  if (payload.code !== 0) {
    throw new Error(`Bitable owner update failed (code ${String(payload.code)})`);
  }
}

export async function deleteOwnerRule(
  env: OwnerDirectoryEnv,
  recordId: string,
): Promise<void> {
  const payload = await call(env, `/records/${recordId}`, { method: "DELETE" });
  if (payload.code !== 0) {
    throw new Error(`Bitable owner delete failed (code ${String(payload.code)})`);
  }
}
