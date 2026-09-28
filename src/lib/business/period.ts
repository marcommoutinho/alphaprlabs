// Business periods (design v3 A1 / A2 / A13 / D9; README "Business period":
// Week / Month / custom range / 12 months). Pure: the server, the browser and
// the tests share it. Every date is a business date, a "YYYY-MM-DD" calendar
// day in America/Toronto (src/lib/inventory/screens.ts businessToday), as
// sales and purchases are recorded; arithmetic is on those calendar days
// (UTC dates, so no clock change ever moves a day).
//
//   week    the 7 days ending today (today - 6 through today): seven bars,
//           today last.
//   month   this calendar month to date (day 1 through today).
//   custom  from..to chosen in the range picker: from <= to <= today, at
//           most CUSTOM_MAX_DAYS days (the revenue-by-day chart draws one
//           bar per day; longer spans are what 12 months is for).
//   12m     the 12 calendar months ending with this one (Oct 2025 - Sep 2026
//           on Sep 24, 2026), the current month to date.
//
// Month over month (README rule 7; decision "12 months with month-over-month
// on matching days"): a partial current month (day 1..d, d = today's day
// number) is compared with the same day numbers of the previous month, days
// 1..min(d, that month's length). So Mar 30 and Mar 31 compare with Feb 1-28
// (Feb 1-29 in a leap year), Sep 30 with Aug 1-30, and Jan 24 with Dec 1-24
// of the previous year. Every earlier month is complete and compares with
// the whole previous month.

export type PeriodKind = "week" | "month" | "custom" | "12m";

/** An inclusive range of business dates. */
export type DateRange = { from: string; to: string };

export type Period = DateRange & { kind: PeriodKind };

/** The longest custom range, in days (inclusive). */
export const CUSTOM_MAX_DAYS = 92;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const EN_DASH = "–";

const parse = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
};
const iso = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

/** A real calendar date "YYYY-MM-DD", or null. */
export function businessDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return year >= 2000 && year <= 2999 && iso(year, month, day) === value ? value : null;
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parse(date);
  return iso(year, month, day + days);
}

/** Days from `from` to `to` (0 when equal). */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The first day of the month `date` is in, moved by `months`. */
export function monthStart(date: string, months = 0): string {
  const { year, month } = parse(date);
  return iso(year, month + months, 1);
}

/** How many days the month `date` is in has. */
export function monthLength(date: string): number {
  const { year, month } = parse(date);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Every date of a range, in order. */
export function datesOf(range: DateRange): string[] {
  const count = daysBetween(range.from, range.to) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, index) => addDays(range.from, index));
}

/** A custom range the picker may ask for, or the reason it can't. */
export function checkCustomRange(from: unknown, to: unknown, today: string): { ok: true; range: DateRange } | { ok: false; error: string } {
  const start = businessDate(from);
  const end = businessDate(to);
  if (!start || !end) return { ok: false, error: "Choose a start and an end date." };
  if (start > end) return { ok: false, error: "The start date must be on or before the end date." };
  if (end > today) return { ok: false, error: "The range can't end after today." };
  if (daysBetween(start, end) + 1 > CUSTOM_MAX_DAYS) {
    return { ok: false, error: `Choose ${CUSTOM_MAX_DAYS} days or fewer, or use 12 months.` };
  }
  return { ok: true, range: { from: start, to: end } };
}

/**
 * The period a Business URL asks for: `?range=week|month|12m`, or
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD` for a custom range. Anything else (or an
 * invalid range) is this month to date, the default.
 */
export function readPeriod(params: { range?: unknown; from?: unknown; to?: unknown }, today: string): Period {
  const range = typeof params.range === "string" ? params.range : null;
  if (range === "week") return { kind: "week", from: addDays(today, -6), to: today };
  if (range === "12m") return { kind: "12m", from: monthStart(today, -11), to: today };
  if (range !== "month" && (params.from !== undefined || params.to !== undefined)) {
    const custom = checkCustomRange(params.from, params.to, today);
    if (custom.ok) return { kind: "custom", ...custom.range };
  }
  return { kind: "month", from: monthStart(today), to: today };
}

/** The query string that opens `period` (empty for the default, month). */
export function periodQuery(period: Pick<Period, "kind" | "from" | "to">): string {
  switch (period.kind) {
    case "week":
      return "range=week";
    case "12m":
      return "range=12m";
    case "custom":
      return new URLSearchParams({ from: period.from, to: period.to }).toString();
    default:
      return "";
  }
}

/**
 * The same-days comparison for the month `today` is in: this month's days
 * 1..d and the previous month's days 1..min(d, its length).
 */
export function sameDaysWindow(today: string): { current: DateRange; previous: DateRange } {
  const day = parse(today).day;
  const previousStart = monthStart(today, -1);
  const previousDay = Math.min(day, monthLength(previousStart));
  return {
    current: { from: monthStart(today), to: today },
    previous: { from: previousStart, to: addDays(previousStart, previousDay - 1) },
  };
}

/** The 12 month starts ending with today's month, oldest first. */
export function twelveMonths(today: string): string[] {
  return Array.from({ length: 12 }, (_, index) => monthStart(today, index - 11));
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** "Sep 24" */
export const monthDayLabel = (date: string) => `${MONTHS[parse(date).month - 1]} ${parse(date).day}`;
/** "Sep" */
export const monthShort = (date: string) => MONTHS[parse(date).month - 1];
/** "September" */
export const monthName = (date: string) => MONTH_NAMES[parse(date).month - 1];
/** "S" (the 12-month axis on a phone). */
export const monthInitial = (date: string) => MONTH_NAMES[parse(date).month - 1][0];

/**
 * A range, compact ("Sep 15–24", "Aug 28–Sep 3", "Dec 28–Jan 3"), or spaced
 * with the year for page headers ("Sep 15 – 24, 2026", "Aug 28 – Sep 3,
 * 2026", "Dec 28, 2025 – Jan 3, 2026"). One day is just that day.
 */
export function rangeLabel(range: DateRange, style: "compact" | "header" = "compact"): string {
  const a = parse(range.from);
  const b = parse(range.to);
  const sameYear = a.year === b.year;
  const sameMonth = sameYear && a.month === b.month;
  if (style === "compact") {
    if (range.from === range.to) return monthDayLabel(range.from);
    return sameMonth ? `${MONTHS[a.month - 1]} ${a.day}${EN_DASH}${b.day}` : `${monthDayLabel(range.from)}${EN_DASH}${monthDayLabel(range.to)}`;
  }
  if (range.from === range.to) return `${monthDayLabel(range.from)}, ${a.year}`;
  if (sameMonth) return `${MONTHS[a.month - 1]} ${a.day} ${EN_DASH} ${b.day}, ${b.year}`;
  if (sameYear) return `${monthDayLabel(range.from)} ${EN_DASH} ${monthDayLabel(range.to)}, ${b.year}`;
  return `${monthDayLabel(range.from)}, ${a.year} ${EN_DASH} ${monthDayLabel(range.to)}, ${b.year}`;
}

/** "Oct 2025 – Sep 2026" */
export const monthsLabel = (first: string, last: string) =>
  `${monthShort(first)} ${parse(first).year} ${EN_DASH} ${monthShort(last)} ${parse(last).year}`;

/** The period's header line (A2's mono range above "Overview"). */
export function periodHeader(period: Period): string {
  return period.kind === "12m" ? monthsLabel(period.from, period.to) : rangeLabel(period, "header");
}
