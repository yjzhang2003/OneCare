import { describe, expect, it } from "vitest";

import {
  VOC_FIELD_NAMES,
  parseReplyText,
  toTagFieldUpdate,
  toVocRecord,
} from "./field-map";

describe("toVocRecord", () => {
  it("unpacks single select, multi select and person fields", () => {
    const record = toVocRecord(
      {
        [VOC_FIELD_NAMES.recordNumber]: "VOC-0001",
        [VOC_FIELD_NAMES.feedbackAt]: 1769126400000,
        [VOC_FIELD_NAMES.channel]: "电商评价",
        [VOC_FIELD_NAMES.category]: "冰箱",
        [VOC_FIELD_NAMES.content]: "等了三天",
        [VOC_FIELD_NAMES.state]: "待跟进",
        [VOC_FIELD_NAMES.polarity]: "差评",
        [VOC_FIELD_NAMES.dimensions]: ["维修时间", "服务态度"],
        [VOC_FIELD_NAMES.severity]: "高",
        [VOC_FIELD_NAMES.owner]: [
          { email: "", en_name: "OneCare", id: "ou_owner", name: "OneCare" },
        ],
        [VOC_FIELD_NAMES.retryCount]: "1",
        [VOC_FIELD_NAMES.rating]: "2",
        [VOC_FIELD_NAMES.ticketOpenedAt]: 1769133600000,
      },
      "rec1",
    );

    expect(record).toMatchObject({
      recordId: "rec1",
      recordNumber: "VOC-0001",
      feedbackAt: "2026-01-23T00:00:00.000Z",
      channel: "电商评价",
      category: "冰箱",
      content: "等了三天",
      state: "待跟进",
      polarity: "差评",
      dimensions: ["维修时间", "服务态度"],
      severity: "高",
      ownerOpenIds: ["ou_owner"],
      retryCount: 1,
      rating: 2,
      ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    });
  });

  it("defaults recordNumber to an empty string when absent", () => {
    expect(toVocRecord({}, "rec1").recordNumber).toBe("");
  });

  it("defaults feedbackAt to null when absent", () => {
    expect(toVocRecord({}, "rec1").feedbackAt).toBeNull();
  });

  it("nulls a severity that is not in the 高/中/低 enum", () => {
    expect(
      toVocRecord({ [VOC_FIELD_NAMES.severity]: "紧急" }, "rec1").severity,
    ).toBeNull();
  });

  it("defaults severity to null when absent", () => {
    expect(toVocRecord({}, "rec1").severity).toBeNull();
  });

  // The next four tests encode calibration against the live Base on 2026-08-10.
  // Every one of them fails against a naive typeof-based unpacker, and none of
  // the failures are visible without real Bitable responses.
  it("reads a Number field that comes back as a string", () => {
    const record = toVocRecord(
      { [VOC_FIELD_NAMES.retryCount]: "3", [VOC_FIELD_NAMES.rating]: "5" },
      "rec1",
    );

    expect(record.retryCount).toBe(3);
    expect(record.rating).toBe(5);
  });

  it("reads a DateTime field that comes back as epoch milliseconds", () => {
    expect(
      toVocRecord({ [VOC_FIELD_NAMES.closedAt]: 1769220000000 }, "rec1").closedAt,
    ).toBe("2026-01-24T02:00:00.000Z");
  });

  it("reads a User field keyed by id rather than open_id", () => {
    expect(
      toVocRecord(
        {
          [VOC_FIELD_NAMES.owner]: [
            { email: "", en_name: "A", id: "ou_a", name: "A" },
            { email: "", en_name: "B", id: "ou_b", name: "B" },
          ],
        },
        "rec1",
      ).ownerOpenIds,
    ).toEqual(["ou_a", "ou_b"]);
  });

  it("ignores a User entry that carries open_id but no id", () => {
    expect(
      toVocRecord(
        { [VOC_FIELD_NAMES.owner]: [{ open_id: "ou_legacy" }] },
        "rec1",
      ).ownerOpenIds,
    ).toEqual([]);
  });

  it("nulls an unparseable date instead of inventing one", () => {
    expect(
      toVocRecord({ [VOC_FIELD_NAMES.closedAt]: "not a date" }, "rec1").closedAt,
    ).toBeNull();
  });

  it("defaults an unset state to 待分析 so untouched rows are pickable", () => {
    expect(toVocRecord({}, "rec1").state).toBe("待分析");
  });

  it("treats an unrecognised state as 待分析 rather than crashing", () => {
    expect(
      toVocRecord({ [VOC_FIELD_NAMES.state]: "手工乱填" }, "rec1").state,
    ).toBe("待分析");
  });

  it("nulls a polarity that is not in the enum", () => {
    expect(
      toVocRecord({ [VOC_FIELD_NAMES.polarity]: "negative" }, "rec1").polarity,
    ).toBeNull();
  });

  it("drops dimensions outside the enum instead of passing them through", () => {
    expect(
      toVocRecord(
        { [VOC_FIELD_NAMES.dimensions]: ["维修时间", "物流速度"] },
        "rec1",
      ).dimensions,
    ).toEqual(["维修时间"]);
  });

  it("defaults retry count to zero", () => {
    expect(toVocRecord({}, "rec1").retryCount).toBe(0);
  });

  // A card callback gets exactly one getRecord, so the re-rendered card can
  // only show what this decode returns. Without these two columns, clicking a
  // button silently stripped the AI summary and the reply suggestions — the
  // text the owner writes their follow-up note from — off the card.
  it("decodes the AI summary and reply suggestions for card re-rendering", () => {
    const record = toVocRecord(
      {
        [VOC_FIELD_NAMES.summary]: "等待三天未上门",
        [VOC_FIELD_NAMES.replies]:
          "【致歉安抚】非常抱歉\n\n【解决方案】明天安排上门",
      },
      "rec1",
    );

    expect(record.summary).toBe("等待三天未上门");
    expect(record.replies).toEqual([
      { tone: "致歉安抚", text: "非常抱歉" },
      { tone: "解决方案", text: "明天安排上门" },
    ]);
  });

  it("defaults the AI summary and replies to empty when the columns are unset", () => {
    const record = toVocRecord({}, "rec1");

    expect(record.summary).toBe("");
    expect(record.replies).toEqual([]);
  });

  // Round trip: whatever toTagFieldUpdate writes must read back unchanged, or
  // the card the owner sees after a click differs from the one the shard sent.
  it("round-trips the replies toTagFieldUpdate writes", () => {
    const replies = [
      { tone: "致歉安抚", text: "非常抱歉给您带来不便" },
      { tone: "解决方案", text: "我们将在 24 小时内安排工程师上门" },
    ];
    const written = toTagFieldUpdate(
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: ["维修时间"],
        summary: "等待三天",
        replies,
      },
      "中",
    );

    expect(
      toVocRecord(
        { [VOC_FIELD_NAMES.replies]: written[VOC_FIELD_NAMES.replies] },
        "rec1",
      ).replies,
    ).toEqual(replies);
  });

  // A malformed payload (deleted record, empty webhook retry body, a bad cast
  // upstream) must decode like an empty object instead of throwing — every
  // other branch in this file already answers "can't read this" with a
  // null/default, and the whole-`fields` case should not be the one exception
  // that crashes the sync loop.
  it("treats a null fields payload as empty instead of throwing", () => {
    const record = toVocRecord(null as never, "rec1");
    expect(record.state).toBe("待分析");
    expect(record.recordId).toBe("rec1");
  });

  it("treats an undefined fields payload as empty instead of throwing", () => {
    const record = toVocRecord(undefined as never, "rec1");
    expect(record.state).toBe("待分析");
    expect(record.recordId).toBe("rec1");
  });

  it("treats a string fields payload as empty instead of throwing", () => {
    const record = toVocRecord("notanobject" as never, "rec1");
    expect(record.state).toBe("待分析");
    expect(record.recordId).toBe("rec1");
  });

  it("treats a number fields payload as empty instead of throwing", () => {
    const record = toVocRecord(42 as never, "rec1");
    expect(record.state).toBe("待分析");
    expect(record.recordId).toBe("rec1");
  });

  it("treats an array fields payload as empty rather than valid fields", () => {
    const record = toVocRecord([] as never, "rec1");
    expect(record.state).toBe("待分析");
    expect(record.recordId).toBe("rec1");
  });

  describe("ownerNames", () => {
    it("reads the display name alongside the open id", () => {
      const record = toVocRecord(
        {
          [VOC_FIELD_NAMES.owner]: [
            { email: "", en_name: "A", id: "ou_a", name: "张三" },
            { email: "", en_name: "B", id: "ou_b", name: "李四" },
          ],
        },
        "rec1",
      );

      expect(record.ownerOpenIds).toEqual(["ou_a", "ou_b"]);
      expect(record.ownerNames).toEqual(["张三", "李四"]);
    });

    it("skips entries without a usable name but keeps their open id", () => {
      const record = toVocRecord(
        { [VOC_FIELD_NAMES.owner]: [{ id: "ou_a" }, { id: "ou_b", name: "李四" }] },
        "rec1",
      );

      expect(record.ownerOpenIds).toEqual(["ou_a", "ou_b"]);
      expect(record.ownerNames).toEqual(["李四"]);
    });

    it("returns an empty list when the field is unset", () => {
      expect(toVocRecord({}, "rec1").ownerNames).toEqual([]);
    });

    it("ignores a non-array people field", () => {
      expect(
        toVocRecord({ [VOC_FIELD_NAMES.owner]: "nope" }, "rec1").ownerNames,
      ).toEqual([]);
    });

    it("ignores a whitespace-only name", () => {
      expect(
        toVocRecord(
          { [VOC_FIELD_NAMES.owner]: [{ id: "ou_a", name: "   " }] },
          "rec1",
        ).ownerNames,
      ).toEqual([]);
    });
  });
});

describe("toTagFieldUpdate", () => {
  it("writes AI columns plus the repo-computed severity", () => {
    const update = toTagFieldUpdate(
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: ["维修时间"],
        summary: "等待三天",
        replies: [{ tone: "致歉安抚", text: "抱歉" }],
      },
      "高",
    );

    expect(update[VOC_FIELD_NAMES.polarity]).toBe("差评");
    expect(update[VOC_FIELD_NAMES.dimensions]).toEqual(["维修时间"]);
    expect(update[VOC_FIELD_NAMES.sentiment]).toEqual(["失望"]);
    expect(update[VOC_FIELD_NAMES.summary]).toBe("等待三天");
    expect(update[VOC_FIELD_NAMES.severity]).toBe("高");
    expect(update[VOC_FIELD_NAMES.replies]).toContain("致歉安抚");
  });

  it("writes an empty string for empty replies by default (no options passed)", () => {
    const update = toTagFieldUpdate(
      {
        recordId: "rec1",
        sentiment: ["满意"],
        polarity: "好评",
        dimensions: [],
        summary: "上门很快",
        replies: [],
      },
      "低",
    );

    expect(update).toHaveProperty(VOC_FIELD_NAMES.replies, "");
  });

  // I6: the field-shortcut track re-parses whatever prose Bitable's own AI
  // field shortcut already wrote into AI 回复话术 (via parseReplyText,
  // upstream of this function). A cell that does not match the "【语气】正文"
  // shape parses to an empty replies array — but the cell itself is not
  // empty. Re-serializing that empty array and writing it back would replace
  // the AI's real output with "". omitEmptyReplies lets a caller that knows
  // it is re-serializing a *re-parsed* column (as opposed to a freshly
  // generated one) skip the write entirely rather than clobber it.
  it("omits the replies key when omitEmptyReplies is set and replies is empty", () => {
    const update = toTagFieldUpdate(
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: ["维修时间"],
        summary: "等待三天",
        replies: [],
      },
      "中",
      { omitEmptyReplies: true },
    );

    expect(update).not.toHaveProperty(VOC_FIELD_NAMES.replies);
  });

  it("still writes the replies key when omitEmptyReplies is set but replies is non-empty", () => {
    const update = toTagFieldUpdate(
      {
        recordId: "rec1",
        sentiment: ["失望"],
        polarity: "差评",
        dimensions: ["维修时间"],
        summary: "等待三天",
        replies: [{ tone: "致歉安抚", text: "抱歉" }],
      },
      "中",
      { omitEmptyReplies: true },
    );

    expect(update[VOC_FIELD_NAMES.replies]).toContain("致歉安抚");
  });
});

// Moved here from app/api/voc/analyze/route.ts, where it was private and only
// exercised by the live Base round trip. It now has two callers — the
// field-shortcut track's re-read and toVocRecord — so one implementation and
// one set of tests replace what would otherwise be two drifting copies.
describe("parseReplyText", () => {
  it("splits the \\n\\n-joined 【语气】正文 format the writer produces", () => {
    expect(parseReplyText("【安抚】抱歉\n\n【方案】明天上门")).toEqual([
      { tone: "安抚", text: "抱歉" },
      { tone: "方案", text: "明天上门" },
    ]);
  });

  it("returns nothing for an empty or whitespace-only cell", () => {
    expect(parseReplyText("")).toEqual([]);
    expect(parseReplyText("   \n  ")).toEqual([]);
  });

  it("drops a hand-edited segment that does not match the shape", () => {
    expect(parseReplyText("随手写的一行\n\n【安抚】抱歉")).toEqual([
      { tone: "安抚", text: "抱歉" },
    ]);
  });

  it("keeps a multi-line body inside one segment", () => {
    expect(parseReplyText("【方案】第一步\n第二步")).toEqual([
      { tone: "方案", text: "第一步\n第二步" },
    ]);
  });

  it("tolerates an empty tone label rather than dropping the reply", () => {
    expect(parseReplyText("【】抱歉")).toEqual([{ tone: "", text: "抱歉" }]);
  });
});
