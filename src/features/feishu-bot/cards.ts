import type { VocRecord } from "../bitable/field-map";
import type { TagResult, VocReply } from "../tagging/contracts";
import type { VocState } from "../voc/service-event";
import {
  ONECARE_CASE_ID,
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
}>): FeishuCard {
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      summary: { content: `${input.title} · 万护 OneCare 演示` },
    },
    header: {
      title: { tag: "plain_text", content: input.title },
      subtitle: { tag: "plain_text", content: input.subtitle },
      template: input.completed ? "green" : (input.template ?? "turquoise"),
      icon: {
        tag: "standard_icon",
        token: input.completed ? "done_colorful" : (input.icon ?? "myai_colorful"),
      },
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

// Only the action that is actually legal from the record's current state is
// offered — the state machine (Task 2) is the single source of truth for
// what happens next, so the card must not invite a click that resolveVocCardAction
// (Task 12) is only going to reject.
const NEXT_VOC_ACTION: Readonly<
  Partial<Record<VocState, Readonly<{ label: string; action: VocCardAction }>>>
> = {
  待跟进: { label: "开始跟进", action: "voc_start_follow_up" },
  跟进中: { label: "提交跟进结果", action: "voc_submit_follow_up" },
  待闭环: { label: "确认闭环", action: "voc_confirm_closure" },
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

function truncateContent(content: string): string {
  return content.length > VOC_TICKET_CONTENT_LIMIT
    ? `${content.slice(0, VOC_TICKET_CONTENT_LIMIT)}…`
    : content;
}

// Mirrors the "【语气】正文" join format field-map.ts's toTagFieldUpdate uses
// when writing AI 回复话术 back to the Base, so the same reply set reads
// identically whether it's viewed in the sheet or on this card.
function repliesText(replies: readonly VocReply[]): string {
  return replies.map((reply) => `【${reply.tone}】${reply.text}`).join("\n\n");
}

export function createVocTicketCard(
  record: VocRecord,
  tag: TagResult,
): FeishuCard {
  const completed = record.state === "已闭环";
  const next = NEXT_VOC_ACTION[record.state];
  const content = truncateContent(record.content);

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
        ["渠道", record.channel],
        ["产品品类", record.category],
      ]),
      field("原始反馈", content),
      field("情绪极性", tag.polarity),
      field(
        "问题维度",
        tag.dimensions.length > 0 ? tag.dimensions.join("、") : "—",
      ),
      ...(tag.replies.length > 0
        ? [field("AI 回复话术建议", repliesText(tag.replies))]
        : []),
      ...(next
        ? [columns(vocActionButton(next.label, next.action, record.recordId))]
        : [note("当前状态无需操作。")]),
    ],
  });
}
