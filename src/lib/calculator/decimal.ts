// Exact decimal parsing and display for amounts (plan: "Store amounts as
// decimal strings at application boundaries. Calculate with decimal.js ...
// Use decimal arithmetic at 40 significant digits and display up to 6 decimal
// places with an approximation indicator when needed").
import Decimal from "decimal.js";

/** Arithmetic for stored and displayed results: 40 significant digits. */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * Arithmetic for exact comparisons (line checks, capacity, dose over vial).
 * Inputs are capped at {@link MAX_INPUT_LENGTH} characters, so products of
 * two or three inputs stay far below this precision and are exact.
 */
export const Exact = Decimal.clone({ precision: 200, rounding: Decimal.ROUND_DOWN });

/** Longest accepted decimal input, in characters (after trimming). */
export const MAX_INPUT_LENGTH = 30;

/** Display precision: at most this many decimal places. */
export const DISPLAY_DECIMALS = 6;

/** Prefix shown when a displayed value had to be rounded. */
export const APPROX = "≈";

// Plain decimal notation only: optional sign, digits, optional fraction, with
// a dot or a single comma as the decimal point (Marco, 2026-09-26: "1,5" is
// 1.5). No exponents, grouping separators, Infinity or NaN.
const DECIMAL = /^[+-]?(\d+[.,]?\d*|[.,]\d+)$/;
// A comma followed by exactly three digits after a non-zero whole part of up
// to three digits reads as a thousands separator ("1,000", "12,500"), so it is
// refused rather than guessed. "0,125" and "1,25" are unambiguous decimals.
const LOOKS_GROUPED = /^[+-]?[1-9]\d{0,2},\d{3}$/;

/**
 * Canonical text of a decimal input: trimmed, with a decimal comma turned into
 * a dot. Accepts strings only — a JS number has already been through binary
 * floating point, so it is refused. Returns null for anything that is not a
 * plain finite decimal: non-strings, empty, text, exponents, grouping
 * separators ("1,000", "1,000.5", "1.000,5", "1,2,3"), over-long input.
 */
export function normalizeDecimal(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_INPUT_LENGTH || !DECIMAL.test(text) || LOOKS_GROUPED.test(text)) return null;
  return text.replace(",", ".");
}

/** Parses a decimal string exactly (see {@link normalizeDecimal} for what is accepted). */
export function parseDecimal(value: unknown): Decimal | null {
  const text = normalizeDecimal(value);
  return text === null ? null : new Exact(text);
}

/** True when the value is a plain decimal strictly greater than zero. */
export function isPositiveDecimal(value: unknown): boolean {
  const parsed = parseDecimal(value);
  return parsed !== null && parsed.greaterThan(0);
}

/** Plain decimal string without exponent or trailing zeros (e.g. "0.12", "12"). */
export function plain(value: Decimal): string {
  return value.toFixed();
}

/**
 * Display format: the exact value when it has at most 6 decimal places,
 * otherwise rounded half-up to 6 places with trailing zeros removed and the
 * "≈" prefix (e.g. "10", "0.12", "≈3.333333"). Never uses exponents.
 * For a computed quotient use {@link formatRatio}: a value already rounded to
 * 40 significant digits can look exact when it is not.
 */
export function formatAmount(value: Decimal): string {
  if (value.decimalPlaces() <= DISPLAY_DECIMALS) return plain(value);
  const rounded = value.toDecimalPlaces(DISPLAY_DECIMALS, Decimal.ROUND_HALF_UP);
  return `${APPROX}${plain(rounded)}`;
}

const DISPLAY_SCALE = new Exact(10).pow(DISPLAY_DECIMALS);

/**
 * Display format for the exact quotient numerator ÷ denominator (denominator
 * non-zero), as {@link formatAmount} but decided on the exact ratio: "≈" only
 * when the true value has more than 6 decimal places. Inputs are exact
 * decimals of bounded length, so every step here is exact at 200 digits.
 */
export function formatRatio(numerator: Decimal.Value, denominator: Decimal.Value): string {
  const n = new Exact(numerator);
  const d = new Exact(denominator);
  if (d.isZero()) throw new RangeError("Division by zero");
  const negative = n.isNegative() !== d.isNegative() && !n.isZero();
  const scaled = n.abs().times(DISPLAY_SCALE);
  const whole = scaled.dividedToIntegerBy(d.abs());
  const remainder = scaled.minus(whole.times(d.abs()));
  const exact = remainder.isZero();
  // Half-up on the magnitude: round up when the remainder is at least half the divisor.
  const rounded = exact || remainder.times(2).lessThan(d.abs()) ? whole : whole.plus(1);
  const value = rounded.dividedBy(DISPLAY_SCALE);
  const text = plain(negative && !value.isZero() ? value.negated() : value);
  return exact ? text : `${APPROX}${text}`;
}
