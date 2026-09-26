// R7 reconstitution calculator math (handoff "Business Rules" 3, plan D5 and
// "Routine implementation rules"). Pure: converts the dose the researcher
// enters; it never chooses, rounds or splits a dose.
//
//   concentration (mg/mL) = vial mg ÷ liquid mL
//   volume (mL)           = dose mg ÷ concentration   (computed as dose × mL ÷ vial mg)
//   units                 = volume × 100              (U-100 syringe)
//
// Line and capacity checks are exact (decimal.js, no floating point).
import type Decimal from "decimal.js";
import { Dec, Exact, formatAmount, parseDecimal, plain } from "./decimal";

/** Supported U-100 syringes by capacity in units. */
export type SyringeCapacity = 100 | 50 | 30;
/** Spacing of the printed lines, in units, or "unknown" when not checked. */
export type LineSpacing = "0.5" | "1" | "2" | "unknown";

export const SYRINGE_CAPACITIES: readonly SyringeCapacity[] = [100, 50, 30];
export const LINE_SPACINGS: readonly LineSpacing[] = ["0.5", "1", "2", "unknown"];

/** Syringe size labels, as the handoff shows them. */
export const SYRINGE_LABEL: Record<SyringeCapacity, string> = { 100: "1 mL", 50: "0.5 mL", 30: "0.3 mL" };

/**
 * Preselected line spacing per capacity (handoff reconciliation 3:
 * 100 → 2, 50 → 1, 30 → 0.5 units). The researcher can change it or mark it
 * unknown; the capacity alone does not establish the spacing.
 */
export const DEFAULT_LINE_SPACING: Record<SyringeCapacity, Exclude<LineSpacing, "unknown">> = {
  100: "2",
  50: "1",
  30: "0.5",
};

/**
 * Amounts are the text the researcher typed: decimal strings with a dot or a
 * single comma as the decimal point ("1,5" = 1.5). Numbers are refused.
 */
export type CalculatorInput = {
  /** Vial strength in mg, as a decimal string. */
  vialMg: string;
  /** Liquid added in mL, as a decimal string. */
  liquidMl: string;
  /** Intended dose in mg, entered by the researcher, as a decimal string. */
  doseMg: string;
  syringe: SyringeCapacity;
  lineSpacing: LineSpacing;
};

export type CalculatorFlagKind = "over-capacity" | "between-lines" | "unknown-lines";
export type CalculatorFlag = { kind: CalculatorFlagKind; message: string };

export type CalculatorResult =
  | { ok: false; errors: string[] }
  | {
      ok: true;
      /** 40-significant-digit decimal strings, for storage and further math. */
      concentrationMgPerMl: string;
      volumeMl: string;
      units: string;
      /** Display values: exact up to 6 decimals, else "≈" and 6 decimals. */
      display: { concentration: string; volume: string; units: string };
      /** True when units land exactly on a printed line; null when spacing is unknown. */
      onLine: boolean | null;
      /** The printed lines either side, when between lines (display strings). */
      betweenLines: { lower: string; upper: string } | null;
      /** True when units exceed the syringe capacity. */
      overCapacity: boolean;
      /** In the handoff's order: over capacity first, then line spacing. */
      flags: CalculatorFlag[];
      /** Line under the syringe scale, e.g. "1 mL syringe · lines every 2 units · 10 lands on a line". */
      summary: string;
    };

// Validation copy (handoff prototype). All failures are listed together
// under "Can't calculate yet".
export const VIAL_REQUIRED = "Enter the vial strength in mg.";
export const VIAL_POSITIVE = "Vial strength must be more than 0 mg.";
export const LIQUID_REQUIRED = "Enter the liquid added in mL.";
export const LIQUID_POSITIVE = "Liquid added must be more than 0 mL.";
export const DOSE_REQUIRED = "Enter your intended dose in mg.";
export const DOSE_POSITIVE = "Intended dose must be more than 0 mg.";
export const DOSE_OVER_VIAL = "Intended dose is larger than the whole vial.";
// Not in the handoff (its controls only offer valid choices); used for
// tampered or stale input.
export const SYRINGE_REQUIRED = "Choose a syringe size.";
export const LINE_SPACING_REQUIRED = "Choose the line spacing on your syringe, or mark it unknown.";

export const UNKNOWN_LINES_MESSAGE =
  "Line spacing is unknown for this syringe, so the app can't tell whether this dose lands on a printed line. Set the spacing to check.";

const unitWord = (spacing: string) => `unit${spacing === "1" ? "" : "s"}`;

export function isSyringeCapacity(value: unknown): value is SyringeCapacity {
  return value === 100 || value === 50 || value === 30;
}

export function isLineSpacing(value: unknown): value is LineSpacing {
  return typeof value === "string" && (LINE_SPACINGS as readonly string[]).includes(value);
}

/**
 * The note beside the line-spacing control, e.g.
 * "1 mL syringes are lined every 2 units", with " (your override)" when the
 * spacing differs from the preselected default, or
 * "Line spacing unknown for this syringe".
 */
export function lineSpacingNote(syringe: SyringeCapacity, spacing: LineSpacing): string {
  if (spacing === "unknown") return "Line spacing unknown for this syringe";
  const override = spacing !== DEFAULT_LINE_SPACING[syringe] ? " (your override)" : "";
  return `${SYRINGE_LABEL[syringe]} syringes are lined every ${spacing} ${unitWord(spacing)}${override}`;
}

function amountErrors(
  value: Decimal | null,
  required: string,
  positive: string,
): string | null {
  if (value === null) return required;
  if (!value.greaterThan(0)) return positive;
  return null;
}

/** Runs the calculator. Invalid input returns every error, in the handoff's order. */
export function calculate(input: CalculatorInput): CalculatorResult {
  const vial = parseDecimal(input?.vialMg);
  const liquid = parseDecimal(input?.liquidMl);
  const dose = parseDecimal(input?.doseMg);
  const errors: string[] = [];

  const vialError = amountErrors(vial, VIAL_REQUIRED, VIAL_POSITIVE);
  if (vialError) errors.push(vialError);
  const liquidError = amountErrors(liquid, LIQUID_REQUIRED, LIQUID_POSITIVE);
  if (liquidError) errors.push(liquidError);
  const doseError = amountErrors(dose, DOSE_REQUIRED, DOSE_POSITIVE);
  if (doseError) errors.push(doseError);
  // Equal to the whole vial is allowed; only more than the vial is refused.
  else if (vial && !vialError && dose && dose.greaterThan(vial)) errors.push(DOSE_OVER_VIAL);
  if (!isSyringeCapacity(input?.syringe)) errors.push(SYRINGE_REQUIRED);
  if (!isLineSpacing(input?.lineSpacing)) errors.push(LINE_SPACING_REQUIRED);
  if (errors.length > 0 || !vial || !liquid || !dose) return { ok: false, errors };

  const syringe = input.syringe;
  const spacing = input.lineSpacing;
  const [vialMg, liquidMl, doseMg] = [vial, liquid, dose];

  // Exact rational parts: units = (dose × mL × 100) ÷ vial mg.
  const unitsNumerator = new Exact(doseMg).times(liquidMl).times(100);
  const overCapacity = unitsNumerator.greaterThan(new Exact(syringe).times(vialMg));

  const concentration = new Dec(vialMg).dividedBy(liquidMl);
  const volume = new Dec(doseMg).times(liquidMl).dividedBy(vialMg);
  const units = new Dec(unitsNumerator).dividedBy(vialMg);
  const unitsText = formatAmount(units);

  const flags: CalculatorFlag[] = [];
  if (overCapacity) {
    flags.push({
      kind: "over-capacity",
      message: `${unitsText} units exceeds the ${SYRINGE_LABEL[syringe]} syringe (${syringe} units). Choose a larger syringe or add less liquid when mixing.`,
    });
  }

  let onLine: boolean | null = null;
  let betweenLines: { lower: string; upper: string } | null = null;
  if (spacing === "unknown") {
    flags.push({ kind: "unknown-lines", message: UNKNOWN_LINES_MESSAGE });
  } else {
    // units ÷ spacing is a whole number ⇔ (dose × mL × 100) mod (vial mg × spacing) = 0.
    const lineDenominator = new Exact(vialMg).times(spacing);
    onLine = unitsNumerator.modulo(lineDenominator).isZero();
    if (!onLine) {
      const lower = unitsNumerator.dividedToIntegerBy(lineDenominator).times(spacing);
      const upper = lower.plus(spacing);
      betweenLines = { lower: plain(lower), upper: plain(upper) };
      flags.push({
        kind: "between-lines",
        message: `${unitsText} units falls between the ${betweenLines.lower} and ${betweenLines.upper} lines (this syringe is lined every ${spacing} ${unitWord(spacing)}). The app will not round — use a finer syringe or change the intended dose.`,
      });
    }
  }

  const linesPart = spacing === "unknown" ? "line spacing unknown" : `lines every ${spacing} ${unitWord(spacing)}`;
  const checkPart =
    onLine === true ? `${unitsText} lands on a line` : onLine === false ? `${unitsText} is between lines` : "can't check lines";

  return {
    ok: true,
    concentrationMgPerMl: plain(concentration),
    volumeMl: plain(volume),
    units: plain(units),
    display: { concentration: formatAmount(concentration), volume: formatAmount(volume), units: unitsText },
    onLine,
    betweenLines,
    overCapacity,
    flags,
    summary: `${SYRINGE_LABEL[syringe]} syringe · ${linesPart} · ${checkPart}`,
  };
}
