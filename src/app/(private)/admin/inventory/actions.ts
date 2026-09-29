"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentAdmin } from "@/lib/auth/session";
import { usdCadRate } from "@/lib/inventory/fx";
import {
  ACCOUNT_REQUIRED,
  convertUsdPurchase,
  PURCHASE_DATE_FUTURE,
  SALE_ALREADY_RECORDED,
  SALE_DATE_FUTURE,
  SELLER_NOT_ADMIN,
  validateLink,
  validatePurchase,
  validateSale,
  type UsdPurchaseEntry,
  type ValidPurchase,
} from "@/lib/inventory/rules";
import { LINK_NOT_LINKABLE, LINK_UNKNOWN_ACCOUNT, linkedToast } from "@/lib/inventory/seller-screens";
import { linkSale } from "@/lib/inventory/sellers";
import {
  businessToday,
  FX_SAVE_UNAVAILABLE,
  fxNoRateMessage,
  purchaseAlreadyRecordedToast,
  SUBMISSION_CONFLICT,
  vials,
} from "@/lib/inventory/screens";
import { onlyOnHand, purchaseRecordedToast, saleRecordedToast, SAVE_UNSURE, STOCK_CHANGED } from "@/lib/records/forms";
import { usdRatePreview, type UsdRatePreview } from "@/lib/records/rate";
import {
  getSale,
  purchaseByKey,
  recordPurchase,
  recordSale,
  replayUsdPurchase,
  type PurchaseResult,
  type RecordedPurchase,
} from "@/lib/inventory/service";
import { createClient } from "@/lib/supabase/server";
import { setStockThreshold, stockLevelOf } from "@/lib/business/service";
import { parseThreshold } from "@/lib/business/stock";

export type InventoryActionResult = {
  /** Inline error under the form. */
  error?: string;
  toast?: string;
  tone?: ToastTone;
  /** Recorded (or already recorded by this same submission): this stock item. */
  stockItemId?: string;
  /**
   * No answer from the database, or one it doesn't define: it may have been
   * recorded. The sheet keeps the request key, so Retry (or Record with the
   * same entry) replays it and never records twice.
   */
  unsure?: boolean;
  /**
   * Refused: the stock is not what the preview showed (sold or bought in
   * between, AP037), or there are fewer vials on hand than asked (AP001).
   * Nothing was recorded; the sheet asks for a new preview.
   */
  stockChanged?: { onHand: number };
};

/**
 * After a purchase or sale is recorded (or found already recorded): the pages
 * that show stock or sales are revalidated, so the stock item the form opens
 * next, A4 Inventory and A7 Sales never come from the client router's cached
 * copy of an earlier visit. In a Server Action, revalidatePath also marks
 * every previously visited page to refetch on its next navigation (Next 16.2
 * docs, revalidatePath "Good to know").
 */
function revalidateStock(stockItemId: string) {
  revalidatePath(`/admin/inventory/${stockItemId}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/ledger");
  revalidatePath("/admin/business");
}

const SAVE_FAILED ="Could not save. Nothing was lost — your entry is still here. Try again.";
const ITEM_GONE = "This stock item no longer exists. The list has been refreshed.";
const PEPTIDE_GONE = "This peptide is no longer in the library. The list has been refreshed.";

/**
 * A5 Record purchase. Every value arrives as the string typed. Dates are
 * checked against today in the business time zone, computed here (never taken
 * from the client). Re-checks that the requester is a signed-in admin; the
 * database function checks it again and is the backstop for future dates.
 */
export async function recordPurchaseAction(input: unknown): Promise<InventoryActionResult> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/ledger?tab=purchases" }));

  const today = businessToday();
  const valid = validatePurchase(input, today);
  if (!valid.ok) return { error: valid.error };

  const db = await createClient();
  let purchase: ValidPurchase | null = null;
  let result: PurchaseResult;
  let recorded: RecordedPurchase | null = null;
  if (valid.value.currency === "USD") {
    // A retry of an entry already recorded (a lost response) replays it
    // without a rate, so it works even while the Bank of Canada is down.
    recorded = await purchaseByKey(db, valid.value.idempotencyKey);
    if (recorded) {
      result = await replayUsdPurchase(db, valid.value);
    } else {
      const usd = await recordNewUsdPurchase(db, valid.value);
      if ("error" in usd) return { error: usd.error };
      ({ purchase, result } = usd);
    }
  } else {
    purchase = valid.value;
    result = await recordPurchase(db, purchase);
  }

  switch (result.kind) {
    case "recorded":
      revalidateStock(result.stockItemId);
      if (result.replayed || !purchase) {
        // The purchase as recorded (its CAD cost and rate), not this retry's.
        recorded ??= valid.value.currency === "USD" ? await purchaseByKey(db, valid.value.idempotencyKey) : null;
        return { stockItemId: result.stockItemId, toast: purchaseAlreadyRecordedToast(recorded), tone: "warn" };
      }
      return { stockItemId: result.stockItemId, toast: purchaseRecordedToast(purchase), tone: "info" };
    case "future_date":
      return { error: PURCHASE_DATE_FUTURE };
    case "rate_changed":
      return { error: FX_SAVE_UNAVAILABLE };
    case "unknown_item":
      refresh();
      return { toast: ITEM_GONE };
    case "unknown_peptide":
      refresh();
      return { toast: PEPTIDE_GONE };
    case "conflict":
      return { toast: SUBMISSION_CONFLICT };
    case "unsure":
      return { error: SAVE_UNSURE, unsure: true };
    default:
      return { toast: SAVE_FAILED };
  }
}

/**
 * A new USD cost: converted here with the Bank of Canada rate looked up now
 * (our stored rates, fx.ts; never the preview's, never the browser's). No
 * rate, no save. The database accepts only the latest stored rate for the
 * window (the same choice as fx.ts); if a newer one was stored between this
 * lookup and the save (the daily sync, or another save's fallback), it
 * refuses (rate_changed) and the rate is looked up again, once.
 */
async function recordNewUsdPurchase(
  db: Awaited<ReturnType<typeof createClient>>,
  entry: UsdPurchaseEntry,
): Promise<{ error: string } | { purchase: ValidPurchase; result: PurchaseResult }> {
  let attempt: { purchase: ValidPurchase; result: PurchaseResult } | null = null;
  for (let tries = 0; tries < 2 && (!attempt || attempt.result.kind === "rate_changed"); tries++) {
    const fx = await usdCadRate(entry.receivedOn);
    if (!fx.ok) return { error: fx.reason === "no_rate" ? fxNoRateMessage(entry.receivedOn) : FX_SAVE_UNAVAILABLE };
    const converted = convertUsdPurchase(entry, fx);
    if (!converted.ok) return { error: converted.error };
    attempt = { purchase: converted.value, result: await recordPurchase(db, converted.value) };
  }
  return attempt!;
}

/**
 * A5 USD rate card: the stored Bank of Canada rate for a date received
 * (lib/records/rate.ts, the lookup the save makes). The sheet reads it from
 * GET /admin/records/rate; this is the same answer as a Server Function.
 */
export async function usdRatePreviewAction(receivedOn: unknown): Promise<UsdRatePreview> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/ledger?tab=purchases" }));
  const { rate, rateDate, error } = await usdRatePreview(receivedOn);
  return error ? { error } : { rate, rateDate };
}

/**
 * A6 Record sale: FIFO allocation, revenue and cost are frozen by the
 * database in one transaction. When stock ran out after the preview, nothing
 * is recorded and the page data is refreshed so the preview shows what is
 * left.
 */
export async function recordSaleAction(input: unknown): Promise<InventoryActionResult> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/ledger" }));

  const valid = validateSale(input, businessToday());
  if (!valid.ok) return { error: valid.error };

  const db = await createClient();
  const result = await recordSale(db, valid.value);
  switch (result.kind) {
    case "recorded": {
      const stockItemId = valid.value.stockItemId;
      revalidateStock(stockItemId);
      if (result.replayed) return { stockItemId, toast: SALE_ALREADY_RECORDED, tone: "warn" };
      return { stockItemId, toast: await recordedSaleToast(db, result.saleId, valid.value.quantity), tone: "info" };
    }
    case "insufficient":
      return { error: onlyOnHand(result.onHand), stockChanged: { onHand: result.onHand } };
    case "stock_changed":
      return { error: STOCK_CHANGED, stockChanged: { onHand: result.onHand } };
    case "future_date":
      return { error: SALE_DATE_FUTURE };
    case "unknown_buyer":
      refresh();
      return { error: ACCOUNT_REQUIRED };
    case "seller_not_admin":
      refresh();
      return { error: SELLER_NOT_ADMIN };
    case "unknown_item":
      refresh();
      return { toast: ITEM_GONE };
    case "conflict":
      return { toast: SUBMISSION_CONFLICT };
    case "unsure":
      return { error: SAVE_UNSURE, unsure: true };
    default:
      return { toast: SAVE_FAILED };
  }
}

export type LinkActionResult = { error?: string; toast?: string; tone?: ToastTone; linked?: boolean };

/**
 * "Link to account…" on an outside buyer's sale (Marco, 2026-09-27): the
 * sale (and optionally every other outside sale with the same buyer name)
 * becomes an account sale. A buyer reference only: nothing else about the
 * sale changes, and the account gains no access and no supplies. The stock
 * item and sales pages are refreshed.
 */
export async function linkSaleAction(input: unknown): Promise<LinkActionResult> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/sales/outside" }));

  const valid = validateLink(input);
  if (!valid.ok) return { error: valid.error };

  const db = await createClient();
  const result = await linkSale(db, valid.value);
  switch (result.kind) {
    case "linked": {
      // Every stock item page (the pattern, with its route group: Next 16.2 docs, revalidatePath).
      revalidatePath("/(private)/admin/inventory/[itemId]", "page");
      revalidatePath("/admin/ledger");
      revalidatePath("/admin/sales/outside");
      // Overview's recent sales name the buyer.
      revalidatePath("/admin/business");
      refresh();
      const sale = await getSale(db, valid.value.saleId).catch(() => null);
      return { linked: true, toast: linkedToast(result.count, sale?.buyerName ?? "the account"), tone: "info" };
    }
    case "not_linkable":
      refresh();
      return { toast: LINK_NOT_LINKABLE };
    case "unknown_buyer":
      return { error: LINK_UNKNOWN_ACCOUNT };
    default:
      return { toast: SAVE_FAILED };
  }
}

export type ThresholdActionResult = {
  error?: string;
  saved?: boolean;
  threshold?: number;
  /** The request key was already saved: nothing changed now. */
  replayed?: boolean;
  /**
   * No answer from the database: it may have been saved. The sheet keeps the
   * request key, so Retry (or Save with the same value) replays it.
   */
  unsure?: boolean;
  /**
   * Refused: the level is no longer the one the sheet was opened with. The
   * current one, when it could be read; the sheet compares against it next.
   */
  changed?: { threshold: number | null };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (input: unknown, name: string): unknown =>
  typeof input === "object" && input !== null ? (input as Record<string, unknown>)[name] : undefined;

/**
 * A3 / D4: an item's reorder level (its low-stock threshold, default 10
 * vials). Admins only: re-checked here and by set_business_stock_threshold,
 * which records who set it and when. A compare-and-set: `expected` is the
 * level the sheet was opened with, and a level changed since (by anyone) is
 * refused with who set it to what; nothing is saved. Idempotent by the
 * request key the sheet made for this entry: a retry replays, the same key
 * with other details is refused. Stock and the overview are refreshed.
 */
export async function setStockThresholdAction(input: unknown): Promise<ThresholdActionResult> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/inventory" }));

  const requestKey = field(input, "requestKey");
  const stockItemId = field(input, "stockItemId");
  if (typeof requestKey !== "string" || !UUID.test(requestKey) || typeof stockItemId !== "string" || !UUID.test(stockItemId)) {
    return { error: THRESHOLD_SAVE_FAILED };
  }
  const expected = parseThreshold(field(input, "expected"));
  if (!expected.ok) return { error: THRESHOLD_SAVE_FAILED };
  const threshold = parseThreshold(field(input, "threshold"));
  if (!threshold.ok) return { error: threshold.error };

  const db = await createClient();
  const result = await setStockThreshold(db, {
    requestKey: requestKey.toLowerCase(),
    stockItemId,
    expected: expected.value,
    threshold: threshold.value,
  });
  switch (result.kind) {
    case "saved":
      revalidatePath("/admin/inventory");
      revalidatePath("/admin/business");
      return { saved: true, threshold: result.threshold, replayed: result.replayed };
    case "unknown_item":
      refresh();
      return { error: ITEM_GONE };
    case "conflict":
      return { error: SUBMISSION_CONFLICT };
    case "invalid":
      return { error: "Enter a whole number of vials, 0 or more." };
    case "not_authorized":
      return { error: THRESHOLD_NOT_ALLOWED };
    case "changed":
      revalidatePath("/admin/inventory");
      revalidatePath("/admin/business");
      refresh();
      return thresholdChanged(db, stockItemId);
    case "unsure":
      return { error: THRESHOLD_SAVE_FAILED, unsure: true };
  }
}

/** "Changed by Owen Marchetti to 8. Nothing was saved." with the level now (nothing was written). */
async function thresholdChanged(db: Awaited<ReturnType<typeof createClient>>, stockItemId: string): Promise<ThresholdActionResult> {
  try {
    const level = await stockLevelOf(db, businessToday(), stockItemId);
    if (!level) return { error: ITEM_GONE };
    const to = level.threshold.toLocaleString("en-CA");
    return {
      error: level.thresholdChangedBy
        ? `Changed by ${level.thresholdChangedBy} to ${to}. Nothing was saved.`
        : `Changed to ${to} since you opened it. Nothing was saved.`,
      changed: { threshold: level.threshold },
    };
  } catch {
    return { error: THRESHOLD_CHANGED_UNREAD, changed: { threshold: null } };
  }
}

const THRESHOLD_SAVE_FAILED = "Couldn't save. Your entry is still here. Try again.";
const THRESHOLD_NOT_ALLOWED = "Only admins can change reorder levels.";
const THRESHOLD_CHANGED_UNREAD = "This reorder level was changed since you opened it. Nothing was saved. Close it and open it again.";

/** The toast with the revenue and gross profit the database froze (not the preview's). */
async function recordedSaleToast(db: Awaited<ReturnType<typeof createClient>>, saleId: string, quantity: number) {
  try {
    const sale = await getSale(db, saleId);
    if (sale) return saleRecordedToast(sale);
  } catch {
    // The sale is recorded; only the amounts for the toast could not be read.
  }
  return `Sale recorded · ${vials(quantity)}`;
}
