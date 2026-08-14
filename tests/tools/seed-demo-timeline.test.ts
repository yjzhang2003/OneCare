// Applies src/features/demo/timeline.ts to the real dataset: rewrites 反馈时间 for all
// 3628 rows and the processing state for most of them, in the Bitable first and then in
// the Postgres mirror.
//
// Written as a vitest file because that is this repository's only runner with
// TypeScript, .env.local and the real clients wired up — the same reason tests/runtime
// and tests/equiv are. It asserts its own outcome, which is what a data migration should
// do anyway. Excluded from `npm test`; run it deliberately:
//
//   SEED_DEMO=apply node --env-file=.env.local node_modules/vitest/vitest.mjs \
//     run --dir tests/tools --environment node --reporter=verbose
//
// Without SEED_DEMO=apply it reports what it would change and writes nothing.
//
// Order matters. The Bitable is written first because it is what the daily sync pulls
// from: if this run dies halfway, the Base holds the newer values and the next sync
// converges toward them, rather than the mirror holding values the Base will overwrite
// tonight. And because seeding is deterministic in the record number, re-running after a
// partial failure reproduces exactly the same dataset instead of reshuffling it.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import {
  createBitableClient,
  createTenantTokenProvider,
} from "../../src/features/bitable/client";
import { VOC_FIELD_NAMES } from "../../src/features/bitable/field-map";
import {
  DEMO_TAG_SOURCE,
  seedRecord,
  shiftedDayStarts,
  summarize,
  type Assignee,
  type SeedOutcome,
} from "../../src/features/demo/timeline";
import { listAssignableMembers } from "../../src/features/directory/members";
import type { VocState } from "../../src/features/voc/service-event";
import type {
  VocDimension,
  VocPolarity,
  VocSeverity,
} from "../../src/features/voc/triage";
import { getSql } from "../../src/features/store/records";
import { readBitableEnv, readBotEnv } from "../../src/lib/env";

const APPLY = process.env.SEED_DEMO === "apply";
const SHANGHAI_OFFSET = 8 * 3_600_000;

// The row's own calendar day in +08:00, which is the day a person would say the feedback
// arrived on. Grouping by the UTC date instead would split each day at 08:00 Beijing.
function shanghaiDay(iso: string): string {
  return new Date(Date.parse(iso) + SHANGHAI_OFFSET).toISOString().slice(0, 10);
}

type Row = Readonly<{
  record_id: string;
  record_number: string;
  feedback_at: Date | null;
  state: string;
  polarity: string | null;
  dimensions: string[];
  severity: string | null;
  owner_open_ids: string[];
  owner_names: string[];
}>;

it(
  "reseeds the demo timeline in both stores",
  async () => {
    const sql = getSql();
    const rows = (await sql.query(
      `SELECT record_id, record_number, feedback_at, state, polarity, dimensions,
              severity, owner_open_ids, owner_names
       FROM voc_records ORDER BY record_id`,
    )) as Row[];
    expect(rows.length).toBeGreaterThan(3000);

    // Owners come from the live directory. Seeding without it would leave every ticket
    // unassigned, which would make the 未分配 queue the whole table — the same kind of
    // uniform artefact this run exists to remove.
    const assignees: readonly Assignee[] = await listAssignableMembers({
      tenantToken: () => {
        const bot = readBotEnv();
        return createTenantTokenProvider(bot.appId, bot.appSecret)();
      },
    });
    expect(assignees.length).toBeGreaterThan(0);
    console.log(`assignees: ${assignees.map((a) => a.name).join(", ")}`);

    const inputs = rows.map((row) => ({
      recordId: row.record_id,
      recordNumber: row.record_number,
      feedbackAt: row.feedback_at ? row.feedback_at.toISOString() : null,
      // Handed through so a row the real pipeline tagged keeps what it decided. The
      // marker is the polarity: nothing else in this codebase writes that column, and it
      // is set on exactly the 19 rows aily tagged.
      existing: {
        state: row.state as VocState,
        polarity: (row.polarity as VocPolarity | null) ?? null,
        dimensions: (row.dimensions ?? []) as VocDimension[],
        severity: (row.severity as VocSeverity | null) ?? null,
        ownerOpenIds: row.owner_open_ids ?? [],
        ownerNames: row.owner_names ?? [],
      },
    }));
    const days = [
      ...new Set(
        inputs
          .map((row) => (row.feedbackAt ? shanghaiDay(row.feedbackAt) : ""))
          .filter((day) => day.length > 0),
      ),
    ];
    console.log(`imported days: ${days.length} (${[...days].sort()[0]} … ${[...days].sort().at(-1)})`);

    const now = Date.now();
    const dayStarts = shiftedDayStarts(days, now);
    const seeded = inputs.map((row) =>
      seedRecord(
        {
          ...row,
          feedbackAt: row.feedbackAt ? shanghaiDay(row.feedbackAt) : null,
        },
        dayStarts,
        { now, assignees },
      ),
    );

    const preserved = seeded.filter((row) => !row.synthesized);
    console.log(`preserved (real pipeline output): ${preserved.length}`);

    const shape = summarize(seeded, now);
    console.log("states:", JSON.stringify(shape.states));
    console.log("polarities:", JSON.stringify(shape.polarities));
    console.log(
      `tickets ${shape.withTicket} (closed ${shape.closed}, open ${shape.withTicket - shape.closed}, unassigned ${shape.unassignedOpen})`,
    );
    console.log(
      `overdue ${shape.overdue}, dwell ${shape.dwellRange[0]}–${shape.dwellRange[1]}h, distinct times of day ${shape.distinctTimesOfDay}`,
    );

    // The invariants that make this dataset worth shipping, asserted against the real
    // table rather than the unit test's synthetic corpus.
    expect(shape.distinctTimesOfDay).toBeGreaterThan(1500);
    expect(shape.overdue).toBeGreaterThan(0);
    expect(shape.overdue / seeded.length).toBeLessThan(0.1);
    expect(shape.dwellRange[1]).toBeLessThan(11 * 24);
    expect(shape.unassignedOpen).toBeGreaterThan(0);
    expect(shape.states["待分析"] ?? 0).toBeGreaterThan(200);

    if (!APPLY) {
      console.log("\nSEED_DEMO is not \"apply\" — nothing was written.");
      return;
    }

    // Backup before the first write. The original 反馈时间 dates are the enterprise's
    // real ones and nothing else in the repository records them; docs/data is gitignored,
    // so this stays out of the public repository.
    const backupDir = resolve(process.cwd(), "docs/data");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = resolve(backupDir, `voc-before-seed-${now}.json`);
    const before = (await sql.query(
      `SELECT record_id, record_number, feedback_at, state, polarity, dimensions,
              severity, owner_open_ids, owner_names, ticket_opened_at, closed_at,
              summary, replies
       FROM voc_records ORDER BY record_id`,
    )) as Record<string, unknown>[];
    writeFileSync(backupPath, JSON.stringify(before, null, 1), "utf8");
    console.log(`\nbacked up ${before.length} rows to ${backupPath}`);

    // 1. The Bitable, in batches. Dates go as epoch milliseconds — a DateTime field
    //    reads back as epoch ms and writing an ISO string is the bug this project has
    //    already been bitten by once.
    const bitable = createBitableClient(readBitableEnv(), (() => {
      const bot = readBotEnv();
      return createTenantTokenProvider(bot.appId, bot.appSecret);
    })());

    const ms = (iso: string | null) => (iso === null ? null : Date.parse(iso));
    // An empty select value is never sent. Bitable auto-creates whatever option it is
    // handed and deleting the row afterwards does not remove it, so writing "" would
    // leave a blank option on 情绪极性/严重度/问题维度 permanently. Nothing needs
    // clearing anyway: a row with no tags to write is a row that had none, because any
    // row that already had a polarity is preserved rather than synthesized.
    const updates = seeded.map((row) => ({
      recordId: row.recordId,
      fields: {
        // Always: the three timestamps and the state the timeline implies.
        [VOC_FIELD_NAMES.feedbackAt]: ms(row.feedbackAt),
        [VOC_FIELD_NAMES.ticketOpenedAt]: ms(row.ticketOpenedAt),
        [VOC_FIELD_NAMES.closedAt]: ms(row.closedAt),
        // Only for rows this run made up. A preserved row keeps its real tags, its AI
        // text and its real 打标来源 — including its state, which the pipeline set.
        ...(row.synthesized
          ? {
              [VOC_FIELD_NAMES.state]: row.state,
              [VOC_FIELD_NAMES.tagSource]: row.tagSource,
              ...(row.polarity ? { [VOC_FIELD_NAMES.polarity]: row.polarity } : {}),
              ...(row.severity ? { [VOC_FIELD_NAMES.severity]: row.severity } : {}),
              ...(row.dimensions.length > 0
                ? { [VOC_FIELD_NAMES.dimensions]: [...row.dimensions] }
                : {}),
              ...(row.ownerOpenIds.length > 0
                ? {
                    [VOC_FIELD_NAMES.owner]: row.ownerOpenIds.map((id) => ({ id })),
                  }
                : {}),
            }
          : {}),
      },
    }));
    const startedBitable = Date.now();
    await bitable.batchUpdateRecords(updates);
    console.log(`bitable: ${updates.length} rows in ${Date.now() - startedBitable}ms`);

    // 2. The mirror, in batches of 200 like the sync's own upsert.
    const startedPg = Date.now();
    for (let from = 0; from < seeded.length; from += 200) {
      const chunk = seeded.slice(from, from + 200);
      const values: unknown[] = [];
      const tuples = chunk.map((row) => {
        const at = values.length;
        values.push(
          row.recordId,
          row.feedbackAt,
          row.state,
          row.polarity,
          row.dimensions,
          row.severity,
          row.ownerOpenIds,
          row.ownerNames,
          row.ticketOpenedAt,
          row.closedAt,
        );
        const p = (offset: number) => `$${at + offset}`;
        return `(${p(1)}, ${p(2)}::timestamptz, ${p(3)}, ${p(4)}, ${p(5)}::text[], ${p(6)}, ${p(7)}::text[], ${p(8)}::text[], ${p(9)}::timestamptz, ${p(10)}::timestamptz)`;
      });

      await sql.query(
        `UPDATE voc_records AS v SET
           feedback_at = s.feedback_at,
           state = s.state,
           polarity = s.polarity,
           dimensions = s.dimensions,
           severity = s.severity,
           owner_open_ids = s.owner_open_ids,
           owner_names = s.owner_names,
           ticket_opened_at = s.ticket_opened_at,
           closed_at = s.closed_at,
           synced_at = now()
         FROM (VALUES ${tuples.join(", ")}) AS s(
           record_id, feedback_at, state, polarity, dimensions, severity,
           owner_open_ids, owner_names, ticket_opened_at, closed_at
         )
         WHERE v.record_id = s.record_id`,
        values,
      );
    }
    console.log(`postgres: ${seeded.length} rows in ${Date.now() - startedPg}ms`);

    // 3. Verify from the mirror, the way the console reads it.
    const check = (await sql.query(
      `SELECT COUNT(DISTINCT feedback_at::time)::int AS times,
              MIN(feedback_at) AS earliest, MAX(feedback_at) AS latest,
              COUNT(*) FILTER (WHERE state = '待分析')::int AS pending,
              COUNT(*) FILTER (WHERE ticket_opened_at IS NOT NULL)::int AS opened,
              COUNT(*) FILTER (WHERE closed_at IS NOT NULL)::int AS closed,
              COUNT(*) FILTER (WHERE feedback_at > now())::int AS in_future,
              COUNT(*) FILTER (WHERE ticket_opened_at < feedback_at)::int AS opened_before_feedback,
              COUNT(*) FILTER (WHERE closed_at < ticket_opened_at)::int AS closed_before_opened
       FROM voc_records`,
    )) as Record<string, number | string>[];
    console.log("after write:", JSON.stringify(check[0]));

    const row = check[0]!;
    expect(Number(row.times)).toBeGreaterThan(1500);
    expect(Number(row.in_future)).toBe(0);
    expect(Number(row.opened_before_feedback)).toBe(0);
    expect(Number(row.closed_before_opened)).toBe(0);
    expect(Number(row.opened)).toBe(shape.withTicket);
    expect(Number(row.closed)).toBe(shape.closed);

    const synthesized: readonly SeedOutcome[] = seeded.filter((r) => r.synthesized);
    expect(synthesized.every((r) => r.tagSource === DEMO_TAG_SOURCE)).toBe(true);
    expect(preserved.every((r) => r.tagSource === "")).toBe(true);
  },
  1_800_000,
);
