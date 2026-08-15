import { revalidateTag } from "next/cache";

import { getCurrentSession } from "../../../../../../src/features/auth/current-session";
import { isGuest, refuseGuestWrite } from "../../../../../../src/features/auth/guest";
import type { AuthUser } from "../../../../../../src/features/auth/types";
import {
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
  type TenantTokenProvider,
} from "../../../../../../src/features/bitable/client";
import type { VocRecord } from "../../../../../../src/features/bitable/field-map";
import { writeRecord } from "../../../../../../src/features/store/mirror";
import { readRecordById } from "../../../../../../src/features/store/records";
import { VOC_RECORDS_CACHE_TAG } from "../../../../../../src/features/voc/cache-tags";
import { listOwnerRuleRecords } from "../../../../../../src/features/voc/owner-directory";
import { adminOpenIds } from "../../../../../../src/features/voc/owner-rules";
import { parseTagEdit, toTagEditFields } from "../../../../../../src/features/voc/tag-edit";
import { readBitableEnv, readBotEnv } from "../../../../../../src/lib/env";

// 人工修正打标结论. See src/features/voc/tag-edit.ts for what an edit is and is not.
export type TagEditDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  updateRecord: (recordId: string, fields: Record<string, unknown>) => Promise<void>;
  listAdmins: () => Promise<readonly string[]>;
  revalidate: () => void;
}>;

export function createTagEditRoute(dependencies: TagEditDependencies) {
  return async function PATCH(
    request: Request,
    context: { params: Promise<{ recordId: string }> },
  ): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }
      if (isGuest(user)) return refuseGuestWrite();

      const { recordId } = await context.params;
      const edit = parseTagEdit(await request.json().catch(() => null));
      if (!recordId || !edit) {
        return Response.json(
          { error: "bad_request", message: "请求格式不正确" },
          { status: 400 },
        );
      }

      const [record, admins] = await Promise.all([
        dependencies.getRecord(recordId),
        dependencies.listAdmins().catch((): readonly string[] => []),
      ]);
      if (!record) {
        return Response.json(
          { error: "not_found", message: "记录不存在或已被删除" },
          { status: 404 },
        );
      }

      // The same shape of rule the transitions use, with one addition: an unowned
      // ticket is anyone's to correct, because there is no owner's judgement to
      // override.
      const allowed =
        record.ownerOpenIds.length === 0 ||
        record.ownerOpenIds.includes(user.openId) ||
        admins.includes(user.openId);
      if (!allowed) {
        return Response.json(
          { error: "forbidden", message: "只有该工单的负责人或管理员可以修改结论" },
          { status: 403 },
        );
      }

      try {
        await dependencies.updateRecord(recordId, toTagEditFields(edit, user.name));
      } catch {
        return Response.json(
          { error: "write_failed", message: "写入失败，请稍后重试" },
          { status: 502 },
        );
      }

      dependencies.revalidate();
      return Response.json({ ok: true, message: "已保存，来源标记为人工修正" });
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

export const PATCH = createTagEditRoute({
  session: getCurrentSession,
  getRecord: readRecordById,
  updateRecord: async (recordId, fields) => {
    const pushes: Promise<void>[] = [];
    await writeRecord(
      { bitable: getBitableClient(), defer: (task) => pushes.push(task()) },
      recordId,
      fields,
    );
    await Promise.all(pushes);
  },
  listAdmins: async () =>
    adminOpenIds(
      await listOwnerRuleRecords({
        bitable: readBitableEnv(),
        token: getTokenProvider(),
      }),
    ),
  revalidate: () => revalidateTag(VOC_RECORDS_CACHE_TAG, { expire: 0 }),
});
