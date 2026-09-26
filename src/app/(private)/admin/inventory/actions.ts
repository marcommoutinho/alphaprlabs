"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentAdmin } from "@/lib/auth/session";
import {
  ACCOUNT_REQUIRED,
  PURCHASE_ALREADY_RECORDED,
  PURCHASE_DATE_FUTURE,
  SALE_ALREADY_RECORDED,
  SALE_DATE_FUTURE,
  stockChangedMessage,
  validatePurchase,
  validateSale,
} from "@/lib/inventory/rules";
import { businessToday, purchaseRecordedToast, saleRecordedToast, SUBMISSION_CONFLICT, vials } from "@/lib/inventory/screens";
import { getSale, recordPurchase, recordSale } from "@/lib/inventory/service";
import { createClient } from "@/lib/supabase/server";

export type InventoryActionResult = {
  /** Inline error under the form. */
  error?: string;
  toast?: string;
  tone?: ToastTone;
  /** Recorded (or already recorded by this same submission): open this stock item. */
  stockItemId?: string;
};

const SAVE_FAILED = "Could not save. Nothing was lost — your entry is still here. Try again.";
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

  const valid = validatePurchase(input, businessToday());
  if (!valid.ok) return { error: valid.error };

  const result = await recordPurchase(await createClient(), valid.value);
  switch (result.kind) {
    case "recorded":
      return result.replayed
        ? { stockItemId: result.stockItemId, toast: PURCHASE_ALREADY_RECORDED, tone: "warn" }
        : {
            stockItemId: result.stockItemId,
            toast: purchaseRecordedToast(valid.value.quantity, valid.value.unitCost),
            tone: "info",
          };
    case "future_date":
      return { error: PURCHASE_DATE_FUTURE };
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
