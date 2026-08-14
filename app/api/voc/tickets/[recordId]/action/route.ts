import { revalidateTag } from "next/cache";

import {
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../../../src/features/bitable/client";
import type { VocRecord } from "../../../../../../src/features/bitable/field-map";
import { getCurrentSession } from "../../../../../../src/features/auth/current-session";
import type { AuthUser } from "../../../../../../src/features/auth/types";
import { readBitableEnv, readBotEnv } from "../../../../../../src/lib/env";
import { VOC_RECORDS_CACHE_TAG } from "../../../../../../src/features/voc/cache-tags";
import {
  listAssignableMembers,
  type Member,
} from "../../../../../../src/features/directory/members";
import { writeRecord } from "../../../../../../src/features/store/mirror";
import { VOC_STATES, type VocState } from "../../../../../../src/features/voc/service-event";
import {
  resolveWorkbenchWrite,
  WORKBENCH_ACTIONS,
  type WorkbenchWriteRequest,
} from "../../../../../../src/features/workbench/write-actions";

// A route handler, deliberately, and not a Server Action. README's "known
// exception" section argues that the next@16.2.10 advisories covering Server
// Actions, middleware and rewrites have no reachable entry point in this
// repository *because it uses none of the three*, and defers the Next upgrade
// past the competition deadline on that basis. Introducing a Server Action here
// would falsify that argument the moment it shipped, and re-validating the
// whole cacheComponents cache architecture on a newer Next is not something
// three days accommodates. A route handler does the same job.
export type TicketActionDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  updateRecord: (recordId: string, fields: Record<string, unknown>) => Promise<void>;
  // Injected rather than called directly so a test can assert it fires exactly
  // when a write landed and never otherwise — a revalidation that quietly stops
  // happening leaves a UI that reports success and shows stale data, which is
  // the hardest kind of bug to notice from the outside.
  revalidate: () => void;
  // Who may be named as an owner. Injected like every other boundary here, and read
  // per request rather than cached: a colleague added to the app's scope should be
  // assignable without a redeploy.
  listMembers: () => Promise<readonly Member[]>;
  now: () => number;
}>;

// The wire shape, validated rather than trusted. Everything here arrives from a
// browser: the action, the note, and — importantly — `seenState`, which the
// client claims was the state it rendered. A forged seenState can only ever
// cause the conflict check to pass when it should have failed, which lands the
// caller in the same position as a plain race, so it needs validating as an
// enum but is not a privilege boundary.
function parseRequest(body: unknown): WorkbenchWriteRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;

  const seenState = raw.seenState;
  if (
    typeof seenState !== "string" ||
    !(VOC_STATES as readonly string[]).includes(seenState)
  ) {
    return null;
  }
  const seen = seenState as VocState;

  if (raw.kind === "claim") {
    return { kind: "claim", seenState: seen };
  }

  if (raw.kind === "assign") {
    const assigneeOpenId = raw.assigneeOpenId;
    if (typeof assigneeOpenId !== "string" || assigneeOpenId.length === 0) {
      return null;
    }
    // The name is resolved server-side from the directory, never taken from the
    // request: a browser-supplied name would let the confirmation message and the
    // Bitable write disagree about who the ticket went to.
    return { kind: "assign", seenState: seen, assigneeOpenId, assigneeName: "" };
  }

  if (raw.kind === "transition") {
    const action = raw.action;
    if (
      typeof action !== "string" ||
      !(WORKBENCH_ACTIONS as readonly string[]).includes(action)
    ) {
      return null;
    }
    const note = typeof raw.note === "string" ? raw.note : undefined;
    return {
      kind: "transition",
      action: action as (typeof WORKBENCH_ACTIONS)[number],
      seenState: seen,
      ...(note === undefined ? {} : { note }),
    };
  }

  return null;
}

// One HTTP status per outcome kind, so the client can branch on the status and
// the message is only ever for display. 409 for a stale view is the accurate
// code: the request conflicts with the current state of the resource, and the
// caller's own retry (after refreshing) is the resolution.
const STATUS: Readonly<Record<string, number>> = {
  write: 200,
  noop: 200,
  conflict: 409,
  forbidden: 403,
  rejected: 422,
};

export function createTicketActionRoute(dependencies: TicketActionDependencies) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ recordId: string }> },
  ): Promise<Response> {
    // Every failure below is a JSON body with a `message` the workbench shows
    // verbatim in a toast. An uncaught throw would reach the browser as Next's
    // opaque 500 and the operator would see a spinner that never resolves, so
    // the whole handler is guarded.
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }

      const { recordId } = await context.params;
      if (!recordId) {
        return Response.json(
          { error: "bad_request", message: "缺少工单 ID" },
          { status: 400 },
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        body = null;
      }
      const parsed = parseRequest(body);
      if (!parsed) {
        return Response.json(
          { error: "bad_request", message: "请求格式不正确" },
          { status: 400 },
        );
      }

      // An assignee is checked against the directory before anything is written. The
      // open_id arrives from a browser, and writing an unverified one would put an
      // id the app cannot see into the owner field — which the Bitable rejects, after
      // the local write has already landed.
      let resolved = parsed;
      if (parsed.kind === "assign") {
        const members = await dependencies.listMembers();
        const member = members.find(
          (candidate) => candidate.openId === parsed.assigneeOpenId,
        );
        if (!member) {
          return Response.json(
            { error: "bad_request", message: "找不到该成员，请重新选择" },
            { status: 400 },
          );
        }
        resolved = { ...parsed, assigneeName: member.name };
      }

      const record = await dependencies.getRecord(recordId);
      if (!record) {
        return Response.json(
          { error: "not_found", message: "记录不存在或已被删除" },
          { status: 404 },
        );
      }

      const outcome = resolveWorkbenchWrite(
        record,
        user.openId,
        resolved,
        dependencies.now(),
      );

      if (outcome.kind !== "write") {
        return Response.json(
          {
            error: outcome.kind,
            message: outcome.message,
            ...(outcome.kind === "conflict" ? { actual: outcome.actual } : {}),
          },
          { status: STATUS[outcome.kind] ?? 400 },
        );
      }

      try {
        await dependencies.updateRecord(recordId, outcome.fields);
      } catch {
        // The write is the only step whose failure leaves the operator's intent
        // unrecorded, so it says so plainly instead of reporting a generic
        // error: they need to know their click did nothing and can be repeated.
        return Response.json(
          { error: "write_failed", message: "写入失败，请稍后重试" },
          { status: 502 },
        );
      }

      // The write has landed, so every cached read of this table is now wrong.
      // Both readVocRecordsCached and readWorkbenchCached carry this tag; they
      // are otherwise time-based (cacheLife "minutes"), which was right while
      // the page could only read and becomes a bug the moment it can write —
      // the operator would get a success toast over a row still showing the old
      // state and reasonably conclude the click did nothing.
      //
      // After the write, never before: revalidating first would drop a good
      // cache entry on behalf of a write that then failed.
      dependencies.revalidate();

      return Response.json({
        ok: true,
        message: outcome.message,
        state: outcome.nextState,
      });
    } catch {
      return Response.json(
        { error: "internal", message: "服务暂时不可用，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

// ---------------------------------------------------------------------------

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

export const POST = createTicketActionRoute({
  session: getCurrentSession,
  listMembers: () =>
    listAssignableMembers({
      tenantToken: () => {
        const botEnv = readBotEnv();
        return createTenantTokenProvider(botEnv.appId, botEnv.appSecret)();
      },
    }),
  getRecord: (recordId) => getBitableClient().getRecord(recordId),
  updateRecord: async (recordId, fields) => {
    // Postgres first: reads answer from there, so this is what makes the operator's
    // own change visible. The Bitable push is awaited too — this path has no external
    // deadline, and finishing it here means the row is not left flagged for the cron
    // to retry.
    const pushes: Promise<void>[] = [];
    await writeRecord(
      { bitable: getBitableClient(), defer: (task) => pushes.push(task()) },
      recordId,
      fields,
    );
    await Promise.all(pushes);
  },
  // { expire: 0 } — immediate expiration — rather than a named profile, and the
  // difference is the whole feature working or appearing not to. Read from
  // Next's own source, not assumed:
  //
  // - updateTag is the read-your-own-writes primitive, and it throws outright in
  //   a route handler ("updateTag can only be called from within a Server
  //   Action"). Server Actions are ruled out here for the README reason above,
  //   so it is not available to us.
  // - It achieves immediacy by passing no profile at all
  //   (server/web/spec-extension/revalidate.js: "updateTag uses immediate
  //   expiration (no profile)").
  // - The named profile these reads use, "minutes", is stale: 300
  //   (server/config-shared.js). Passing it here would let the operator's own
  //   refresh be served up to five minutes of stale data — a success toast over
  //   a row still showing the old state, which reads as "the button did nothing".
  //
  // CacheLifeConfig is { expire?: number }, so this is the same immediate
  // expiration updateTag gets, without the Server Action it demands.
  revalidate: () => revalidateTag(VOC_RECORDS_CACHE_TAG, { expire: 0 }),
  now: () => Date.now(),
});
