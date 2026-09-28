// V2 cycle geometry: the day ruler (tick bar), the date axis and the phase
// lanes, as percentages so one set of numbers draws the phone and the laptop.
import { describe, expect, it } from "vitest";
import {
  LANE_HEIGHTS,
  axisLabels,
  barHeight,
  dateRange,
  daysBetween,
  daysLabel,
  doseSegments,
  laneBars,
  monthDay,
  plusDays,
  tickGeometry,
} from "@/lib/cycles/geometry";
import type { ActivePhase, Phase } from "@/lib/schedule/engine";

const active = (id: string, start: string, end: string, doseMg: string, extra: Partial<ActivePhase> = {}): ActivePhase => ({
  id,
  kind: "active",
  start,
  end,
  doseMg,
  time: "20:00",
  schedule: { type: "interval", everyDays: 1 },
  ...extra,
});
const rest = (id: string, start: string, end: string): Phase => ({ id, kind: "break", start, end });

describe("dates", () => {
  it("counts days across months, a year end and a DST change", () => {
    expect(daysBetween("2026-09-01", "2026-11-23")).toBe(83);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(plusDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(plusDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("labels", () => {
    expect(monthDay("2026-09-01")).toBe("Sep 1");
    expect([daysLabel(1, 56), daysLabel(3, 3)]).toEqual(["Days 1–56", "Day 3"]);
    expect(dateRange("2026-09-01", "2026-10-26")).toBe("Sep 1 – Oct 26");
    expect(dateRange("2026-11-10", "2026-11-23")).toBe("Nov 10 – 23");
    expect(dateRange("2026-11-10", "2026-11-10")).toBe("Nov 10");
    expect(dateRange("2025-10-06", "2025-12-01", "2026")).toBe("Oct 6 – Dec 1, 2025");
    expect(dateRange("2025-12-20", "2026-01-10")).toBe("Dec 20, 2025 – Jan 10, 2026");
    expect(dateRange("2026-09-01", "2026-10-26", "2026")).toBe("Sep 1 – Oct 26");
  });
});

describe("tick bar", () => {
  it("one tick per day; the past filled; today centred on its day", () => {
    const ticks = tickGeometry(84, 24);
    expect(ticks.pitch).toBeCloseTo(100 / 84);
    expect(ticks.filled).toBeCloseTo((23 / 84) * 100);
    expect(ticks.today).toBeCloseTo((23.5 / 84) * 100);
  });

  it("day 1 has nothing filled; the last day has all but itself", () => {
    expect(tickGeometry(10, 1)).toEqual({ pitch: 10, filled: 0, today: 5 });
    expect(tickGeometry(10, 10)).toEqual({ pitch: 10, filled: 90, today: 95 });
  });

  it("before the start nothing is filled and there is no today; once ended everything is", () => {
    expect(tickGeometry(10, -3)).toEqual({ pitch: 10, filled: 0, today: null });
    expect(tickGeometry(10, 0)).toEqual({ pitch: 10, filled: 0, today: null });
    expect(tickGeometry(10, 11)).toEqual({ pitch: 10, filled: 100, today: null });
    expect(tickGeometry(10, 400)).toEqual({ pitch: 10, filled: 100, today: null });
  });

  it("a zero-day cycle still draws one tick", () => {
    expect(tickGeometry(0, 1)).toEqual({ pitch: 100, filled: 0, today: 50 });
  });
});

describe("axis labels", () => {
  it("the ends, each month's 1st and Today, in order", () => {
    const labels = axisLabels("2026-09-01", "2026-11-23", "2026-09-15");
    expect(labels.map((l) => [l.text, l.align])).toEqual([
      ["Sep 1", "start"],
      ["Today", "center"],
      ["Oct 1", "center"],
      ["Nov 1", "center"],
      ["Nov 23", "end"],
    ]);
    expect(labels[1].today).toBe(true);
    expect(labels[2].percent).toBeCloseTo((30 / 84) * 100);
  });

  it("Today wins over a nearby date; the ends win over a nearby month", () => {
    // Today on Oct 2: Oct 1 is too close and drops.
    expect(axisLabels("2026-09-01", "2026-11-23", "2026-10-02").map((l) => l.text)).toEqual(["Sep 1", "Today", "Nov 1", "Nov 23"]);
    // Today on day 1: the start label drops.
    expect(axisLabels("2026-09-01", "2026-11-23", "2026-09-01").map((l) => l.text)).toEqual(["Today", "Oct 1", "Nov 1", "Nov 23"]);
    // Today on Sep 24 is 7 days before Oct 1 (8% of 84 days): Oct 1 drops.
    expect(axisLabels("2026-09-01", "2026-11-23", "2026-09-24").map((l) => l.text)).toEqual(["Sep 1", "Today", "Nov 1", "Nov 23"]);
    // Nov 1 is 4 days before the end of a 57-day cycle (9%): the end wins.
    expect(axisLabels("2026-09-10", "2026-11-05", null).map((l) => l.text)).toEqual(["Sep 10", "Oct 1", "Nov 5"]);
  });

  it("no Today outside the cycle, months can be left out, and a one-day cycle has no end label", () => {
    expect(axisLabels("2026-09-01", "2026-09-30", "2026-10-05").map((l) => l.text)).toEqual(["Sep 1", "Sep 30"]);
    expect(axisLabels("2026-09-01", "2026-11-23", null, { months: false }).map((l) => l.text)).toEqual(["Sep 1", "Nov 23"]);
    expect(axisLabels("2026-09-01", "2026-09-01", "2026-09-01").map((l) => l.text)).toEqual(["Sep 1", "Today"]);
    expect(axisLabels("2026-09-01", "2026-09-01", null).map((l) => l.text)).toEqual(["Sep 1"]);
  });

  it("labels never sit closer than the gap", () => {
    for (const today of ["2026-09-02", "2026-09-29", "2026-10-15", "2026-11-22"]) {
      const labels = axisLabels("2026-09-01", "2026-11-23", today);
      for (let i = 1; i < labels.length; i += 1) expect(labels[i].percent - labels[i - 1].percent).toBeGreaterThanOrEqual(16);
    }
  });
});

describe("lanes", () => {
  it("a bar per phase, in cycle days and % of the width", () => {
    const bars = laneBars([rest("b", "2026-10-01", "2026-10-07"), active("a", "2026-09-10", "2026-09-30", "0.25")], "2026-09-10", 28);
    expect(bars.map((b) => [b.kind, b.from, b.to, b.doseMg, b.level])).toEqual([
      ["active", 1, 21, "0.25", null],
      ["break", 22, 28, null, null],
    ]);
    expect(bars[0].left).toBe(0);
    expect(bars[0].width).toBeCloseTo(75);
    expect(bars[1].left).toBeCloseTo(75);
    expect(bars[1].width).toBeCloseTo(25);
  });

  it("dose changes cut a phase and set each piece's level between the smallest and largest dose", () => {
    const phase = active("a", "2026-09-01", "2026-09-28", "0.25", {
      doseChanges: [
        { from: "2026-09-08", doseMg: "0.5" },
        { from: "2026-09-15", doseMg: "0.5" },
        { from: "2026-09-22", doseMg: "1" },
      ],
    });
    expect(doseSegments(phase)).toEqual([
      { start: "2026-09-01", end: "2026-09-07", dose: "0.25" },
      { start: "2026-09-08", end: "2026-09-21", dose: "0.5" },
      { start: "2026-09-22", end: "2026-09-28", dose: "1" },
    ]);
    const bars = laneBars([phase], "2026-09-01", 28);
    expect(bars.map((b) => [b.from, b.to, b.level])).toEqual([
      [1, 7, 0],
      [8, 21, 1 / 3],
      [22, 28, 1],
    ]);
    expect(new Set(bars.map((b) => b.phaseId))).toEqual(new Set(["a"]));
  });

  it("a time change alone doesn't cut the bar, and a change to the same amount merges", () => {
    const phase = active("a", "2026-09-01", "2026-09-10", "0.5", {
      timeChanges: [{ from: "2026-09-05", time: "07:00" }],
      doseChanges: [{ from: "2026-09-06", doseMg: "0.50" }],
    });
    expect(laneBars([phase], "2026-09-01", 10).map((b) => [b.from, b.to])).toEqual([[1, 10]]);
  });

  it("clamps to the cycle", () => {
    const bars = laneBars([active("a", "2026-08-25", "2026-09-20", "1")], "2026-09-01", 10);
    expect(bars.map((b) => [b.from, b.to, b.left, b.width])).toEqual([[1, 10, 0, 100]]);
  });

  it("heights: breaks and equal doses flat, levels between the size's range", () => {
    expect(barHeight({ kind: "break", level: null }, LANE_HEIGHTS.card)).toBe(10);
    expect(barHeight({ kind: "active", level: null }, LANE_HEIGHTS.card)).toBe(10);
    expect(barHeight({ kind: "active", level: 0 }, LANE_HEIGHTS.card)).toBe(8);
    expect(barHeight({ kind: "active", level: 1 }, LANE_HEIGHTS.card)).toBe(16);
    expect(barHeight({ kind: "active", level: 0.5 }, LANE_HEIGHTS.timeline)).toBe(29);
    expect(barHeight({ kind: "active", level: null }, LANE_HEIGHTS.timeline)).toBe(34);
  });
});
