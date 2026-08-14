// Holds readProfiles' SQL to profiles.ts — the reference implementation — over the
// real table. The SQL filters and groups in Postgres; the reference filters in
// JavaScript with matchesQuery and groups with userProfiles/deviceProfiles. Any
// disagreement in membership, order, counts or the distinct arrays fails here.
//
// Excluded from `npm test` because it needs a database. Run it against the real one:
//
//   node --env-file=.env.local node_modules/vitest/vitest.mjs \
//     run --dir tests/equiv --environment node
//
// Every filter value it uses is discovered from the data rather than written down, so
// the test cannot rot when the corpus changes — and no record content ends up in this
// public repository.
import { expect, it } from "vitest";

import { getSql } from "../../src/features/store/records";
import { readAllRecords } from "../../src/features/store/records";
import {
  readFilterOptions,
  readProfiles,
} from "../../src/features/store/workbench-query";
import { toWorkbenchTicket } from "../../src/features/workbench/data";
import {
  deviceProfiles,
  repeatOnly,
  userProfiles,
} from "../../src/features/workbench/profiles";
import {
  matchesQuery,
  PAGE_SIZE,
  parseWorkbenchQuery,
} from "../../src/features/workbench/query";

type Params = Record<string, string | string[] | undefined>;

// An identity that exists and appears in none of the four columns a ticket search
// covers, so a case built from it passes only if the profile search really does look
// at the identity column.
async function anIdentityOnlySearchableAsItself(
  column: "user_ref" | "device_ref",
): Promise<string | null> {
  const rows = (await getSql().query(
    `SELECT ${column} AS id FROM voc_records
     WHERE ${column} <> ''
       AND position(${column} in source_ticket_no) = 0
       AND position(${column} in record_number) = 0
       AND position(${column} in content) = 0
       AND position(${column} in model) = 0
     LIMIT 1`,
  )) as { id: string }[];
  return rows[0]?.id ?? null;
}

it(
  "agrees with the reference profile aggregation",
  async () => {
    const [all, options, userId, deviceId] = await Promise.all([
      readAllRecords().then((records) => records.map(toWorkbenchTicket)),
      readFilterOptions(),
      anIdentityOnlySearchableAsItself("user_ref"),
      anIdentityOnlySearchableAsItself("device_ref"),
    ]);

    // One case per filter field, taking a value the data actually contains, plus the
    // combinations and pages where the two implementations could plausibly diverge.
    const value = (field: keyof typeof options) => options[field][0];
    const cases: Params[] = [
      {},
      { page: "2" },
      { page: "999" },
      { channel: value("channel") },
      { category: value("category") },
      { polarity: value("polarity") },
      { dimension: value("dimension") },
      { severity: value("severity") },
      { state: value("state") },
      { owner: value("owner") },
      { unit: value("unit") },
      { level1: value("level1") },
      { channel: value("channel"), category: value("category") },
      { state: value("state"), page: "2" },
      { search: "噪音" },
      { search: "没有这个词的字符串" },
      ...(userId ? [{ search: userId }] : []),
      ...(deviceId ? [{ search: deviceId }] : []),
    ];

    expect(userId, "no identity is searchable only as itself").not.toBeNull();

    const failures: string[] = [];

    for (const kind of ["user", "device"] as const) {
      const identity = (ticket: (typeof all)[number]) =>
        kind === "user" ? ticket.userRef : ticket.deviceRef;

      for (const raw of cases) {
        const query = parseWorkbenchQuery({ ...raw, section: `${kind}s` });
        const sql = await readProfiles(kind, query);

        const admitted = all.filter((t) => matchesQuery(t, query, identity));
        const grouped =
          kind === "user" ? userProfiles(admitted) : deviceProfiles(admitted);
        const repeats = repeatOnly(grouped);
        const pageCount = Math.max(1, Math.ceil(repeats.length / PAGE_SIZE));
        const page = Math.min(query.page, pageCount);
        const expected = repeats.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

        const label = `${kind} ${JSON.stringify(raw)}`;
        const problems: string[] = [];
        if (sql.matched !== repeats.length) {
          problems.push(`matched ${sql.matched} vs ${repeats.length}`);
        }
        if (sql.total !== grouped.length) {
          problems.push(`total ${sql.total} vs ${grouped.length}`);
        }
        if (sql.page !== page) problems.push(`page ${sql.page} vs ${page}`);
        const got = sql.profiles.map((p) => p.id).join(",");
        const want = expected.map((p) => p.id).join(",");
        if (got !== want) {
          problems.push(
            `ids differ (${sql.profiles.length} rows vs ${expected.length})`,
          );
        } else {
          for (const [index, row] of sql.profiles.entries()) {
            if (JSON.stringify(row) !== JSON.stringify(expected[index])) {
              problems.push(`row ${index} differs from the reference`);
              break;
            }
          }
        }

        if (problems.length > 0) {
          failures.push(`${label}: ${problems.join("; ")}`);
        } else {
          console.log(
            `ok   ${label} — ${sql.matched} repeat / ${sql.total} total, page ${sql.page}/${sql.pageCount}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  },
  900_000,
);
