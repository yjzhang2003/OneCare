import { getCurrentSession } from "../../../../src/features/auth/current-session";
import type { AuthUser } from "../../../../src/features/auth/types";
import { createTenantTokenProvider } from "../../../../src/features/bitable/client";
import { listAssignableMembers } from "../../../../src/features/directory/members";
import {
  createOwnerRule,
  listOwnerRuleRecords,
} from "../../../../src/features/voc/owner-directory";
import {
  composeScope,
  validateOwnerRule,
  type OwnerRuleDraft,
  type OwnerRuleRecord,
} from "../../../../src/features/voc/owner-rules";
import { readFilterOptions } from "../../../../src/features/store/workbench-query";
import { readBitableEnv, readBotEnv } from "../../../../src/lib/env";

// 人员管理 的列表与新增。
//
// Validation runs here, not only in the form: the browser is not a trust boundary, and
// the rules being enforced are not cosmetic — a scope that matches nothing is a rule
// that silently never fires, and a second 兜底 makes routing ambiguous. Both are refused
// with the reason, in the same words the form would have shown.
export type OwnerRoutesDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  list: () => Promise<readonly OwnerRuleRecord[]>;
  create: (input: {
    scope: string;
    openId: string;
    fallback: boolean;
  }) => Promise<string>;
  // The real values a scope can be built from, and who may be named. Both are read for
  // validation rather than trusted from the request.
  options: () => Promise<Readonly<{ channels: readonly string[]; categories: readonly string[] }>>;
  assignableOpenIds: () => Promise<readonly string[]>;
}>;

export function parseDraft(body: unknown): OwnerRuleDraft | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;
  if (
    typeof raw.channel !== "string" ||
    typeof raw.openId !== "string" ||
    (raw.category !== undefined && typeof raw.category !== "string")
  ) {
    return null;
  }
  return {
    channel: raw.channel,
    category: typeof raw.category === "string" ? raw.category : "",
    openId: raw.openId,
    fallback: raw.fallback === true,
  };
}

export function createOwnerListRoute(dependencies: OwnerRoutesDependencies) {
  return async function GET(): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }
      const rules = await dependencies.list();
      return Response.json({ ok: true, rules });
    } catch {
      return Response.json(
        { error: "internal", message: "读取负责人表失败，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

export function createOwnerCreateRoute(dependencies: OwnerRoutesDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }

      const draft = parseDraft(await request.json().catch(() => null));
      if (!draft) {
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

      const problems = validateOwnerRule({
        draft,
        existing,
        editingRecordId: null,
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

      const recordId = await dependencies.create({
        scope: composeScope(draft.channel, draft.category),
        openId: draft.openId,
        fallback: draft.fallback,
      });

      return Response.json({ ok: true, recordId, message: "已新增路由规则" });
    } catch {
      return Response.json(
        { error: "internal", message: "写入负责人表失败，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

// ---------------------------------------------------------------------------

export function ownerDependencies(): OwnerRoutesDependencies {
  const env = () => ({
    bitable: readBitableEnv(),
    token: (() => {
      const bot = readBotEnv();
      return createTenantTokenProvider(bot.appId, bot.appSecret);
    })(),
  });

  return {
    session: getCurrentSession,
    list: () => listOwnerRuleRecords(env()),
    create: (input) => createOwnerRule(env(), input),
    options: async () => {
      const options = await readFilterOptions();
      return { channels: options.channel, categories: options.category };
    },
    assignableOpenIds: async () => {
      const members = await listAssignableMembers({
        tenantToken: () => {
          const bot = readBotEnv();
          return createTenantTokenProvider(bot.appId, bot.appSecret)();
        },
      }).catch(() => []);
      return members.map((member) => member.openId);
    },
  };
}

const dependencies = ownerDependencies();
export const GET = createOwnerListRoute(dependencies);
export const POST = createOwnerCreateRoute(dependencies);
