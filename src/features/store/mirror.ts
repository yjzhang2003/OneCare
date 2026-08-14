import type { BitableClient } from "../bitable/client";
import type { BitableFields } from "../bitable/field-map";
import {
  clearPendingPush,
  getSql,
  markPendingPush,
  toVocRecord,
  upsertRecords,
} from "./records";
import { toBitableFields, toLocalWrite } from "./write";

// Where a write lands, in order.
//
// Postgres first, the Bitable after. Reads all answer from Postgres, so writing there
// first is what makes an operator's own change visible immediately — the previous
// order (Bitable first, mirror after) put a cross-border round trip in front of every
// click and left the console showing pre-click data until it finished.
//
// The Bitable is still where the operations team lives: they edit owners with its
// person picker and read the table directly. So it is not abandoned, it is updated
// afterwards, and the row stays flagged until that lands.

export type WriteDependencies = Readonly<{
  bitable: Pick<BitableClient, "getRecord" | "updateRecord">;
  // How to run the Bitable push. The card callback answers to Feishu's 3s deadline
  // and hands this to Next's after(); everything else awaits it.
  defer: (task: () => Promise<void>) => void;
}>;

// Applies what the mirror can hold, and flags the row as owing the Bitable a write.
// A write touching only unmirrored columns still flags the row — the flag is about the
// push being outstanding, not about whether anything changed locally.
export async function applyLocally(
  recordId: string,
  fields: BitableFields,
): Promise<void> {
  const { assignments, params } = toLocalWrite(fields);
  if (assignments.length > 0) {
    await getSql().query(
      `UPDATE voc_records
       SET ${assignments.join(", ")}, pending_push = TRUE
       WHERE record_id = $${params.length + 1}`,
      [...params, recordId],
    );
    return;
  }
  await markPendingPush(recordId);
}

// Re-reads the record from the Bitable and replaces the mirror row with it, then
// clears the flag. This is the reconciliation step, and it is why applyLocally is
// allowed to be an incomplete projection: a people write carries ids and no names,
// and owner_names is what the 未分配 queue and the profile views read.
export async function reconcile(
  bitable: Pick<BitableClient, "getRecord">,
  recordId: string,
): Promise<void> {
  const record = await bitable.getRecord(recordId);
  // A record that vanished between the write and this read is not worth failing over:
  // the write already happened, and the periodic sync reconciles whatever is left.
  if (record) await upsertRecords([record]);
  await clearPendingPush(recordId);
}

// The whole write, for every call site that used to call bitable.updateRecord
// directly. Returns once the local write has landed; the Bitable push and the
// reconciliation run through `defer`.
export async function writeRecord(
  dependencies: WriteDependencies,
  recordId: string,
  fields: BitableFields,
): Promise<void> {
  await applyLocally(recordId, fields);

  dependencies.defer(async () => {
    try {
      await dependencies.bitable.updateRecord(recordId, fields);
      await reconcile(dependencies.bitable, recordId);
    } catch (error) {
      // The row keeps pending_push, so the periodic sync will not overwrite it with
      // the older Bitable values, and the push is retried on the next cron tick.
      // Logged rather than thrown because by the time this runs the caller has
      // already answered.
      console.error(
        `Bitable push failed for ${recordId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}

// Re-pushes rows whose Bitable write never landed. Run by the cron before it pulls,
// so a failed push is retried rather than sitting flagged forever — and so the pull
// that follows has fewer rows it must skip.
export async function pushPending(
  bitable: Pick<BitableClient, "getRecord" | "updateRecord">,
): Promise<Readonly<{ attempted: number; pushed: number }>> {
  const rows = (await getSql().query(
    `SELECT * FROM voc_records WHERE pending_push`,
  )) as Record<string, unknown>[];

  let pushed = 0;
  for (const row of rows) {
    const record = toVocRecord(row);
    try {
      await bitable.updateRecord(record.recordId, toBitableFields(record));
      await reconcile(bitable, record.recordId);
      pushed += 1;
    } catch (error) {
      console.error(
        `Retrying Bitable push failed for ${record.recordId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return { attempted: rows.length, pushed };
}
