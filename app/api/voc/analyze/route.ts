import {
  BITABLE_TIMEOUT_MS,
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../src/features/bitable/client";
import { pushPending, writeRecord } from "../../../../src/features/store/mirror";
import {
  migrate,
  readPendingPushIds,
  syncFromBitable,
  upsertRecords,
} from "../../../../src/features/store/records";
import {
  VOC_FIELD_NAMES,
  openIds,
  parseReplyText,
  stringArray,
  text,
  toTagFieldUpdate,
  type BitableFields,
  type VocRecord,
} from "../../../../src/features/bitable/field-map";
import type { FeishuOutboundMessage } from "../../../../src/features/feishu-bot/card-types";
import {
  createVocTicketMessage,
  createWarRoomEscalationCard,
} from "../../../../src/features/feishu-bot/cards";
import { sendFeishuMessage } from "../../../../src/features/feishu-bot/client";
import { createAilyTaggingProvider } from "../../../../src/features/tagging/aily-provider";
import type {
  TagOutcome,
  TagResult,
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
import { triage, type VocSeverity } from "../../../../src/features/voc/triage";
import { warRoomDecision } from "../../../../src/features/warroom/naming";
import {
  readBitableEnv,
  readBotEnv,
  readTaggingEnv,
  type BitableEnv,
  type TaggingEnv,
} from "../../../../src/lib/env";

// `runtime = "nodejs"` was dropped: it is the App Router default anyway, and
// task 14 enables `cacheComponents` in next.config.ts (for the VOC
// dashboard's `use cache`), which rejects this route segment config outright.
// 60s was set when tagging was a stub. Measured against the live aily skill on
// 2026-08-12: one record takes roughly 23 seconds, because the batch had to be
// cut to one record per call — a five-record batch takes 36.5s when it works and
// otherwise comes back as an aily gateway 504. A SHARD_SIZE of 5 therefore needs
// about two minutes, and the first production run of this route died at
// FUNCTION_INVOCATION_TIMEOUT with nothing written: the per-record write design
// meant no half-processed rows, but no progress either. 300s is Vercel's current
// default ceiling and leaves room for a shard that runs slower than measured.
export const maxDuration = 300;

// The spec derives this from "single shard end-to-end <= 20s" (§5.6); 5 is
// the stated starting point pending a real measurement. Injected as a plain
// number (not read from env) because the whole point of sharding is that the
// same small, known-safe size runs on every Cron tick.
const SHARD_SIZE = 5;

// Only the fields this route actually reads off a pending record. Deliberately
// narrower than the full VocRecord (which also carries polarity/ownerOpenIds/
// closedAt for metrics elsewhere) so a caller injecting a fake listPending
// only has to supply what this route uses. The real listPending returns full
// VocRecord values, which trivially satisfy this narrower shape.
// recordNumber and feedbackAt are here because the ticket card this route now
// delivers puts both on screen (spec §6.1) — reading them off the row already
// listed costs nothing, and omitting them would render the owner's card with
// two placeholder dashes.
// warRoomChatId is here for Task 7's escalation gate: whether a war room gets
// proposed *again* for the same ticket reads it through warRoomDecision — the
// one persisted column that records both "a group already exists" and "the
// approver already declined." Whether one gets proposed at all is a
// different question with a different data source: spec §3.1 reads "当分片
// 作业把一条记录推进到 待跟进 (即 triage 判定要建单) 时，若该记录 严重度 = 高"
// — the severity in that sentence is triage()'s own verdict for *this* pass
// (buildTaggedWrite's local `severity`, plumbed out via TaggedWrite below),
// not a column read off the row before tagging ran. A first-run 待分析 row's
// own 严重度 column is null by construction (nothing has tagged it yet), so
// gating on that column instead would make the whole feature unreachable —
// this was caught and corrected after the first implementation of this task
// gated on the column literally, per the brief's own (incorrect) wording.
type PendingRecord = Pick<
  VocRecord,
  | "recordId"
  | "recordNumber"
  | "feedbackAt"
  | "channel"
  | "category"
  | "content"
  | "rating"
  | "state"
  | "retryCount"
  | "warRoomChatId"
>;

// Announcing a ticket to its owner, resolved as one value so the write path
// and the delivery path cannot disagree about who owns the row or what the
// card says.
type TicketDelivery = Readonly<{
  openId: string;
  message: FeishuOutboundMessage;
}>;

// This route holds two kinds of data about a ticket, and confusing them is
// exactly the bug this type exists to make impossible: **history** (what is
// already true and persisted — identity fields, the owner's resolved name,
// the war-room chat id) versus **this pass's own computation** (what tagging
// and triage() just decided — polarity/dimensions/summary/replies/severity).
// The rule for which a field belongs to: if a future retry of this same
// record could see a *different* value next time tagging runs, it is
// this-pass data and does not belong on EscalationRecord; if it does not
// change just because tagging ran again, it is history and does. Omitting
// summary/polarity/dimensions/replies/severity here (unlike PendingRecord,
// which never carried them to begin with) makes it a compile error to reach
// into `record` for any of the five instead of the `tag`/`severity` fields
// on EscalateInput below — the mistake this type replaces cannot type-check
// again. ownerNames is history on purpose: it is a person's display name off
// Base's own resolved people-field, which this pass's tagging does not
// produce and does not change.
type EscalationRecord = Omit<
  VocRecord,
  "summary" | "polarity" | "dimensions" | "replies" | "severity"
>;

// The whole input to an escalate() call. `tag` and `severity` are this
// pass's own fresh results — outcome.result and buildTaggedWrite's severity,
// both already computed by the time runShard's loop reaches the gate — kept
// as their own top-level fields (not merged into `record`) specifically so
// nothing about "read record.summary instead" can compile.
type EscalateInput = Readonly<{
  record: EscalationRecord;
  tag: TagResult;
  severity: VocSeverity;
  fallbackOpenIds: readonly string[];
}>;

type AnalyzeRouteDependencies = Readonly<{
  cronSecret: string;
  // Bitable -> Postgres. Injected like every other IO boundary in this route so a
  // test can drive the shard without a database.
  syncStore: () => Promise<Readonly<{ read: number; written: number; skipped: number }>>;
  shardSize: number;
  listPending: (shardSize: number) => Promise<readonly PendingRecord[]>;
  tag: (
    records: readonly TaggingRequestRecord[],
  ) => Promise<readonly TagOutcome[]>;
  ownerRules: () => Promise<readonly OwnerRule[]>;
  updateRecord: (recordId: string, fields: BitableFields) => Promise<void>;
  // The step that makes 待跟进 reachable by a human. Kept as its own
  // dependency (rather than folded into updateRecord) because it is an
  // announcement, not persistence: it happens strictly after the state is
  // committed, and its failure means "the row is correct but nobody was
  // told" — a different fact from "the row was not written".
  notifyOwner: (delivery: TicketDelivery) => Promise<void>;
  // Optional: a shard's tests overwhelmingly never exercise the high-severity
  // path, and an escalation-less run must behave exactly as it did before
  // this task existed. See EscalateInput above for why `record`, `tag`, and
  // `severity` are three separate fields rather than one VocRecord: an
  // earlier version of this dependency took just `{ record: VocRecord }` and
  // its default implementation read summary/polarity/dimensions/severity off
  // that stale, pre-tagging record — reachable, but showing the approver a
  // blank AI summary and blank severity on every escalation. fallbackOpenIds
  // is computed once per shard (the fallback set does not vary per record)
  // and handed down rather than re-derived inside every call.
  escalate?: (input: EscalateInput) => Promise<void>;
  // Spec §3.2: 打标来源 records "aily:<skill_id>@<批次号>" or "field-shortcut"
  // so a tagged/failed row is explainable and traceable. A plain string
  // (not a thunk) so the whole shard call — potentially several records —
  // reports the same batch identity; production wiring reads it once via
  // `dependencies.tagSource` at the top of the handler rather than once per
  // record, so an aily batch number stays stable across the shard.
  tagSource: string;
}>;

// notified/notifyErrors are separate keys, not folded into writeErrors:
// writeErrors means "could not write back to the Base" and a run that wrote
// every row correctly but told nobody is a different, equally urgent failure.
// Collapsing the two would make "0 writeErrors" read as a clean run while no
// owner ever saw a card.
// escalated has no error-counting sibling the way notified/notifyErrors do:
// per the brief, a failed proposal is swallowed with no counter at all
// ("仅不计数") — escalation is a pure enhancement, and its failure carries no
// operator-facing accounting distinct from "the number didn't go up".
type AnalyzeResponseBody = Readonly<{
  processed: number;
  tagged: number;
  failed: number;
  writeErrors: number;
  notified: number;
  notifyErrors: number;
  escalated: number;
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

// The fields for the one `updateRecord` write, plus — only when this record
// actually became a routable ticket — the card to hand its owner. Both come
// out of the same decision so the card can never claim a state the write did
// not set, or address someone the write did not record as the owner.
// severity is triage()'s verdict for *this* tagging pass — plumbed out so the
// escalation gate in runShard's loop can read the value that was actually
// just decided, rather than reaching back into the pre-tagging row for a
// column triage() itself is about to overwrite. Present on every branch for
// type uniformity, even though only the ticket-with-owner branch below can
// ever reach the gate (the other two leave delivery null, and the loop's own
// `if (!delivery) continue` skips the gate before it is read).
type TaggedWrite = Readonly<{
  fields: BitableFields;
  delivery: TicketDelivery | null;
  severity: VocSeverity;
}>;

// Computes the whole 待分析 -> 已分析 -> {待跟进|无需跟进} chain in memory and
// returns the single set of fields for the one `updateRecord` write the brief
// calls for — Bitable has no transaction, so a two-write version could leave
// a record stuck at 已分析 if the process died between them. Synchronous: the
// caller resolves ownerRules once, upfront, before any record is tagged (see
// createAnalyzeRoute), rather than this function lazily awaiting it per call.
function buildTaggedWrite(
  record: PendingRecord,
  result: TagResult,
  ownerRules: readonly OwnerRule[],
  tagSource: string,
): TaggedWrite {
  const { createTicket, severity } = triage({
    polarity: result.polarity,
    dimensions: result.dimensions,
  });
  // I6: tagSource identifies which track produced this result (the literal
  // "field-shortcut" for B, "aily:<skill_id>@<批次号>" for A) and is reliable
  // for that because a shard only ever runs one track — both dependencies.tag
  // and dependencies.tagSource are derived from the same TAGGING_PROVIDER env
  // read for the whole request. Only the B track's replies are a re-parse of
  // an existing Base column (see ToTagFieldUpdateOptions), so only it is told
  // to omit rather than blank out AI 回复话术 when parsing came up empty.
  const tagFields = {
    ...toTagFieldUpdate(result, severity, {
      omitEmptyReplies: tagSource === "field-shortcut",
    }),
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
      fields: {
        ...tagFields,
        [VOC_FIELD_NAMES.state]:
          noTicket.kind === "ok" ? noTicket.next : afterTagging,
      },
      // 无需跟进 is a terminal state nobody has to act on, so there is no
      // ticket to announce and no owner to announce it to.
      delivery: null,
      severity,
    };
  }

  const assignment = resolveOwner(ownerRules, {
    channel: record.channel,
    category: record.category,
  });
  const withTicket = transition(afterTagging, "需建单", {
    ...context,
    hasOwner: assignment !== null,
  });

  if (withTicket.kind === "ok" && assignment) {
    return {
      fields: {
        ...tagFields,
        [VOC_FIELD_NAMES.state]: withTicket.next,
        [VOC_FIELD_NAMES.owner]: [{ id: assignment.openId }],
        [VOC_FIELD_NAMES.ticketOpenedAt]: Date.now(),
      },
      delivery: {
        openId: assignment.openId,
        // Rendered from withTicket.next rather than the literal 待跟进 for the
        // same reason the write above is: the state machine decides what the
        // record's state is, and the card must show whatever it decided.
        message: createVocTicketMessage(
          {
            recordId: record.recordId,
            recordNumber: record.recordNumber,
            channel: record.channel,
            category: record.category,
            content: record.content,
            feedbackAt: record.feedbackAt,
            state: withTicket.next,
            severity,
          },
          result,
        ),
      },
      severity,
    };
  }

  // No usable owner or fallback (violates the "兜底是必需项" business rule
  // in spec §3.4) — never write a transition the state machine itself
  // rejected. The tagging work is still saved at the last legal state, and
  // with nobody to route it to there is nobody to push a card to either.
  return {
    fields: { ...tagFields, [VOC_FIELD_NAMES.state]: afterTagging },
    delivery: null,
    severity,
  };
}

// Every 负责人表 row with 兜底 checked, deduplicated by open_id and with a
// blank id dropped — the same "usable" filter resolveOwner already applies
// for ticket assignment. Pulled out (and exported) so the escalation gate's
// one real piece of logic — "no fallback resolves" — is testable without a
// fetcher or a live Base call, the same reason parseOwnerRules exists below.
// Computed once per shard from the ownerRules already fetched for owner
// resolution: the fallback set does not vary per record, so recomputing it
// inside the per-record loop would repeat the same filter for nothing.
export function fallbackOwnerOpenIds(
  ownerRules: readonly OwnerRule[],
): readonly string[] {
  const openIdList = ownerRules
    .filter((rule) => rule.fallback && rule.openId.trim().length > 0)
    .map((rule) => rule.openId);
  return [...new Set(openIdList)];
}

// "listPending"/"ownerRules" name the two reads whose failure is expected and
// diagnosable — seeing which one failed in a Vercel log is worth keeping.
// "unexpected" is the catch-all: everything else, named as such precisely
// because it carries no more specific claim than "this shard did not run".
type UnavailableSource = "listPending" | "ownerRules" | "unexpected";

// The catch-all's own error formatting must not be able to throw, or the last
// line of defense has the very hole it exists to close: String() raises
// TypeError for a prototype-less object (`Object.create(null)`), and both
// `.message` and `toString` can be throwing getters. A throw from inside a
// catch block is uncaught all over again.
function errorReason(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "unreadable error";
  }
}

function serviceUnavailable(
  source: UnavailableSource,
  error: unknown,
): Response {
  // No secret ever appears in these messages (listPending/ownerRules only
  // ever throw Bitable business-code strings), so it's safe to surface the
  // reason for whoever is reading Vercel's runtime logs for this Cron.
  return json(
    { error: "service_unavailable", source, reason: errorReason(error) },
    503,
  );
}

// The whole shard body, lifted out of the handler so it has exactly one call
// site — and that call site is inside the handler's catch-all. Reads added to
// this function in the future are covered by construction rather than by
// remembering to wrap them.
async function runShard(
  dependencies: AnalyzeRouteDependencies,
): Promise<Response> {
  // Pull the Bitable into the Postgres mirror before tagging anything. Every read
  // surface now answers from the mirror, so without this an operator editing a record
  // in the Bitable UI — assigning an owner with the person picker, say — would never
  // appear in the console. Individual writes made *by this app* refresh their own row
  // immediately; this is the only path that notices changes made outside it.
  //
  // Failing to sync must not cost the day's tagging, so it reports and continues
  // rather than aborting the shard: a stale mirror is bad, a day with no tagging is
  // worse.
  try {
    const sync = await dependencies.syncStore();
    console.info(
      `Store sync: read ${sync.read}, wrote ${sync.written}, skipped ${sync.skipped} pending push`,
    );
  } catch (error) {
    console.error(
      "Store sync failed:",
      error instanceof Error ? error.message : String(error),
    );
  }

  let records: readonly PendingRecord[];
  try {
    records = await dependencies.listPending(dependencies.shardSize);
  } catch (error) {
    return serviceUnavailable("listPending", error);
  }

  if (records.length === 0) {
    const empty: AnalyzeResponseBody = {
      processed: 0,
      tagged: 0,
      failed: 0,
      writeErrors: 0,
      notified: 0,
      notifyErrors: 0,
      escalated: 0,
    };
    return json(empty);
  }

  // Read-before-acting: every critical read this shard needs is resolved up
  // front, before tag() spends any AI budget and before any write is
  // attempted. A transient Bitable failure here (rate limit, 5xx) must fail
  // the whole shard rather than tag records it then can't route — 已分析 is a
  // dead end (listPendingRecords only ever re-fetches 待分析 and 分析失败;
  // nothing ever revisits 已分析), so a record stranded there after already
  // burning its one tagging attempt is worse than refusing the shard outright
  // and letting the next Cron tick retry cleanly with nothing written yet.
  let ownerRules: readonly OwnerRule[];
  try {
    ownerRules = await dependencies.ownerRules();
  } catch (error) {
    return serviceUnavailable("ownerRules", error);
  }

  // Derived once per shard from the same ownerRules read above, for the same
  // reason tagSource is read once below: the fallback set does not vary per
  // record, so every escalate() call in this shard reuses the one list.
  const fallbackOpenIds = fallbackOwnerOpenIds(ownerRules);

  // Read once per request, not once per record: dependencies.tagSource is a
  // getter in production so a fresh aily batch number is minted per Cron
  // tick, but every record in this shard must report the same batch. It gets
  // no try of its own — reading it is one of the many things in this function
  // that "shouldn't" throw, and the handler's catch-all is what covers all of
  // them uniformly.
  const tagSource = dependencies.tagSource;

  // Deliberately unguarded here too: the tagging providers hold a "never
  // throws, always returns an outcome per input" contract (Tasks 6/7, verified
  // against concurrency and malformed input). A dedicated catch around tag()
  // would silently absorb a break in that contract and make it unfindable
  // later. The handler's catch-all still turns such a break into a 503 rather
  // than a 500 — that is a backstop, not a sanctioned failure mode.
  const outcomes = await dependencies.tag(records.map(toTaggingRequest));
  const outcomeByRecordId = new Map(
    outcomes.map((outcome) => [outcomeRecordId(outcome), outcome] as const),
  );

  let tagged = 0;
  let failed = 0;
  let writeErrors = 0;
  let notified = 0;
  let notifyErrors = 0;
  let escalated = 0;

  for (const record of records) {
    const outcome =
      outcomeByRecordId.get(record.recordId) ??
      ({
        kind: "failed",
        recordId: record.recordId,
        reason: "未获得打标结果",
      } as const);

    let fields: BitableFields;
    let delivery: TicketDelivery | null = null;
    // This pass's own triage verdict and tag result, not the row's
    // pre-tagging column/AI fields — see the escalation gate below and
    // EscalationRecord's comment above for why that distinction is
    // load-bearing. Stays null for a failed outcome, which is harmless: a
    // failed outcome never produces a delivery either, so the gate's
    // `if (!delivery) continue` above it is never reached.
    let freshTagging: Readonly<{ severity: VocSeverity; tag: TagResult }> | null =
      null;
    if (outcome.kind === "tagged") {
      tagged += 1;
      const write = buildTaggedWrite(
        record,
        outcome.result,
        ownerRules,
        tagSource,
      );
      fields = write.fields;
      delivery = write.delivery;
      freshTagging = { severity: write.severity, tag: outcome.result };
    } else {
      failed += 1;
      fields = buildFailedFields(outcome, record.retryCount, tagSource);
    }

    // Per-record, and per-record only: one row that won't write must not cost
    // the rest of the shard the work already paid for in AI budget. This
    // stays a counted, non-fatal outcome, not something the catch-all sees.
    try {
      await dependencies.updateRecord(record.recordId, fields);
    } catch {
      writeErrors += 1;
      // Nothing was persisted, so there is no 待跟进 ticket to announce. A
      // card sent here would point its owner at a button the state machine is
      // about to reject, because the row is still sitting at 待分析.
      continue;
    }

    if (!delivery) continue;

    // Strictly after the write, and with its own counter. A failed push must
    // not roll back a state that is already committed, must not be charged to
    // writeErrors (whose meaning is "the Base write failed"), and must not
    // cost the remaining records in this shard their writes.
    try {
      await dependencies.notifyOwner(delivery);
      notified += 1;
    } catch {
      notifyErrors += 1;
    }

    // Escalation is an enhancement on top of the closed loop above, never a
    // condition of it: the ticket already reached 待跟进 and its owner was
    // already (attempted to be) notified by this point, regardless of
    // anything below. Gated on three independent things, from two different
    // data sources on purpose:
    //   - `freshTagging.severity === "高"` is *this pass's* triage verdict
    //     (spec §3.1: "分片作业把一条记录推进到 待跟进 时，若该记录 严重度 =
    //     高"), not record's own pre-tagging 严重度 column — that column is
    //     null for any record reaching this branch for the first time, which
    //     would make the whole feature unreachable. (An earlier version of
    //     this gate read record.severity directly; caught and corrected
    //     before merge — see the commit history on this line.)
    //   - `warRoomDecision(record.warRoomChatId)` reads the opposite kind of
    //     data on purpose: a persisted fact about *history*, not this pass's
    //     computation. That column is the one place "already has a group" or
    //     "approver already declined" survives across Cron ticks, which is
    //     what makes a ticket proposed at most once even though the shard
    //     re-runs daily and retries failures — an unconditional proposal
    //     would nag the approver about a ticket they already answered.
    //   - `dependencies.escalate` presence: most tests, and any caller that
    //     hasn't wired one up, get silent no-ops here.
    // A throw falls into this record's own try/catch, exactly like the write
    // and push above, but is not counted — the brief is explicit that a
    // failed proposal costs no counter of its own, only the chance to have
    // gone up.
    if (
      dependencies.escalate &&
      freshTagging &&
      freshTagging.severity === "高" &&
      warRoomDecision(record.warRoomChatId) === "create"
    ) {
      try {
        await dependencies.escalate({
          // PendingRecord is a Pick of VocRecord's identity/history fields
          // (never the AI ones — EscalationRecord excludes them, and
          // PendingRecord never carried them to begin with); the production
          // listPending already returns full VocRecord values under the
          // narrower static type (see PendingRecord's own comment above), so
          // this widens rather than lies. Tests inject their own escalate
          // fake and never read the fields this cast doesn't guarantee.
          record: record as unknown as EscalationRecord,
          tag: freshTagging.tag,
          severity: freshTagging.severity,
          fallbackOpenIds,
        });
        escalated += 1;
      } catch {
        // Swallowed on purpose: the ticket is already at 待跟进 and its owner
        // already has the single-chat card. Letting this throw reach the
        // handler's catch-all would turn a working closed loop into a 503
        // over a feature that is, by design, optional.
      }
    }
  }

  const body: AnalyzeResponseBody = {
    processed: records.length,
    tagged,
    failed,
    writeErrors,
    notified,
    notifyErrors,
    escalated,
  };
  return json(body);
}

export function createAnalyzeRoute(dependencies: AnalyzeRouteDependencies) {
  return async function POST(request: Request): Promise<Response> {
    // One guard around the entire handler, with exactly one call site for the
    // shard body inside it. The shape this replaces — a try around each read
    // that had been *observed* to throw — closed one hole per round and left
    // the next one open three rounds running: ownerRules, then listPending,
    // then the tagSource getter, which landed in the gap between the two new
    // try blocks. Enumerating throwers is the wrong move because the
    // enumeration is never finished; what closes the class is that there is
    // no longer any path out of this function that isn't inside this try.
    try {
      // Authorization stays the first statement executed. Nothing below is
      // reachable without the cron secret, and the 401 verdict is settled
      // before any dependency other than cronSecret is touched.
      //
      // It sits *inside* the guard rather than in front of it because
      // `dependencies.cronSecret` is itself a getter in production
      // (readCronSecret() throws when CRON_SECRET is unset) — the one read a
      // per-read shape could never have covered without yet another try.
      // Wrapping reorders nothing: a request with a bad or missing header
      // still returns 401 from here and never reaches runShard.
      const authorization = request.headers.get("authorization") ?? "";
      if (authorization !== `Bearer ${dependencies.cronSecret}`) {
        return json({ error: "unauthorized" }, 401);
      }

      return await runShard(dependencies);
    } catch (error) {
      // Cron runs once a day on this project's Hobby plan, so an uncaught
      // throw here does not cost one request — it costs a day of tagging,
      // reported as an opaque Next.js 500. 503 with a source is the same
      // refusal, legible in the runtime log.
      return serviceUnavailable("unexpected", error);
    }
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

// B-track source: re-reads the AI columns Bitable's own field shortcut
// already filled on each row. This is a second, independent read per record
// (not reused from listPending's VocRecord, which doesn't decode these AI
// columns at all) because the field shortcut can still be computing when the
// row was first listed.
//
// I5: bitableEnv/token/fetcher are explicit parameters (the same DI shape as
// listOwnerRules above) rather than read from process.env / a module
// singleton, so the network path is testable with a fake fetcher and no live
// Base call. Both a non-2xx HTTP status and a non-zero Bitable business code
// are now checked and thrown on — previously neither was, so a rate-limited
// or expired-token response (HTTP 200, code != 0, no data.record) silently
// decoded as an all-blank row. That blank row then failed downstream
// tag-payload validation with "polarity 不在枚举内：" — a misdiagnosis
// pointing at the AI model for what was actually a failed API call, while
// also burning one of the record's limited retries. The thrown error here
// carries the real Bitable code/HTTP status instead.
export async function readFieldShortcutRows(
  bitableEnv: BitableEnv,
  token: TenantTokenProvider,
  recordIds: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<readonly FieldShortcutRow[]> {
  const tokenValue = await token();
  const rows: FieldShortcutRow[] = [];

  for (const recordId of recordIds) {
    const url = `${BASE_URL}/bitable/v1/apps/${bitableEnv.appToken}/tables/${bitableEnv.vocTableId}/records/${recordId}?user_id_type=open_id`;
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${tokenValue}` },
      signal: AbortSignal.timeout(BITABLE_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Bitable field shortcut read failed (HTTP ${response.status})`,
      );
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.code !== 0) {
      const code = isRecord(payload) ? String(payload.code) : "unknown";
      throw new Error(`Bitable field shortcut read failed (code ${code})`);
    }

    const data = isRecord(payload.data) ? payload.data : {};
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
          // The aily skill-start API resolves the aily application from the
          // calling credential rather than from the app id in the path, so
          // when the aily application is published under an app of its own,
          // that app has to sign the call. Verified against the live API: the
          // main app's token returns 2320008 for a real, published aily app id.
          // Bitable reads and outbound messages keep using the main app either
          // way — only this one call changes identity.
          tenantAccessToken: env.credential
            ? createTenantTokenProvider(
                env.credential.appId,
                env.credential.appSecret,
              )
            : getTokenProvider(),
        });
      },
      createFieldShortcut: () =>
        createFieldShortcutTaggingProvider({
          read: (recordIds) =>
            readFieldShortcutRows(
              readBitableEnv(),
              getTokenProvider(),
              recordIds,
            ),
        }),
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

// Builds one escalation card and sends it to every deduplicated fallback
// approver. No fallback resolves ("负责人表" has no row with 兜底 checked) is
// a missing piece of configuration, not a shard failure — spec §3.1 calls
// for a silent return, no send and no throw, rather than surfacing it as an
// error nobody asked to see on every Cron tick.
//
// The card's AI content (summary/polarity/dimensions/severity) comes from
// `input.tag`/`input.severity` — this pass's own fresh results — not from
// `input.record`. That split is enforced by EscalateInput's type, not by
// this function remembering it: EscalationRecord has no summary/polarity/
// dimensions/replies/severity fields to read by mistake. Only ownerNames (a
// person's display name, resolved by Base's own people-field, which this
// pass's tagging does not produce) is read off `input.record`.
//
// Exported (like the other production-wiring functions above) so this one
// real branch is directly testable: an empty fallbackOpenIds list must return
// before ever touching readBotEnv() or the network, which is what makes it
// safe regardless of bot credentials.
export async function escalateToWarRoom(input: EscalateInput): Promise<void> {
  if (input.fallbackOpenIds.length === 0) return;

  const message: FeishuOutboundMessage = {
    msgType: "interactive",
    content: JSON.stringify(
      createWarRoomEscalationCard(
        {
          recordId: input.record.recordId,
          recordNumber: input.record.recordNumber,
          channel: input.record.channel,
          category: input.record.category,
          content: input.record.content,
          feedbackAt: input.record.feedbackAt,
          state: input.record.state,
          // The one AI-shaped field VocTicketCardRecord asks for, sourced
          // from this pass's own triage() verdict — not input.record, which
          // has no severity field to reach into by mistake.
          severity: input.severity,
        },
        {
          summary: input.tag.summary,
          polarity: input.tag.polarity,
          dimensions: input.tag.dimensions,
          replies: input.tag.replies,
        },
        input.record.ownerNames,
      ),
    ),
  };

  const env = readBotEnv();
  for (const openId of input.fallbackOpenIds) {
    await sendFeishuMessage({ env, openId, message });
  }
}

// A function rather than a const because two callers now need this wiring with two
// small differences: the daily Cron shard, and the workbench's "立即分析" button,
// which runs one named record and skips the Bitable pull. Overrides are applied with
// Object.assign onto the fresh object so the `cronSecret` and `tagSource` accessors
// below survive — spreading the object would evaluate both getters at spread time,
// which for cronSecret means throwing when CRON_SECRET is unset (a web button has no
// business depending on that) and for tagSource means freezing one aily batch number.
function productionDependencies(
  overrides?: Partial<AnalyzeRouteDependencies>,
): AnalyzeRouteDependencies {
  const base: AnalyzeRouteDependencies = {
    syncStore: async () => {
      await migrate();
      // Retry outstanding pushes before pulling. A row whose Bitable write failed keeps
      // pending_push and is skipped by the pull, so without this it would stay flagged
      // and diverged indefinitely.
      const pushed = await pushPending(getBitableClient());
      if (pushed.attempted > 0) {
        console.info(
          `Retried ${pushed.pushed} of ${pushed.attempted} outstanding Bitable pushes`,
        );
      }
      return syncFromBitable({
        listRecords: () => getBitableClient().listRecords(),
        pendingIds: readPendingPushIds,
        upsert: upsertRecords,
      });
    },
    get cronSecret() {
      return readCronSecret();
    },
    shardSize: SHARD_SIZE,
    listPending: listPendingRecords,
    tag: (records) => getTaggingProvider().tag(records),
    ownerRules: () => listOwnerRules(readBitableEnv(), getTokenProvider()),
    updateRecord: async (recordId, fields) => {
      // Awaited end to end: this shard runs under a 300s maxDuration, and a tagged
      // record that never reaches the mirror is invisible in the console.
      const pushes: Promise<void>[] = [];
      await writeRecord(
        { bitable: getBitableClient(), defer: (task) => pushes.push(task()) },
        recordId,
        fields,
      );
      await Promise.all(pushes);
    },
    // readBotEnv() is called here, not hoisted: this module is imported at build
    // time and must never touch process.env on import (the same discipline the
    // rest of this wiring follows). A missing bot credential therefore surfaces
    // as one record's notifyErrors, inside runShard's per-record try, rather
    // than as a failed build or a dead shard.
    notifyOwner: (delivery) =>
      sendFeishuMessage({
        env: readBotEnv(),
        openId: delivery.openId,
        message: delivery.message,
      }),
    escalate: escalateToWarRoom,
    // A getter (like cronSecret) so each Cron tick — not each import — gets a
    // fresh aily batch number; createAnalyzeRoute reads this once per request
    // and reuses it for every record in the shard.
    get tagSource() {
      return resolveTagSource(readTaggingEnv());
    },
  };

  return overrides ? Object.assign(base, overrides) : base;
}

// One named record, tagged now, because a person asked for it — the workbench's
// 立即分析 button. Everything about *how* a record gets tagged stays in runShard:
// the provider, the owner rules, the single write, the owner's card, the war-room
// escalation. Only two things differ from a Cron tick:
//
//   - the shard is exactly this record, so nothing else is touched;
//   - no Bitable pull first. That sync exists so edits made in the Bitable UI reach
//     the mirror, which is the daily job's business; here it would spend seconds
//     reading 3628 rows before starting the work the operator is waiting on.
//
// The caller is responsible for the record being in a state worth tagging —
// analyzeEligibility is where that decision lives, and it is what turns a 分析失败
// row's 重试 into the 待分析 state the shard needs to see.
export function analyzeOneRecord(record: PendingRecord): Promise<Response> {
  return runShard(
    productionDependencies({
      shardSize: 1,
      listPending: async () => [record],
      syncStore: async () => ({ read: 0, written: 0, skipped: 0 }),
    }),
  );
}

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
const handler = createAnalyzeRoute(productionDependencies());
export const GET = handler;
export const POST = handler;
