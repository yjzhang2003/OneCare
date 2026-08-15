// 手动新建工单：一条演示用的真实工单。
//
// The VOC table has never had a create path — records arrive by importing the
// enterprise's own export, and inventing rows in someone else's dataset is not something
// an app should do casually. What makes this one defensible is that it is marked: every
// row created here carries 来源明细 = 手动录入（演示）, so "which rows did we type in
// ourselves" is answerable from the Base itself, by anyone, forever.
//
// It exists because the demo needs a starting gun. Every other way to show the chain
// consumes a real record: 立即分析 uses up a 待分析 row, and the rehearsal endpoint moves
// existing ones around. A ticket typed on the spot runs the whole loop — 打标 → triage →
// 建单 → 路由 → 工单卡 → 通知 → 派工 → 回填 → 闭环 — without spending anything.

import { VOC_FIELD_NAMES, type BitableFields } from "../bitable/field-map";

// The marker, in one place. It goes in 来源明细 rather than 打标来源 because it describes
// where the *record* came from, not who labelled it — 打标来源 still says demo-seed or
// aily or manual, and both facts stay true independently.
export const MANUAL_SOURCE_DETAIL = "手动录入（演示）";

export type NewTicketDraft = Readonly<{
  channel: string;
  category: string;
  model: string;
  content: string;
  userRef: string;
  deviceRef: string;
}>;

export type NewTicketOptions = Readonly<{
  // The values the Base's single-selects already carry. Writing anything else would
  // create a new option in the enterprise's table — the one thing this feature must not
  // be able to do by accident.
  channels: readonly string[];
  categories: readonly string[];
}>;

const MAX_CONTENT = 2000;

export function parseNewTicket(
  body: unknown,
  options: NewTicketOptions,
): Readonly<{ draft: NewTicketDraft } | { problems: readonly string[] }> {
  const raw =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  const draft: NewTicketDraft = {
    channel: text(raw.channel),
    category: text(raw.category),
    model: text(raw.model),
    content: text(raw.content),
    userRef: text(raw.userRef),
    deviceRef: text(raw.deviceRef),
  };

  const problems: string[] = [];
  if (draft.content.length < 5) {
    problems.push("请把用户说的话写清楚，至少 5 个字");
  }
  if (draft.content.length > MAX_CONTENT) {
    problems.push(`原始内容太长了（上限 ${MAX_CONTENT} 字）`);
  }
  if (!options.channels.includes(draft.channel)) {
    problems.push("请选择一个数据里已有的渠道");
  }
  if (draft.category.length > 0 && !options.categories.includes(draft.category)) {
    problems.push("请选择一个数据里已有的品类");
  }

  return problems.length > 0 ? { problems } : { draft };
}

// 记录编号 is a UUID everywhere else in this table, and the console shows its last six
// characters. Keeping the same shape means a demo ticket looks like every other row in
// the list — which is the point: the chain it runs through is the real one.
export function newTicketFields(
  draft: NewTicketDraft,
  recordNumber: string,
  now: number,
): BitableFields {
  return {
    [VOC_FIELD_NAMES.recordNumber]: recordNumber,
    [VOC_FIELD_NAMES.feedbackAt]: now,
    [VOC_FIELD_NAMES.channel]: draft.channel,
    ...(draft.category.length > 0
      ? { [VOC_FIELD_NAMES.category]: draft.category }
      : {}),
    ...(draft.model.length > 0 ? { [VOC_FIELD_NAMES.model]: draft.model } : {}),
    [VOC_FIELD_NAMES.content]: draft.content,
    ...(draft.userRef.length > 0
      ? { [VOC_FIELD_NAMES.userRef]: draft.userRef }
      : {}),
    ...(draft.deviceRef.length > 0
      ? { [VOC_FIELD_NAMES.deviceRef]: draft.deviceRef }
      : {}),
    // 待分析 is the only state the tagging pipeline can start from, and starting there is
    // the whole reason to create a ticket by hand.
    [VOC_FIELD_NAMES.state]: "待分析",
    [VOC_FIELD_NAMES.sourceDetail]: MANUAL_SOURCE_DETAIL,
  };
}
