import { describe, expect, it } from "vitest";
import { defaultLineSpacing, syringeScale, syringeTicks } from "@/lib/alpha/syringe-scale";

const kinds = (capacity: 100 | 50 | 30, spacing: Parameters<typeof syringeTicks>[1]) => {
  const ticks = syringeTicks(capacity, spacing);
  return {
    count: ticks.length,
    minor: ticks.filter((t) => t.kind === "minor").length,
    mid: ticks.filter((t) => t.kind === "mid").length,
    major: ticks.filter((t) => t.kind === "major").length,
    labels: ticks.filter((t) => t.label !== null).map((t) => t.label),
    first: ticks[0],
    last: ticks.at(-1),
  };
};

describe("syringe ruler ticks (real line spacing)", () => {
  it("defaults the line spacing per syringe: 100 → 2, 50 → 1, 30 → 0.5 units", () => {
    expect([defaultLineSpacing(100), defaultLineSpacing(50), defaultLineSpacing(30)]).toEqual(["2", "1", "0.5"]);
  });

  it("100-unit: a line every 2 units, major every 10, labels every 10, closing tick at 100", () => {
    const scale = kinds(100, "2");
    expect(scale.count).toBe(51);
    expect(scale.major).toBe(11);
    expect(scale.minor).toBe(40);
    expect(scale.mid).toBe(0);
    expect(scale.labels).toEqual(["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100"]);
    expect(scale.first).toMatchObject({ units: "0", percent: 0, kind: "major" });
    expect(scale.last).toMatchObject({ units: "100", percent: 100, kind: "major", label: "100" });
    expect(syringeTicks(100, "2")[1]).toMatchObject({ units: "2", percent: 2, kind: "minor", label: null });
  });

  it("50-unit: a line every unit, major every 5, labels every 10", () => {
    const scale = kinds(50, "1");
    expect(scale.count).toBe(51);
    expect(scale.major).toBe(11);
    expect(scale.minor).toBe(40);
    expect(scale.labels).toEqual(["0", "10", "20", "30", "40", "50"]);
    expect(syringeTicks(50, "1")[5]).toMatchObject({ units: "5", percent: 10, kind: "major", label: null });
  });

  it("30-unit: a line every 0.5 unit, mid every 1, major every 5, labels every 5", () => {
    const scale = kinds(30, "0.5");
    expect(scale.count).toBe(61);
    expect(scale.major).toBe(7);
    expect(scale.mid).toBe(24);
    expect(scale.minor).toBe(30);
    expect(scale.labels).toEqual(["0", "5", "10", "15", "20", "25", "30"]);
    const ticks = syringeTicks(30, "0.5");
    expect(ticks.slice(0, 4).map((t) => [t.units, t.kind])).toEqual([
      ["0", "major"],
      ["0.5", "minor"],
      ["1", "mid"],
      ["1.5", "minor"],
    ]);
    expect(ticks[1].percent).toBeCloseTo(100 / 60, 10);
  });

  it("draws the researcher's own spacing, or only the major lines when it is unknown", () => {
    expect(kinds(30, "1")).toMatchObject({ count: 31, major: 7, mid: 0, minor: 24 });
    expect(kinds(100, "unknown")).toMatchObject({ count: 11, major: 11, minor: 0 });
  });
});

describe("syringe ruler reading and flags", () => {
  it("50 units on a 100-unit syringe: half full, on a line, its label drawn heavier", () => {
    const scale = syringeScale({ units: "50", capacity: 100 })!;
    expect(scale).toMatchObject({
      fillPercent: 50,
      markerPercent: 50,
      labelAtValue: "50",
      unitsText: "50",
      onLine: true,
      overCapacity: false,
      flags: [],
    });
  });

  it("5 units on a 100-unit syringe falls between the 4 and 6 lines (never rounded)", () => {
    const scale = syringeScale({ units: "5", capacity: 100 })!;
    expect(scale.onLine).toBe(false);
    expect(scale.markerPercent).toBe(5);
    expect(scale.labelAtValue).toBeNull();
    expect(scale.flags).toEqual([
      {
        kind: "between-lines",
        lower: "4",
        upper: "6",
        message: "On a 100-unit syringe, 5 units falls between the 4 and 6 lines.",
      },
    ]);
  });

  it("the same 5 units lands on a line of the 50- and 30-unit syringes", () => {
    expect(syringeScale({ units: "5", capacity: 50 })!.onLine).toBe(true);
    const thirty = syringeScale({ units: "5", capacity: 30 })!;
    expect(thirty.onLine).toBe(true);
    expect(thirty.labelAtValue).toBe("5");
    expect(thirty.fillPercent).toBeCloseTo(16.6667, 3);
  });

  it("checks lines exactly: 12.5 is on a 0.5 line but between the 12 and 13 lines of a 50-unit syringe", () => {
    expect(syringeScale({ units: "12.5", capacity: 30 })!.onLine).toBe(true);
    const fifty = syringeScale({ units: "12.5", capacity: 50 })!;
    expect(fifty.flags[0]).toMatchObject({ kind: "between-lines", lower: "12", upper: "13" });
  });

  it("long values display with ≈ and still name the lines either side", () => {
    const scale = syringeScale({ units: "3.3333333333333333333333333333333333333333", capacity: 30 })!;
    expect(scale.unitsText).toBe("≈3.333333");
    expect(scale.flags[0]).toMatchObject({ kind: "between-lines", lower: "3", upper: "3.5" });
    expect(syringeScale({ units: "0.25", capacity: 30, unitsText: "0.25" })!.flags[0]).toMatchObject({
      lower: "0",
      upper: "0.5",
    });
  });

  it("over capacity: the barrel shows full with no marker, flagged, and on a line only the capacity flag", () => {
    const scale = syringeScale({ units: "120", capacity: 100 })!;
    expect(scale).toMatchObject({ overCapacity: true, fillPercent: 100, markerPercent: null, onLine: true, labelAtValue: null });
    expect(scale.flags).toEqual([{ kind: "over-capacity", message: "120 units is more than a 100-unit syringe holds." }]);
    // Exactly full is not over.
    expect(syringeScale({ units: "30", capacity: 30 })).toMatchObject({ overCapacity: false, onLine: true, markerPercent: 100 });
  });

  // The calculator's contract (tests/unit/calculator.test.ts, "checks each
  // capacity, listing over-capacity before the line check"): over capacity
  // still gets the line check, after the capacity flag.
  it("the 50-unit contract: 50.5 units is over capacity and between the 50 and 51 lines", () => {
    const scale = syringeScale({ units: "50.5", capacity: 50 })!;
    expect(scale).toMatchObject({ overCapacity: true, onLine: false, markerPercent: null, fillPercent: 100 });
    expect(scale.flags).toEqual([
      { kind: "over-capacity", message: "50.5 units is more than a 50-unit syringe holds." },
      {
        kind: "between-lines",
        lower: "50",
        upper: "51",
        message: "On a 50-unit syringe, 50.5 units falls between the 50 and 51 lines.",
      },
    ]);
  });

  it.each([
    // capacity, off-line value, its lines, on-line value (default spacing 2 / 1 / 0.5)
    [100, "101", "100", "102", "104"],
    [100, "150.5", "150", "152", "200"],
    [50, "50.5", "50", "51", "52"],
    [50, "75.25", "75", "76", "60"],
    [30, "30.25", "30", "30.5", "31.5"],
    [30, "45.1", "45", "45.5", "40"],
  ] as const)("over a %i-unit syringe: %s is between %s and %s; %s is on a line", (capacity, off, lower, upper, on) => {
    const offScale = syringeScale({ units: off, capacity })!;
    expect(offScale).toMatchObject({ overCapacity: true, onLine: false });
    expect(offScale.flags.map((flag) => flag.kind)).toEqual(["over-capacity", "between-lines"]);
    expect(offScale.flags[1]).toMatchObject({ lower, upper });

    const onScale = syringeScale({ units: on, capacity })!;
    expect(onScale).toMatchObject({ overCapacity: true, onLine: true });
    expect(onScale.flags.map((flag) => flag.kind)).toEqual(["over-capacity"]);
  });

  it("over capacity with a researcher's own spacing, or unknown spacing", () => {
    // Lined every 2 on a 50-unit syringe: 51 is between 50 and 52; 54 is on a line.
    expect(syringeScale({ units: "51", capacity: 50, lineSpacing: "2" })!.flags.map((flag) => flag.kind)).toEqual([
      "over-capacity",
      "between-lines",
    ]);
    expect(syringeScale({ units: "54", capacity: 50, lineSpacing: "2" })!).toMatchObject({ onLine: true });
    // Unknown spacing can't check lines, over capacity or not (calculator: over-capacity, unknown-lines).
    const unknown = syringeScale({ units: "31", capacity: 30, lineSpacing: "unknown" })!;
    expect(unknown).toMatchObject({ overCapacity: true, onLine: null });
    expect(unknown.flags.map((flag) => flag.kind)).toEqual(["over-capacity", "unknown-lines"]);
  });

  it("unknown spacing can't check lines", () => {
    const scale = syringeScale({ units: "5", capacity: 100, lineSpacing: "unknown" })!;
    expect(scale.onLine).toBeNull();
    expect(scale.flags.map((f) => f.kind)).toEqual(["unknown-lines"]);
  });

  it("refuses values that are not a plain, non-negative decimal", () => {
    for (const units of ["", "abc", "-1", "1e3"]) expect(syringeScale({ units, capacity: 100 })).toBeNull();
    expect(syringeScale({ units: "0", capacity: 100 })).toMatchObject({ fillPercent: 0, onLine: true });
  });
});
