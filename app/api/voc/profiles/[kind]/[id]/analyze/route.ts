import { getCurrentSession } from "../../../../../../../src/features/auth/current-session";
import type { AuthUser } from "../../../../../../../src/features/auth/types";
import {
  ruleBasedProvider,
  type ProfileInsight,
  type ProfileInsightProvider,
} from "../../../../../../../src/features/profiles/insight";
import {
  readIdentityRecords,
  readProfile,
} from "../../../../../../../src/features/store/workbench-query";
import type { IdentityProfile } from "../../../../../../../src/features/workbench/profiles";
import type { WorkbenchTicket } from "../../../../../../../src/features/workbench/data";

// 画像分析 / 设备预警 for one identity.
//
// The provider is injected rather than imported at the call site, which is the whole
// point of this route existing: today it binds `ruleBasedProvider`, and an aily skill
// implementing the same `ProfileInsightProvider` replaces it without the pages or this
// handler changing. That seam is why the mock is worth shipping — it is the interface
// that survives, not the rules behind it.
export type ProfileAnalyzeDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  getProfile: (
    kind: "user" | "device",
    id: string,
  ) => Promise<IdentityProfile | null>;
  getRecords: (
    kind: "user" | "device",
    id: string,
  ) => Promise<readonly WorkbenchTicket[]>;
  provider: ProfileInsightProvider;
  now: () => number;
}>;

export type ProfileAnalyzeResponse = Readonly<{
  ok: true;
  insight: ProfileInsight;
}>;

export function createProfileAnalyzeRoute(
  dependencies: ProfileAnalyzeDependencies,
) {
  return async function POST(
    _request: Request,
    context: { params: Promise<{ kind: string; id: string }> },
  ): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }

      const { kind, id } = await context.params;
      // Two identities exist and no more. An unrecognised kind is a bad request rather
      // than a lookup that quietly returns nothing.
      if (kind !== "user" && kind !== "device") {
        return Response.json(
          { error: "bad_request", message: "只支持用户或设备画像" },
          { status: 400 },
        );
      }
      const identity = decodeURIComponent(id);
      if (identity.length === 0) {
        return Response.json(
          { error: "bad_request", message: "缺少标识" },
          { status: 400 },
        );
      }

      const [profile, records] = await Promise.all([
        dependencies.getProfile(kind, identity),
        dependencies.getRecords(kind, identity),
      ]);
      if (!profile) {
        return Response.json(
          { error: "not_found", message: "找不到这个标识" },
          { status: 404 },
        );
      }

      const insight = await dependencies.provider.analyze({
        kind,
        profile,
        records,
        now: dependencies.now(),
      });

      return Response.json({ ok: true, insight } satisfies ProfileAnalyzeResponse);
    } catch {
      return Response.json(
        { error: "internal", message: "分析暂时不可用，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

export const POST = createProfileAnalyzeRoute({
  session: getCurrentSession,
  getProfile: readProfile,
  getRecords: readIdentityRecords,
  provider: ruleBasedProvider,
  now: () => Date.now(),
});
