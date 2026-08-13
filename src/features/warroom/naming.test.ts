import { describe, expect, it } from "vitest";
import { DECLINED_MARKER, warRoomDecision, warRoomName } from "./naming";

describe("warRoomName", () => {
  it("uses the last six characters of the record number", () => {
    expect(
      warRoomName({ recordNumber: "0030084c-b4dd-424e-8c6c-0489e86af5df", category: "冰箱", severity: "高" }),
    ).toBe("VOC-6af5df-冰箱-高");
  });

  it("keeps a short record number whole instead of padding it", () => {
    expect(warRoomName({ recordNumber: "R-1", category: "电视", severity: "中" })).toBe("VOC-R-1-电视-中");
  });

  it("drops the category segment when the Base has none", () => {
    // 714 of the 3628 imported rows have no product category, because the source
    // file mixes product lines with org units in one column.
    expect(warRoomName({ recordNumber: "abcdef", category: "", severity: "高" })).toBe("VOC-abcdef-高");
  });

  it("drops the severity segment when the ticket is not yet tagged", () => {
    expect(warRoomName({ recordNumber: "abcdef", category: "冰箱", severity: null })).toBe("VOC-abcdef-冰箱");
  });
});

describe("warRoomDecision", () => {
  it("creates when the column is empty", () => {
    expect(warRoomDecision("")).toBe("create");
    expect(warRoomDecision("   ")).toBe("create");
  });

  it("reports an existing group for any oc_ id", () => {
    expect(warRoomDecision("oc_abc123")).toBe("exists");
  });

  it("reports a declined escalation for the marker", () => {
    expect(warRoomDecision(DECLINED_MARKER)).toBe("declined");
  });

  it("treats an unrecognised value as an existing group rather than creating a second one", () => {
    // A hand-edited cell must never cause a duplicate group. Erring toward
    // "exists" is recoverable by clearing the cell; erring toward "create"
    // leaves two groups and no way to tell which one people are talking in.
    expect(warRoomDecision("garbage")).toBe("exists");
  });
});
