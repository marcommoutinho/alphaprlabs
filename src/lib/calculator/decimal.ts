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

// Plain decimal notation only: optional sign, digits, optional fraction.
// No exponents, grouping separators, commas, Infinity or NaN.
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * Parses a decimal string (or finite number) exactly. Returns null for
 * anything that is not a plain finite decimal: empty, text, exponents,
 * commas, over-long input, NaN or Infinity.
 */
export function parseDecimal(value: unknown): Decimal | null {
  let text: string;
  if (typeof value === "string") text = value.trim();
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else return null;
  if (text.length === 0 || text.length > MAX_INPUT_LENGTH || !DECIMAL.test(text)) return null;
  return new Exact(text);
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
 */
export function formatAmount(value: Decimal): string {
  if (value.decimalPlaces() <= DISPLAY_DECIMALS) return plain(value);
  const rounded = value.toDecimalPlaces(DISPLAY_DECIMALS, Decimal.ROUND_HALF_UP);
  return `${APPROX}${plain(rounded)}`;
}
