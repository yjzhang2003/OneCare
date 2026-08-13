import type { BitableClient } from "../bitable/client";
import { upsertRecords } from "./records";

// Keeps the Postgres mirror in step with a Bitable write.
//
// Reads now come from Postgres and writes still go to Bitable, so without this the
// console would show an operator data that predates their own click — strictly worse
// than the slow-but-correct arrangement it replaced. Every write site calls this
// immediately after a successful updateRecord.
//
// It re-reads the record rather than upserting the fields that were just written: a
// write sends a handful of columns, while the mirror row needs all of them, and the
// re-read also picks up anything Bitable computed on its own.
export async function mirrorRecord(
  bitable: Pick<BitableClient, "getRecord">,
  recordId: string,
): Promise<void> {
  const record = await bitable.getRecord(recordId);
  // A record that has vanished between the write and this read is not an error worth
  // failing the caller over — the write already succeeded, and the next full sync
  // will reconcile whatever happened.
  if (!record) return;
  await upsertRecords([record]);
}

// The same thing where latency is not affordable. A Feishu card callback has a
// three-second deadline and the war room path already measured 2725ms of it, so the
// mirror refresh there cannot be awaited — it is handed to the caller's deferral
// primitive (Next's after()) instead, and a failure is logged rather than surfaced
// because nothing is listening by then.
export function mirrorRecordDeferred(
  bitable: Pick<BitableClient, "getRecord">,
  recordId: string,
  defer: (task: () => Promise<void>) => void,
): void {
  defer(async () => {
    try {
      await mirrorRecord(bitable, recordId);
    } catch (error) {
      console.error(
        "Mirror refresh failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}
