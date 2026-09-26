// Display formatting shared by the private app (handoff "Global patterns").
//   Currency: CAD 1,234.00   (en-CA grouping, always 2 decimals)
//   Dates:    Fri Sep 11 · Sep 11 · Sep 11, 2026 · Fri Sep 11 · 07:30 (24-hour clock)

const EMPTY = "—";

const cadNumber = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  // Never render "-0.00" for values that round to zero.
  signDisplay: "negative",
});

/**
 * Formats an amount as `CAD 1,234.00`. Accepts a number or a decimal string
 * (such as a Postgres `numeric`), which Intl formats exactly without going
 * through binary floating point. Missing or non-finite input renders `—`.
 */
export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return EMPTY;
  if (typeof amount === "number" && !Number.isFinite(amount)) return EMPTY;
  if (typeof amount === "string" && !/^-?\d+(\.\d+)?$/.test(amount.trim())) return EMPTY;
  // Intl.NumberFormat accepts decimal strings (ES2023), but the DOM typings
  // only declare number | bigint.
  return `CAD ${cadNumber.format(amount as number)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

type Parts = { year: number; month: number; day: number; weekday: number; hour: number; minute: number };

export type DateInput = Date | string;
export type DateFormatOptions = {
  /** IANA time zone used for instants. Defaults to the runtime's zone. */
  timeZone?: string;
};

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let formatter = partsFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Resolves the calendar parts of a value. A `YYYY-MM-DD` string is a plain
 * calendar date (never shifted by a time zone); anything else is an instant
 * shown in `timeZone`.
 */
function toParts(value: DateInput, timeZone: string | undefined): Parts {
  if (typeof value === "string") {
    const match = DATE_ONLY.exec(value);
    if (match) {
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
      const utc = new Date(Date.UTC(year, month - 1, day));
      if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
        throw new RangeError(`Invalid calendar date: ${value}`);
      }
      return { year, month, day, weekday: utc.getUTCDay(), hour: 0, minute: 0 };
    }
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${String(value)}`);
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const [year, month, day] = [get("year"), get("month"), get("day")];
  return {
    year,
    month,
    day,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    hour: get("hour"),
    minute: get("minute"),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `Fri Sep 11` */
export function formatDay(value: DateInput, options: DateFormatOptions = {}): string {
  const p = toParts(value, options.timeZone);
  return `${WEEKDAYS[p.weekday]} ${MONTHS[p.month - 1]} ${p.day}`;
}

/** `Sep 11` (A3 "updated Aug 28") */
export function formatMonthDay(value: DateInput, options: DateFormatOptions = {}): string {
  const p = toParts(value, options.timeZone);
  return `${MONTHS[p.month - 1]} ${p.day}`;
}

/** `Sep 11, 2026` */
export function formatDate(value: DateInput, options: DateFormatOptions = {}): string {
  const p = toParts(value, options.timeZone);
  return `${MONTHS[p.month - 1]} ${p.day}, ${p.year}`;
}

/** `Fri Sep 11 · 07:30` (24-hour clock) */
export function formatDateTime(value: DateInput, options: DateFormatOptions = {}): string {
  const p = toParts(value, options.timeZone);
  return `${WEEKDAYS[p.weekday]} ${MONTHS[p.month - 1]} ${p.day} · ${pad2(p.hour)}:${pad2(p.minute)}`;
}
