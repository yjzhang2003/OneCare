import { revalidateTag } from "next/cache";

import { getCurrentSession } from "../../../../src/features/auth/current-session";
import { isGuest, refuseGuestWrite } from "../../../../src/features/auth/guest";
import type { AuthUser } from "../../../../src/features/auth/types";
import {
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../src/features/bitable/client";
import type { BitableFields, VocRecord } from "../../../../src/features/bitable/field-map";
import { upsertRecords } from "../../../../src/features/store/records";
import { readFilterOptions } from "../../../../src/features/store/workbench-query";
import { VOC_RECORDS_CACHE_TAG } from "../../../../src/features/voc/cache-tags";
import {
  MANUAL_SOURCE_DETAIL,
  newTicketFields,
  parseNewTicket,
  type NewTicketDraft,
} from "../../../../src/features/voc/new-ticket";
import { readBitableEnv, readBotEnv } from "../../../../src/lib/env";

// 手动新建工单. One POST, and the row it makes is an ordinary 待分析 ticket — everything
// downstream (打标, triage, 建单, 路由, 工单卡, 消息) is the production chain, unchanged.
export type NewTicketDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  // The channel and category values the data already contains. Read rather than trusted:
  // both columns are single-selects, and writing an unknown value would create a new
  // option in the enterprise's own table.
  options: () => Promise<Readonly<{ channels: readonly string[]; categories: readonly string[] }>>;
  create: (fields: BitableFields) => Promise<string>;
  // The mirror is what the console reads, so a row that exists only in the Bitable would
  // not appear until the next sync — which is not a demo, it is a wait.
  mirror: (record: VocRecord) => Promise<void>;
  revalidate: () => void;
  recordNumber: () => string;
  now: () => number;
}>;

// The mirror row for a ticket that has only just been typed: everything the tagging
// pipeline has not produced yet is empty, exactly as it reads back from the Base.
export function toMirrorRecord(
  recordId: string,
  recordNumber: string,
  draft: NewTicketDraft,
  now: number,
): VocRecord {
  return {
    recordId,
    recordNumber,
    channel: draft.channel,
    category: draft.category,
    model: draft.model,
    content: draft.content,
    rating: null,
    feedbackAt: new Date(now).toISOString(),
    state: "待分析",
    polarity: null,
    dimensions: [],
    summary: "",
    replies: [],
    severity: null,
    ownerOpenIds: [],
    ownerNames: [],
    retryCount: 0,
    ticketOpenedAt: null,
    closedAt: null,
    warRoomChatId: "",
    engineerOpenIds: [],
    engineerNames: [],
    dispatchedAt: null,
    userRef: draft.userRef,
    deviceRef: draft.deviceRef,
    sourceTicketNo: "",
    sourceUrl: "",
    sourceDetail: MANUAL_SOURCE_DETAIL,
    businessUnit: "",
    categoryLevel1: "",
  };
}

export function createNewTicketRoute(dependencies: NewTicketDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }
      if (isGuest(user)) return refuseGuestWrite();

      const options = await dependencies.options();
      const parsed = parseNewTicket(await request.json().catch(() => null), options);
      if ("problems" in parsed) {
        return Response.json(
          {
            error: "rejected",
            message: parsed.problems.join("；"),
            problems: parsed.problems,
          },
          { status: 422 },
        );
      }

      const recordNumber = dependencies.recordNumber();
      const now = dependencies.now();

      let recordId: string;
      try {
        recordId = await dependencies.create(
          newTicketFields(parsed.draft, recordNumber, now),
        );
      } catch {
        return Response.json(
          { error: "write_failed", message: "新建失败，请稍后重试" },
          { status: 502 },
        );
      }

      // A Bitable row the console cannot see is worse than no row at all: the operator
      // would be told it worked and find nothing. Reported as a partial success with the
      // number, so they can still find it after the next sync.
      try {
        await dependencies.mirror(
          toMirrorRecord(recordId, recordNumber, parsed.draft, now),
        );
      } catch {
        return Response.json({
          ok: true,
          recordId,
          recordNumber,
          mirrored: false,
          message: "工单已写入多维表格，但工作台镜像未更新，稍后刷新再看",
        });
      }

      dependencies.revalidate();

      return Response.json({
        ok: true,
        recordId,
        recordNumber,
        mirrored: true,
        message: "工单已创建，状态待分析——点「立即分析」跑完整条链路",
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

export const POST = createNewTicketRoute({
  session: getCurrentSession,
  options: async () => {
    const options = await readFilterOptions();
    return { channels: options.channel, categories: options.category };
  },
  create: (fields) => getBitableClient().createRecord(fields),
  mirror: async (record) => {
    await upsertRecords([record]);
  },
  revalidate: () => revalidateTag(VOC_RECORDS_CACHE_TAG, { expire: 0 }),
  // The same shape as every other 记录编号 in this table.
  recordNumber: () => crypto.randomUUID(),
  now: () => Date.now(),
});
