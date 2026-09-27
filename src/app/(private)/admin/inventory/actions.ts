"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentAdmin } from "@/lib/auth/session";
import { usdCadRate } from "@/lib/inventory/fx";
import {
  ACCOUNT_REQUIRED,
  calendarDate,
  convertUsdPurchase,
  PURCHASE_DATE_FUTURE,
  PURCHASE_DATE_REQUIRED,
  SALE_ALREADY_RECORDED,
  SALE_DATE_FUTURE,
  stockChangedMessage,
  validatePurchase,
  validateSale,
  type UsdPurchaseEntry,
  type ValidPurchase,
} from "@/lib/inventory/rules";
import {
  businessToday,
  FX_SAVE_UNAVAILABLE,
  FX_UNAVAILABLE,
  fxNoRateMessage,
  purchaseAlreadyRecordedToast,
  purchaseRecordedToast,
  saleRecordedToast,
  SUBMISSION_CONFLICT,
  vials,
} from "@/lib/inventory/screens";
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

export type InventoryActionResult = {
  /** Inline error under the form. */
  error?: string;
  toast?: string;
  tone?: ToastTone;
  /** Recorded (or already recorded by this same submission): open this stock item. */
  stockItemId?: string;
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
  revalidatePath("/admin/sales");
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
  if (!admin) redirect(signInUrl({ next: "/admin/inventory/purchase" }));

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
      return {
        stockItemId: result.stockItemId,
        toast: purchaseRecordedToast(purchase.quantity, purchase.unitCost, purchase.usd?.usdUnitCost),
        tone: "info",
      };
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

export type UsdRatePreview = { rate?: string; rateDate?: string; error?: string };

/**
 * A5 USD preview: the Bank of Canada rate for a date received, fetched on the
 * server through the same module the save uses (fx.ts). Display only: saving
 * fetches the rate again and converts on the server.
 */
export async function usdRatePreviewAction(receivedOn: unknown): Promise<UsdRatePreview> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/inventory/purchase" }));

  const today = businessToday();
  const date = calendarDate(receivedOn);
  if (!date) return { error: PURCHASE_DATE_REQUIRED };
  if (date > today) return { error: PURCHASE_DATE_FUTURE };
  const fx = await usdCadRate(date);
  if (!fx.ok) return { error: fx.reason === "no_rate" ? fxNoRateMessage(date) : FX_UNAVAILABLE };
  return { rate: fx.rate, rateDate: fx.rateDate };
}

/**
 * A6 Record sale: FIFO allocation, revenue and cost are frozen by the
 * database in one transaction. When stock ran out after the preview, nothing
 * is recorded and the page data is refreshed so the preview shows what is
 * left.
 */
export async function recordSaleAction(input: unknown): Promise<InventoryActionResult> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/inventory/sale" }));

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
      refresh();
      return { error: stockChangedMessage(result.onHand) };
    case "future_date":
      return { error: SALE_DATE_FUTURE };
    case "unknown_buyer":
      refresh();
      return { error: ACCOUNT_REQUIRED };
    case "unknown_item":
      refresh();
      return { toast: ITEM_GONE };
    case "conflict":
      return { toast: SUBMISSION_CONFLICT };
    default:
      return { toast: SAVE_FAILED };
  }
}

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
