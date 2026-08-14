// 人员管理: what a routing rule is allowed to be.
//
// `resolveOwner` matches a ticket to a rule by **exact string equality** on
// `渠道/品类`, then on `渠道`, then falls back to whichever rule is marked 兜底. That
// makes the scope string load-bearing in a way a free-text field cannot protect: a rule
// scoped to "400客服" (no space) never fires against the channel "400 客服", and nothing
// anywhere reports that it is dead. The console therefore builds the scope out of values
// the data actually contains rather than accepting whatever was typed.
//
// Two more shapes are unreachable-by-construction and are refused here rather than
// silently accepted:
//
//   - **A second rule with the same scope.** resolveOwner takes the first match, so the
//     second is dead the moment it is written.
//   - **A second 兜底.** Same reason: the first one wins, and an operator looking at two
//     of them cannot tell which.

import type { OwnerRule } from "./assignment";

// 谁在这套系统里做什么。路由只看客服行；工程师是派工的候选人；管理员不受工单负责人
// 限制，也是唯一能改这张表的人。
export const OWNER_ROLES = ["客服", "工程师", "管理员"] as const;
export type OwnerRole = (typeof OWNER_ROLES)[number];

// The three rows that predate the 角色 column read back with an empty cell. They are
// channel routing rules, which is what 客服 means, so that is what an empty cell is.
export function toOwnerRole(value: unknown): OwnerRole {
  return typeof value === "string" && (OWNER_ROLES as readonly string[]).includes(value)
    ? (value as OwnerRole)
    : "客服";
}

export type OwnerRuleRecord = Readonly<{
  recordId: string;
  scope: string;
  openId: string;
  // Resolved by the Bitable's own people field. Empty when the person cannot be read,
  // which is a state the list must show rather than hide.
  ownerName: string;
  fallback: boolean;
  role: OwnerRole;
}>;

export type OwnerRuleDraft = Readonly<{
  role: OwnerRole;
  // Empty means "everything on this channel"; the composed scope is then the channel
  // alone, which is exactly resolveOwner's second candidate.
  channel: string;
  category: string;
  openId: string;
  fallback: boolean;
}>;

// The two shapes resolveOwner looks for, in its own order.
export function composeScope(channel: string, category: string): string {
  const left = channel.trim();
  const right = category.trim();
  if (left.length === 0) return "";
  return right.length === 0 ? left : `${left}/${right}`;
}

export function splitScope(
  scope: string,
): Readonly<{ channel: string; category: string }> {
  const at = scope.indexOf("/");
  return at === -1
    ? { channel: scope, category: "" }
    : { channel: scope.slice(0, at), category: scope.slice(at + 1) };
}

export type ValidationInput = Readonly<{
  draft: OwnerRuleDraft;
  // The rules already stored, so duplicates and a second 兜底 can be refused.
  existing: readonly OwnerRuleRecord[];
  // Null when creating; the record being edited is excluded from the conflict checks.
  editingRecordId: string | null;
  // Distinct values the data actually contains, from the same source the filters use.
  channels: readonly string[];
  categories: readonly string[];
  // Whoever the directory says can be named. Empty when the directory could not be read,
  // which disables the person check rather than rejecting every rule.
  assignableOpenIds: readonly string[];
}>;

// One message per problem, written for the person who will read it in a toast.
export function validateOwnerRule(input: ValidationInput): readonly string[] {
  const problems: string[] = [];
  const { draft, existing, editingRecordId } = input;
  const scope = composeScope(draft.channel, draft.category);
  const others = existing.filter((rule) => rule.recordId !== editingRecordId);

  // 工程师 and 管理员 are people, not routes. A 负责范围 on either would look like a
  // routing rule to anyone reading the table and would never be matched against —
  // resolveOwner only ever sees 客服 rows.
  if (draft.role !== "客服") {
    if (scope.length > 0) {
      problems.push(`${draft.role}不需要负责范围——工单路由只看客服的规则`);
    }
    if (draft.fallback) {
      problems.push("只有客服可以设为兜底");
    }
    if (
      draft.openId.trim().length > 0 &&
      others.some((rule) => rule.role === draft.role && rule.openId === draft.openId)
    ) {
      problems.push(`这个人已经是${draft.role}了`);
    }
    if (draft.openId.trim().length === 0) {
      problems.push("请选择人员");
    } else if (
      input.assignableOpenIds.length > 0 &&
      !input.assignableOpenIds.includes(draft.openId)
    ) {
      problems.push("这个人不在应用可见范围内，写进去会被多维表格拒绝");
    }
    return problems;
  }

  if (scope.length === 0) {
    problems.push("请选择负责范围的渠道");
  } else {
    // Checked against real values because an exact-match rule on a value that does not
    // exist can never fire, and nothing downstream would ever say so.
    if (
      input.channels.length > 0 &&
      !input.channels.includes(draft.channel.trim())
    ) {
      problems.push(`渠道「${draft.channel}」在数据里不存在，这条规则永远不会命中`);
    }
    if (
      draft.category.trim().length > 0 &&
      input.categories.length > 0 &&
      !input.categories.includes(draft.category.trim())
    ) {
      problems.push(`品类「${draft.category}」在数据里不存在，这条规则永远不会命中`);
    }
  }

  if (draft.openId.trim().length === 0) {
    problems.push("请选择负责人");
  } else if (
    input.assignableOpenIds.length > 0 &&
    !input.assignableOpenIds.includes(draft.openId)
  ) {
    problems.push("这个负责人不在应用可见范围内，写进去会被多维表格拒绝");
  }

  const routes = others.filter((rule) => rule.role === "客服");

  if (scope.length > 0 && routes.some((rule) => rule.scope === scope)) {
    problems.push(`已经有一条「${scope}」的规则了——匹配只取第一条，第二条不会生效`);
  }

  if (draft.fallback && routes.some((rule) => rule.fallback)) {
    problems.push("已经有一个兜底负责人了，兜底只能有一个");
  }

  return problems;
}

// What the routing table can and cannot answer, computed from the rules themselves.
// Shown above the table so the state of the routing is visible without reading every row.
export type RoutingHealth = Readonly<{
  total: number;
  hasFallback: boolean;
  // 派工 needs at least one, and 人员管理 is the only place to add one.
  engineers: number;
  admins: number;
  // Scopes that duplicate an earlier rule, and are therefore dead.
  shadowed: readonly string[];
  // Channels present in the data with no rule of their own — they will route by fallback.
  uncovered: readonly string[];
}>;

export function routingHealth(
  allRules: readonly OwnerRuleRecord[],
  channels: readonly string[],
): RoutingHealth {
  // Only 客服 rows route anything, so only they can shadow one another or leave a
  // channel uncovered. Counting the whole table here would report a healthy routing
  // table as having rules it does not have.
  const rules = allRules.filter((rule) => rule.role === "客服");
  const seen = new Set<string>();
  const shadowed: string[] = [];
  for (const rule of rules) {
    if (seen.has(rule.scope)) shadowed.push(rule.scope);
    else seen.add(rule.scope);
  }

  const covered = new Set(rules.map((rule) => splitScope(rule.scope).channel));
  return {
    total: rules.length,
    hasFallback: rules.some((rule) => rule.fallback),
    engineers: allRules.filter((rule) => rule.role === "工程师").length,
    admins: allRules.filter((rule) => rule.role === "管理员").length,
    shadowed,
    uncovered: channels.filter((channel) => !covered.has(channel)),
  };
}

// The shape the tagging pipeline consumes. Kept here so the management page and the
// pipeline cannot disagree about what a rule means.
export function toOwnerRules(
  records: readonly OwnerRuleRecord[],
): readonly OwnerRule[] {
  return records
    .filter((record) => record.role === "客服")
    .map((record) => ({
      scope: record.scope,
      openId: record.openId,
      fallback: record.fallback,
    }));
}

// Who may operate any ticket and edit this table. Empty is a real state — it means the
// table has no 管理员 row yet — and every caller has to decide what that means rather
// than being handed a default.
export function adminOpenIds(
  records: readonly OwnerRuleRecord[],
): readonly string[] {
  return records
    .filter((record) => record.role === "管理员" && record.openId.trim().length > 0)
    .map((record) => record.openId);
}

export function engineerRules(
  records: readonly OwnerRuleRecord[],
): readonly OwnerRuleRecord[] {
  return records.filter((record) => record.role === "工程师");
}
