import { describe, expect, it } from "vitest";

import { VOC_FIELD_NAMES, toTagFieldUpdate, toVocRecord } from "./field-map";

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
});
