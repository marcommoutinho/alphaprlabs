// View helpers for the stock and records screens (A4 Stock item, A5 Record
// purchase, A6 Record sale): the designed copy, labels and the business's
// calendar. Pure: no database, no React, so the browser, the server and the
// tests share them. Money stays exact decimal text (decimal.js), never binary
// floating point.
import Decimal from "decimal.js";
import { formatCurrency, formatDate, formatMonthDay, formatUsd } from "@/lib/format";
import { PURCHASE_ALREADY_RECORDED, type UsdConversion } from "./rules";

// ── Designed copy (handoff README A4-A7 and the prototype) ──────────────────
export const PURCHASES_CAPTION = "Oldest first — the order FIFO uses.";
export const SALES_CAPTION = "Each sale keeps the cost it was allocated at the time.";
export const NO_PURCHASES = "No purchases yet.";
export const NO_SALES = "No sales yet.";
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
/** A submission reused its idempotency key for different details (a lost response, then an edit). */
export const SUBMISSION_CONFLICT =
  "This form was already saved with different details, so nothing new was recorded. Check the stock item, then reload to start a new entry.";

/** The newest-N note when the stock item lists only part of its sales. */
export const stockSalesTruncatedNote = (shown: number) =>
  `Showing the newest ${shown.toLocaleString("en-CA")} sales of this item.`;

/** `1 vial`, `12 vials` */
export const vials = (count: number) => `${count.toLocaleString("en-CA")} vial${count === 1 ? "" : "s"}`;

/**
 * The business's time zone (Marco, 2026-09-26: the business is local only).
 * Purchase and sale dates, and the Ledger's and Business's periods, follow
 * its calendar, whatever device the admin uses.
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
 * sales are validated against (no future dates), and the periods' anchor.
 * `now` is injectable for tests.
 */
export function businessToday(now: Date = new Date()): string {
  const parts = businessDateParts.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

export type ProfitTone = "negative" | "zero" | "positive";

/** Gross profit color: red below zero, neutral at zero, green above (prototype). */
export function profitTone(amount: string): ProfitTone {
  const value = new Decimal(amount);
  return value.isZero() ? "zero" : value.isNegative() ? "negative" : "positive";
}

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
export const FX_LOADING = "Getting the Bank of Canada rate…";
/** The preview could not get a rate (the server could not reach the Bank of Canada). */
export const FX_UNAVAILABLE = "Couldn't get the Bank of Canada rate. Try again in a moment.";
/** Saving refused because the rate could not be fetched: nothing recorded, retry. */
export const FX_SAVE_UNAVAILABLE =
  "Couldn't get the Bank of Canada rate, so nothing was recorded. Your entry is still here — try again in a moment.";
/** No rate in the look-back window (fx.ts FX_LOOKBACK_DAYS). */
export const fxNoRateMessage = (receivedOn: string) =>
  `The Bank of Canada has no USD→CAD rate for the 10 days up to ${formatDate(receivedOn)}. Enter this cost in CAD instead.`;

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
