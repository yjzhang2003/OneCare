import { describe, expect, it } from "vitest";

import { VOC_FIELD_NAMES, toTagFieldUpdate, toVocRecord } from "./field-map";

describe("toVocRecord", () => {
  it("unpacks single select, multi select and person fields", () => {
    const record = toVocRecord(
      {
        [VOC_FIELD_NAMES.channel]: "电商评价",
        [VOC_FIELD_NAMES.category]: "冰箱",
        [VOC_FIELD_NAMES.content]: "等了三天",
        [VOC_FIELD_NAMES.state]: "待跟进",
        [VOC_FIELD_NAMES.polarity]: "差评",
        [VOC_FIELD_NAMES.dimensions]: ["维修时间", "服务态度"],
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
      channel: "电商评价",
      category: "冰箱",
      content: "等了三天",
      state: "待跟进",
      polarity: "差评",
      dimensions: ["维修时间", "服务态度"],
      ownerOpenIds: ["ou_owner"],
      retryCount: 1,
      rating: 2,
      ticketOpenedAt: "2026-01-23T02:00:00.000Z",
    });
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
