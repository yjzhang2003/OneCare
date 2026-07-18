import { describe, expect, it } from "vitest";

import {
  ONECARE_CARD_ACTIONS,
  ONECARE_CASE_ID,
  type OneCareCardView,
} from "./card-types";
import { createCardMessage, createWelcomeMessage } from "./cards";

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
