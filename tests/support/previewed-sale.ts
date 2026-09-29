// Integration tests' sales, recorded against their cost preview as the app
// does (record_business_sale requires the preview's lots): the service's
// recordSale and the Record sale action's input, each previewed first
// unless the test gives the lots itself. See sales.ts.
import type { ExpectedLot, ValidSale } from "@/lib/inventory/rules";
import { recordSale as recordSaleAsSent, type Db } from "@/lib/inventory/service";
import { previewedLots } from "./sales";

export { previewedLots };

/** The preview's lots for a sale, in the app's shape. */
export async function expectedFor(db: Db, stockItemId: string, quantity: number): Promise<ExpectedLot[]> {
  return (await previewedLots(db, stockItemId, quantity)).map((lot) => ({ purchaseId: lot.purchase_id, quantity: lot.quantity }));
}

/**
 * lib/inventory/service recordSale, after the preview. Lots a test gives are
 * sent as they are. Otherwise it does what the admin does: preview, record,
 * and when the stock changed in between (another sale won the race), look at
 * the new preview and record again, so racing sales end recorded or short.
 */
export async function recordSale(db: Db, sale: Omit<ValidSale, "expectedAllocation"> & { expectedAllocation?: ExpectedLot[] }) {
  if (sale.expectedAllocation) return recordSaleAsSent(db, { ...sale, expectedAllocation: sale.expectedAllocation });
  for (let attempt = 1; ; attempt++) {
    const result = await recordSaleAsSent(db, { ...sale, expectedAllocation: await expectedFor(db, sale.stockItemId, sale.quantity) });
    if (result.kind !== "stock_changed" || attempt >= 50) return result;
  }
}

/** A Record sale action input with the preview's lots added, as the sheet sends it (unless it has them, or its item or vials aren't usable). */
export async function withPreview(db: Db, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if ("expectedAllocation" in input) return input;
  const quantity = Number(String(input.quantity ?? "").trim());
  if (typeof input.stockItemId !== "string" || !Number.isSafeInteger(quantity)) return input;
  return { ...input, expectedAllocation: await expectedFor(db, input.stockItemId, quantity) };
}
