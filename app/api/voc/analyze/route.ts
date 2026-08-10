import {
  BITABLE_TIMEOUT_MS,
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../src/features/bitable/client";
import {
  VOC_FIELD_NAMES,
  openIds,
  stringArray,
  text,
  toTagFieldUpdate,
  type BitableFields,
  type VocRecord,
} from "../../../../src/features/bitable/field-map";
import { createAilyTaggingProvider } from "../../../../src/features/tagging/aily-provider";
import type {
  TagOutcome,
  TagResult,
  VocReply,
} from "../../../../src/features/tagging/contracts";
import {
  createFieldShortcutTaggingProvider,
  type FieldShortcutRow,
} from "../../../../src/features/tagging/field-shortcut-provider";
import { selectTaggingProvider } from "../../../../src/features/tagging/provider";
import type {
  TaggingProvider,
  TaggingRequestRecord,
} from "../../../../src/features/tagging/provider-types";
import {
  resolveOwner,
  type OwnerRule,
} from "../../../../src/features/voc/assignment";
import {
  transition,
  type TransitionContext,
  type VocState,
} from "../../../../src/features/voc/service-event";
import { triage } from "../../../../src/features/voc/triage";
import {
  readBitableEnv,
  readBotEnv,
  readTaggingEnv,
  type BitableEnv,
  type TaggingEnv,
} from "../../../../src/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

// The spec derives this from "single shard end-to-end <= 20s" (§5.6); 5 is
// the stated starting point pending a real measurement. Injected as a plain
// number (not read from env) because the whole point of sharding is that the
// same small, known-safe size runs on every Cron tick.
const SHARD_SIZE = 5;

// Only the fields this route actually reads off a pending record. Deliberately
// narrower than the full VocRecord (which also carries recordNumber/
// feedbackAt/severity/ownerOpenIds/ticketOpenedAt/closedAt for card display
// and metrics elsewhere) so a caller injecting a fake listPending only has to
// supply what this route uses. The real listPending returns full VocRecord
// values, which trivially satisfy this narrower shape.
type PendingRecord = Pick<
  VocRecord,
  "recordId" | "channel" | "category" | "content" | "rating" | "state" | "retryCount"
>;

type AnalyzeRouteDependencies = Readonly<{
  cronSecret: string;
  shardSize: number;
  listPending: (shardSize: number) => Promise<readonly PendingRecord[]>;
  tag: (
    records: readonly TaggingRequestRecord[],
  ) => Promise<readonly TagOutcome[]>;
  ownerRules: () => Promise<readonly OwnerRule[]>;
  updateRecord: (recordId: string, fields: BitableFields) => Promise<void>;
  // Spec §3.2: 打标来源 records "aily:<skill_id>@<批次号>" or "field-shortcut"
  // so a tagged/failed row is explainable and traceable. A plain string
  // (not a thunk) so the whole shard call — potentially several records —
  // reports the same batch identity; production wiring reads it once via
  // `dependencies.tagSource` at the top of the handler rather than once per
  // record, so an aily batch number stays stable across the shard.
  tagSource: string;
}>;

type AnalyzeResponseBody = Readonly<{
  processed: number;
  tagged: number;
  failed: number;
  writeErrors: number;
}>;

function json(data: object, status = 200): Response {
  return Response.json(data, { status });
}

function outcomeRecordId(outcome: TagOutcome): string {
  return outcome.kind === "tagged" ? outcome.result.recordId : outcome.recordId;
}

function toTaggingRequest(record: PendingRecord): TaggingRequestRecord {
  return {
    recordId: record.recordId,
    content: record.content,
    channel: record.channel,
    category: record.category,
    ...(record.rating === null ? {} : { rating: record.rating }),
  };
}

// The four write fields spelled out in the brief for a failed outcome, plus
// 打标来源 (spec §3.2 requires it on every AI write, success or failure, for
// explainability — a failed attempt is exactly the case an operator most
// needs to know which track produced it). 原始输出 is always written (as ""
// when the provider gave none) rather than omitted, so a diagnosing operator
// never has to guess whether the column is empty because nothing was
// captured or because this code path skipped it.
function buildFailedFields(
  outcome: Extract<TagOutcome, { kind: "failed" }>,
  retryCount: number,
  tagSource: string,
): BitableFields {
  return {
    [VOC_FIELD_NAMES.state]: "分析失败",
    [VOC_FIELD_NAMES.failureReason]: outcome.reason,
    [VOC_FIELD_NAMES.rawOutput]: outcome.rawOutput ?? "",
    [VOC_FIELD_NAMES.retryCount]: retryCount + 1,
    [VOC_FIELD_NAMES.tagSource]: tagSource,
  };
}

// Computes the whole 待分析 -> 已分析 -> {待跟进|无需跟进} chain in memory and
// returns the single set of fields for the one `updateRecord` write the brief
// calls for — Bitable has no transaction, so a two-write version could leave
// a record stuck at 已分析 if the process died between them.
async function buildTaggedFields(
  record: PendingRecord,
  result: TagResult,
  getOwnerRules: () => Promise<readonly OwnerRule[]>,
  tagSource: string,
): Promise<BitableFields> {
  const { createTicket, severity } = triage({
    polarity: result.polarity,
    dimensions: result.dimensions,
  });
  const tagFields = {
    ...toTagFieldUpdate(result, severity),
    [VOC_FIELD_NAMES.tagSource]: tagSource,
  };
  const context: TransitionContext = {
    retryCount: record.retryCount,
    hasOwner: false,
  };

  // record.state is always 待分析 here because listPending only ever fetches
  // that state, so this is expected to always be "ok". It is still routed
  // through transition() rather than hardcoded, because the state machine —
  // not this route — is the single source of truth for what 打标成功 means.
  const analyzed = transition(record.state, "打标成功", context);
  const afterTagging: VocState =
    analyzed.kind === "ok" ? analyzed.next : record.state;

  if (!createTicket) {
    const noTicket = transition(afterTagging, "无需建单", context);
    return {
      ...tagFields,
      [VOC_FIELD_NAMES.state]:
        noTicket.kind === "ok" ? noTicket.next : afterTagging,
    };
  }

  const rules = await getOwnerRules();
  const assignment = resolveOwner(rules, {
    channel: record.channel,
    category: record.category,
  });
  const withTicket = transition(afterTagging, "需建单", {
    ...context,
    hasOwner: assignment !== null,
  });

  if (withTicket.kind === "ok" && assignment) {
    return {
      ...tagFields,
      [VOC_FIELD_NAMES.state]: withTicket.next,
      [VOC_FIELD_NAMES.owner]: [{ id: assignment.openId }],
      [VOC_FIELD_NAMES.ticketOpenedAt]: Date.now(),
    };
  }

  // No usable owner or fallback (violates the "兜底是必需项" business rule
  // in spec §3.4) — never write a transition the state machine itself
  // rejected. The tagging work is still saved at the last legal state.
  return { ...tagFields, [VOC_FIELD_NAMES.state]: afterTagging };
}

export function createAnalyzeRoute(dependencies: AnalyzeRouteDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? "";
    if (authorization !== `Bearer ${dependencies.cronSecret}`) {
      return json({ error: "unauthorized" }, 401);
    }

    const records = await dependencies.listPending(dependencies.shardSize);
    if (records.length === 0) {
      const empty: AnalyzeResponseBody = {
        processed: 0,
        tagged: 0,
        failed: 0,
        writeErrors: 0,
      };
      return json(empty);
    }

    // Read once per request, not once per record: dependencies.tagSource is a
    // getter in production so a fresh aily batch number is minted per Cron
    // tick, but every record in this shard must report the same batch.
    const tagSource = dependencies.tagSource;

    const outcomes = await dependencies.tag(records.map(toTaggingRequest));
    const outcomeByRecordId = new Map(
      outcomes.map((outcome) => [outcomeRecordId(outcome), outcome] as const),
    );

    let tagged = 0;
    let failed = 0;
    let writeErrors = 0;

    // Fetched at most once per shard call and shared by every record that
    // needs it, rather than once per ticket-creating record: the owner table
    // doesn't change mid-shard, and shards can carry more than one 差评.
    let cachedOwnerRules: readonly OwnerRule[] | null = null;
    async function getOwnerRules(): Promise<readonly OwnerRule[]> {
      if (!cachedOwnerRules) {
        cachedOwnerRules = await dependencies.ownerRules();
      }
      return cachedOwnerRules;
    }

    for (const record of records) {
      const outcome =
        outcomeByRecordId.get(record.recordId) ??
        ({
          kind: "failed",
          recordId: record.recordId,
          reason: "未获得打标结果",
        } as const);

      let fields: BitableFields;
      if (outcome.kind === "tagged") {
        tagged += 1;
        fields = await buildTaggedFields(
          record,
          outcome.result,
          getOwnerRules,
          tagSource,
        );
      } else {
        failed += 1;
        fields = buildFailedFields(outcome, record.retryCount, tagSource);
      }

      try {
        await dependencies.updateRecord(record.recordId, fields);
      } catch {
        writeErrors += 1;
      }
    }

    const body: AnalyzeResponseBody = {
      processed: records.length,
      tagged,
      failed,
      writeErrors,
    };
    return json(body);
  };
}

// Merges freshly-fetched 待分析 records with retry-eligible 分析失败
// candidates into one shard, up to shardSize. Pure and IO-free on purpose:
// before this, the 分析失败 -> 重试 -> 待分析 transition and its
// `重试次数 < RETRY_CEILING` guard were unreachable from any code path in the
// repo — listPending only ever fetched 待分析, so a failed record had no way
// back in and spec §14's "分析失败的记录可被下一片 Cron 重取" could never be
// met. Each candidate is routed through the real transition() (not a
// hand-rolled numeric comparison) so the guard is genuinely exercised: a
// record at the retry ceiling is "rejected" and left untouched at 分析失败;
// everything else this function does is decide who gets a slot.
export function buildPendingShard(
  pending: readonly PendingRecord[],
  failedCandidates: readonly PendingRecord[],
  shardSize: number,
): readonly PendingRecord[] {
  const remaining = shardSize - pending.length;
  if (remaining <= 0) return pending;

  const retried: PendingRecord[] = [];
  for (const record of failedCandidates) {
    if (retried.length >= remaining) break;

    const result = transition(record.state, "重试", {
      retryCount: record.retryCount,
      hasOwner: false,
    });
    if (result.kind === "ok") {
      // Reset in memory only — the eventual single updateRecord write below
      // reflects wherever tagging actually lands the record (待跟进/无需跟进/
      // 分析失败 again), so 流程状态 never visibly passes through 待分析 in
      // the Base for a retried row.
      retried.push({ ...record, state: result.next });
    }
    // "rejected" (retry ceiling reached): leave the record at 分析失败,
    // untouched, for good — it must never be retaken.
  }

  return [...pending, ...retried];
}

// ---------------------------------------------------------------------------
// Production wiring. Everything below is deliberately deferred (closures, not
// eagerly-evaluated values) so importing this module never touches
// process.env — the same discipline app/api/feishu/events/route.ts already
// follows for readBotEnv(). A `get` accessor lets cronSecret stay a plain
// string on the type while still deferring the read to request time.
// ---------------------------------------------------------------------------

const BASE_URL = "https://open.feishu.cn/open-apis";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCronSecret(): string {
  const value = process.env.CRON_SECRET?.trim();
  if (!value) {
    throw new Error("Missing server environment variable: CRON_SECRET");
  }
  return value;
}

let tokenProvider: TenantTokenProvider | null = null;
function getTokenProvider(): TenantTokenProvider {
  if (!tokenProvider) {
    const botEnv = readBotEnv();
    tokenProvider = createTenantTokenProvider(botEnv.appId, botEnv.appSecret);
  }
  return tokenProvider;
}

let bitableClient: BitableClient | null = null;
function getBitableClient(): BitableClient {
  if (!bitableClient) {
    bitableClient = createBitableClient(readBitableEnv(), getTokenProvider());
  }
  return bitableClient;
}

async function listPendingRecords(
  shardSize: number,
): Promise<readonly PendingRecord[]> {
  const bitable = getBitableClient();
  const pending = await bitable.listRecords({
    pageSize: shardSize,
    maxPages: 1,
    filter: `CurrentValue.[${VOC_FIELD_NAMES.state}]="待分析"`,
  });
  if (pending.length >= shardSize) return pending;

  // Best-effort: fetches up to shardSize 分析失败 candidates and
  // buildPendingShard takes the first ones that pass the retry guard. A run
  // of more than shardSize consecutive over-ceiling failures could still
  // under-fill this one shard; the next Cron tick picks up whatever is left.
  const failedCandidates = await bitable.listRecords({
    pageSize: shardSize,
    maxPages: 1,
    filter: `CurrentValue.[${VOC_FIELD_NAMES.state}]="分析失败"`,
  });
  return buildPendingShard(pending, failedCandidates, shardSize);
}

// The owner table (负责范围/负责人/兜底) is a second table on the same Base,
// outside BitableClient's scope (which only addresses the VOC table). It has
// no schema-guard of its own; reading it here mirrors the pattern deliberately
// kept minimal for a table this small.
const OWNER_FIELD_NAMES = {
  scope: "负责范围",
  owner: "负责人",
  fallback: "兜底",
} as const;

// The Bitable-response -> OwnerRule[] mapping, pulled out of listOwnerRules
// so it's testable without a fetcher or real env vars — previously this whole
// function was only exercised by the live Base round-trip.
export function parseOwnerRules(items: readonly unknown[]): readonly OwnerRule[] {
  return items.flatMap((item) => {
    if (!isRecord(item) || !isRecord(item.fields)) return [];
    return [
      {
        scope: text(item.fields[OWNER_FIELD_NAMES.scope]),
        // resolveOwner already drops rules with a blank openId (assignment.ts
        // "usable" filter), so an empty fallback here is handled downstream
        // rather than filtered twice.
        openId: openIds(item.fields[OWNER_FIELD_NAMES.owner])[0] ?? "",
        fallback: item.fields[OWNER_FIELD_NAMES.fallback] === true,
      },
    ];
  });
}

// Same DI shape as client.ts's createBitableClient(env, token, fetcher):
// bitableEnv and token are explicit parameters, not read from process.env or
// a module singleton inside the function body, and fetcher defaults to the
// real fetch. Before this, the network path itself — URL construction, the
// auth header, the timeout, the code!==0 branch, and malformed-response
// handling — was exercised only by the live Base round-trip, because there
// was no way to hand this function a fake fetcher without also faking real
// env vars and the token cache singleton. Semantics are unchanged from
// before this refactor; this only makes them injectable so client.test.ts's
// established pattern can lock them down.
export async function listOwnerRules(
  bitableEnv: BitableEnv,
  token: TenantTokenProvider,
  fetcher: typeof fetch = fetch,
): Promise<readonly OwnerRule[]> {
  const tokenValue = await token();
  const url = `${BASE_URL}/bitable/v1/apps/${bitableEnv.appToken}/tables/${bitableEnv.ownerTableId}/records?user_id_type=open_id&page_size=100`;

  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${tokenValue}` },
    signal: AbortSignal.timeout(BITABLE_TIMEOUT_MS),
  });
  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.code !== 0) {
    const code = isRecord(payload) ? String(payload.code) : "unknown";
    throw new Error(`Bitable owner list failed (code ${code})`);
  }

  const data = isRecord(payload.data) ? payload.data : {};
  const items = Array.isArray(data.items) ? data.items : [];
  return parseOwnerRules(items);
}

// Reverses the "【语气】正文" \n\n-joined format toTagFieldUpdate/cards.ts's
// repliesText write into the Base, so the field-shortcut track can read back
// what it (or a human) put in AI 回复话术. A segment that doesn't match the
// shape is dropped rather than thrown on — a hand-edited cell here must
// degrade like every other malformed-input path in this codebase, not crash
// the shard.
function parseReplyText(raw: string): readonly VocReply[] {
  if (raw.trim().length === 0) return [];
  const segmentPattern = /^【([^】]*)】([\s\S]*)$/;
  return raw.split("\n\n").flatMap((segment) => {
    const match = segmentPattern.exec(segment);
    return match ? [{ tone: match[1], text: match[2] }] : [];
  });
}

// B-track source: re-reads the AI columns Bitable's own field shortcut
// already filled on each row. This is a second, independent read per record
// (not reused from listPending's VocRecord, which doesn't decode these AI
// columns at all) because the field shortcut can still be computing when the
// row was first listed.
async function readFieldShortcutRows(
  recordIds: readonly string[],
): Promise<readonly FieldShortcutRow[]> {
  const bitableEnv = readBitableEnv();
  const token = await getTokenProvider()();
  const rows: FieldShortcutRow[] = [];

  for (const recordId of recordIds) {
    const url = `${BASE_URL}/bitable/v1/apps/${bitableEnv.appToken}/tables/${bitableEnv.vocTableId}/records/${recordId}?user_id_type=open_id`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(BITABLE_TIMEOUT_MS),
    });
    const payload: unknown = await response.json();
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
    const record = isRecord(data.record) ? data.record : null;
    const fields = record && isRecord(record.fields) ? record.fields : {};

    rows.push({
      recordId,
      sentiment: stringArray(fields[VOC_FIELD_NAMES.sentiment]),
      polarity: text(fields[VOC_FIELD_NAMES.polarity]),
      dimensions: stringArray(fields[VOC_FIELD_NAMES.dimensions]),
      summary: text(fields[VOC_FIELD_NAMES.summary]),
      replies: parseReplyText(text(fields[VOC_FIELD_NAMES.replies])),
    });
  }

  return rows;
}

let taggingProvider: TaggingProvider | null = null;
function getTaggingProvider(): TaggingProvider {
  if (!taggingProvider) {
    const env = readTaggingEnv();
    taggingProvider = selectTaggingProvider(env.provider, {
      createAily: () => {
        // selectTaggingProvider only ever invokes the factory matching
        // env.provider, so this branch is unreachable in practice; it exists
        // to satisfy the discriminated union without an unsound cast.
        if (env.provider !== "aily") {
          throw new Error("TAGGING_PROVIDER is not aily");
        }
        return createAilyTaggingProvider({
          ailyAppId: env.ailyAppId,
          skillId: env.taggingSkillId,
          tenantAccessToken: getTokenProvider(),
        });
      },
      createFieldShortcut: () =>
        createFieldShortcutTaggingProvider({ read: readFieldShortcutRows }),
    });
  }
  return taggingProvider;
}

// Spec §3.2: "打标来源" must read back as "aily:<skill_id>@<批次号>" (A track)
// or the literal "field-shortcut" (B track) so a tagged/failed row is
// explainable and traceable to what produced it. `now` is injectable so the
// batch-number format is testable without faking Date.now() globally.
export function resolveTagSource(
  env: TaggingEnv,
  now: () => number = Date.now,
): string {
  return env.provider === "aily"
    ? `aily:${env.taggingSkillId}@${now()}`
    : "field-shortcut";
}

const defaultDependencies: AnalyzeRouteDependencies = {
  get cronSecret() {
    return readCronSecret();
  },
  shardSize: SHARD_SIZE,
  listPending: listPendingRecords,
  tag: (records) => getTaggingProvider().tag(records),
  ownerRules: () => listOwnerRules(readBitableEnv(), getTokenProvider()),
  updateRecord: (recordId, fields) =>
    getBitableClient().updateRecord(recordId, fields),
  // A getter (like cronSecret) so each Cron tick — not each import — gets a
  // fresh aily batch number; createAnalyzeRoute reads this once per request
  // and reuses it for every record in the shard.
  get tagSource() {
    return resolveTagSource(readTaggingEnv());
  },
};

// Vercel Cron Jobs always invoke their target with an HTTP GET, not POST
// (confirmed against vercel.com/docs/cron-jobs: "Vercel makes an HTTP GET
// request"); the vercel.json crons entry below has no field to change that.
// A POST-only export would pass every test in this file — the mocked
// request is never GET — and still 405 in production the moment the Cron
// fires, exactly the "green tests, silent real-world failure" class of bug
// this codebase has hit before (epoch-ms writes, {id} vs {open_id}). Both
// verbs are wired to the same handler so a manual `curl -X POST` (used
// during development and in this task's own verification) keeps working
// too.
const handler = createAnalyzeRoute(defaultDependencies);
export const GET = handler;
export const POST = handler;
