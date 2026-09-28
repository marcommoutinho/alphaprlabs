// Design v3 display formatting for times and dates (COMPONENTS_AND_THEMING
// §5 "Number formatting rules"). Pure and client-safe. The mocks use the
// 12-hour clock ("7:30 AM"); dates in lists are "Thu, Sep 24". Times are
// wall-clock times already resolved in the right zone ("HH:MM").
import type Decimal from "decimal.js";
import { Exact, formatAmount, parseDecimal, plain } from "@/lib/calculator/decimal";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "08:05" → "8:05 AM", "00:00" → "12:00 AM", "12:30" → "12:30 PM". */
export function clock12(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${suffix}`;
}

const parts = (date: string) => {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return { weekday: WEEKDAYS[d.getUTCDay()], month: MONTHS[d.getUTCMonth()], day: d.getUTCDate() };
};

/** "2026-09-24" → "Thu, Sep 24". */
export function shortDate(date: string): string {
  const p = parts(date);
  return `${p.weekday}, ${p.month} ${p.day}`;
}

/** "2026-09-24" → "Thu". */
export const weekdayOf = (date: string) => parts(date).weekday;

/** A wall-clock "YYYY-MM-DDTHH:MM" as "Wed 8:00 PM", or "8:00 PM" on `today`. */
export function wallWhen(wall: string, today: string): string {
  const time = clock12(wall.slice(11, 16));
  return wall.slice(0, 10) === today ? time : `${weekdayOf(wall)} ${time}`;
}

/** "In 10 h 48 min", "In 25 min", "In 2 h" (never "In 0 min": "In 1 min"). */
export function untilLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `In ${rest} min`;
  return rest === 0 ? `In ${hours} h` : `In ${hours} h ${rest} min`;
}

// ── Peptide amounts (design v3: "BPC-157 · 250 mcg") ─────────────────────────

/** The unit an amount of peptide is shown in. */
export type MassUnit = "mcg" | "mg";

const THOUSAND = new Exact(1000);
const asExact = (mg: string | Decimal) => (typeof mg === "string" ? parseDecimal(mg) : new Exact(mg));

/** mcg for an amount under 1 mg (other than 0), else mg. Stored values are always mg. */
export function massUnit(mg: string | Decimal): MassUnit {
  const value = asExact(mg);
  return value && !value.isZero() && value.abs().lessThan(1) ? "mcg" : "mg";
}

/**
 * An amount stored in mg as shown (COMPONENTS_AND_THEMING §5 units): under
 * 1 mg in mcg ("0.25" → "250 mcg"), otherwise mg ("2.5 mg", "0 mg"). Only
 * the unit changes: the value is the stored one times 1000, exact, shown by
 * formatAmount's rule ("≈" only past 6 decimal places). Text that is not a
 * decimal is shown as given, in mg.
 */
export function massLabel(mg: string | Decimal): string {
  const value = asExact(mg);
  if (!value) return `${String(mg)} mg`;
  return massUnit(value) === "mcg" ? `${formatAmount(value.times(THOUSAND))} mcg` : `${formatAmount(value)} mg`;
}

/** A stored mg amount as a plain decimal in `unit`, exact ("0.25" → "250" in mcg): an input's starting text. */
export function inMassUnit(mg: string, unit: MassUnit): string {
  const value = parseDecimal(mg);
  if (!value) return mg;
  return plain(unit === "mcg" ? value.times(THOUSAND) : value);
}

/** Input text in `unit` as mg, exact ("250" mcg → "0.25"); text that is not a decimal comes back as typed (the form refuses it). */
export function mgFromUnit(text: string, unit: MassUnit): string {
  const value = parseDecimal(text);
  if (!value) return text;
  return plain(unit === "mcg" ? value.dividedBy(THOUSAND) : value);
}
