import { revalidateTag } from "next/cache";

import { getCurrentSession } from "../../../../../../src/features/auth/current-session";
import type { AuthUser } from "../../../../../../src/features/auth/types";
import type { VocRecord } from "../../../../../../src/features/bitable/field-map";
import { readRecordById } from "../../../../../../src/features/store/records";
import { VOC_RECORDS_CACHE_TAG } from "../../../../../../src/features/voc/cache-tags";
import { analyzeEligibility } from "../../../../../../src/features/workbench/analyze-eligibility";
import { analyzeOneRecord } from "../../../analyze/route";

// A route handler, not a Server Action, for the reason the sibling action route
// states at length: README's known-exception argues the next@16.2.10 Server Action
// advisories have no reachable entry point here *because this repository uses none*,
// and introducing one would falsify that the moment it shipped.

// The same ceiling the Cron shard runs under, and for the same measured reason: one
// record through the live aily skill takes roughly 23 seconds. The default would not
// have been enough for a slow one, and the operator is watching a spinner while it
// runs.
export const maxDuration = 300;

export type TicketAnalyzeDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  // Runs the tagging pipeline over the one record and answers with the shard's own
  // response body. Injected so this handler's refusals and messages can be tested
  // without an aily call, a Bitable or a database.
  analyze: (record: VocRecord, state: VocRecord["state"]) => Promise<Response>;
  revalidate: () => void;
}>;

// The shard's body, as far as this route reads it. Deliberately partial: the shard
// reports seven counters and this route only branches on the three that describe what
// happened to a single record.
function readCounts(body: unknown): Readonly<{
  tagged: number;
  failed: number;
  writeErrors: number;
}> {
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const n = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    tagged: n(raw.tagged),
    failed: n(raw.failed),
    writeErrors: n(raw.writeErrors),
  };
}

export function createTicketAnalyzeRoute(
  dependencies: TicketAnalyzeDependencies,
) {
  return async function POST(
    _request: Request,
    context: { params: Promise<{ recordId: string }> },
  ): Promise<Response> {
    // Every failure below carries a `message` the workbench shows verbatim. An
    // uncaught throw would arrive as Next's opaque 500 behind a spinner that never
    // resolves — and this button's spinner is already a 23-second one.
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

      const record = await dependencies.getRecord(recordId);
      if (!record) {
        return Response.json(
          { error: "not_found", message: "记录不存在或已被删除" },
          { status: 404 },
        );
      }

      // Checked here and not only in the UI: the button is one caller, a POST is
      // another. A record that has already been tagged, or that has burned its retry
      // attempts, is refused with the reason the state machine gives.
      const eligibility = analyzeEligibility(record);
      if (eligibility.kind === "refused") {
        return Response.json(
          { error: "rejected", message: eligibility.reason },
          { status: 422 },
        );
      }

      const response = await dependencies.analyze(record, eligibility.state);
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        // The shard answers 503 with a source when a read it depends on failed —
        // nothing was tagged and nothing was written, so this is safe to retry.
        return Response.json(
          {
            error: "unavailable",
            message: "打标服务暂时不可用，请稍后重试",
          },
          { status: 503 },
        );
      }

      const counts = readCounts(body);

      if (counts.writeErrors > 0) {
        return Response.json(
          { error: "write_failed", message: "分析完成但写入失败，请稍后重试" },
          { status: 502 },
        );
      }

      // The write landed, so every cached read of this table is now wrong. Same
      // primitive and same reasoning as the sibling action route: { expire: 0 } is
      // the immediate expiration updateTag would give, without the Server Action it
      // demands and which this repository does not have.
      dependencies.revalidate();

      if (counts.tagged > 0) {
        return Response.json({
          ok: true,
          tagged: true,
          message: "AI 分析完成，打标结果已回写",
        });
      }

      // A tagged: 0 / failed: 1 shard is not a broken request — the pipeline ran and
      // recorded why it could not produce a result, which is now on the record as
      // 失败原因. Reported as a success with tagged: false so the workbench can show
      // it as a warning rather than as a green toast over a failure.
      return Response.json({
        ok: true,
        tagged: false,
        message:
          counts.failed > 0
            ? "AI 分析失败，失败原因已记录在工单上"
            : "打标流水线没有返回结果，请稍后重试",
      });
    } catch {
      return Response.json(
        { error: "internal", message: "服务暂时不可用，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

export const POST = createTicketAnalyzeRoute({
  session: getCurrentSession,
  // From the mirror, not the Bitable: it is the primary store now, and reading one
  // row by its id is a single indexed query.
  getRecord: readRecordById,
  // The state comes from analyzeEligibility, not from the record — a 分析失败 record
  // is handed to the pipeline as 待分析, which is what its 重试 transition resolved to
  // and the only state the pipeline can start from. This mirrors, in memory only,
  // what buildPendingShard does for the Cron path: 流程状态 never visibly passes
  // through 待分析 in the Base, because the single write reflects wherever tagging
  // actually landed the record.
  analyze: (record, state) => analyzeOneRecord({ ...record, state }),
  revalidate: () => revalidateTag(VOC_RECORDS_CACHE_TAG, { expire: 0 }),
});
