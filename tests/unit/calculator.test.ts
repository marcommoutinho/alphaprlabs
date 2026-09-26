// R7 calculator math (handoff Business Rules 3, plan D5, handoff
// reconciliation 3): exact concentration, volume and units; between-line,
// over-capacity and unknown-spacing flags; dose over the whole vial; invalid
// input; display precision (plan: up to 6 decimals with "≈").
import { describe, expect, it } from "vitest";
import {
  calculate,
  type CalculatorInput,
  DEFAULT_LINE_SPACING,
  DOSE_OVER_VIAL,
  DOSE_POSITIVE,
  DOSE_REQUIRED,
  LINE_SPACING_REQUIRED,
  lineSpacingNote,
  LIQUID_POSITIVE,
  LIQUID_REQUIRED,
  SYRINGE_LABEL,
  SYRINGE_REQUIRED,
  UNKNOWN_LINES_MESSAGE,
  VIAL_POSITIVE,
  VIAL_REQUIRED,
} from "@/lib/calculator/calculator";
import { formatAmount, formatRatio, normalizeDecimal, parseDecimal } from "@/lib/calculator/decimal";

const base: CalculatorInput = { vialMg: "8", liquidMl: "2", doseMg: "0.4", syringe: 100, lineSpacing: "2" };
const run = (overrides: Partial<CalculatorInput>) => calculate({ ...base, ...overrides });
function ok(overrides: Partial<CalculatorInput>) {
  const result = run(overrides);
  if (!result.ok) throw new Error(`expected ok, got ${result.errors.join(" | ")}`);
  return result;
}

describe("concentration, volume and units", () => {
  it("matches the handoff's seeded mixture: 8 mg in 2 mL, 0.4 mg on a 1 mL syringe", () => {
    expect(ok({})).toEqual({
      ok: true,
      concentrationMgPerMl: "4",
      volumeMl: "0.1",
      units: "10",
      display: { concentration: "4", volume: "0.1", units: "10" },
      onLine: true,
      betweenLines: null,
      overCapacity: false,
      flags: [],
      summary: "1 mL syringe · lines every 2 units · 10 lands on a line",
    });
  });

  it("computes volume as dose × mL ÷ vial mg, so a repeating concentration doesn't leak into the volume", () => {
    const result = ok({ vialMg: "10", liquidMl: "3", doseMg: "1" });
    expect(result.concentrationMgPerMl).toBe("3.333333333333333333333333333333333333333");
    expect(result.display.concentration).toBe("≈3.333333");
    expect(result.volumeMl).toBe("0.3");
    expect(result.units).toBe("30");
    expect(result.onLine).toBe(true);
  });

  it("is exact where binary floating point is not", () => {
    // 0.3 mg of 10 mg/mL: floating point gives 2.9999999999999996 units.
    const result = ok({ vialMg: "10", liquidMl: "1", doseMg: "0.3", lineSpacing: "1" });
    expect(result.units).toBe("3");
    expect(result.onLine).toBe(true);
    expect(ok({ vialMg: "0.3", liquidMl: "0.1", doseMg: "0.03", lineSpacing: "1" }).units).toBe("1");
  });

  it("accepts the whole vial as a dose", () => {
    const result = ok({ vialMg: "5", liquidMl: "0.5", doseMg: "5" });
    expect(result.volumeMl).toBe("0.5");
    expect(result.units).toBe("50");
  });

  it("trims whitespace and accepts plain decimals such as .5 and 2.", () => {
    expect(ok({ vialMg: " 8 ", liquidMl: "2.", doseMg: ".4" }).units).toBe("10");
  });
});

describe("line spacing", () => {
  it("preselects the handoff's default per capacity", () => {
    expect(DEFAULT_LINE_SPACING).toEqual({ 100: "2", 50: "1", 30: "0.5" });
    expect(SYRINGE_LABEL).toEqual({ 100: "1 mL", 50: "0.5 mL", 30: "0.3 mL" });
  });

  it("describes the spacing and marks a change from the default as an override", () => {
    expect(lineSpacingNote(100, "2")).toBe("1 mL syringes are lined every 2 units");
    expect(lineSpacingNote(50, "1")).toBe("0.5 mL syringes are lined every 1 unit");
    expect(lineSpacingNote(30, "0.5")).toBe("0.3 mL syringes are lined every 0.5 units");
    expect(lineSpacingNote(100, "1")).toBe("1 mL syringes are lined every 1 unit (your override)");
    expect(lineSpacingNote(30, "unknown")).toBe("Line spacing unknown for this syringe");
  });

  it("flags units between lines without rounding the dose", () => {
    const result = ok({ vialMg: "5", liquidMl: "2", doseMg: "0.33" });
    expect(result.units).toBe("13.2");
    expect(result.onLine).toBe(false);
    expect(result.betweenLines).toEqual({ lower: "12", upper: "14" });
    expect(result.flags).toEqual([
      {
        kind: "between-lines",
        message:
          "13.2 units falls between the 12 and 14 lines (this syringe is lined every 2 units). The app will not round — use a finer syringe or change the intended dose.",
      },
    ]);
    expect(result.summary).toBe("1 mL syringe · lines every 2 units · 13.2 is between lines");
  });

  it("checks against the selected spacing, singular for 1 unit", () => {
    const half = ok({ vialMg: "5", liquidMl: "2", doseMg: "0.33", syringe: 30, lineSpacing: "0.5" });
    expect(half.betweenLines).toEqual({ lower: "13", upper: "13.5" });
    expect(half.flags[0].message).toContain("(this syringe is lined every 0.5 units)");
    const one = ok({ vialMg: "5", liquidMl: "2", doseMg: "0.33", syringe: 50, lineSpacing: "1" });
    expect(one.betweenLines).toEqual({ lower: "13", upper: "14" });
    expect(one.flags[0].message).toContain("(this syringe is lined every 1 unit)");
    const halfLine = ok({ vialMg: "5", liquidMl: "2", doseMg: "0.3375", syringe: 30, lineSpacing: "0.5" });
    expect([halfLine.units, halfLine.onLine, halfLine.flags]).toEqual(["13.5", true, []]);
  });

  it("flags repeating units with the approximation mark and exact neighbouring lines", () => {
    const result = ok({ vialMg: "3", liquidMl: "1", doseMg: "0.1" });
    expect(result.display.units).toBe("≈3.333333");
    expect(result.betweenLines).toEqual({ lower: "2", upper: "4" });
    expect(result.flags[0].message.startsWith("≈3.333333 units falls between the 2 and 4 lines")).toBe(true);
    expect(result.summary).toBe("1 mL syringe · lines every 2 units · ≈3.333333 is between lines");
  });

  it("is not fooled by values within a hair of a line", () => {
    // 10.0000000001 units is not on the 10 line.
    const result = ok({ vialMg: "8", liquidMl: "2", doseMg: "0.400000000004" });
    expect(result.units).toBe("10.0000000001");
    expect(result.display.units).toBe("≈10");
    expect(result.onLine).toBe(false);
    expect(result.betweenLines).toEqual({ lower: "10", upper: "12" });
  });

  it("flags unknown spacing instead of guessing", () => {
    const result = ok({ lineSpacing: "unknown" });
    expect(result.onLine).toBeNull();
    expect(result.betweenLines).toBeNull();
    expect(result.flags).toEqual([{ kind: "unknown-lines", message: UNKNOWN_LINES_MESSAGE }]);
    expect(UNKNOWN_LINES_MESSAGE).toBe(
      "Line spacing is unknown for this syringe, so the app can't tell whether this dose lands on a printed line. Set the spacing to check.",
    );
    expect(result.summary).toBe("1 mL syringe · line spacing unknown · can't check lines");
  });
});

describe("syringe capacity", () => {
  it("flags units over the capacity, and allows exactly the capacity", () => {
    const over = ok({ vialMg: "2", liquidMl: "3", doseMg: "1" });
    expect(over.units).toBe("150");
    expect(over.overCapacity).toBe(true);
    expect(over.flags).toEqual([
      {
        kind: "over-capacity",
        message: "150 units exceeds the 1 mL syringe (100 units). Choose a larger syringe or add less liquid when mixing.",
      },
    ]);
    const full = ok({ vialMg: "2", liquidMl: "2", doseMg: "1" });
    expect(full.units).toBe("100");
    expect(full.overCapacity).toBe(false);
    expect(full.flags).toEqual([]);
  });

  it("checks each capacity, listing over-capacity before the line check", () => {
    const fifty = ok({ doseMg: "2.02", syringe: 50, lineSpacing: "1" });
    expect(fifty.units).toBe("50.5");
    expect(fifty.flags.map((f) => f.kind)).toEqual(["over-capacity", "between-lines"]);
    expect(fifty.flags[0].message).toBe(
      "50.5 units exceeds the 0.5 mL syringe (50 units). Choose a larger syringe or add less liquid when mixing.",
    );
    const thirty = ok({ doseMg: "1.3", syringe: 30, lineSpacing: "unknown" });
    expect(thirty.flags.map((f) => f.kind)).toEqual(["over-capacity", "unknown-lines"]);
    expect(thirty.flags[0].message).toContain("exceeds the 0.3 mL syringe (30 units)");
    expect(ok({ doseMg: "1.2", syringe: 30, lineSpacing: "0.5" }).overCapacity).toBe(false);
  });

  it("flags a whole vial that doesn't fit the syringe", () => {
    const result = ok({ vialMg: "8", liquidMl: "2", doseMg: "8" });
    expect(result.units).toBe("200");
    expect(result.overCapacity).toBe(true);
  });
});

describe("invalid input", () => {
  it("uses the handoff's messages and lists every failure in order", () => {
    expect(run({ vialMg: "", liquidMl: "", doseMg: "" })).toEqual({
      ok: false,
      errors: [VIAL_REQUIRED, LIQUID_REQUIRED, DOSE_REQUIRED],
    });
    expect([VIAL_REQUIRED, LIQUID_REQUIRED, DOSE_REQUIRED]).toEqual([
      "Enter the vial strength in mg.",
      "Enter the liquid added in mL.",
      "Enter your intended dose in mg.",
    ]);
    expect(run({ vialMg: "0", liquidMl: "-2", doseMg: "0" })).toEqual({
      ok: false,
      errors: [VIAL_POSITIVE, LIQUID_POSITIVE, DOSE_POSITIVE],
    });
    expect([VIAL_POSITIVE, LIQUID_POSITIVE, DOSE_POSITIVE]).toEqual([
      "Vial strength must be more than 0 mg.",
      "Liquid added must be more than 0 mL.",
      "Intended dose must be more than 0 mg.",
    ]);
  });

  it("refuses a dose larger than the whole vial", () => {
    expect(DOSE_OVER_VIAL).toBe("Intended dose is larger than the whole vial.");
    expect(run({ doseMg: "8.0000001" })).toEqual({ ok: false, errors: [DOSE_OVER_VIAL] });
    // Only compared when the vial strength itself is valid.
    expect(run({ vialMg: "0", doseMg: "9" })).toEqual({ ok: false, errors: [VIAL_POSITIVE] });
  });

  it("treats anything but a plain finite decimal as missing", () => {
    for (const bad of ["abc", "8mg", "1e3", "1.2.3", "Infinity", "NaN", "-", ".", ",", "   ", "1".repeat(31)]) {
      expect(run({ vialMg: bad }), bad).toEqual({ ok: false, errors: [VIAL_REQUIRED] });
    }
    const untyped = { ...base, doseMg: undefined, liquidMl: null } as unknown as CalculatorInput;
    expect(calculate(untyped)).toEqual({ ok: false, errors: [LIQUID_REQUIRED, DOSE_REQUIRED] });
    expect(calculate(null as unknown as CalculatorInput)).toMatchObject({ ok: false });
  });

  it("refuses numbers: amounts arrive as the text the researcher typed", () => {
    // 0.1 + 0.2 as a JS number is 0.30000000000000004; accepting it would
    // report 3.0000000000000004 units as "between lines".
    const numeric = { ...base, vialMg: 10, liquidMl: 1, doseMg: 0.1 + 0.2 } as unknown as CalculatorInput;
    expect(calculate(numeric)).toEqual({ ok: false, errors: [VIAL_REQUIRED, LIQUID_REQUIRED, DOSE_REQUIRED] });
  });

  it("accepts a comma as the decimal point", () => {
    const result = ok({ vialMg: "10", liquidMl: "1", doseMg: "0,3", lineSpacing: "1" });
    expect(result).toMatchObject({ units: "3", onLine: true, volumeMl: "0.03" });
    expect(ok({ vialMg: "8", liquidMl: "2,0", doseMg: " 0,4 " }).units).toBe("10");
    expect(ok({ vialMg: "5", liquidMl: "2", doseMg: "1,25" }).units).toBe("50");
  });

  // Marco (2026-09-26): thousands-looking comma forms such as "1,000" stay refused.
  it("refuses thousands separators and mixed or repeated separators rather than guessing", () => {
    for (const bad of ["1,000", "12,500", "100,000", "1,000.5", "1.000,5", "1,2,3", "1,,5", "1.5,", "1 000", "1'000"]) {
      expect(run({ vialMg: bad }), bad).toEqual({ ok: false, errors: [VIAL_REQUIRED] });
    }
  });

  it("refuses unsupported syringe sizes and line spacings", () => {
    const bad = { ...base, syringe: 75, lineSpacing: "3" } as unknown as CalculatorInput;
    expect(calculate(bad)).toEqual({ ok: false, errors: [SYRINGE_REQUIRED, LINE_SPACING_REQUIRED] });
    const text = { ...base, syringe: "100" } as unknown as CalculatorInput;
    expect(calculate(text)).toEqual({ ok: false, errors: [SYRINGE_REQUIRED] });
  });
});

describe("decimal parsing and display", () => {
  it("parses plain decimals exactly and rejects everything else", () => {
    expect(parseDecimal("0.1")?.plus("0.2").toFixed()).toBe("0.3");
    // Strings only: numbers (even exact ones) and other types are invalid input.
    expect(parseDecimal(2.5)).toBeNull();
    expect(parseDecimal(0.1 + 0.2)).toBeNull();
    expect(parseDecimal(Number.NaN)).toBeNull();
    expect(parseDecimal(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseDecimal({})).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal(BigInt(10))).toBeNull();
  });

  it("reads one comma as the decimal point, and only when there is no dot", () => {
    const read = (text: string) => parseDecimal(text)?.toFixed() ?? null;
    expect(read("1,5")).toBe("1.5");
    expect(read("0,125")).toBe("0.125");
    expect(read(",5")).toBe("0.5");
    expect(read("1,0000")).toBe("1");
    expect(read("1234,567")).toBe("1234.567");
    expect(normalizeDecimal(" 2,75 ")).toBe("2.75");
    // Grouping, mixed and repeated separators are refused, not guessed.
    for (const bad of ["1,000", "999,999", "-1,000", "1,000,000", "1,000.5", "1.000,5", "1,2,3", "1,,5"]) {
      expect(read(bad), bad).toBeNull();
    }
  });

  it("shows up to 6 decimals exactly, otherwise rounds half-up with ≈", () => {
    const show = (text: string) => formatAmount(parseDecimal(text)!);
    expect(show("12")).toBe("12");
    expect(show("0.120")).toBe("0.12");
    expect(show("0.123456")).toBe("0.123456");
    expect(show("0.1234565")).toBe("≈0.123457");
    expect(show("0.0000004")).toBe("≈0");
    expect(show("123456789012345678901234567890")).toBe("123456789012345678901234567890");
  });

  it("decides \"≈\" on the exact ratio, not on the 40-digit result", () => {
    expect(formatRatio("10", "3")).toBe("≈3.333333");
    expect(formatRatio("2", "3")).toBe("≈0.666667");
    expect(formatRatio("1", "8")).toBe("0.125");
    expect(formatRatio("1", "3000000")).toBe("≈0");
    expect(formatRatio("12", "1")).toBe("12");
    expect(formatRatio("-2", "3")).toBe("≈-0.666667");
    // Exact to 6 places at 40 digits would show "1"; the true value is 1 + 1e-30.
    expect(formatRatio("1" + "0".repeat(29) + "1", "1" + "0".repeat(30))).toBe("≈1");
  });
});

describe("display on inputs near 40 significant digits", () => {
  it("marks units approximate when the 40-digit result looks exact but the ratio isn't", () => {
    const nines = "9".repeat(30);
    const almost = `${"9".repeat(29)}8`;
    const result = ok({ vialMg: nines, liquidMl: almost, doseMg: almost, syringe: 100, lineSpacing: "1" });
    // units = almost² × 100 ÷ nines = 99…99700 + 100/nines: not whole, not on a line.
    expect(result.display.units).toBe("≈99999999999999999999999999999700");
    expect(result.onLine).toBe(false);
    expect(result.betweenLines).toEqual({ lower: "99999999999999999999999999999700", upper: "99999999999999999999999999999701" });
    expect(result.display.concentration).toBe("≈1");
    expect(result.display.volume.startsWith("≈")).toBe(true);
    // Stored results stay at 40 significant digits.
    expect(result.units).toBe("99999999999999999999999999999700");
  });
});
