import type { VocRecord } from "../bitable/field-map";
import type { VocReply } from "../tagging/contracts";
import type { VocState } from "../voc/service-event";
import type { OperatorSummary } from "./operator-summary";
import type { TodayOverviewCounts, TodayOverviewResult } from "./today-overview";
import {
  ONECARE_CASE_ID,
  VOC_NOTE_FIELD_NAME,
  VOC_NOTE_FORM_NAME,
  VOC_NOTE_MAX_LENGTH,
  VOC_NOTE_SUBMIT_NAME,
  type FeishuCard,
  type FeishuOutboundMessage,
  type OneCareCardAction,
  type OneCareCardState,
  type OneCareCardView,
  type VocCardAction,
} from "./card-types";

type CardElement = Record<string, unknown>;

const WEBSITE_URL = "https://onecare.ohmyfeishu.top/";

function markdown(content: string): CardElement {
  return {
    tag: "markdown",
    content,
    text_align: "left",
    text_size: "normal_v2",
    margin: "0px",
  };
}

function field(label: string, value: string): CardElement {
  return {
    tag: "div",
    text: { tag: "lark_md", content: `**${label}**\n${value}` },
  };
}

function detailBlock(
  content: string,
  fields: ReadonlyArray<readonly [string, string]>,
): CardElement {
  return {
    tag: "div",
    text: { tag: "lark_md", content },
    fields: fields.map(([label, value]) => ({
      is_short: true,
      text: { tag: "lark_md", content: `**${label}**\n${value}` },
    })),
  };
}

function callbackButton(
  text: string,
  action: OneCareCardAction,
  options: Readonly<{
    type?: "primary_filled" | "default";
    disabled?: boolean;
  }> = {},
): CardElement {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type: options.type ?? "default",
    size: "medium",
    width: "fill",
    disabled: options.disabled ?? false,
    ...(options.disabled
      ? {}
      : {
          behaviors: [
            {
              type: "callback",
              value: { action, case_id: ONECARE_CASE_ID },
            },
          ],
        }),
  };
}

function websiteButton(): CardElement {
  return {
    tag: "button",
    text: { tag: "plain_text", content: "打开网页演示" },
    type: "default",
    size: "medium",
    width: "fill",
    behaviors: [{ type: "open_url", default_url: WEBSITE_URL }],
  };
}

function columns(...elements: CardElement[]): CardElement {
  return {
    tag: "column_set",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: elements.map((element) => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      vertical_align: "top",
      elements: [element],
    })),
  };
}

function note(content: string): CardElement {
  return {
    tag: "div",
    icon: { tag: "standard_icon", token: "info_outlined" },
    text: { tag: "lark_md", content },
  };
}

function cardRoot(input: Readonly<{
  title: string;
  subtitle: string;
  elements: readonly CardElement[];
  completed?: boolean;
  template?: string;
  icon?: string;
  status: string;
  statusColor: string;
  // Card 2.0's own collapsed/notification preview text. Every caller before
  // Task 12 was a demo view or a demo-case-shaped production card and took
  // the default below, which unconditionally appends "· 万护 OneCare 演示" —
  // a phrase that does not belong on a card whose entire point is that the
  // numbers on it are real (the operator summary card). This lets that one
  // caller override it instead of rewriting the shared default every other
  // card in this file still relies on.
  summary?: string;
}>): FeishuCard {
  // Task 14: no fallback to a default token here any more. Every call site in
  // this file passes `icon` explicitly (verified: none ever relied on the
  // old `?? "myai_colorful"` default), and both of the two production cards
  // this task fixes now pass no icon at all rather than an unverified guess
  // at a valid "_outlined" replacement for the "chart_colorful" placeholder
  // token they used to carry — see createOperatorSummaryCard/
  // createTodayOverviewCard. `icon` on the Card 2.0 header is genuinely
  // optional, so when neither `input.icon` nor `completed` supplies one, the
  // header renders with no icon field at all instead of a broken glyph.
  const iconToken = input.completed ? "done_colorful" : input.icon;

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      summary: { content: input.summary ?? `${input.title} · 万护 OneCare 演示` },
    },
    header: {
      title: { tag: "plain_text", content: input.title },
      subtitle: { tag: "plain_text", content: input.subtitle },
      template: input.completed ? "green" : (input.template ?? "turquoise"),
      ...(iconToken
        ? { icon: { tag: "standard_icon", token: iconToken } }
        : {}),
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: input.status },
          color: input.completed ? "green" : input.statusColor,
        },
      ],
      padding: "12px 12px 12px 12px",
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 12px 12px",
      vertical_spacing: "12px",
      elements: input.elements,
    },
  };
}

function workbenchCard(): FeishuCard {
  return cardRoot({
    title: "万护 OneCare",
    subtitle: "员工协同工作台 · 演示",
    status: "演示工作台",
    statusColor: "turquoise",
    icon: "myai_colorful",
    elements: [
      detailBlock(
        "**问题出现前，服务已经开始。**\nAI 串联客服、工程师与运营岗位，让同一案例沿一条服务链路推进。",
        [
          ["当前案例", `${ONECARE_CASE_ID}\n冷藏室温度持续偏高`],
          ["当前阶段", "AI 已完成预诊\n等待客服确认"],
        ],
      ),
      markdown("**选择工作入口**"),
      columns(
        callbackButton("客服 · 待确认服务", "open_pending", {
          type: "primary_filled",
        }),
        callbackButton("工程师 · 今日任务", "open_tasks"),
        callbackButton("运营后台", "open_operations"),
      ),
      columns(
        websiteButton(),
      ),
      note("所有内容均为演示数据，不会写入真实服务系统。"),
    ],
  });
}

function operationsCard(): FeishuCard {
  return cardRoot({
    title: "运营后台",
    subtitle: "服务闭环与 VOC 风险 · 演示",
    status: "闭环监控 · 演示",
    statusColor: "blue",
    template: "blue",
    icon: "chart_colorful",
    elements: [
      columns(
        field("主动预警", "1 个\n正在流转"),
        field("待客服确认", "1 个\n剩余 28 分钟"),
        field("重复上门风险", "低\n配件已预判"),
      ),
      field("VOC 聚集主题", "冷藏温度偏高反馈近期出现聚集趋势"),
      field("闭环提醒", "若 30 分钟内未确认，系统将触发跨岗位协同提醒"),
      columns(
        callbackButton("查看当前进度", "open_progress", {
          type: "primary_filled",
        }),
        websiteButton(),
      ),
      note("运营指标与风险均为演示数据。"),
    ],
  });
}

function pendingCard(): FeishuCard {
  return cardRoot({
    title: "待确认服务",
    subtitle: "客服工作台 · 演示",
    status: "待客服确认",
    statusColor: "yellow",
    template: "yellow",
    icon: "myai_colorful",
    elements: [
      field("用户问题", "冷藏室温度持续偏高"),
      columns(
        field("案例编号", ONECARE_CASE_ID),
        field("AI 置信度", "86%"),
      ),
      field("AI 建议", "先用知识库辅助用户自查门体密封与温控设置；若仍异常，再创建服务工单。"),
      columns(
        callbackButton("创建演示工单", "create_ticket", {
          type: "primary_filled",
        }),
        callbackButton("查看 AI 预诊与配件", "open_diagnosis"),
      ),
      note("操作只更新演示卡片，不会创建真实工单。"),
    ],
  });
}

function ticketCard(state: OneCareCardState): FeishuCard {
  const completed = state === "completed";
  return cardRoot({
    title: completed ? "演示工单已创建" : "创建服务工单",
    subtitle: "客服工作台 · 演示",
    completed,
    status: completed ? "已创建 · 演示" : "待创建",
    statusColor: completed ? "green" : "orange",
    template: "orange",
    icon: "todo_colorful",
    elements: [
      columns(
        field("工单号", ONECARE_CASE_ID),
        field("服务优先级", "P2 · 需关注"),
      ),
      field("故障描述", "冷藏室温度持续偏高，知识库自查后仍未恢复"),
      field("派工建议", "安排工程师携带冷藏室温度传感器备件上门核验"),
      columns(
        callbackButton(
          completed ? "创建完成" : "确认创建演示工单",
          "create_ticket",
          { type: "primary_filled", disabled: completed },
        ),
        callbackButton("查询服务进度", "open_progress"),
        callbackButton("查看工程师任务", "open_tasks"),
      ),
      note(
        completed
          ? "演示状态已更新；未写入真实工单系统。"
          : "确认后仅更新本张演示卡片。",
      ),
    ],
  });
}

function progressCard(): FeishuCard {
  return cardRoot({
    title: "服务进度",
    subtitle: `${ONECARE_CASE_ID} · 演示`,
    status: "客服确认中",
    statusColor: "blue",
    template: "blue",
    icon: "todo_colorful",
    elements: [
      markdown(
        "🟢 **发现异常**　设备信号触发主动预警\n\n🟢 **完成预诊**　生成自查建议与备件清单\n\n🟠 **客服确认**　当前阶段\n\n⚪ **预约上门**　等待推进",
      ),
      columns(
        callbackButton("查看工程师任务", "open_tasks", {
          type: "primary_filled",
        }),
        callbackButton("查看运营风险", "open_operations"),
      ),
      note("案例尚未进入真实服务系统。"),
    ],
  });
}

function tasksCard(): FeishuCard {
  return cardRoot({
    title: "今日任务",
    subtitle: "工程师工作台 · 演示",
    status: "待上门 · 演示",
    statusColor: "blue",
    template: "blue",
    icon: "todo_colorful",
    elements: [
      columns(
        field("今日上门", "1 项"),
        field("服务时间", "14:00–16:00"),
      ),
      field("任务案例", `${ONECARE_CASE_ID}\n冷藏室温度持续偏高`),
      field("服务地点", "青岛市 · 详细地址已脱敏"),
      columns(
        callbackButton("查看预诊与配件", "open_diagnosis", {
          type: "primary_filled",
        }),
        callbackButton("查看服务结果", "open_result"),
      ),
      note("任务信息为演示数据。"),
    ],
  });
}

function diagnosisCard(state: OneCareCardState): FeishuCard {
  const completed = state === "completed";
  return cardRoot({
    title: completed ? "配件准备已确认" : "AI 预诊与配件",
    subtitle: "工程师工作台 · 演示",
    completed,
    status: completed ? "配件已确认 · 演示" : "待核验",
    statusColor: completed ? "green" : "turquoise",
    icon: "myai_colorful",
    elements: [
      field("可能原因", "温度传感器漂移 / 门体密封异常 / 风道循环受阻"),
      field("建议携带", "冷藏室温度传感器、密封检测工具、风道清洁组件"),
      field("上门前核验", "设备型号、历史告警与用户自查结果"),
      columns(
        callbackButton(
          completed ? "配件已确认" : "确认配件准备完成",
          "confirm_parts",
          { type: "primary_filled", disabled: completed },
        ),
        callbackButton("返回今日任务", "open_tasks"),
      ),
      note(completed ? "演示确认已记录。" : "确认不会触发真实配件出库。"),
    ],
  });
}

function resultCard(state: OneCareCardState): FeishuCard {
  const completed = state === "completed";
  return cardRoot({
    title: completed ? "服务结果已提交" : "提交服务结果",
    subtitle: "工程师工作台 · 演示",
    completed,
    status: completed ? "已提交 · 演示" : "待提交",
    statusColor: completed ? "green" : "yellow",
    template: "yellow",
    icon: "todo_colorful",
    elements: [
      field("处理结果", "完成传感器核验与风道清理，温度恢复观察中"),
      field("闭环动作", "服务完成后自动触发回访与满意度评价"),
      columns(
        callbackButton(
          completed ? "结果已提交" : "提交演示服务结果",
          "submit_result",
          { type: "primary_filled", disabled: completed },
        ),
        callbackButton("查看运营闭环", "open_operations"),
      ),
      note(completed ? "演示结果已记录。" : "不会写入真实服务或回访系统。"),
    ],
  });
}

export function createCard(
  view: OneCareCardView,
  state: OneCareCardState = "initial",
): FeishuCard {
  switch (view) {
    case "workbench":
      return workbenchCard();
    case "operations":
      return operationsCard();
    case "pending":
      return pendingCard();
    case "ticket":
      return ticketCard(state);
    case "progress":
      return progressCard();
    case "tasks":
      return tasksCard();
    case "diagnosis":
      return diagnosisCard(state);
    case "result":
      return resultCard(state);
  }
}

export function createCardMessage(
  view: OneCareCardView,
  state: OneCareCardState = "initial",
): FeishuOutboundMessage {
  return { msgType: "interactive", content: JSON.stringify(createCard(view, state)) };
}

export function createWelcomeMessage(): FeishuOutboundMessage {
  return createCardMessage("workbench");
}

// A bare chat message, not a card. Spec §6.1 step 5 calls for the war room
// Q&A answer to land as an ordinary text message, and the same shape serves
// its two failure fallbacks ("no ticket for this group" / "cannot answer
// right now") — none of the three is a dashboard tile, they are prose meant
// to be read in the flow of the conversation.
export function createTextMessage(text: string): FeishuOutboundMessage {
  return { msgType: "text", content: JSON.stringify({ text }) };
}

// Task 12: this is what a p2p text message from an operator gets back now,
// in place of workbenchCard()'s demo command menu — no case id, no "演示"
// wording, no disclaimer, because unlike every card above it this one
// renders real numbers off the real Base (via computeOperatorSummary).
const OPERATIONS_WORKBENCH_URL = "https://onecare.ohmyfeishu.top/enter";

function operationsWorkbenchButton(): CardElement {
  return {
    tag: "button",
    text: { tag: "plain_text", content: "打开运营工作台" },
    type: "primary_filled",
    size: "medium",
    width: "fill",
    behaviors: [{ type: "open_url", default_url: OPERATIONS_WORKBENCH_URL }],
  };
}

function summaryField(label: string, value: number): CardElement {
  return field(label, `${value} 条`);
}

// Task 14: no `icon` here any more. The official icon documentation lists
// only tokens ending in "_outlined" — "chart_colorful" (this card's icon
// before this task) isn't documented at all, which is exactly why it
// rendered as a broken placeholder glyph in production instead of a chart
// icon. Rather than guess at an unverified "_outlined" replacement,
// cardRoot's `icon` is left unset: no icon is a clean header, not a risk.
export function createOperatorSummaryCard(
  summary: OperatorSummary | null,
): FeishuCard {
  return cardRoot({
    title: "万护 OneCare 服务运营",
    subtitle: "我的工作台",
    status: summary ? "实时数据" : "指标不可用",
    statusColor: summary ? "blue" : "grey",
    template: "blue",
    summary: "万护 OneCare 服务运营",
    elements: summary
      ? [
          columns(
            summaryField("我的待跟进", summary.myPendingFollowUp),
            summaryField("我的跟进中", summary.myInProgress),
            summaryField("我的待闭环", summary.myPendingClosure),
          ),
          summaryField("全部反馈总量", summary.total),
          operationsWorkbenchButton(),
        ]
      : [
          // Deliberately zero digits anywhere in this branch (see the
          // operator-summary.test.ts / cards.test.ts assertions that lock
          // this): a failed read must never render as "0 条", which a reader
          // has no way to tell apart from a real, if empty, measurement.
          // readVocRecordsCached's own comment states the same rule on the
          // read side — this is that rule applied to what the card shows.
          note("指标暂不可用，请稍后重试。"),
          operationsWorkbenchButton(),
        ],
  });
}

export function createOperatorSummaryMessage(
  summary: OperatorSummary | null,
): FeishuOutboundMessage {
  return {
    msgType: "interactive",
    content: JSON.stringify(createOperatorSummaryCard(summary)),
  };
}

// Task 13 built this against getVocDashboardMetrics's full VocMetricsResult;
// Task 14 replaced the read behind it with readTodayOverviewCounts's
// counts-only TodayOverviewResult (today-overview.ts) after a real-tenant
// measurement put the old full-table read at ~10.7s against ~1.0s for a
// single filtered records/search count. "ok" vs "unavailable" is still
// resolved here, once, exactly the same way — nothing upstream may collapse
// it into a boolean or a bare counts object first — but the "ok" branch can
// now only show what a count can answer directly: 反馈总量 (unfiltered),
// 已建单/已闭环 (state-filtered), and 闭环率 (their ratio). negativeShare,
// averageClosureHours, 打标覆盖率 and 问题维度 Top all needed the full record set
// aggregateVocMetrics computes in memory — none of those reduce to "how many
// rows match this filter", so none of them belong in a counts-only card. They
// still exist, on the operations workbench the button below still points at;
// the note beneath the numbers says so explicitly rather than leaving a
// reader to wonder why a metric they remember from the dashboard is gone.
function percentField(label: string, ratio: number): CardElement {
  return field(label, `${Math.round(ratio * 100)}%`);
}

function todayOverviewElements(counts: TodayOverviewCounts): CardElement[] {
  return [
    columns(
      summaryField("反馈总量", counts.total),
      summaryField("已建单", counts.ticketsOpened),
      summaryField("已闭环", counts.ticketsClosed),
    ),
    percentField("闭环率", counts.closureRate),
    note("完整指标见运营工作台。"),
    operationsWorkbenchButton(),
  ];
}

function unavailableOverviewElements(): CardElement[] {
  return [
    // Same rule and the same wording as createOperatorSummaryCard's own
    // unavailable branch: a failed read must never render as a 0 a reader
    // could mistake for a real measurement.
    note("指标暂不可用，请稍后重试。"),
    operationsWorkbenchButton(),
  ];
}

// Task 14: no `icon` here either, for the same reason as
// createOperatorSummaryCard immediately above — "chart_colorful" is not a
// documented token, and this card renders with none rather than an
// unverified guess at a replacement.
export function createTodayOverviewCard(result: TodayOverviewResult): FeishuCard {
  return cardRoot({
    title: "万护 OneCare 服务运营",
    subtitle: "今日概览",
    status: result.status === "ok" ? "实时数据" : "指标不可用",
    statusColor: result.status === "ok" ? "blue" : "grey",
    template: "blue",
    summary: "万护 OneCare 今日概览",
    elements:
      result.status === "ok"
        ? todayOverviewElements(result.counts)
        : unavailableOverviewElements(),
  });
}

export function createTodayOverviewMessage(
  result: TodayOverviewResult,
): FeishuOutboundMessage {
  return {
    msgType: "interactive",
    content: JSON.stringify(createTodayOverviewCard(result)),
  };
}

// Task 13: what a bare p2p text message gets back now that the bot has a
// real custom menu (我的工单 / 今日概览) to ask for actual numbers from — see
// route.ts's dispatch on application.bot.menu_v6. Sending a card here is
// exactly the unsolicited-card behaviour this task exists to stop, so this is
// deliberately createTextMessage, never another card.
export function createMenuHintMessage(): FeishuOutboundMessage {
  return createTextMessage(
    "请使用输入框上方的菜单查看「我的工单」或「今日概览」，或在协同群里 @ 我提问。",
  );
}

// Unlike callbackButton (which always ships the fixed demo case id), a VOC
// ticket button addresses a real Bitable row: the callback's value carries
// record_id instead of case_id, which is exactly what event-handler.ts's
// isVocCardAction branch expects to read back.
function vocActionButton(
  text: string,
  action: VocCardAction,
  recordId: string,
): CardElement {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type: "primary_filled",
    size: "medium",
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: { action, record_id: recordId },
      },
    ],
  };
}

// A Card 2.0 form container: the only way an owner's typed text reaches this
// server. Feishu is explicit that "要结合使用输入框组件与按钮组件，你需将输入框
// 组件与按钮组件内嵌于表单容器中" — a standalone input only submits via the
// small icon drawn inside the input itself, so a separate button can never read
// it. The submit button therefore carries `form_action_type: "submit"` (not a
// behaviors type) alongside the callback behavior that routes the click, and
// both components carry the `name` Feishu keys `action.form_value` by.
// Docs: open.feishu.cn/document/feishu-cards/card-json-v2-components/containers/form-container
//       open.feishu.cn/document/feishu-cards/card-json-v2-components/interactive-components/input
function noteForm(
  label: string,
  placeholder: string,
  submitLabel: string,
  action: VocCardAction,
  recordId: string,
): CardElement {
  return {
    tag: "form",
    name: VOC_NOTE_FORM_NAME,
    elements: [
      {
        tag: "input",
        name: VOC_NOTE_FIELD_NAME,
        // Not a separate tag: a multi-line box is `tag: "input"` plus
        // input_type. Newlines come back in the callback as "\n".
        input_type: "multiline_text",
        rows: 3,
        max_length: VOC_NOTE_MAX_LENGTH,
        // Client-side only, and deliberately duplicated by the server-side
        // guard in service-event.ts: a required flag stops an honest slip, it
        // does not stop a forged callback with no form_value at all.
        required: true,
        width: "fill",
        label: { tag: "plain_text", content: label },
        placeholder: { tag: "plain_text", content: placeholder },
      },
      {
        tag: "button",
        name: VOC_NOTE_SUBMIT_NAME,
        form_action_type: "submit",
        text: { tag: "plain_text", content: submitLabel },
        type: "primary_filled",
        size: "medium",
        width: "fill",
        behaviors: [
          {
            type: "callback",
            value: { action, record_id: recordId },
          },
        ],
      },
    ],
  };
}

// Only the action that is actually legal from the record's current state is
// offered — the state machine (Task 2) is the single source of truth for
// what happens next, so the card must not invite a click that resolveVocCardAction
// (Task 12) is only going to reject.
//
// `note` names the column the action's text lands in, and its presence is what
// decides between a bare callback button and a form. The two transitions the
// state machine guards on non-empty text are exactly the two that get an input
// box, so the card can no longer offer a button whose guard it gives the owner
// no way to satisfy.
const NEXT_VOC_ACTION: Readonly<
  Partial<
    Record<
      VocState,
      Readonly<{
        label: string;
        action: VocCardAction;
        note?: Readonly<{ label: string; placeholder: string }>;
      }>
    >
  >
> = {
  待跟进: { label: "开始跟进", action: "voc_start_follow_up" },
  跟进中: {
    label: "提交跟进结果",
    action: "voc_submit_follow_up",
    note: { label: "跟进记录", placeholder: "请填写与用户沟通的过程与结果" },
  },
  待闭环: {
    label: "确认闭环",
    action: "voc_confirm_closure",
    note: { label: "闭环结论", placeholder: "请填写问题的最终处理结论" },
  },
};

const STATUS_COLOR_BY_STATE: Readonly<Record<VocState, string>> = {
  待分析: "turquoise",
  分析失败: "red",
  已分析: "turquoise",
  无需跟进: "grey",
  待跟进: "orange",
  跟进中: "blue",
  待闭环: "yellow",
  已闭环: "green",
};

// VOC content is free text a user typed into a review box, so its length is
// unbounded. Spec §6.1 calls for "原始内容（截断）" precisely because an
// untruncated multi-thousand-character complaint would blow past what a
// mobile Card 2.0 body renders cleanly and crowd out the AI summary, the
// dimensions, and the reply suggestions that share the same card. 200
// characters is roughly the length of a fully-detailed complaint paragraph —
// enough for the owner to triage without reading the raw transcript here (the
// full text still lives in the Base row itself).
export const VOC_TICKET_CONTENT_LIMIT = 200;

// content.slice() cuts UTF-16 code units, not characters. VOC text is
// user-typed and emoji are common; an emoji outside the Basic Multilingual
// Plane is two UTF-16 code units (a surrogate pair), so a slice that lands
// exactly between them keeps a lone surrogate. That lone surrogate survives
// JSON.stringify and becomes mojibake once re-encoded as UTF-8 for the
// Feishu API. Array.from() splits on code points instead, so a boundary
// landing mid-emoji drops the whole character rather than half of it.
function truncateContent(content: string): string {
  const codePoints = Array.from(content);
  return codePoints.length > VOC_TICKET_CONTENT_LIMIT
    ? `${codePoints.slice(0, VOC_TICKET_CONTENT_LIMIT).join("")}…`
    : content;
}

// Mirrors the "【语气】正文" join format field-map.ts's toTagFieldUpdate uses
// when writing AI 回复话术 back to the Base, so the same reply set reads
// identically whether it's viewed in the sheet or on this card.
function repliesText(replies: readonly VocReply[]): string {
  return replies.map((reply) => `【${reply.tone}】${reply.text}`).join("\n\n");
}

// Exactly the eight record fields this card puts on screen, named as a type
// so both producers can build one without inventing the other seven. The
// analyze route holds a freshly-tagged pending row (no polarity or owner
// decoded yet) and the callback path holds the row it just read; a full
// VocRecord satisfies this structurally, so nothing that already passes one
// has to change.
export type VocTicketCardRecord = Pick<
  VocRecord,
  | "recordId"
  | "recordNumber"
  | "channel"
  | "category"
  | "content"
  | "feedbackAt"
  | "state"
  | "severity"
>;

// The four AI-derived values the card renders, widened from TagResult's own
// literal unions so the callback path can reconstruct them from a Base row
// (where a hand-edited 情绪极性 is just a string) instead of having to hold a
// real TagResult it never received. A TagResult is assignable to this.
export type VocTicketCardTag = Readonly<{
  summary: string;
  polarity: string;
  dimensions: readonly string[];
  replies: readonly VocReply[];
}>;

// Sent to exactly one approver (the fallback owner for the record's 负责范围),
// whose only job is deciding whether this ticket warrants a group. It
// deliberately omits record.content: the customer's own words belong in the
// group, after people have been deliberately added to work the ticket — this
// notification is one less surface carrying them. The AI summary in tag
// stands in for the raw complaint here.
export function createWarRoomEscalationCard(
  record: VocTicketCardRecord,
  tag: VocTicketCardTag,
  ownerNames: readonly string[],
): FeishuCard {
  return cardRoot({
    title: "VOC 升级提请",
    subtitle: `${record.channel} · ${record.category}`,
    status: "待确认",
    statusColor: "red",
    template: "red",
    icon: "todo_colorful",
    elements: [
      field("记录编号", record.recordNumber || "—"),
      field("严重度", record.severity ?? "—"),
      field("情绪极性", tag.polarity),
      field(
        "问题维度",
        tag.dimensions.length > 0 ? tag.dimensions.join("、") : "—",
      ),
      field("AI 摘要", tag.summary || "—"),
      field(
        "负责人",
        ownerNames.length > 0 ? ownerNames.join("、") : "未解析到负责人",
      ),
      // Same value shape as the existing four VOC actions (action + record_id)
      // so the callback path (event-handler.ts's isVocCardAction branch) reads
      // it back exactly the same way.
      columns(
        vocActionButton("确认拉群协同", "voc_open_war_room", record.recordId),
        vocActionButton("暂不需要", "voc_decline_war_room", record.recordId),
      ),
    ],
  });
}

export function createVocTicketCard(
  record: VocTicketCardRecord,
  tag: VocTicketCardTag,
  options: Readonly<{ fullContent?: boolean }> = {},
): FeishuCard {
  const completed = record.state === "已闭环";
  const next = NEXT_VOC_ACTION[record.state];
  // Default (and every existing call site) keeps truncating: the single-chat
  // card this function has always produced must stay byte-for-byte unchanged.
  // Only the in-group war room card (Task 6) opts into the untruncated text —
  // everyone in that group was deliberately added to work the ticket, and a
  // truncated complaint is one they cannot act on.
  const content = options.fullContent ? record.content : truncateContent(record.content);

  return cardRoot({
    title: "VOC 工单",
    subtitle: `${record.channel} · ${record.category}`,
    completed,
    status: record.state,
    statusColor: STATUS_COLOR_BY_STATE[record.state],
    template: completed ? "green" : "orange",
    icon: "todo_colorful",
    elements: [
      detailBlock(tag.summary || content, [
        ["记录编号", record.recordNumber || "—"],
        ["渠道", record.channel],
        ["产品品类", record.category],
        ["反馈时间", record.feedbackAt ?? "—"],
      ]),
      field("原始反馈", content),
      field("情绪极性", tag.polarity),
      field(
        "问题维度",
        tag.dimensions.length > 0 ? tag.dimensions.join("、") : "—",
      ),
      field("严重度", record.severity ?? "—"),
      ...(tag.replies.length > 0
        ? [field("AI 回复话术建议", repliesText(tag.replies))]
        : []),
      // A form container "不可被内嵌在其它组件内，只可放在卡片根节点下", so the
      // note form goes straight into body.elements while the note-free action
      // keeps its column_set wrapper.
      ...(next
        ? next.note
          ? [
              noteForm(
                next.note.label,
                next.note.placeholder,
                next.label,
                next.action,
                record.recordId,
              ),
            ]
          : [columns(vocActionButton(next.label, next.action, record.recordId))]
        : [note("当前状态无需操作。")]),
    ],
  });
}

// The outbound-message wrapper for the ticket card, mirroring
// createCardMessage's role for the demo views. It exists so the shard job can
// hand a ready-to-send message to whatever delivers it, keeping the card's
// JSON shape a concern of this file alone.
export function createVocTicketMessage(
  record: VocTicketCardRecord,
  tag: VocTicketCardTag,
): FeishuOutboundMessage {
  return {
    msgType: "interactive",
    content: JSON.stringify(createVocTicketCard(record, tag)),
  };
}
