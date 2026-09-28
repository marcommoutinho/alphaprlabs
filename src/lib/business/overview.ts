// A1 / A2 Business overview and A13 / D9 12 months (design v3), pure: the
// screen models the pages render, built from the database's exact totals
// (src/lib/business/service.ts). Money stays exact decimal text (decimal.js);
// "gross profit" is always gross (revenue minus the cost of stock sold),
// never net. Periods and the month-over-month rule: ./period.ts.
import Decimal from "decimal.js";
import { money, percentOf } from "@/lib/alpha/format";
import { csvField } from "@/lib/progress/csv";
import {
  datesOf,
  monthDayLabel,
  monthInitial,
  monthName,
  monthShort,
  monthsLabel,
  monthStart,
  periodHeader,
  rangeLabel,
  type DateRange,
  type Period,
} from "./period";
import type { DayTotals, MonthTotals, SupplierPurchases, Totals } from "./service";

const ZERO = new Decimal(0);
const dec = (value: string) => new Decimal(value);
const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), ZERO).toFixed(2);

export type Direction = "up" | "down" | "flat";
/** A change between two amounts: its direction and size (never negative). */
export type Change = { direction: Direction; amount: string };

export function changeOf(current: string, previous: string): Change {
  const delta = dec(current).minus(previous);
  return { direction: delta.isZero() ? "flat" : delta.isPositive() ? "up" : "down", amount: delta.abs().toFixed(2) };
}

/** "Up $1,036.01" · "Down $80.00" · "No change" */
export function changeWords(change: Change): string {
  if (change.direction === "flat") return "No change";
  return `${change.direction === "up" ? "Up" : "Down"} ${money(change.amount)}`;
}

// ── People on admin screens (sellers and buyers; admin names are fine here) ──

const words = (name: string) => name.trim().split(/\s+/).filter(Boolean);

/** "Priya Sandhu" → "Priya S." (A1's recent sales); one word stays as it is. */
export function sellerShort(name: string | null): string {
  if (!name) return "No seller";
  const parts = words(name);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : name.trim();
}

/** "Priya Sandhu" → "Priya" (A2's Seller → buyer column). */
export const sellerFirst = (name: string | null) => (name ? words(name)[0] ?? name : "No seller");

/** "Jordan Reyes" → "J. Reyes" (A2); "A. Moreau" and one-word names stay as recorded. */
export function buyerShort(name: string): string {
  const parts = words(name);
  if (parts.length < 2) return name.trim();
  const first = parts[0];
  return /^\p{L}\.$/u.test(first) ? parts.join(" ") : `${first[0]}. ${parts.slice(1).join(" ")}`;
}

// ── A1 / A2: a period (week, month, custom range) ───────────────────────────

export type DayBar = {
  day: string;
  revenue: string;
  /** Bar height as a share of the period's best day (0..1); 0 draws the 2 px stub. */
  height: number;
  today: boolean;
};

export type PeriodOverview = {
  period: Period;
  /** A2's mono line: "Sep 15 – 24, 2026". */
  header: string;
  totals: Totals;
  /** Gross profit below zero: shown in `missed` with a minus sign. */
  negative: boolean;
  /** "89.1%" of revenue; null without revenue. */
  margin: string | null;
  /** The split bar's profit share (0..1); null without revenue. A loss draws it all as cost. */
  profitShare: number | null;
  /** Revenue per vial sold; null with none sold. */
  avgPrice: string | null;
  days: DayBar[];
  /** The day with the most revenue (the earliest of equals); null with no revenue. */
  best: { day: string; revenue: string } | null;
  /** The best day's revenue, for A2's "max $890". */
  max: string;
  /** Under the bars: first day, and "Today" (or the last day when the range ends earlier). */
  axis: [string, string];
};

export function periodOverview(input: { period: Period; today: string; totals: Totals; days: DayTotals[] }): PeriodOverview {
  const { period, today, totals } = input;
  const byDay = new Map(input.days.map((row) => [row.day, row.revenue]));
  const revenues = datesOf(period).map((day) => ({ day, revenue: byDay.get(day) ?? "0.00" }));
  const best = revenues.reduce<{ day: string; revenue: string } | null>(
    (top, row) => (dec(row.revenue).greaterThan(top ? top.revenue : "0") ? row : top),
    null,
  );
  const max = best ? dec(best.revenue) : ZERO;
  const revenue = dec(totals.revenue);
  const gross = dec(totals.grossProfit);
  return {
    period,
    header: periodHeader(period),
    totals,
    negative: gross.isNegative(),
    margin: percentOf(totals.grossProfit, totals.revenue),
    profitShare: revenue.isZero() ? null : Decimal.max(0, Decimal.min(1, gross.dividedBy(revenue))).toNumber(),
    avgPrice: totals.vials > 0 ? revenue.dividedBy(totals.vials).toFixed(2, Decimal.ROUND_HALF_UP) : null,
    days: revenues.map((row) => ({
      day: row.day,
      revenue: row.revenue,
      height: max.isZero() ? 0 : dec(row.revenue).dividedBy(max).toNumber(),
      today: row.day === today,
    })),
    best,
    max: max.toFixed(2),
    axis: [monthDayLabel(period.from), period.to === today ? "Today" : monthDayLabel(period.to)],
  };
}

/** "best Sep 21 · $890.00", or "no sales yet" for a period without revenue. */
export const bestDayLine = (overview: Pick<PeriodOverview, "best">) =>
  overview.best ? `best ${monthDayLabel(overview.best.day)} · ${money(overview.best.revenue)}` : "no sales yet";

// ── A13 / D9: 12 months ─────────────────────────────────────────────────────

export type MonthRow = MonthTotals & {
  /** "Sep" */
  label: string;
  /** "September" */
  name: string;
  /** "S" */
  initial: string;
  /** This month, to date. */
  current: boolean;
  margin: string | null;
  /** Gross profit vs the previous month (the current month: vs its same days). */
  change: Change;
  /** The stacked sales bar: its height as a share of the tallest month (0..1)... */
  barHeight: number;
  /** ...and the hatched cost part's share of that bar (0..1; a loss is all cost). */
  costShare: number;
  /** The supplier purchases bar as a share of the month with the most (0..1; 0: the 2 px stub). */
  purchasesHeight: number;
};

export type SupplierRow = {
  /** null: purchases with no supplier recorded (listed last). */
  name: string | null;
  total: string;
  /** 0..1 of every purchase in the 12 months. */
  share: number;
  /** "53.6%" (phone) and "54%" (laptop). */
  percent: string;
  percentWhole: string;
  /** "USD", "CAD", "CAD + USD"; null for the no-supplier group. */
  currency: string | null;
  orders: number;
};

export type TwelveMonths = {
  /** "Oct 2025 – Sep 2026" */
  header: string;
  /** Oldest first, the current month last. */
  months: MonthRow[];
  current: {
    /** "September" */
    name: string;
    grossProfit: string;
    negative: boolean;
    vials: number;
    change: Change;
    /** "Aug 1–24" */
    vsLabel: string;
    previousGrossProfit: string;
    /** "August" (D9's footnote). */
    previousName: string;
  };
  totals: { revenue: string; grossProfit: string; purchases: string };
  /** The month with the most revenue: "Aug" and its revenue; null with no sales. */
  best: { label: string; revenue: string } | null;
  /** "none in Nov, Apr"; null when every month has purchases. */
  noPurchases: string | null;
  suppliers: SupplierRow[];
};

/**
 * `months`: 13 rows from admin_business_months, the month before the first
 * shown included (so the oldest shown month has a change too). `sameDays`:
 * the previous month's totals for the current month's days (period.ts
 * sameDaysWindow), and that window.
 */
export function twelveMonths(input: {
  months: MonthTotals[];
  sameDays: { previous: Totals; window: DateRange };
  suppliers: SupplierPurchases[];
}): TwelveMonths {
  const all = [...input.months].sort((a, b) => a.month.localeCompare(b.month));
  const shown = all.slice(-12);
  const before = all.length > 12 ? all[all.length - 13] : null;
  const maxBar = shown.reduce((max, m) => Decimal.max(max, dec(m.revenue), dec(m.cost)), ZERO);
  const maxPurchases = shown.reduce((max, m) => Decimal.max(max, dec(m.purchases)), ZERO);
  const last = shown.length - 1;

  const months: MonthRow[] = shown.map((m, index) => {
    const current = index === last;
    const previous = index > 0 ? shown[index - 1] : before;
    const revenue = dec(m.revenue);
    const cost = dec(m.cost);
    const bar = Decimal.max(revenue, cost);
    return {
      ...m,
      label: monthShort(m.month),
      name: monthName(m.month),
      initial: monthInitial(m.month),
      current,
      margin: percentOf(m.grossProfit, m.revenue),
      change: changeOf(m.grossProfit, current ? input.sameDays.previous.grossProfit : (previous?.grossProfit ?? "0.00")),
      barHeight: maxBar.isZero() ? 0 : bar.dividedBy(maxBar).toNumber(),
      costShare: bar.isZero() ? 0 : Decimal.min(1, cost.dividedBy(bar)).toNumber(),
      purchasesHeight: maxPurchases.isZero() ? 0 : dec(m.purchases).dividedBy(maxPurchases).toNumber(),
    };
  });

  const now = months[last];
  const best = months.reduce<MonthRow | null>((top, m) => (dec(m.revenue).greaterThan(top ? top.revenue : "0") ? m : top), null);
  const empty = months.filter((m) => m.purchaseOrders === 0).map((m) => m.label);
  const totalPurchases = sum(input.suppliers.map((s) => s.total));
  const suppliers = [...input.suppliers]
    .sort((a, b) => (a.name === null) !== (b.name === null) ? (a.name === null ? 1 : -1) : dec(b.total).comparedTo(a.total))
    .map((s): SupplierRow => {
      const share = dec(totalPurchases).isZero() ? ZERO : dec(s.total).dividedBy(totalPurchases);
      return {
        name: s.name,
        total: s.total,
        share: share.toNumber(),
        percent: `${share.times(100).toFixed(1, Decimal.ROUND_HALF_UP)}%`,
        percentWhole: `${share.times(100).toFixed(0, Decimal.ROUND_HALF_UP)}%`,
        currency: s.name === null ? null : s.currencies.length > 0 ? [...s.currencies].sort().join(" + ") : null,
        orders: s.orders,
      };
    });

  return {
    header: monthsLabel(shown[0].month, now.month),
    months,
    current: {
      name: now.name,
      grossProfit: now.grossProfit,
      negative: dec(now.grossProfit).isNegative(),
      vials: now.vials,
      change: now.change,
      vsLabel: rangeLabel(input.sameDays.window),
      previousGrossProfit: input.sameDays.previous.grossProfit,
      previousName: monthName(input.sameDays.window.from),
    },
    totals: {
      revenue: sum(months.map((m) => m.revenue)),
      grossProfit: sum(months.map((m) => m.grossProfit)),
      purchases: sum(months.map((m) => m.purchases)),
    },
    best: best ? { label: best.label, revenue: best.revenue } : null,
    noPurchases: empty.length === 0 ? null : empty.length <= 4 ? `none in ${empty.join(", ")}` : `none in ${empty.length} months`,
    suppliers,
  };
}

/** "14 orders" · "1 order" (an order is one recorded purchase). */
export const ordersLabel = (count: number) => `${count.toLocaleString("en-CA")} order${count === 1 ? "" : "s"}`;

// ── D9 Export CSV: the month table ──────────────────────────────────────────

export const MONTHS_CSV_HEADER = [
  "Month",
  "Vials",
  "Revenue (CAD)",
  "Cost of stock sold (CAD)",
  "Gross profit (CAD)",
  "Margin",
  "Purchases (CAD)",
  "Purchase orders",
  "Gross profit change (CAD)",
  "Change compared with",
] as const;

const BOM = "﻿";

/** The month table as CSV, newest month first as on screen (RFC 4180, CRLF, BOM). Amounts are exact decimals; a fall is negative. */
export function monthsCsv(view: TwelveMonths, sameDays: DateRange): string {
  const lines = [MONTHS_CSV_HEADER.map(csvField).join(",")];
  const rows = [...view.months].reverse();
  rows.forEach((m, index) => {
    const previous = rows[index + 1];
    const signed = m.change.direction === "down" ? `-${m.change.amount}` : m.change.amount;
    const compared = m.current ? `${sameDays.from} to ${sameDays.to}` : (previous?.month ?? monthStart(m.month, -1)).slice(0, 7);
    lines.push(
      [
        m.month.slice(0, 7) + (m.current ? " (to date)" : ""),
        String(m.vials),
        m.revenue,
        m.cost,
        m.grossProfit,
        m.margin?.replace("−", "-") ?? "",
        m.purchases,
        String(m.purchaseOrders),
        signed,
        compared,
      ]
        .map(csvField)
        .join(","),
    );
  });
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** "alpha-business-months_2025-10_to_2026-09.csv" */
export const monthsCsvFilename = (view: TwelveMonths) =>
  `alpha-business-months_${view.months[0].month.slice(0, 7)}_to_${view.months[view.months.length - 1].month.slice(0, 7)}.csv`;
