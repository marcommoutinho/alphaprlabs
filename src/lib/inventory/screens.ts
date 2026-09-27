// View helpers for the inventory and sales screens (A4 Inventory and Stock
// item, A5 Record purchase, A6 Record sale, A7 Sales & gross profit): the
// designed copy, labels and the A6 live preview. Pure: no database, no React,
// so the browser, the server and the tests share them. Money stays exact
// decimal text (decimal.js), never binary floating point.
import Decimal from "decimal.js";
import { formatCurrency, formatDate, formatMonthDay, formatUsd } from "@/lib/format";
import {
  allocateFifo,
  PURCHASE_ALREADY_RECORDED,
  saleAmounts,
  usdAmount,
  usdToCad,
  type FifoAllocation,
  type FifoLot,
  type SalesPeriod,
  type UsdConversion,
} from "./rules";

// ── Designed copy (handoff README A4-A7 and the prototype) ──────────────────
export const INVENTORY_SUBTITLE =
  "Whole vials on hand, counted per peptide and strength. Business stock only — never a researcher's personal supplies.";
export const INVENTORY_EMPTY = "No stock items yet. Record a purchase to create one.";
export const PURCHASES_CAPTION = "Oldest first — the order FIFO uses.";
export const SALES_CAPTION = "Each sale keeps the cost it was allocated at the time.";
export const NO_PURCHASES = "No purchases yet.";
export const NO_SALES = "No sales yet.";
export const PURCHASE_SUBTITLE =
  "Adds whole vials to stock and sets the cost FIFO will use for later sales. A USD cost is converted to CAD; all totals are in CAD.";
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

/**
 * `Jordan Reyes (account)` or `K. Osei (outside)`; a sale linked to an
 * account later keeps the name it was recorded with:
 * `Kwame Osei (account · recorded as K. Osei)`.
 */
export function buyerLabel(sale: { buyerType: "account" | "outside"; buyerName: string; originalBuyerName?: string | null }) {
  if (sale.buyerType === "outside") return `${sale.buyerName || "outside buyer"} (outside)`;
  const name = sale.buyerName || "account";
  return sale.originalBuyerName ? `${name} (account · recorded as ${sale.originalBuyerName})` : `${name} (account)`;
}

/** A7 empty state for the current view, or null when it has sales. */
export function salesEmptyText(report: { totals: { sales: number }; hasSales: boolean; hasPurchases: boolean }): string | null {
  if (report.totals.sales > 0) return null;
  if (!report.hasSales) return report.hasPurchases ? SALES_EMPTY_NO_SALES : SALES_EMPTY_NOTHING;
  return SALES_EMPTY_FILTERED;
}

/**
 * Toast after a purchase: `Purchase recorded · 10 vials at CAD 20.00`, or for
 * a USD purchase `Purchase recorded · 10 vials at USD 11.00 = CAD 15.26`.
 */
export const purchaseRecordedToast = (quantity: number, unitCost: string, usdUnitCost?: string) =>
  `Purchase recorded · ${vials(quantity)} at ${usdUnitCost ? `${formatUsd(usdUnitCost)} = ` : ""}${formatCurrency(unitCost)}`;

/**
 * Toast when the entry was already recorded (a retry): for a USD purchase it
 * adds the conversion it was recorded with, which a retry never changes:
 * `… No duplicate created. Recorded as USD 11.00 × 1.3876 (BoC Aug 26) = CAD 15.26.`
 */
export function purchaseAlreadyRecordedToast(recorded: { unitCost: string; usd: UsdConversion | null } | null): string {
  return recorded?.usd
    ? `${PURCHASE_ALREADY_RECORDED} Recorded as ${usdConversionLine({ unitCost: recorded.unitCost, usd: recorded.usd })}.`
    : PURCHASE_ALREADY_RECORDED;
}

// ── USD purchases (Marco, 2026-09-27) ──────────────────────────────────────
export const CURRENCY_OPTIONS = ["CAD", "USD"] as const;
export type PurchaseCurrency = (typeof CURRENCY_OPTIONS)[number];
export const USD_NOTE = "Converted to CAD with the Bank of Canada daily rate for the date received. Stock costs and gross profit stay in CAD.";
export const FX_LOADING = "Getting the Bank of Canada rate…";
/** The preview could not get a rate (the server could not reach the Bank of Canada). */
export const FX_UNAVAILABLE = "Couldn't get the Bank of Canada rate. Try again in a moment.";
/** Saving refused because the rate could not be fetched: nothing recorded, retry. */
export const FX_SAVE_UNAVAILABLE =
  "Couldn't get the Bank of Canada rate, so nothing was recorded. Your entry is still here — try again in a moment.";
/** No rate in the look-back window (fx.ts FX_LOOKBACK_DAYS). */
export const fxNoRateMessage = (receivedOn: string) =>
  `The Bank of Canada has no USD→CAD rate for the 10 days up to ${formatDate(receivedOn)}. Enter this cost in CAD instead.`;

/** `Bank of Canada rate for Aug 26: 1.3876` */
export const fxRateLine = (fx: { rate: string; rateDate: string }) => `Bank of Canada rate for ${formatMonthDay(fx.rateDate)}: ${fx.rate}`;

/**
 * Why an earlier day's rate is used, or null when the date received has its
 * own: today before the day's rate is published (around 4:30 PM ET), or a
 * weekend or holiday.
 */
export function fxEarlierNote(fx: { rateDate: string }, receivedOn: string, today: string): string | null {
  if (fx.rateDate >= receivedOn) return null;
  return receivedOn === today
    ? "Today's rate isn't published yet (around 4:30 PM ET on business days), so the latest earlier rate is used."
    : `No rate was published for ${formatMonthDay(receivedOn)} (weekend or holiday), so the latest earlier rate is used.`;
}

/** A4 purchase line for a USD purchase: `USD 11.00 × 1.3876 (BoC Aug 26) = CAD 15.26` */
export const usdConversionLine = (lot: { unitCost: string; usd: { usdUnitCost: string; rate: string; rateDate: string } }) =>
  `${formatUsd(lot.usd.usdUnitCost)} × ${lot.usd.rate} (BoC ${formatMonthDay(lot.usd.rateDate)}) = ${formatCurrency(lot.unitCost)}`;

/**
 * A5 USD preview with the rate the server fetched: the CAD cost per vial
 * (usdToCad, as the save computes it) and in total, each null (`—`) while the
 * entry can't give one.
 */
export function usdPreview(quantity: string, usdUnitCost: string, rate: string): { unitCost: string | null; total: string | null } {
  const usd = usdAmount(usdUnitCost);
  const unitCost = usd.ok ? usdToCad(usd.value, rate) : null;
  const count = wholeVials(quantity);
  return { unitCost, total: unitCost !== null && count !== null ? new Decimal(unitCost).times(count).toFixed(2) : null };
}

/** Toast after a sale: `Sale recorded · 12 vials · revenue CAD 480.00 · gross profit CAD 230.00` */
export const saleRecordedToast = (sale: { quantity: number; revenue: string; grossProfit: string }) =>
  `Sale recorded · ${vials(sale.quantity)} · revenue ${formatCurrency(sale.revenue)} · gross profit ${formatCurrency(sale.grossProfit)}`;
