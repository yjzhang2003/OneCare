import { describe, expect, it } from "vitest";

import type { VocRecord } from "../bitable/field-map";
import type { TagResult } from "../tagging/contracts";
import {
  ONECARE_CARD_ACTIONS,
  ONECARE_CASE_ID,
  type OneCareCardView,
  type VocCardAction,
} from "./card-types";
import {
  createCardMessage,
  createVocTicketCard,
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
    content: "冷藏室温度持续偏高，用户已联系三次",
    rating: 2,
    feedbackAt: "2026-01-20T00:00:00.000Z",
    state: "待跟进",
    polarity: "差评",
    dimensions: ["维修时间"],
    severity: "中",
    ownerOpenIds: ["ou_owner"],
    retryCount: 0,
    ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    closedAt: null,
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
