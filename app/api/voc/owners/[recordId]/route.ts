import { createTenantTokenProvider } from "../../../../../src/features/bitable/client";
import {
  deleteOwnerRule,
  updateOwnerRule,
} from "../../../../../src/features/voc/owner-directory";
import {
  composeScope,
  validateOwnerRule,
} from "../../../../../src/features/voc/owner-rules";
import { readBitableEnv, readBotEnv } from "../../../../../src/lib/env";
import {
  ownerDependencies,
  parseDraft,
  type OwnerRoutesDependencies,
} from "../route";

// 人员管理 的编辑与删除。
//
// The same validation as create, with the edited rule excluded from the conflict checks —
// otherwise saving a rule unchanged would report it as a duplicate of itself.
export type OwnerMutationDependencies = OwnerRoutesDependencies &
  Readonly<{
    update: (
      recordId: string,
      input: { scope: string; openId: string; fallback: boolean },
    ) => Promise<void>;
    remove: (recordId: string) => Promise<void>;
  }>;

export function createOwnerUpdateRoute(dependencies: OwnerMutationDependencies) {
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

      const { recordId } = await context.params;
      const draft = parseDraft(await request.json().catch(() => null));
      if (!recordId || !draft) {
        return Response.json(
          { error: "bad_request", message: "请求格式不正确" },
          { status: 400 },
        );
      }

      const [existing, options, assignableOpenIds] = await Promise.all([
        dependencies.list(),
        dependencies.options(),
        dependencies.assignableOpenIds(),
      ]);

      if (!existing.some((rule) => rule.recordId === recordId)) {
        return Response.json(
          { error: "not_found", message: "这条规则不存在或已被删除" },
          { status: 404 },
        );
      }

      const problems = validateOwnerRule({
        draft,
        existing,
        // Excluded, or a rule saved unchanged would conflict with itself.
        editingRecordId: recordId,
        channels: options.channels,
        categories: options.categories,
        assignableOpenIds,
      });
      if (problems.length > 0) {
        return Response.json(
          { error: "rejected", message: problems.join("；"), problems },
          { status: 422 },
        );
      }

      await dependencies.update(recordId, {
        scope: composeScope(draft.channel, draft.category),
        openId: draft.openId,
        fallback: draft.fallback,
      });

      return Response.json({ ok: true, message: "已保存" });
    } catch {
      return Response.json(
        { error: "internal", message: "写入负责人表失败，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

export function createOwnerDeleteRoute(dependencies: OwnerMutationDependencies) {
  return async function DELETE(
    _request: Request,
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

      const { recordId } = await context.params;
      if (!recordId) {
        return Response.json(
          { error: "bad_request", message: "缺少规则 ID" },
          { status: 400 },
        );
      }

      const existing = await dependencies.list();
      const target = existing.find((rule) => rule.recordId === recordId);
      if (!target) {
        return Response.json(
          { error: "not_found", message: "这条规则不存在或已被删除" },
          { status: 404 },
        );
      }

      // Deleting the only 兜底 is the one delete that changes what happens to tickets
      // matching nothing: they stop being routed at all. Refused rather than warned,
      // because the consequence is invisible until a ticket goes missing.
      if (target.fallback && existing.filter((rule) => rule.fallback).length === 1) {
        return Response.json(
          {
            error: "rejected",
            message: "这是唯一的兜底负责人，删掉之后匹配不到规则的工单将无人接收——请先指定新的兜底",
          },
          { status: 422 },
        );
      }

      await dependencies.remove(recordId);
      return Response.json({ ok: true, message: "已删除" });
    } catch {
      return Response.json(
        { error: "internal", message: "删除失败，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

// ---------------------------------------------------------------------------

function mutationDependencies(): OwnerMutationDependencies {
  const env = () => ({
    bitable: readBitableEnv(),
    token: (() => {
      const bot = readBotEnv();
      return createTenantTokenProvider(bot.appId, bot.appSecret);
    })(),
  });

  return {
    ...ownerDependencies(),
    update: (recordId, input) => updateOwnerRule(env(), recordId, input),
    remove: (recordId) => deleteOwnerRule(env(), recordId),
  };
}

const dependencies = mutationDependencies();
export const PATCH = createOwnerUpdateRoute(dependencies);
export const DELETE = createOwnerDeleteRoute(dependencies);
