import { describe, expect, it } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import type { TagResult } from "../tagging/contracts";
import type { OperatorSummary } from "./operator-summary";
import type { TodayOverviewCounts, TodayOverviewResult } from "./today-overview";
import {
  ONECARE_CARD_ACTIONS,
  ONECARE_CASE_ID,
  VOC_NOTE_FIELD_NAME,
  VOC_NOTE_FORM_NAME,
  VOC_NOTE_MAX_LENGTH,
  VOC_NOTE_SUBMIT_NAME,
  type OneCareCardView,
  type VocCardAction,
} from "./card-types";
import {
  createCardMessage,
  createMenuHintMessage,
  createOperatorSummaryCard,
  createOperatorSummaryMessage,
  createTextMessage,
  createTodayOverviewCard,
  createTodayOverviewMessage,
  createEngineerTaskCard,
  createNotificationCard,
  createProfileInsightCard,
  createVocTicketCard,
  createVocTicketMessage,
  createWarRoomEscalationCard,
  createWelcomeMessage,
  VOC_TICKET_CONTENT_LIMIT,
} from "./cards";

const views: readonly OneCareCardView[] = [
  "workbench",
  "operations",
  "pending",
  "ticket",
  "progress",
  "tasks",
  "diagnosis",
  "result",
];

function collectTaggedValues(value: unknown, tag: string): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTaggedValues(item, tag));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  return [
    ...(record.tag === tag ? [record] : []),
    ...Object.values(record).flatMap((item) =>
      collectTaggedValues(item, tag),
    ),
  ];
}

describe("OneCare Feishu Card 2.0 builders", () => {
  it.each(views)("builds the %s view as an interactive Card 2.0", (view) => {
    const message = createCardMessage(view);
    const card = JSON.parse(message.content) as Record<string, unknown>;

    expect(message.msgType).toBe("interactive");
    expect(card.schema).toBe("2.0");
    expect((card.config as Record<string, unknown>).width_mode).toBe("default");
    expect(card.header).toBeTruthy();
    expect(card.body).toBeTruthy();
    expect(message.content).toContain("演示");
    expect(collectTaggedValues(card, "hr")).toEqual([]);
    expect(
      ((card.body as Record<string, unknown>).elements as unknown[]).length,
    ).toBeLessThanOrEqual(5);
    expect(
      ((card.header as Record<string, unknown>).text_tag_list as unknown[])
        .length,
    ).toBeGreaterThan(0);
    expect(
      (collectTaggedValues(card, "button") as Array<Record<string, unknown>>)
        .filter((button) => button.type === "primary_filled").length,
    ).toBeLessThanOrEqual(1);
  });

  it("uses only allowlisted callback actions with the fixed demo case", () => {
    const behaviors = views.flatMap((view) => {
      const card = JSON.parse(createCardMessage(view).content) as unknown;
      return collectTaggedValues(card, "button").flatMap((button) => {
        const buttonRecord = button as Record<string, unknown>;
        return Array.isArray(buttonRecord.behaviors)
          ? buttonRecord.behaviors
          : [];
      });
    });

    for (const behavior of behaviors) {
      const record = behavior as Record<string, unknown>;
      if (record.type !== "callback") continue;

      const value = record.value as Record<string, unknown>;
      expect(ONECARE_CARD_ACTIONS).toContain(value.action);
      expect(value.case_id).toBe(ONECARE_CASE_ID);
    }
  });

  it("uses open_url only for the website demo button", () => {
    const card = JSON.parse(createCardMessage("workbench").content) as unknown;
    const buttons = collectTaggedValues(card, "button") as Array<
      Record<string, unknown>
    >;
    const openUrlBehaviors = buttons.flatMap((button) =>
      (button.behaviors as Array<Record<string, unknown>>).filter(
        (behavior) => behavior.type === "open_url",
      ),
    );

    expect(openUrlBehaviors).toEqual([
      expect.objectContaining({
        type: "open_url",
        default_url: "https://onecare.ohmyfeishu.top/",
      }),
    ]);
  });

  it.each([
    ["workbench", ["open_pending", "open_tasks", "open_operations"]],
    ["pending", ["create_ticket", "open_diagnosis"]],
    ["ticket", ["create_ticket", "open_progress", "open_tasks"]],
    ["progress", ["open_tasks", "open_operations"]],
    ["tasks", ["open_diagnosis", "open_result"]],
    ["diagnosis", ["confirm_parts", "open_tasks"]],
    ["result", ["submit_result", "open_operations"]],
    ["operations", ["open_progress"]],
  ] as const)("exposes the approved %s card actions", (view, expectedActions) => {
    const card = JSON.parse(createCardMessage(view).content) as unknown;
    const actualActions = collectTaggedValues(card, "button").flatMap(
      (button) => {
        const behaviors = (button as Record<string, unknown>).behaviors;
        if (!Array.isArray(behaviors)) return [];
        return behaviors.flatMap((behavior) => {
          const record = behavior as Record<string, unknown>;
          if (record.type !== "callback") return [];
          return [(record.value as Record<string, unknown>).action];
        });
      },
    );

    expect(actualActions).toEqual(expectedActions);
  });

  it.each([
    ["ticket", "创建完成"],
    ["diagnosis", "配件已确认"],
    ["result", "结果已提交"],
  ] as const)("renders a completed %s card with a disabled action", (view, label) => {
    const card = JSON.parse(createCardMessage(view, "completed").content);
    const buttons = collectTaggedValues(card, "button") as Array<
      Record<string, unknown>
    >;

    expect(card.header.template).toBe("green");
    expect(buttons).toContainEqual(
      expect.objectContaining({
        disabled: true,
        text: expect.objectContaining({ content: label }),
      }),
    );
  });

  it("uses the workbench as the welcome card", () => {
    expect(createWelcomeMessage()).toEqual(createCardMessage("workbench"));
  });
});

function vocRecord(overrides: Partial<VocRecord> = {}): VocRecord {
  return {
    recordId: "rec1",
    recordNumber: "VOC-0001",
    channel: "电商评价",
    category: "冰箱",
    model: "BCD-525WNK1PU",
    content: "冷藏室温度持续偏高，用户已联系三次",
    rating: 2,
    feedbackAt: "2026-01-20T00:00:00.000Z",
    state: "待跟进",
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "用户反馈冷藏室温度持续偏高，等待维修三天未解决",
    replies: [{ tone: "安抚", text: "非常抱歉给您带来不便" }],
    severity: "中",
    ownerOpenIds: ["ou_owner"],
    ownerNames: [],
    retryCount: 0,
    ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    closedAt: null,
    warRoomChatId: "",
    engineerOpenIds: [],
    engineerNames: [],
    dispatchedAt: null,
    followUpNote: "",
    closingNote: "",
    sourceTicketNo: "CAS-42567239-Q7Q8Q",
    userRef: "U-3878645B",
    deviceRef: "D-91C2A70E",
    sourceUrl: "",
    sourceDetail: "400投诉",
    businessUnit: "冰冷事业部",
    categoryLevel1: "安装调试",
    ...overrides,
  };
}

function tagResult(overrides: Partial<TagResult> = {}): TagResult {
  return {
    recordId: "rec1",
    sentiment: ["失望"],
    polarity: "差评",
    dimensions: ["维修时间"],
    summary: "用户反馈冷藏室温度持续偏高，等待维修三天未解决",
    replies: [{ tone: "安抚", text: "非常抱歉给您带来不便" }],
    ...overrides,
  };
}

describe("createVocTicketCard", () => {
  it("is a real Card 2.0 payload that surfaces the record and the AI summary", () => {
    const card = createVocTicketCard(vocRecord(), tagResult());

    expect(card.schema).toBe("2.0");
    expect(JSON.stringify(card)).toContain("电商评价");
    expect(JSON.stringify(card)).toContain("冰箱");
    expect(JSON.stringify(card)).toContain("冷藏室温度持续偏高，用户已联系三次");
    expect(JSON.stringify(card)).toContain("用户反馈冷藏室温度持续偏高，等待维修三天未解决");
  });

  // Spec §6.1 lists 记录编号、反馈时间、严重度 alongside 渠道/品类 as required
  // card content; field-map.ts didn't expose them until this task.
  it("renders 记录编号, 反馈时间 and 严重度 from the record", () => {
    const card = createVocTicketCard(
      vocRecord({
        recordNumber: "VOC-0042",
        feedbackAt: "2026-01-20T00:00:00.000Z",
        severity: "高",
      }),
      tagResult(),
    );
    const json = JSON.stringify(card);

    expect(json).toContain("VOC-0042");
    expect(json).toContain("2026-01-20T00:00:00.000Z");
    expect(json).toContain("高");
  });

  it("falls back to a placeholder when 记录编号/反馈时间/严重度 are unset", () => {
    expect(() =>
      createVocTicketCard(
        vocRecord({ recordNumber: "", feedbackAt: null, severity: null }),
        tagResult(),
      ),
    ).not.toThrow();
  });

  it.each([
    ["待跟进", "开始跟进", "voc_start_follow_up"],
    ["跟进中", "提交跟进结果", "voc_submit_follow_up"],
    ["待闭环", "确认闭环", "voc_confirm_closure"],
  ] satisfies ReadonlyArray<readonly [VocRecord["state"], string, VocCardAction]>)(
    "addresses the specific record instead of the fixed demo case for %s",
    (state, label, action) => {
      const record = vocRecord({ state });
      const card = createVocTicketCard(record, tagResult());

      const buttons = collectTaggedValues(card, "button") as Array<
        Record<string, unknown>
      >;
      const behaviors = buttons.flatMap((button) =>
        Array.isArray(button.behaviors) ? button.behaviors : [],
      ) as Array<Record<string, unknown>>;
      const callback = behaviors.find(
        (behavior) => behavior.type === "callback",
      );

      expect(callback?.value).toEqual({ action, record_id: record.recordId });
      expect(JSON.stringify(card)).not.toContain(ONECARE_CASE_ID);
      expect(JSON.stringify(card)).toContain(label);
    },
  );

  it("shows no action button once the ticket is already closed", () => {
    const card = createVocTicketCard(
      vocRecord({ state: "已闭环", closedAt: "2026-01-24T00:00:00.000Z" }),
      tagResult(),
    );

    const buttons = collectTaggedValues(card, "button") as Array<
      Record<string, unknown>
    >;
    const callbacks = buttons.flatMap((button) =>
      Array.isArray(button.behaviors) ? button.behaviors : [],
    ) as Array<Record<string, unknown>>;

    expect(callbacks.filter((behavior) => behavior.type === "callback")).toEqual(
      [],
    );
    expect((card.header as Record<string, unknown>).template).toBe("green");
  });

  it("truncates 原始内容 beyond the limit and drops the tail", () => {
    const head = "反".repeat(VOC_TICKET_CONTENT_LIMIT);
    const content = `${head}TAIL_MARKER`;

    const card = createVocTicketCard(vocRecord({ content }), tagResult());
    const json = JSON.stringify(card);

    expect(json).not.toContain("TAIL_MARKER");
    expect(json).toContain(`${head}…`);
  });

  it("does not add an ellipsis when 原始内容 is exactly at the limit", () => {
    const content = "反".repeat(VOC_TICKET_CONTENT_LIMIT);

    const card = createVocTicketCard(vocRecord({ content }), tagResult());
    const json = JSON.stringify(card);

    expect(json).toContain(content);
    expect(json).not.toContain("…");
  });

  it("renders short 原始内容 unchanged", () => {
    const card = createVocTicketCard(
      vocRecord({ content: "太短了" }),
      tagResult(),
    );
    const json = JSON.stringify(card);

    expect(json).toContain("太短了");
    expect(json).not.toContain("…");
  });

  it("does not throw when 原始内容 is empty", () => {
    expect(() =>
      createVocTicketCard(vocRecord({ content: "" }), tagResult()),
    ).not.toThrow();
  });

  it("truncates on a code point boundary instead of splitting a surrogate pair", () => {
    // "😀" sits outside the Basic Multilingual Plane and is two UTF-16 code
    // units. Landing the cut exactly between them (as content.slice(0, 200)
    // would for this input) leaves a lone surrogate, which becomes mojibake
    // once re-encoded as UTF-8 for the Feishu API.
    const content = `${"a".repeat(199)}😀TAIL`;
    const json = JSON.stringify(
      createVocTicketCard(vocRecord({ content }), tagResult()),
    );
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

    expect(json).not.toContain("TAIL");
    expect(loneSurrogate.test(json)).toBe(false);
  });

  it("renders 情绪极性 from the tag result", () => {
    const card = createVocTicketCard(vocRecord(), tagResult({ polarity: "中评" }));

    expect(JSON.stringify(card)).toContain("中评");
  });

  it("renders every AI reply with its tone label", () => {
    const card = createVocTicketCard(
      vocRecord(),
      tagResult({
        replies: [
          { tone: "安抚", text: "非常抱歉给您带来不便" },
          { tone: "解决方案", text: "我们将在24小时内安排工程师上门" },
        ],
      }),
    );
    const json = JSON.stringify(card);

    expect(json).toContain("【安抚】非常抱歉给您带来不便");
    expect(json).toContain("【解决方案】我们将在24小时内安排工程师上门");
  });

  it("skips the AI reply block entirely when there are no replies", () => {
    const card = createVocTicketCard(vocRecord(), tagResult({ replies: [] }));
    const json = JSON.stringify(card);

    expect(json).not.toContain("AI 回复话术建议");
  });
});

// Before this, the two actions the state machine guards on non-empty text were
// offered as bare buttons: the owner had no control to type into, so
// 提交跟进结果 and 确认闭环 were rejected 100% of the time by a guard the card
// gave them no way to satisfy.
describe("createVocTicketCard note form", () => {
  function form(card: Record<string, unknown>): Record<string, unknown> | null {
    const body = card.body as Record<string, unknown>;
    const elements = body.elements as Array<Record<string, unknown>>;
    return elements.find((element) => element.tag === "form") ?? null;
  }

  it.each([
    ["跟进中", "voc_submit_follow_up", "提交跟进结果", "跟进记录"],
    ["待闭环", "voc_confirm_closure", "确认闭环", "闭环结论"],
  ] satisfies ReadonlyArray<
    readonly [VocRecord["state"], VocCardAction, string, string]
  >)(
    "gives the %s card a form whose input feeds %s",
    (state, action, submitLabel, noteLabel) => {
      const card = createVocTicketCard(vocRecord({ state }), tagResult());
      const container = form(card);

      // A form container "不可被内嵌在其它组件内，只可放在卡片根节点下" — nesting
      // it inside a column_set would stop it rendering at all.
      expect(container).not.toBeNull();
      expect(container?.name).toBe(VOC_NOTE_FORM_NAME);

      const elements = container?.elements as Array<Record<string, unknown>>;
      const input = elements.find((element) => element.tag === "input");
      const button = elements.find((element) => element.tag === "button");

      // Feishu keys action.form_value by each component's `name`, so this is
      // the one string the event parser has to agree on.
      expect(input?.name).toBe(VOC_NOTE_FIELD_NAME);
      expect(input?.input_type).toBe("multiline_text");
      expect(input?.required).toBe(true);
      expect(input?.max_length).toBe(VOC_NOTE_MAX_LENGTH);
      expect((input?.label as Record<string, unknown>).content).toBe(noteLabel);

      // Both `name` and `form_action_type` are required on a button inside a
      // form container; without form_action_type the click never submits the
      // input's value.
      expect(button?.name).toBe(VOC_NOTE_SUBMIT_NAME);
      expect(button?.form_action_type).toBe("submit");
      expect((button?.text as Record<string, unknown>).content).toBe(
        submitLabel,
      );
      expect(button?.behaviors).toEqual([
        { type: "callback", value: { action, record_id: "rec1" } },
      ]);
    },
  );

  it("keeps 开始跟进 a plain button, since it carries no text", () => {
    const card = createVocTicketCard(vocRecord({ state: "待跟进" }), tagResult());

    expect(form(card)).toBeNull();
    expect(JSON.stringify(card)).toContain("voc_start_follow_up");
  });

  it("offers no form once the ticket is closed", () => {
    const card = createVocTicketCard(vocRecord({ state: "已闭环" }), tagResult());

    expect(form(card)).toBeNull();
  });

  it("never exceeds the platform's 1000 character input ceiling", () => {
    expect(VOC_NOTE_MAX_LENGTH).toBeLessThanOrEqual(1000);
    expect(VOC_NOTE_MAX_LENGTH).toBeGreaterThanOrEqual(1);
  });
});

describe("createVocTicketMessage", () => {
  it("wraps the ticket card as an interactive outbound message", () => {
    const message = createVocTicketMessage(vocRecord(), tagResult());

    expect(message.msgType).toBe("interactive");
    expect(JSON.parse(message.content)).toEqual(
      createVocTicketCard(vocRecord(), tagResult()),
    );
  });
});

// Two cards, two deliberately different disclosure levels for the same
// underlying record and tag: the escalation card goes to one approver
// deciding whether to open a group at all, and the in-group ticket card goes
// to whoever was deliberately added to that group to work the ticket.
const ticketRecord = vocRecord();
const ticketTag = tagResult();

describe("createWarRoomEscalationCard", () => {
  it("keeps the raw complaint out of the escalation card", () => {
    const card = createWarRoomEscalationCard(
      { ...ticketRecord, content: "报修后等了三天没人上门" },
      ticketTag,
      ["张三"],
    );
    const json = JSON.stringify(card);

    // The escalation card is a notification sent to one approver. The complaint
    // itself belongs in the group, after people have been deliberately added —
    // one less surface carrying a customer's words.
    expect(json).not.toContain("报修后等了三天没人上门");
    expect(json).toContain("张三");
    expect(json).toContain("voc_open_war_room");
    expect(json).toContain("voc_decline_war_room");
  });
});

describe("createVocTicketCard fullContent option", () => {
  it("renders the full complaint on the in-group ticket card", () => {
    const long = "投".repeat(400);
    const json = JSON.stringify(createVocTicketCard({ ...ticketRecord, content: long }, ticketTag, { fullContent: true }));

    // Everyone in the group was deliberately added to work this ticket; a
    // truncated complaint is one they cannot act on.
    expect(json).toContain(long);
  });

  it("still truncates by default so the single-chat card is unchanged", () => {
    const long = "投".repeat(400);
    const json = JSON.stringify(createVocTicketCard({ ...ticketRecord, content: long }, ticketTag));

    expect(json).not.toContain(long);
  });
});

describe("createTextMessage", () => {
  it("wraps the text as a plain chat message, not a card", () => {
    const message = createTextMessage("这条投诉本周同维度还有 12 条。");

    expect(message.msgType).toBe("text");
    expect(JSON.parse(message.content)).toEqual({
      text: "这条投诉本周同维度还有 12 条。",
    });
  });
});

function operatorSummary(overrides: Partial<OperatorSummary> = {}): OperatorSummary {
  return {
    myPendingFollowUp: 3,
    myInProgress: 2,
    myPendingClosure: 1,
    total: 3628,
    ...overrides,
  };
}

// Task 12: replaces the demo command menu (createBotReply) as what a p2p
// text message gets back. Unlike every demo view above, this card must never
// carry the demo case id, the word "演示", or a "not real data" disclaimer —
// the whole point of sending it is that the numbers on it are real.
//
// Task 14: myOverdue and newToday are gone from OperatorSummary (and so from
// this card) — both needed a full record's timestamp fields, and this card's
// data source switched from a ~10.7s full-table scan to four concurrent
// records/search counts that never read a record body at all (see
// operator-summary.ts's own comment for the measured numbers).
describe("createOperatorSummaryCard", () => {
  it("is a real Card 2.0 payload with no demo markers at all", () => {
    const card = createOperatorSummaryCard(operatorSummary());
    const json = JSON.stringify(card);

    expect(card.schema).toBe("2.0");
    expect(json).not.toContain("演示");
    expect(json).not.toContain(ONECARE_CASE_ID);
    expect(json).toContain("万护 OneCare 服务运营");
  });

  // Task 14: neither this card nor createTodayOverviewCard may use a
  // "_colorful" icon token — the user verified against Feishu's own icon
  // documentation that every valid standard_icon token ends in "_outlined",
  // and "chart_colorful" (this card's icon before this task) is not
  // documented at all, which is why it rendered as a broken placeholder in
  // production. Rather than guess at an unverified "_outlined" replacement,
  // this card renders with no icon at all — cardRoot's `icon` is optional,
  // and an absent icon is not a rendering risk the way an invalid token is.
  it("carries no _colorful icon token anywhere in the card", () => {
    const json = JSON.stringify(createOperatorSummaryCard(operatorSummary()));
    expect(json).not.toContain("_colorful");
    expect(JSON.stringify(createOperatorSummaryCard(null))).not.toContain("_colorful");
  });

  it("renders each of the operator's own counts and the shop-wide total", () => {
    const json = JSON.stringify(
      createOperatorSummaryCard(
        operatorSummary({
          myPendingFollowUp: 11,
          myInProgress: 22,
          myPendingClosure: 33,
          total: 3628,
        }),
      ),
    );

    expect(json).toContain("我的待跟进");
    expect(json).toContain("11 条");
    expect(json).toContain("我的跟进中");
    expect(json).toContain("22 条");
    expect(json).toContain("我的待闭环");
    expect(json).toContain("33 条");
    expect(json).toContain("全部反馈总量");
    expect(json).toContain("3628 条");
  });

  it("links the workbench button to the real operations site", () => {
    const card = createOperatorSummaryCard(operatorSummary());
    const buttons = collectTaggedValues(card, "button") as Array<
      Record<string, unknown>
    >;
    const openUrlBehaviors = buttons.flatMap((button) =>
      (button.behaviors as Array<Record<string, unknown>>).filter(
        (behavior) => behavior.type === "open_url",
      ),
    );

    expect(openUrlBehaviors).toEqual([
      expect.objectContaining({
        type: "open_url",
        default_url: "https://onecare.ohmyfeishu.top/enter",
      }),
    ]);
    expect(
      buttons.some(
        (button) =>
          (button.text as Record<string, unknown>).content === "打开运营工作台",
      ),
    ).toBe(true);
  });

  // The project-wide rule readVocRecordsCached itself states: a failed read
  // must never render as a number (0 or otherwise) a reader could mistake
  // for a real measurement. This checks it at the strongest level available —
  // not one label at a time, but that the card's entire content area (not its
  // padding/spacing chrome, which is boilerplate on every card regardless of
  // data) carries no digit character whatsoever.
  it("shows no numbers at all when the read failed, only an unavailable notice", () => {
    const card = createOperatorSummaryCard(null);
    const elementsJson = JSON.stringify(
      (card.body as Record<string, unknown>).elements,
    );

    expect(elementsJson).not.toMatch(/[0-9]/);
    expect(elementsJson).toContain("暂不可用");
    expect(JSON.stringify(card)).not.toContain("演示");
  });

  it("still offers the workbench button when the read failed", () => {
    const card = createOperatorSummaryCard(null);
    const buttons = collectTaggedValues(card, "button") as Array<
      Record<string, unknown>
    >;

    expect(
      buttons.some(
        (button) =>
          (button.text as Record<string, unknown>).content === "打开运营工作台",
      ),
    ).toBe(true);
  });
});

describe("createOperatorSummaryMessage", () => {
  it("wraps the operator summary card as an interactive outbound message", () => {
    const message = createOperatorSummaryMessage(operatorSummary());

    expect(message.msgType).toBe("interactive");
    expect(JSON.parse(message.content)).toEqual(
      createOperatorSummaryCard(operatorSummary()),
    );
  });
});

// Task 13 built this against getVocDashboardMetrics's full VocMetricsResult;
// Task 14 replaced the read behind it with readTodayOverviewCounts's
// counts-only TodayOverviewResult (see today-overview.ts) — a ~10.7s
// full-table aggregation traded for five concurrent, ~1.0s-each
// records/search counts. Only the four numbers a count can answer directly
// survive on the card: 反馈总量 (an unfiltered total), 已建单 and 已闭环 (each a
// state-filtered count), and 闭环率 (their ratio). negativeShare,
// averageClosureHours, 打标覆盖率 and 问题维度 Top all needed the full record
// set in memory and are gone from this card entirely — the brief's own
// reasoning is that a menu card's value is a number in three seconds, not a
// second copy of the dashboard; the workbench button (kept) is where those
// live now, alongside a one-line pointer saying so.
function todayOverviewCounts(
  overrides: Partial<TodayOverviewCounts> = {},
): TodayOverviewCounts {
  return {
    total: 120,
    ticketsOpened: 80,
    ticketsClosed: 60,
    closureRate: 0.75,
    ...overrides,
  };
}

describe("createTodayOverviewCard", () => {
  it("is a real Card 2.0 payload with no demo markers at all", () => {
    const card = createTodayOverviewCard({ status: "ok", counts: todayOverviewCounts() });
    const json = JSON.stringify(card);

    expect(card.schema).toBe("2.0");
    expect(json).not.toContain("演示");
    expect(json).not.toContain(ONECARE_CASE_ID);
    expect(json).toContain("今日概览");
  });

  // Same rule and reasoning as createOperatorSummaryCard's equivalent test:
  // "chart_colorful" (this card's icon before this task) is not a documented
  // token, so this card now renders with no icon at all rather than guessing
  // at an unverified "_outlined" replacement.
  it("carries no _colorful icon token anywhere in the card", () => {
    const okJson = JSON.stringify(
      createTodayOverviewCard({ status: "ok", counts: todayOverviewCounts() }),
    );
    const unavailableJson = JSON.stringify(
      createTodayOverviewCard({ status: "unavailable" }),
    );

    expect(okJson).not.toContain("_colorful");
    expect(unavailableJson).not.toContain("_colorful");
  });

  it("renders every count-derived metric, each traceable to a TodayOverviewCounts field", () => {
    const json = JSON.stringify(
      createTodayOverviewCard({
        status: "ok",
        counts: todayOverviewCounts({
          total: 3628,
          ticketsOpened: 900,
          ticketsClosed: 540,
          closureRate: 0.6,
        }),
      }),
    );

    expect(json).toContain("反馈总量");
    expect(json).toContain("3628");
    expect(json).toContain("已建单");
    expect(json).toContain("900");
    expect(json).toContain("已闭环");
    expect(json).toContain("540");
    expect(json).toContain("闭环率");
    expect(json).toContain("60%");
  });

  // The metrics this card no longer computes must not silently reappear —
  // there is no field on TodayOverviewCounts to render them from any more.
  it("no longer renders the metrics that need a full-table aggregation", () => {
    const json = JSON.stringify(
      createTodayOverviewCard({ status: "ok", counts: todayOverviewCounts() }),
    );

    expect(json).not.toContain("负向占比");
    expect(json).not.toContain("平均闭环时长");
    expect(json).not.toContain("打标覆盖率");
    expect(json).not.toContain("问题维度");
  });

  // The brief's explicit requirement: what got dropped from the card must be
  // pointed at, not just silently missing.
  it("tells the reader the full metrics live on the operations workbench", () => {
    const json = JSON.stringify(
      createTodayOverviewCard({ status: "ok", counts: todayOverviewCounts() }),
    );

    expect(json).toContain("完整指标见运营工作台");
  });

  it("links the workbench button to the real operations site", () => {
    const card = createTodayOverviewCard({ status: "ok", counts: todayOverviewCounts() });
    const buttons = collectTaggedValues(card, "button") as Array<
      Record<string, unknown>
    >;
    const openUrlBehaviors = buttons.flatMap((button) =>
      (button.behaviors as Array<Record<string, unknown>>).filter(
        (behavior) => behavior.type === "open_url",
      ),
    );

    expect(openUrlBehaviors).toEqual([
      expect.objectContaining({
        type: "open_url",
        default_url: "https://onecare.ohmyfeishu.top/enter",
      }),
    ]);
  });

  // The project-wide rule stated on readVocRecordsCached itself: a failed
  // read must never render as a number (0 or otherwise) a reader could
  // mistake for a real measurement. Checked at the strongest level available,
  // exactly like createOperatorSummaryCard's own equivalent test — the
  // card's entire content area carries no digit character whatsoever.
  it("shows no numbers at all when the counts are unavailable, only an unavailable notice", () => {
    const card = createTodayOverviewCard({ status: "unavailable" });
    const elementsJson = JSON.stringify(
      (card.body as Record<string, unknown>).elements,
    );

    expect(elementsJson).not.toMatch(/[0-9]/);
    expect(elementsJson).toContain("指标暂不可用");
    expect(JSON.stringify(card)).not.toContain("演示");
  });

  it("still offers the workbench button when the counts are unavailable", () => {
    const card = createTodayOverviewCard({ status: "unavailable" });
    const buttons = collectTaggedValues(card, "button") as Array<
      Record<string, unknown>
    >;

    expect(
      buttons.some(
        (button) =>
          (button.text as Record<string, unknown>).content === "打开运营工作台",
      ),
    ).toBe(true);
  });
});

describe("createTodayOverviewMessage", () => {
  it("wraps the today-overview card as an interactive outbound message", () => {
    const result: TodayOverviewResult = { status: "ok", counts: todayOverviewCounts() };
    const message = createTodayOverviewMessage(result);

    expect(message.msgType).toBe("interactive");
    expect(JSON.parse(message.content)).toEqual(createTodayOverviewCard(result));
  });
});

// Task 13: what a bare p2p text message gets back now, in place of the real
// operator card (createOperatorSummaryMessage) — the custom menu is the
// intended way to ask for real numbers, so this must be plain text, never
// another card.
describe("createMenuHintMessage", () => {
  it("is a plain text message, not a card, pointing at the menu and the war room", () => {
    const message = createMenuHintMessage();

    expect(message.msgType).toBe("text");
    const text = (JSON.parse(message.content) as { text: string }).text;
    expect(text).toContain("菜单");
    expect(text).toContain("我的工单");
    expect(text).toContain("今日概览");
    expect(text).toContain("@");
  });
});

describe("production cards carry no unverified icon token", () => {
  // Feishu's icon library documents only tokens ending in "_outlined"; every
  // "_colorful" token this file once used renders as a broken-image
  // placeholder, which a user reported seeing on a real card. The demo cards
  // are unreachable so their tokens are left alone, but the four cards an
  // operator actually receives must not carry one — and must not acquire one
  // later, which is what this test is for.
  it.each([
    ["war room escalation", () => createWarRoomEscalationCard(ticketRecord, ticketTag, ["张三"])],
    ["in-group ticket", () => createVocTicketCard(ticketRecord, ticketTag, { fullContent: true })],
    ["closed ticket", () => createVocTicketCard({ ...ticketRecord, state: "已闭环" }, ticketTag)],
  ])("%s card", (_name, build) => {
    expect(JSON.stringify(build())).not.toContain("_colorful");
  });
});

// Every card this bot sends carries a door back into the console. A message that says
// something happened and leaves the reader to go find it is half a notification.
describe("every card opens the workbench", () => {
  function buttons(card: unknown): { text: string; url: string }[] {
    const found: { text: string; url: string }[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (typeof node !== "object" || node === null) return;
      const record = node as Record<string, unknown>;
      const behaviors = record.behaviors;
      if (record.tag === "button" && Array.isArray(behaviors)) {
        for (const behavior of behaviors) {
          const value = behavior as { type?: unknown; default_url?: unknown };
          if (value.type === "open_url" && typeof value.default_url === "string") {
            const text = record.text as { content?: unknown } | undefined;
            found.push({
              text: typeof text?.content === "string" ? text.content : "",
              url: value.default_url,
            });
          }
        }
      }
      for (const value of Object.values(record)) walk(value);
    };
    walk(card);
    return found;
  }

  const record = {
    recordId: "rec1",
    recordNumber: "VOC-a3cdc5",
    channel: "400 客服",
    category: "冰箱",
    content: "报修后等了三天没人上门",
    feedbackAt: "2026-08-14T04:00:00.000Z",
    state: "待跟进" as const,
    severity: "高" as const,
  };
  const tag = {
    summary: "用户反馈上门维修延迟三天",
    polarity: "差评",
    dimensions: ["维修时间"],
    replies: [],
  };

  it("puts the ticket link on a button, on the ticket card", () => {
    const links = buttons(createVocTicketCard(record, tag));
    expect(links).toContainEqual({
      text: "在工作台打开",
      url: "https://onecare.ohmyfeishu.top/workbench/tickets/VOC-a3cdc5",
    });
  });

  it("puts it on the escalation card too", () => {
    const links = buttons(createWarRoomEscalationCard(record, tag, ["黄齐"]));
    expect(links.some((link) => link.url.includes("VOC-a3cdc5"))).toBe(true);
  });

  it("puts it on the engineer's task card", () => {
    const links = buttons(
      createEngineerTaskCard({
        record,
        tag,
        dispatcherName: "张禹健",
        model: "BCD-525",
        userRef: "U-1",
        deviceRef: "D-1",
        deviceTotal: 7,
        deviceOpen: 2,
        recurrence: null,
      }),
    );
    expect(links.some((link) => link.url.includes("VOC-a3cdc5"))).toBe(true);
  });

  // The identity cards open the identity, not a ticket that does not exist.
  it("opens the device page from a device alert", () => {
    const links = buttons(
      createProfileInsightCard({
        kind: "device",
        id: "D-BE66CB3A",
        level: "高",
        headline: "7 次报修",
        labels: [],
        signals: [],
        actions: [],
        producedBy: "规则引擎",
        openTicketNumbers: [],
      }),
    );
    expect(links).toContainEqual({
      text: "打开设备页",
      url: "https://onecare.ohmyfeishu.top/?section=devices&device=D-BE66CB3A&queue=all",
    });
  });

  // Everything a card can do, it offers. 拉群 is the one action that is not a state
  // transition, so it appears on every live ticket regardless of where it is in the flow.
  it("offers 拉群处理 on a live ticket card and on the engineer's task card", () => {
    const live = JSON.stringify(createVocTicketCard(record, tag));
    expect(live).toContain("拉群处理");
    expect(live).toContain("voc_open_war_room");

    const task = JSON.stringify(
      createEngineerTaskCard({
        record,
        tag,
        dispatcherName: "张禹健",
        model: "BCD-525",
        userRef: "U-1",
        deviceRef: "D-1",
        deviceTotal: 7,
        deviceOpen: 2,
        recurrence: null,
      }),
    );
    expect(task).toContain("拉群处理");
  });

  // 设备预警 lands in a chat with a verdict on it; the move that verdict calls for is a
  // group, and it should not require leaving the card to find the button.
  it("offers 拉群处理 on the identity card, addressed by kind and id", () => {
    const card = JSON.stringify(
      createProfileInsightCard({
        kind: "device",
        id: "D-BE66CB3A",
        level: "高",
        headline: "7 次报修",
        labels: [],
        signals: [],
        actions: [],
        producedBy: "规则引擎",
        openTicketNumbers: [],
      }),
    );

    expect(card).toContain("voc_open_identity_war_room");
    expect(card).toContain("D-BE66CB3A");
    expect(card).toContain("identity_kind");
  });

  it("puts the link on a button on a notification card", () => {
    const links = buttons(
      createNotificationCard({
        title: "工单改派给你",
        body: "张禹健改派给你",
        subject: "VOC-a3cdc5",
        url: "https://onecare.ohmyfeishu.top/workbench/tickets/VOC-a3cdc5",
        buttonLabel: "打开工单",
      }),
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ text: "打开工单" });
  });
});
