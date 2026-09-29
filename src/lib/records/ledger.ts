// A7 / A14 / D5 Ledger: every sale and purchase in a range, by day or by
// month. Pure (no database, no React): the page, the browser and the tests
// share it. Dates are business dates (America/Toronto, as recorded); money
// is exact decimal text summed with decimal.js and shown with `money`.
import Decimal from "decimal.js";
import { money, monthDay, shortDate } from "@/lib/alpha/format";
import { sellerFirst } from "@/lib/business/overview";
import {
  addDays,
  checkCustomRange,
  daysBetween,
  monthName,
  monthStart,
  monthsLabel,
  rangeLabel,
  businessDate,
  type DateRange,
} from "@/lib/business/period";
import { usd } from "./forms";

export type LedgerTab = "sales" | "purchases";
export type LedgerGroup = "day" | "month";

/** The URL value for sales recorded before sellers existed (no seller). */
export const NO_SELLER = "none";
/** Its key in the database functions (admin_business_ledger_sales p_seller). */
export const NO_SELLER_KEY = "00000000-0000-0000-0000-000000000000";
/** The longest month view: 36 months. */
export const LEDGER_MONTHS_MAX = 36;

export type LedgerView = {
  tab: LedgerTab;
  group: LedgerGroup;
  range: DateRange;
  /** A range the admin chose (else the group's default). */
  custom: boolean;
  /** A seller's profile id, NO_SELLER, or null for every seller (Sales only). */
  seller: string | null;
  /** One stock item, or null for all. */
  item: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);

/** Day view: this month to date. Month view: the 12 months ending with this one. */
export const defaultRange = (group: LedgerGroup, today: string): DateRange =>
  group === "month" ? { from: monthStart(today, -11), to: today } : { from: monthStart(today), to: today };

/** Whole months from `from`'s to `to`'s, inclusive. */
const monthsSpanned = (range: DateRange) =>
  (Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4))) * 12 + Number(range.to.slice(5, 7)) - Number(range.from.slice(5, 7)) + 1;

/**
 * The Ledger a URL asks for: `?tab=purchases`, `?group=month`,
 * `?from=&to=` (day view: at most 92 days; month view: whole months, at
 * most 36), `?seller=<id>|none`, `?item=<stock item>`. Anything invalid is
 * the default.
 */
export function readLedgerView(params: Record<string, unknown>, today: string): LedgerView {
  const tab: LedgerTab = one(params.tab) === "purchases" ? "purchases" : "sales";
  const group: LedgerGroup = one(params.group) === "month" ? "month" : "day";
  const sellerParam = one(params.seller);
  const seller = sellerParam === NO_SELLER ? NO_SELLER : typeof sellerParam === "string" && UUID.test(sellerParam) ? sellerParam.toLowerCase() : null;
  const itemParam = one(params.item);
  const item = typeof itemParam === "string" && UUID.test(itemParam) ? itemParam.toLowerCase() : null;
  const from = one(params.from);
  const to = one(params.to);
  let range = defaultRange(group, today);
  let custom = false;
  if (from !== undefined || to !== undefined) {
    if (group === "day") {
      const checked = checkCustomRange(from, to, today);
      if (checked.ok) {
        range = checked.range;
        custom = true;
      }
    } else {
      const start = businessDate(from);
      const end = businessDate(to);
      if (start && end && start <= end && end <= today) {
        const months = { from: monthStart(start), to: end };
        if (monthsSpanned(months) <= LEDGER_MONTHS_MAX) {
          range = months;
          custom = true;
        }
      }
    }
  }
  return { tab, group, range, custom, seller: tab === "sales" ? seller : null, item };
}

/** The Ledger's address for `view` with `changes`; a new group starts on its default range. */
export function ledgerHref(
  view: LedgerView,
  changes: Partial<{ tab: LedgerTab; group: LedgerGroup; range: DateRange | null; seller: string | null; item: string | null }> = {},
): string {
  const tab = changes.tab ?? view.tab;
  const group = changes.group ?? view.group;
  const range = changes.range !== undefined ? changes.range : changes.group && changes.group !== view.group ? null : view.custom ? view.range : null;
  const seller = changes.seller !== undefined ? changes.seller : view.seller;
  const item = changes.item !== undefined ? changes.item : view.item;
  const query = new URLSearchParams();
  if (tab === "purchases") query.set("tab", "purchases");
  if (group === "month") query.set("group", "month");
  if (range) {
    query.set("from", range.from);
    query.set("to", range.to);
  }
  if (tab === "sales" && seller) query.set("seller", seller);
  if (item) query.set("item", item);
  const text = query.toString();
  return text ? `/admin/ledger?${text}` : "/admin/ledger";
}

/** The range chip: "Sep 1–24" (days) or "Oct 2025 – Sep 2026" (months). */
export const rangeChip = (view: Pick<LedgerView, "group" | "range">) =>
  view.group === "month" ? monthsLabel(view.range.from, view.range.to) : rangeLabel(view.range);

/** D5's mono line above the title: "Sep 1 – 24, 2026". */
export const rangeHeader = (view: Pick<LedgerView, "group" | "range">) =>
  view.group === "month" ? monthsLabel(view.range.from, view.range.to) : rangeLabel(view.range, "header");

/** Presets the range sheet offers for the day view. */
export function dayPresets(today: string): { key: string; label: string; range: DateRange }[] {
  const lastMonth = monthStart(today, -1);
  return [
    { key: "month", label: "This month", range: { from: monthStart(today), to: today } },
    { key: "7d", label: "Last 7 days", range: { from: addDays(today, -6), to: today } },
    { key: "30d", label: "Last 30 days", range: { from: addDays(today, -29), to: today } },
    { key: "prev", label: "Last month", range: { from: lastMonth, to: addDays(monthStart(today), -1) } },
  ];
}

/** Presets for the month view. */
export function monthPresets(today: string): { key: string; label: string; range: DateRange }[] {
  const year = today.slice(0, 4);
  return [
    { key: "12m", label: "12 months", range: { from: monthStart(today, -11), to: today } },
    { key: "ytd", label: "This year", range: { from: `${year}-01-01`, to: today } },
    { key: "24m", label: "24 months", range: { from: monthStart(today, -23), to: today } },
    { key: "36m", label: "36 months", range: { from: monthStart(today, -35), to: today } },
  ];
}

/** Whether a month-view range is allowed (whole months, at most 36, not after today). */
export function checkMonthRange(from: unknown, to: unknown, today: string): { ok: true; range: DateRange } | { ok: false; error: string } {
  const start = businessDate(from);
  const end = businessDate(to);
  if (!start || !end) return { ok: false, error: "Choose a start and an end date." };
  if (start > end) return { ok: false, error: "The start date must be on or before the end date." };
  if (end > today) return { ok: false, error: "The range can't end after today." };
  const range = { from: monthStart(start), to: end };
  if (monthsSpanned(range) > LEDGER_MONTHS_MAX) return { ok: false, error: `Choose ${LEDGER_MONTHS_MAX} months or fewer.` };
  return { ok: true, range };
}

// ── Entries ───────────────────────────────────────────────────────────────

/** mg as stored ("10.000") without trailing zeros ("10"). */
export const mg = (strength: string) => new Decimal(strength).toString();
/** "BPC-157 · 10 mg" */
export const itemLabel = (peptideName: string, strengthMg: string) => `${peptideName} · ${mg(strengthMg)} mg`;

export type LedgerSale = {
  id: string;
  sortKey: string;
  soldOn: string;
  itemId: string;
  item: string;
  quantity: number;
  unitPrice: string;
  revenue: string;
  cost: string;
  grossProfit: string;
  sellerId: string | null;
  sellerName: string | null;
  buyerType: "account" | "outside";
  buyerName: string;
  originalBuyerName: string | null;
};

export type LedgerPurchase = {
  id: string;
  sortKey: string;
  receivedOn: string;
  itemId: string;
  item: string;
  quantity: number;
  /** CAD per vial. */
  unitCost: string;
  totalCost: string;
  currency: "CAD" | "USD";
  usdUnitCost: string | null;
  fxRate: string | null;
  fxRateDate: string | null;
  supplier: string | null;
};

/** "BPC-157 · 10 mg × 3" */
export const entryTitle = (entry: { item: string; quantity: number }) => `${entry.item} × ${entry.quantity.toLocaleString("en-CA")}`;

/** "Priya → Jordan Reyes · $120.00 ea" (A7 sale row, mono). */
export const saleLine = (sale: Pick<LedgerSale, "sellerName" | "buyerName" | "unitPrice">) =>
  `${sellerFirst(sale.sellerName)} → ${sale.buyerName || "Outside buyer"} · ${money(sale.unitPrice)} ea`;

/** "GP $319.86" */
export const gpLabel = (grossProfit: string) => `GP ${money(grossProfit)}`;

/** A purchase's unit cost as entered: "US$ 9.20" or "$13.38". */
export const unitCostLabel = (purchase: Pick<LedgerPurchase, "currency" | "usdUnitCost" | "unitCost">) =>
  purchase.currency === "USD" && purchase.usdUnitCost ? usd(purchase.usdUnitCost) : money(purchase.unitCost);

/** The rate a USD purchase was converted with ("1.3741"), "—" for CAD. */
export const rateLabel = (purchase: Pick<LedgerPurchase, "fxRate">) => purchase.fxRate ?? "—";

export const NO_SUPPLIER = "No supplier recorded";

/** "Halcyon Peptides · US$ 9.20 · 1.3741" (A7 purchase row, mono). */
export const purchaseLine = (purchase: LedgerPurchase) =>
  [purchase.supplier ?? "No supplier", unitCostLabel(purchase), purchase.fxRate ? `at ${purchase.fxRate}` : null].filter(Boolean).join(" · ");

export type Totals = { entries: number; vials: number; revenue: string; cost: string; grossProfit: string; total: string };

const ZERO = new Decimal(0);

export function saleTotals(sales: readonly Pick<LedgerSale, "quantity" | "revenue" | "cost" | "grossProfit">[]): Totals {
  let revenue = ZERO;
  let cost = ZERO;
  let gp = ZERO;
  let vials = 0;
  for (const sale of sales) {
    revenue = revenue.plus(sale.revenue);
    cost = cost.plus(sale.cost);
    gp = gp.plus(sale.grossProfit);
    vials += sale.quantity;
  }
  return { entries: sales.length, vials, revenue: revenue.toFixed(2), cost: cost.toFixed(2), grossProfit: gp.toFixed(2), total: revenue.toFixed(2) };
}

export function purchaseTotals(purchases: readonly Pick<LedgerPurchase, "quantity" | "totalCost">[]): Totals {
  let total = ZERO;
  let vials = 0;
  for (const purchase of purchases) {
    total = total.plus(purchase.totalCost);
    vials += purchase.quantity;
  }
  return { entries: purchases.length, vials, revenue: "0.00", cost: total.toFixed(2), grossProfit: "0.00", total: total.toFixed(2) };
}

export type DayGroup<E> = { day: string; totals: Totals; entries: E[] };

/** A7: entries (newest first) grouped by day, newest day first, each with its totals. */
export function byDay<E extends LedgerSale | LedgerPurchase>(entries: readonly E[]): DayGroup<E>[] {
  const sorted = [...entries].sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
  const groups: DayGroup<E>[] = [];
  for (const entry of sorted) {
    const day = "soldOn" in entry ? entry.soldOn : entry.receivedOn;
    const last = groups.at(-1);
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, totals: saleTotals([]), entries: [entry] });
  }
  for (const group of groups) {
    group.totals =
      group.entries.length > 0 && "soldOn" in group.entries[0]
        ? saleTotals(group.entries as LedgerSale[])
        : purchaseTotals(group.entries as LedgerPurchase[]);
  }
  return groups;
}

/** A7 day header: "Thu, Sep 24". */
export const dayTitle = (day: string) => shortDate(day);

/** D5's date column: "Sep 23". */
export const dayShort = (day: string) => monthDay(day);

// ── A14 by month ──────────────────────────────────────────────────────────

export type MonthItem = {
  key: string;
  month: string;
  itemId: string;
  item: string;
  entries: number;
  vials: number;
  revenue: string;
  cost: string;
  grossProfit: string;
  /** Purchases: the CAD total. Sales: the revenue. */
  total: string;
  /** Purchases: the one supplier, or null (none, or several: see supplierCount). */
  supplier: string | null;
  supplierCount: number;
  noSupplier: number;
};

export type MonthGroup = { month: string; totals: Totals; items: MonthItem[] };

/** A14: month rows grouped by month, newest first; items by revenue (sales) or total (purchases), largest first. */
export function byMonth(items: readonly MonthItem[]): MonthGroup[] {
  const months = new Map<string, MonthItem[]>();
  for (const item of items) months.set(item.month, [...(months.get(item.month) ?? []), item]);
  return [...months.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, rows]) => {
      let revenue = ZERO;
      let cost = ZERO;
      let gp = ZERO;
      let total = ZERO;
      let vials = 0;
      let entries = 0;
      for (const row of rows) {
        revenue = revenue.plus(row.revenue);
        cost = cost.plus(row.cost);
        gp = gp.plus(row.grossProfit);
        total = total.plus(row.total);
        vials += row.vials;
        entries += row.entries;
      }
      return {
        month,
        totals: { entries, vials, revenue: revenue.toFixed(2), cost: cost.toFixed(2), grossProfit: gp.toFixed(2), total: total.toFixed(2) },
        items: [...rows].sort((a, b) => new Decimal(b.total).comparedTo(a.total) || a.item.localeCompare(b.item, "en", { numeric: true })),
      };
    });
}

/** "September to date" (the current month), "August", "December 2025" (another year). */
export function monthTitle(month: string, today: string): string {
  if (month.slice(0, 7) === today.slice(0, 7)) return `${monthName(month)} to date`;
  return month.slice(0, 4) === today.slice(0, 4) ? monthName(month) : `${monthName(month)} ${month.slice(0, 4)}`;
}

/** "55 vials · GP $6,057.16" (sales) or "3 orders · 120 vials" (purchases). */
export function monthLine(tab: LedgerTab, totals: Totals): string {
  const vials = `${totals.vials.toLocaleString("en-CA")} vial${totals.vials === 1 ? "" : "s"}`;
  return tab === "sales" ? `${vials} · ${gpLabel(totals.grossProfit)}` : `${ordersText(totals.entries)} · ${vials}`;
}

const ordersText = (count: number) => `${count.toLocaleString("en-CA")} order${count === 1 ? "" : "s"}`;

/** A month's purchase item: its one supplier, "3 suppliers", or "No supplier recorded". */
export function supplierSummary(item: Pick<MonthItem, "supplier" | "supplierCount" | "noSupplier">): string {
  if (item.supplierCount === 1 && item.supplier) return item.noSupplier > 0 ? `${item.supplier} + no supplier` : item.supplier;
  if (item.supplierCount > 1) return `${item.supplierCount} suppliers`;
  return NO_SUPPLIER;
}

/** A month's range within the view (the current month ends today). */
export const monthRange = (month: string, view: DateRange): DateRange => {
  const start = month > view.from ? month : view.from;
  const end = addDays(monthStart(month, 1), -1);
  return { from: start, to: end < view.to ? end : view.to };
};

/** Days in a range, inclusive. */
export const daysIn = (range: DateRange) => daysBetween(range.from, range.to) + 1;

/** The Sales tab's label: "Sales · 32 vials". */
export const salesTabLabel = (vials: number | null) =>
  vials === null ? "Sales" : `Sales · ${vials.toLocaleString("en-CA")} vial${vials === 1 ? "" : "s"}`;

export const LEDGER_EMPTY = {
  sales: "No sales in this range.",
  purchases: "No purchases in this range.",
  salesSeller: "No sales by this seller in this range.",
} as const;
