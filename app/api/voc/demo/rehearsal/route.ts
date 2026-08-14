import { revalidateTag } from "next/cache";

import { getCurrentSession } from "../../../../../src/features/auth/current-session";
import type { AuthUser } from "../../../../../src/features/auth/types";
import type { VocRecord } from "../../../../../src/features/bitable/field-map";
import { VOC_FIELD_NAMES } from "../../../../../src/features/bitable/field-map";
import {
  assignSlots,
  fieldsOf,
  resetTo,
  type RehearsalFields,
  type RehearsalSlot,
} from "../../../../../src/features/demo/rehearsal";
import {
  clearSnapshots,
  readSnapshots,
  writeSnapshots,
} from "../../../../../src/features/store/rehearsal-store";
import { VOC_RECORDS_CACHE_TAG } from "../../../../../src/features/voc/cache-tags";

// 演示彩排接口：`prepare` 把录屏要用的记录摆回起始状态，`restore` 按快照还原。
//
//   POST /api/voc/demo/rehearsal            → 看现在会选中哪几条，什么都不写
//   POST /api/voc/demo/rehearsal?do=prepare → 存快照并布置
//   POST /api/voc/demo/rehearsal?do=restore → 按快照还原，清空快照
//
// Writes go to Postgres and the Bitable both, for the same reason the seeding runner does:
// the mirror is what the console reads, and the Base is what the Feishu cards read and
// what the daily sync pulls from. Staging only one of them would put the web page and the
// card in different states — during a recording, which is the worst possible time.
//
// Session-gated, and it can only ever touch records it selected itself under the rules in
// demo/rehearsal.ts: rows already in the shot's own state, never the 19 carrying real aily
// output, never dragging a closed ticket back open.
export type RehearsalDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  // Candidates to stage from. Deliberately a plain read of the states the shots need
  // rather than the whole table.
  candidates: () => Promise<readonly VocRecord[]>;
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  applyFields: (recordId: string, fields: RehearsalFields) => Promise<void>;
  readSnapshots: typeof readSnapshots;
  writeSnapshots: typeof writeSnapshots;
  clearSnapshots: typeof clearSnapshots;
  revalidate: () => void;
}>;

type Action = "plan" | "prepare" | "restore";

function parseAction(request: Request): Action | null {
  const value = new URL(request.url).searchParams.get("do") ?? "plan";
  return value === "plan" || value === "prepare" || value === "restore"
    ? value
    : null;
}

export function createRehearsalRoute(dependencies: RehearsalDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }

      const action = parseAction(request);
      if (action === null) {
        return Response.json(
          { error: "bad_request", message: "do 只支持 plan / prepare / restore" },
          { status: 400 },
        );
      }

      if (action === "restore") return restore(dependencies);

      const slots = assignSlots(await dependencies.candidates());
      const missing = ["analyze", "flow", "retry"].filter(
        (role) => !slots.some((slot) => slot.key === role),
      );

      if (action === "plan") {
        return Response.json({
          ok: true,
          action,
          slots: slots.map(described),
          missing,
          message:
            missing.length === 0
              ? "三个镜头都有素材，加 ?do=prepare 布置"
              : `缺少素材：${missing.join(" / ")}`,
        });
      }

      return prepare(dependencies, slots, missing, user.openId);
    } catch {
      return Response.json(
        { error: "internal", message: "彩排接口暂时不可用，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

function described(slot: RehearsalSlot) {
  return {
    shot: slot.shot,
    role: slot.key,
    label: slot.label,
    recordNumber: slot.recordNumber,
    state: slot.haveState,
    // The exact page to open when the camera rolls.
    href: `/workbench/tickets/${encodeURIComponent(slot.recordNumber)}?queue=all`,
  };
}

async function prepare(
  dependencies: RehearsalDependencies,
  slots: readonly RehearsalSlot[],
  missing: readonly string[],
  openId: string,
): Promise<Response> {
  const snapshots: {
    recordId: string;
    recordNumber: string;
    role: RehearsalSlot["key"];
    before: RehearsalFields;
  }[] = [];
  const staged: string[] = [];

  for (const slot of slots) {
    const record = await dependencies.getRecord(slot.recordId);
    if (!record) continue;
    const before = fieldsOf(record);
    // The snapshot is written for every slot, including the ones already in position:
    // restore has to be able to put back what it found, not what it changed.
    snapshots.push({
      recordId: slot.recordId,
      recordNumber: slot.recordNumber,
      role: slot.key,
      before,
    });

    const target = resetTo(slot.key, before);
    if (target === null) continue;
    await dependencies.applyFields(slot.recordId, target);
    staged.push(slot.recordNumber);
  }

  await dependencies.writeSnapshots(snapshots, openId);
  if (staged.length > 0) dependencies.revalidate();

  return Response.json({
    ok: true,
    action: "prepare",
    slots: slots.map(described),
    staged,
    missing,
    message:
      staged.length === 0
        ? "都已经在起始状态，没有改动；快照已记录"
        : `已布置 ${staged.length} 条，拍完调用 ?do=restore 还原`,
  });
}

async function restore(
  dependencies: RehearsalDependencies,
): Promise<Response> {
  const snapshots = await dependencies.readSnapshots();
  if (snapshots.length === 0) {
    return Response.json({
      ok: true,
      action: "restore",
      restored: [],
      message: "没有可还原的快照——先调用 ?do=prepare",
    });
  }

  const restored: string[] = [];
  for (const snapshot of snapshots) {
    await dependencies.applyFields(snapshot.recordId, snapshot.before);
    restored.push(snapshot.recordNumber);
  }
  await dependencies.clearSnapshots();
  dependencies.revalidate();

  return Response.json({
    ok: true,
    action: "restore",
    restored,
    // Said every time, because it is the one thing a restore cannot undo.
    message: `已还原 ${restored.length} 条。注意：录制过程中真实创建的飞书群不会被删除，只是记录不再指向它。`,
  });
}

// ---------------------------------------------------------------------------

import {
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../../src/features/bitable/client";
import { writeRecord } from "../../../../../src/features/store/mirror";
import { getSql, toVocRecord } from "../../../../../src/features/store/records";
import { readBitableEnv, readBotEnv } from "../../../../../src/lib/env";

let tokenProvider: TenantTokenProvider | null = null;
function getTokenProvider(): TenantTokenProvider {
  if (!tokenProvider) {
    const bot = readBotEnv();
    tokenProvider = createTenantTokenProvider(bot.appId, bot.appSecret);
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

export const POST = createRehearsalRoute({
  session: getCurrentSession,
  candidates: async () => {
    // Only the three states the shots need, and only rows with no AI summary — the same
    // guard eligibleFor applies, pushed into SQL so a full table read is never necessary.
    const rows = (await getSql().query(
      `SELECT * FROM voc_records
       WHERE state IN ('待分析', '待跟进', '分析失败') AND summary = ''
       ORDER BY record_number
       LIMIT 400`,
    )) as Record<string, unknown>[];
    return rows.map(toVocRecord);
  },
  getRecord: async (recordId) => {
    const rows = (await getSql().query(
      `SELECT * FROM voc_records WHERE record_id = $1 LIMIT 1`,
      [recordId],
    )) as Record<string, unknown>[];
    return rows[0] ? toVocRecord(rows[0]) : null;
  },
  applyFields: async (recordId, fields) => {
    // Through the same DB-first write path every operator action uses, so the mirror and
    // the Base cannot disagree about what state the demo is in.
    const pushes: Promise<void>[] = [];
    await writeRecord(
      { bitable: getBitableClient(), defer: (task) => pushes.push(task()) },
      recordId,
      {
        [VOC_FIELD_NAMES.state]: fields.state,
        [VOC_FIELD_NAMES.owner]: fields.ownerOpenIds.map((id) => ({ id })),
        [VOC_FIELD_NAMES.ticketOpenedAt]: fields.ticketOpenedAt
          ? Date.parse(fields.ticketOpenedAt)
          : null,
        [VOC_FIELD_NAMES.closedAt]: fields.closedAt
          ? Date.parse(fields.closedAt)
          : null,
        [VOC_FIELD_NAMES.warRoomChatId]: fields.warRoomChatId,
        [VOC_FIELD_NAMES.retryCount]: fields.retryCount,
      },
    );
    await Promise.all(pushes);
  },
  readSnapshots,
  writeSnapshots,
  clearSnapshots,
  revalidate: () => revalidateTag(VOC_RECORDS_CACHE_TAG, { expire: 0 }),
});
