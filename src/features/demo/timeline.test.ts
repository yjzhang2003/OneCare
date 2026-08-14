import { describe, expect, it } from "vitest";

import { triage } from "../voc/triage";
import {
  DEMO_TAG_SOURCE,
  seedRecord,
  shiftedDayStarts,
  summarize,
  type SeedInput,
} from "./timeline";

const NOW = Date.parse("2026-08-14T14:00:00+08:00");

// The ten days the import actually produced, and roughly its per-day volume.
const DAYS = [
  "2026-01-22",
  "2026-01-23",
  "2026-01-24",
  "2026-01-25",
  "2026-01-26",
  "2026-01-27",
  "2026-01-28",
  "2026-01-29",
  "2026-01-30",
  "2026-01-31",
] as const;

const ASSIGNEES = [
  { openId: "ou_a", name: "黄齐" },
  { openId: "ou_b", name: "张睿哲" },
  { openId: "ou_c", name: "张禹健" },
] as const;

function corpus(perDay = 360): readonly SeedInput[] {
  const rows: SeedInput[] = [];
  for (const [dayIndex, day] of DAYS.entries()) {
    for (let i = 0; i < perDay; i += 1) {
      rows.push({
        recordId: `rec${dayIndex}-${i}`,
        recordNumber: `${dayIndex}-${i}-8f4c1d2e-aaaa-4bbb-8ccc-${String(i).padStart(12, "0")}`,
        feedbackAt: `${day}T00:00:00.000Z`,
      });
    }
  }
  return rows;
}

const dayStarts = shiftedDayStarts([...DAYS], NOW);
const seeded = corpus().map((row) =>
  seedRecord(row, dayStarts, { now: NOW, assignees: ASSIGNEES }),
);
const shape = summarize(seeded, NOW);

describe("demo timeline", () => {
  it("keeps the ten days' shape and slides the block to end just before now", () => {
    const starts = [...dayStarts.values()].sort((a, b) => a - b);
    expect(starts).toHaveLength(10);

    // Consecutive days stay exactly one day apart: the gaps are the import's, not ours.
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i]! - starts[i - 1]!).toBe(24 * 3_600_000);
    }
    // The newest day covers up to two hours before now, and nothing is in the future.
    const newest = starts.at(-1)!;
    expect(NOW - newest).toBeGreaterThan(24 * 3_600_000);
    expect(NOW - newest).toBeLessThan(48 * 3_600_000);
    for (const row of seeded) {
      expect(Date.parse(row.feedbackAt)).toBeLessThanOrEqual(NOW);
    }
  });

  // The complaint that started this: 3628 rows shared one time of day, so every
  // 反馈时间 on screen was identical and every 停留时长 differed only by whole days.
  it("gives the rows distinct times of day, spread across the clock", () => {
    expect(shape.distinctTimesOfDay).toBeGreaterThan(2000);

    const hours = new Set(
      seeded.map((row) => new Date(row.feedbackAt).toISOString().slice(11, 13)),
    );
    expect(hours.size).toBe(24);
  });

  // The other half of the complaint: 3612 of 3628 rows read 已超时 against the assumed
  // SLA, which made the 超时风险 queue meaningless.
  it("leaves overdue a minority rather than the whole table", () => {
    expect(shape.overdue).toBeGreaterThan(0);
    expect(shape.overdue / seeded.length).toBeLessThan(0.05);
  });

  it("keeps every dwell time inside a range a person can read", () => {
    const [min, max] = shape.dwellRange;
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(10 * 24);
  });

  // The product's own rules decide the tags, not this file. A 好评 row must never carry
  // a ticket, and a row triage() would escalate must never be filed as 无需跟进.
  it("never contradicts triage", () => {
    for (const row of seeded) {
      if (row.polarity === null) {
        expect(["待分析", "分析失败"]).toContain(row.state);
        expect(row.dimensions).toEqual([]);
        expect(row.severity).toBeNull();
        continue;
      }
      const decision = triage({
        polarity: row.polarity,
        dimensions: row.dimensions,
      });
      expect(row.severity).toBe(decision.severity);
      const filed = row.ticketOpenedAt !== null;
      expect(filed).toBe(decision.createTicket);
      if (!decision.createTicket) expect(row.state).toBe("无需跟进");
    }
  });

  it("orders feedback, ticket and closure timestamps", () => {
    for (const row of seeded) {
      const feedback = Date.parse(row.feedbackAt);
      if (row.ticketOpenedAt) {
        const opened = Date.parse(row.ticketOpenedAt);
        expect(opened).toBeGreaterThanOrEqual(feedback);
        expect(opened).toBeLessThanOrEqual(NOW);
        if (row.closedAt) {
          const closedAt = Date.parse(row.closedAt);
          expect(closedAt).toBeGreaterThanOrEqual(opened);
          expect(closedAt).toBeLessThanOrEqual(NOW);
        }
      } else {
        // No ticket means nothing to close, in both directions.
        expect(row.closedAt).toBeNull();
      }
    }
  });

  it("leaves a real share of the table untagged, as asked", () => {
    const pending = shape.states["待分析"] ?? 0;
    expect(pending / seeded.length).toBeGreaterThan(0.1);
    expect(pending / seeded.length).toBeLessThan(0.2);
  });

  it("fills every queue the sider offers", () => {
    // 待处理: has a ticket and is not terminal. 分析异常: 分析失败. 未分配: a ticket with
    // nobody on it. A queue that is always empty teaches an operator to ignore it.
    expect(shape.states["分析失败"] ?? 0).toBeGreaterThan(0);
    expect(shape.unassignedOpen).toBeGreaterThan(0);
    expect(shape.withTicket - shape.closed).toBeGreaterThan(20);
    expect(shape.closed).toBeGreaterThan(100);
  });

  it("produces a polarity mix that leaves the charts something to show", () => {
    for (const polarity of ["好评", "中评", "差评"]) {
      expect(shape.polarities[polarity] ?? 0).toBeGreaterThan(50);
    }
  });

  it("marks every row it synthesized, so the real ones stay identifiable", () => {
    for (const row of seeded) {
      expect(row.synthesized).toBe(true);
      expect(row.tagSource).toBe(DEMO_TAG_SOURCE);
    }
  });

  // The 19 rows the real aily skill tagged carry the only genuine AI 摘要 and 回复话术 in
  // the dataset. Seeding over them would destroy exactly the rows worth opening in a
  // demo, so a row that already has a polarity keeps everything the pipeline decided and
  // only has its timeline rebuilt — its 反馈时间 came from the same January import as
  // every other row, while its 建单时间 was created this week, which after the shift
  // would place the ticket before the feedback that caused it.
  describe("rows the real pipeline already tagged", () => {
    const base = corpus(1)[0]!;
    const preserved = seedRecord(
      {
        ...base,
        existing: {
          state: "跟进中",
          polarity: "差评",
          dimensions: ["维修时间", "服务态度"],
          severity: "高",
          ownerOpenIds: ["ou_real"],
          ownerNames: ["真实负责人"],
        },
      },
      dayStarts,
      { now: NOW, assignees: ASSIGNEES },
    );

    it("keeps the pipeline's own state, tags and owner", () => {
      expect(preserved.state).toBe("跟进中");
      expect(preserved.polarity).toBe("差评");
      expect(preserved.dimensions).toEqual(["维修时间", "服务态度"]);
      expect(preserved.severity).toBe("高");
      expect(preserved.ownerNames).toEqual(["真实负责人"]);
    });

    it("does not stamp them as synthesized, so 打标来源 survives", () => {
      expect(preserved.synthesized).toBe(false);
      expect(preserved.tagSource).toBe("");
    });

    it("still rebuilds the timeline, consistently with the state it kept", () => {
      const feedback = Date.parse(preserved.feedbackAt);
      expect(feedback).toBeLessThanOrEqual(NOW);
      expect(preserved.ticketOpenedAt).not.toBeNull();
      expect(Date.parse(preserved.ticketOpenedAt!)).toBeGreaterThanOrEqual(feedback);
      // 跟进中 is not terminal, so there is nothing closed about it.
      expect(preserved.closedAt).toBeNull();
    });

    it("gives a closed ticket both timestamps and an untriaged row neither", () => {
      const closed = seedRecord(
        {
          ...base,
          existing: {
            state: "已闭环",
            polarity: "中评",
            dimensions: ["维修价格"],
            severity: "中",
            ownerOpenIds: ["ou_real"],
            ownerNames: ["真实负责人"],
          },
        },
        dayStarts,
        { now: NOW, assignees: ASSIGNEES },
      );
      expect(closed.ticketOpenedAt).not.toBeNull();
      expect(Date.parse(closed.closedAt!)).toBeGreaterThanOrEqual(
        Date.parse(closed.ticketOpenedAt!),
      );

      const noTicket = seedRecord(
        {
          ...base,
          existing: {
            state: "无需跟进",
            polarity: "好评",
            dimensions: [],
            severity: "低",
            ownerOpenIds: [],
            ownerNames: [],
          },
        },
        dayStarts,
        { now: NOW, assignees: ASSIGNEES },
      );
      expect(noTicket.ticketOpenedAt).toBeNull();
      expect(noTicket.closedAt).toBeNull();
    });

    // An untagged row carries no polarity, so it must fall through to synthesis rather
    // than be mistaken for pipeline output and frozen as 待分析 forever.
    it("synthesizes a row whose existing tags are empty", () => {
      const untagged = seedRecord(
        {
          ...base,
          existing: {
            state: "待分析",
            polarity: null,
            dimensions: [],
            severity: null,
            ownerOpenIds: [],
            ownerNames: [],
          },
        },
        dayStarts,
        { now: NOW, assignees: ASSIGNEES },
      );
      expect(untagged.synthesized).toBe(true);
    });
  });

  // Re-runnable by construction: the seeding writes 3628 rows to two stores, and a
  // second run has to be able to produce the same dataset rather than reshuffle it.
  it("is deterministic in the record number", () => {
    const again = corpus().map((row) =>
      seedRecord(row, dayStarts, { now: NOW, assignees: ASSIGNEES }),
    );
    expect(again).toEqual(seeded);
  });

  it("assigns only people the caller supplied", () => {
    const allowed = new Set<string>(ASSIGNEES.map((a) => a.name));
    for (const row of seeded) {
      for (const name of row.ownerNames) expect(allowed.has(name)).toBe(true);
      expect(row.ownerOpenIds).toHaveLength(row.ownerNames.length);
    }
  });

  it("assigns nobody when the directory could not be read", () => {
    const withoutDirectory = corpus(20).map((row) =>
      seedRecord(row, dayStarts, { now: NOW, assignees: [] }),
    );
    for (const row of withoutDirectory) {
      expect(row.ownerNames).toEqual([]);
      expect(row.ownerOpenIds).toEqual([]);
    }
  });
});
