// Syringe ruler scale (design v3, COMPONENTS_AND_THEMING §7.8). Pure: the
// ticks, labels, fill and flags the <SyringeRuler> draws for a reading.
//
// Units are U-100 and never rounded: the ruler shows where the exact value
// falls, and says so when it lands between two printed lines or beyond the
// syringe's capacity. Line checks are exact decimals (see src/lib/calculator).
//
//   100-unit syringe: a line every 2 units, major every 10, labels every 10
//    50-unit syringe: a line every 1 unit,  major every 5,  labels every 10
//    30-unit syringe: a line every 0.5 unit, mid every 1, major every 5, labels every 5
//
// The line spacing defaults per capacity (plan, handoff reconciliation 3) and
// can be the researcher's own choice, or unknown (no minor lines are drawn and
// no line check is possible).
import {
  DEFAULT_LINE_SPACING,
  UNKNOWN_LINES_MESSAGE,
  type LineSpacing,
  type SyringeCapacity,
} from "@/lib/calculator/calculator";
import type Decimal from "decimal.js";
import { Exact, formatAmount, plain } from "@/lib/calculator/decimal";

export type TickKind = "minor" | "mid" | "major";

export type SyringeTick = {
  /** Position on the scale, in units (a decimal string, e.g. "0.5"). */
  units: string;
  /** 0–100: percentage of the barrel from the needle end. */
  percent: number;
  kind: TickKind;
  /** Printed number under the tick, when this tick carries one. */
  label: string | null;
};

export type SyringeFlag =
  | { kind: "between-lines"; lower: string; upper: string; message: string }
  | { kind: "over-capacity"; message: string }
  | { kind: "unknown-lines"; message: string };

export type SyringeScale = {
  capacity: SyringeCapacity;
  lineSpacing: LineSpacing;
  ticks: SyringeTick[];
  /** Barrel fill, 0–100, capped at the capacity. */
  fillPercent: number;
  /** Marker position, 0–100; null when the value is off the scale. */
  markerPercent: number | null;
  /** The value's own label on the scale (drawn heavier), when it lands on one. */
  labelAtValue: string | null;
  /** Display text of the value: exact up to 6 decimals, else "≈". */
  unitsText: string;
  overCapacity: boolean;
  /** True on a printed line, false between lines, null when spacing is unknown. */
  onLine: boolean | null;
  flags: SyringeFlag[];
};

/** Major tick and label intervals per capacity (units). */
const MAJOR_EVERY: Record<SyringeCapacity, number> = { 100: 10, 50: 5, 30: 5 };
const LABEL_EVERY: Record<SyringeCapacity, number> = { 100: 10, 50: 10, 30: 5 };

/** Spacing of the printed lines for a syringe when none is given. */
export function defaultLineSpacing(capacity: SyringeCapacity): LineSpacing {
  return DEFAULT_LINE_SPACING[capacity];
}

/**
 * Every tick of the scale, from 0 to the capacity inclusive (the closing tick
 * at capacity is always drawn). Positions are computed in half units, so
 * 0.5-unit spacing needs no floating-point steps.
 */
export function syringeTicks(capacity: SyringeCapacity, lineSpacing: LineSpacing): SyringeTick[] {
  const halves = capacity * 2;
  const major = MAJOR_EVERY[capacity] * 2;
  const label = LABEL_EVERY[capacity] * 2;
  // Unknown spacing: only the major lines, which every syringe prints.
  const step = lineSpacing === "unknown" ? major : Number(lineSpacing) * 2;
  const ticks: SyringeTick[] = [];
  for (let at = 0; at <= halves; at += step) ticks.push(tickAt(at, capacity, major, label, step));
  if (halves % step !== 0) ticks.push(tickAt(halves, capacity, major, label, step));
  return ticks;
}

function tickAt(halves: number, capacity: SyringeCapacity, major: number, label: number, step: number): SyringeTick {
  const isMajor = halves % major === 0 || halves === capacity * 2;
  // A whole-unit line between finer lines is drawn a little longer (30-unit: every 1).
  const isMid = !isMajor && step < 2 && halves % 2 === 0;
  const units = halves % 2 === 0 ? String(halves / 2) : `${(halves - 1) / 2}.5`;
  return {
    units,
    percent: (halves / (capacity * 2)) * 100,
    kind: isMajor ? "major" : isMid ? "mid" : "minor",
    label: halves % label === 0 ? units : null,
  };
}

// Computed values (the calculator's 40-significant-digit `units`) are longer
// than typed input, so this accepts any plain non-negative decimal (up to 30
// whole and 60 fraction digits) rather than the 30-character input rule.
const PLAIN_DECIMAL = /^\d{1,30}(\.\d{1,60})?$/;

function parseUnits(text: string): Decimal | null {
  return typeof text === "string" && PLAIN_DECIMAL.test(text) ? new Exact(text) : null;
}

/**
 * The scale for a reading. `units` is an exact decimal string (for example the
 * calculator's 40-digit `units`); `unitsText` overrides its display text.
 * Returns null for a value that is not a plain, non-negative decimal.
 */
export function syringeScale(input: {
  units: string;
  capacity: SyringeCapacity;
  lineSpacing?: LineSpacing;
  unitsText?: string;
}): SyringeScale | null {
  const value = parseUnits(input.units);
  if (value === null) return null;
  const { capacity } = input;
  const lineSpacing = input.lineSpacing ?? defaultLineSpacing(capacity);
  const unitsText = input.unitsText ?? formatAmount(value);
  const overCapacity = value.greaterThan(capacity);
  const ratio = overCapacity ? 1 : value.dividedBy(capacity).toNumber();
  const flags: SyringeFlag[] = [];

  if (overCapacity) {
    flags.push({
      kind: "over-capacity",
      message: `${unitsText} units is more than a ${capacity}-unit syringe holds.`,
    });
  }

  let onLine: boolean | null = null;
  if (lineSpacing === "unknown") {
    flags.push({ kind: "unknown-lines", message: UNKNOWN_LINES_MESSAGE });
  } else if (!overCapacity) {
    const spacing = new Exact(lineSpacing);
    onLine = value.modulo(spacing).isZero();
    if (!onLine) {
      const lowerValue = value.dividedToIntegerBy(spacing).times(spacing);
      const lower = plain(lowerValue);
      const upper = plain(lowerValue.plus(spacing));
      flags.push({
        kind: "between-lines",
        lower,
        upper,
        message: `On a ${capacity}-unit syringe, ${unitsText} units falls between the ${lower} and ${upper} lines.`,
      });
    }
  }

  const ticks = syringeTicks(capacity, lineSpacing);
  const valueText = plain(value);
  const labelAtValue = overCapacity ? null : (ticks.find((tick) => tick.label === valueText)?.label ?? null);

  return {
    capacity,
    lineSpacing,
    ticks,
    fillPercent: ratio * 100,
    markerPercent: overCapacity ? null : ratio * 100,
    labelAtValue,
    unitsText,
    overCapacity,
    onLine,
    flags,
  };
}
