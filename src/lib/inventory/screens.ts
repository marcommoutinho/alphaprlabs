// View helpers for the inventory and sales screens (A4 Inventory and Stock
// item, A5 Record purchase, A6 Record sale, A7 Sales & gross profit): the
// designed copy, labels and the A6 live preview. Pure: no database, no React,
// so the browser, the server and the tests share them. Money stays exact
// decimal text (decimal.js), never binary floating point.
import Decimal from "decimal.js";
import { formatCurrency, formatDate } from "@/lib/format";
import { allocateFifo, saleAmounts, type FifoAllocation, type FifoLot, type SalesPeriod } from "./rules";

// ── Designed copy (handoff README A4-A7 and the prototype) ──────────────────
export const INVENTORY_SUBTITLE =
  "Whole vials on hand, counted per peptide and strength. Business stock only — never a researcher's personal supplies.";
export const INVENTORY_EMPTY = "No stock items yet. Record a purchase to create one.";
export const PURCHASES_CAPTION = "Oldest first — the order FIFO uses.";
export const SALES_CAPTION = "Each sale keeps the cost it was allocated at the time.";
export const NO_PURCHASES = "No purchases yet.";
export const NO_SALES = "No sales yet.";
export const PURCHASE_SUBTITLE =
  "Adds whole vials to stock and sets the cost FIFO will use for later sales. All amounts in CAD.";
export const PURCHASE_FOOTNOTE =
  "Purchases already allocated to sales can't be edited here — historical gross profit must not change. Corrections are out of scope for this MVP.";
export const NEW_ITEM_OPTION = "New peptide / strength…";
export const SALE_INTRO =
  "Manual entry. No ordering, checkout or payment happens here. Linking a researcher account is a buyer reference only — it grants no access to their private records and adds nothing to their personal supplies.";
export const SALE_PREVIEW_FOOTNOTE =
  "Gross profit is revenue minus the purchase cost of these vials. It is not net profit; other expenses aren't included.";
export const OUTSIDE_BUYER_PLACEHOLDER = "No app account needed";
export const BUYER_SEARCH_PLACEHOLDER = "Search by name or email";
export const BUYER_SEARCH_EMPTY = "No account matches.";

/** A6 buyer account as shown: `Jordan Reyes · jordan@example.com`. */
export const accountLabel = (account: { name: string; email: string }) => `${account.name} · ${account.email}`;

/** A6 account search: the name, the email or `Name · email` contains the typed text (any case). */
export function accountMatches(account: { name: string; email: string }, query: string): boolean {
  const text = query.trim().toLocaleLowerCase("en-CA");
  const lower = (value: string) => value.toLocaleLowerCase("en-CA");
  return !text || [account.name, account.email, accountLabel(account)].some((value) => lower(value).includes(text));
}
export const SALES_NOTE =
  "Gross profit = revenue − FIFO purchase cost of the vials sold. Not net profit. Current stock is a separate figure — see Inventory.";
export const SALES_EMPTY_NOTHING = "No purchases or sales yet.";
export const SALES_EMPTY_NO_SALES = "Purchases recorded, no sales yet.";
export const SALES_EMPTY_FILTERED = "No sales match this period and item.";
export const ALL_ITEMS_OPTION = "All peptides & strengths";
export const PERIOD_OPTIONS: readonly { value: SalesPeriod; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "month", label: "This month" },
  { value: "prev", label: "Last month" },
];
/** A submission reused its idempotency key for different details (a lost response, then an edit). */
export const SUBMISSION_CONFLICT =
  "This form was already saved with different details, so nothing new was recorded. Check the stock item, then reload to start a new entry.";

/** The newest-N note when a list holds only part of the sales (the totals still cover all of them). */
export const salesTruncatedNote = (shown: number) =>
  `Showing the newest ${shown.toLocaleString("en-CA")} sales. The totals above include every sale in this view.`;
export const stockSalesTruncatedNote = (shown: number) =>
  `Showing the newest ${shown.toLocaleString("en-CA")} sales of this item.`;

/** `1 vial`, `12 vials` */
export const vials = (count: number) => `${count.toLocaleString("en-CA")} vial${count === 1 ? "" : "s"}`;

/**
 * The business's time zone (Marco, 2026-09-26: the business is local only).
 * Purchase and sale dates, and A7's This month / Last month, follow its
 * calendar, whatever device the admin uses.
 */
export const BUSINESS_TIME_ZONE = "America/Toronto";

const businessDateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Today's date in the business time zone (`YYYY-MM-DD`), computed on the
 * server: the default for Received and Sale date, the `today` purchases and
 * sales are validated against (no future dates), and A7's period anchor.
 * `now` is injectable for tests.
 */
export function businessToday(now: Date = new Date()): string {
  const parts = businessDateParts.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

/** A7 Period from a URL value: this month, last month, else all time. */
export const salesPeriodOf = (value: unknown): SalesPeriod => (value === "month" || value === "prev" ? value : "all");

/** A whole number of vials above 0 as typed, or null. */
function wholeVials(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const count = Number(text);
  return count > 0 && Number.isSafeInteger(count) ? count : null;
}

/** A CAD amount (0 or more) as typed, or null. */
function cad(raw: string): string | null {
  const text = raw.trim();
  return /^\d+(\.\d+)?$/.test(text) ? new Decimal(text).toString() : null;
}

/** A5 summary card: the total purchase cost as typed, or `—`. */
export function purchaseTotal(quantity: string, unitCost: string): string {
  const count = wholeVials(quantity);
  const cost = cad(unitCost);
  return count !== null && cost !== null ? formatCurrency(new Decimal(cost).times(count).toFixed(2)) : "—";
}

export type ProfitTone = "negative" | "zero" | "positive";

/** Gross profit color: red below zero, neutral at zero, green above (prototype). */
export function profitTone(amount: string): ProfitTone {
  const value = new Decimal(amount);
  return value.isZero() ? "zero" : value.isNegative() ? "negative" : "positive";
}

export type SalePreview = {
  available: number;
  /** More vials asked for than are on hand: saving is blocked. */
  short: boolean;
  /** Exact `0.00` strings, or null while the entry can't give one (shown as `—`). */
  revenue: string | null;
  cost: string | null;
  grossProfit: string | null;
  /** Cost allocation, oldest stock first (empty unless the sale fits). */
  allocations: FifoAllocation[];
};

/**
 * A6 live preview, as the prototype computes it and the database allocates:
 * revenue = vials × price; cost = FIFO over the item's open lots (allocateFifo,
 * the same order record_business_sale uses); gross profit = revenue − cost.
 * `lots` null means the item's lots are still loading.
 */
export function salePreview(input: { onHand: number; lots: FifoLot[] | null; quantity: string; unitPrice: string }): SalePreview {
  const count = wholeVials(input.quantity);
  const price = cad(input.unitPrice);
  const short = count !== null && count > input.onHand;
  const fits = count !== null && !short && input.lots !== null;
  const fifo = fits ? allocateFifo(input.lots!, count) : null;
  // The lots cover the on-hand count; a gap means they belong to an older snapshot.
  const cost = fifo && fifo.short === 0 ? fifo.cost : null;
  const revenue = count !== null && price !== null ? new Decimal(price).times(count).toFixed(2) : null;
  return {
    available: input.onHand,
    short,
    revenue,
    cost,
    grossProfit: revenue !== null && cost !== null ? saleAmounts(count!, price!, cost).grossProfit : null,
    allocations: cost !== null && fifo ? fifo.allocations : [],
  };
}

/** A6 allocation line: `10 × CAD 20.00 from the Aug 15, 2026 purchase` (prototype copy). */
export const previewAllocationLine = (a: Pick<FifoAllocation, "quantity" | "unitCost" | "receivedOn">) =>
  `${a.quantity} × ${formatCurrency(a.unitCost)} from the ${formatDate(a.receivedOn)} purchase`;

/** A sale's frozen allocation in short: `10 × CAD 20.00 + 2 × CAD 25.00`. */
export const allocationSummary = (allocations: { quantity: number; unitCost: string }[]) =>
  allocations.map((a) => `${a.quantity} × ${formatCurrency(a.unitCost)}`).join(" + ");

/** A4 Stock item purchase sub-line: how many of the lot's vials sales already use. */
export const lotNote = (lot: { quantity: number; allocated: number }) =>
  lot.allocated > 0 ? `${lot.allocated} of ${lot.quantity} allocated to sales · cost locked` : "None allocated yet";

/** `Jordan Reyes (account)` or `K. Osei (outside)` */
export const buyerLabel = (sale: { buyerType: "account" | "outside"; buyerName: string }) =>
  sale.buyerType === "account" ? `${sale.buyerName || "account"} (account)` : `${sale.buyerName || "outside buyer"} (outside)`;

/** A7 empty state for the current view, or null when it has sales. */
export function salesEmptyText(report: { totals: { sales: number }; hasSales: boolean; hasPurchases: boolean }): string | null {
  if (report.totals.sales > 0) return null;
  if (!report.hasSales) return report.hasPurchases ? SALES_EMPTY_NO_SALES : SALES_EMPTY_NOTHING;
  return SALES_EMPTY_FILTERED;
}

/** Toast after a purchase: `Purchase recorded · 10 vials at CAD 20.00` */
export const purchaseRecordedToast = (quantity: number, unitCost: string) =>
  `Purchase recorded · ${vials(quantity)} at ${formatCurrency(unitCost)}`;

/** Toast after a sale: `Sale recorded · 12 vials · revenue CAD 480.00 · gross profit CAD 230.00` */
export const saleRecordedToast = (sale: { quantity: number; revenue: string; grossProfit: string }) =>
  `Sale recorded · ${vials(sale.quantity)} · revenue ${formatCurrency(sale.revenue)} · gross profit ${formatCurrency(sale.grossProfit)}`;
