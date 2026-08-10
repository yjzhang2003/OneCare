export const VOC_STATES = [
  "待分析",
  "分析失败",
  "已分析",
  "无需跟进",
  "待跟进",
  "跟进中",
  "待闭环",
  "已闭环",
] as const;

export type VocState = (typeof VOC_STATES)[number];

export const VOC_STATE_SEQUENCE: Readonly<Record<VocState, number>> = {
  待分析: 0,
  分析失败: 1,
  已分析: 2,
  无需跟进: 3,
  待跟进: 4,
  跟进中: 5,
  待闭环: 6,
  已闭环: 7,
};

export const VOC_ACTIONS = [
  "打标成功",
  "打标失败",
  "重试",
  "需建单",
  "无需建单",
  "开始跟进",
  "提交跟进结果",
  "确认闭环",
] as const;

export type VocAction = (typeof VOC_ACTIONS)[number];

export const RETRY_CEILING = 3;

export type TransitionContext = Readonly<{
  retryCount: number;
  hasOwner: boolean;
  followUpNote?: string;
  closingNote?: string;
}>;

export type TransitionResult =
  | Readonly<{ kind: "ok"; next: VocState }>
  | Readonly<{ kind: "noop"; state: VocState }>
  | Readonly<{ kind: "rejected"; reason: string }>;

type Rule = Readonly<{
  from: VocState;
  action: VocAction;
  to: VocState;
  guard?: (context: TransitionContext) => string | null;
}>;

function requireText(
  value: string | undefined,
  label: string,
): string | null {
  return value && value.trim().length > 0 ? null : `${label}不能为空`;
}

const RULES: readonly Rule[] = [
  { from: "待分析", action: "打标成功", to: "已分析" },
  { from: "待分析", action: "打标失败", to: "分析失败" },
  {
    from: "分析失败",
    action: "重试",
    to: "待分析",
    guard: (context) =>
      context.retryCount < RETRY_CEILING
        ? null
        : `重试次数已达上限 ${RETRY_CEILING}`,
  },
  {
    from: "已分析",
    action: "需建单",
    to: "待跟进",
    guard: (context) => (context.hasOwner ? null : "未解析到负责人或兜底人"),
  },
  { from: "已分析", action: "无需建单", to: "无需跟进" },
  { from: "待跟进", action: "开始跟进", to: "跟进中" },
  {
    from: "跟进中",
    action: "提交跟进结果",
    to: "待闭环",
    guard: (context) => requireText(context.followUpNote, "跟进记录"),
  },
  {
    from: "待闭环",
    action: "确认闭环",
    to: "已闭环",
    guard: (context) => requireText(context.closingNote, "闭环结论"),
  },
];

export function transition(
  current: VocState,
  action: VocAction,
  context: TransitionContext,
): TransitionResult {
  // Feishu card buttons get double-clicked and retried on the wire, so landing
  // on the action's target state again is success, not an error.
  const alreadyThere = RULES.find(
    (rule) => rule.action === action && rule.to === current,
  );
  if (alreadyThere) {
    return { kind: "noop", state: current };
  }

  const rule = RULES.find((r) => r.from === current && r.action === action);
  if (!rule) {
    return { kind: "rejected", reason: `${current} 不支持动作 ${action}` };
  }

  const violation = rule.guard?.(context) ?? null;
  if (violation) {
    return { kind: "rejected", reason: violation };
  }

  return { kind: "ok", next: rule.to };
}
