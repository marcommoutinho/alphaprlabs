// Every sale is recorded against its cost preview (20260929100000_records.sql:
// record_business_sale requires p_expected_allocation), so tests that record
// sales directly preview first, as the app and any script must. No app
// imports: e2e specs use this too.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
export type PreviewedLot = { purchase_id: string; quantity: number };

/**
 * The lots admin_business_sale_preview shows for a sale of `quantity` vials
 * of the item, as record_business_sale takes them. When it shows none (stock
 * short, an unknown item, bad vials, or a caller who may not preview), a lot
 * no allocation can match is sent instead, so what comes back is the
 * database's own refusal for that sale (AP001, AP002, 22023, 42501…), never
 * a recorded sale.
 */
export async function previewedLots(db: Client, stockItemId: string, quantity: number): Promise<PreviewedLot[]> {
  const { data } = await db.rpc("admin_business_sale_preview", { p_stock_item_id: stockItemId, p_quantity: quantity });
  const lots = ((data as { lots?: PreviewedLot[] } | null)?.lots ?? []).map((lot) => ({ purchase_id: lot.purchase_id, quantity: lot.quantity }));
  if (lots.length > 0) return lots;
  return [{ purchase_id: randomUUID(), quantity: Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 100_000 ? quantity : 1 }];
}

type SaleArgs = Database["public"]["Functions"]["record_business_sale"]["Args"];

/** record_business_sale's arguments with the preview's lots (unless given). */
export async function previewed(db: Client, args: Omit<SaleArgs, "p_expected_allocation"> & { p_expected_allocation?: SaleArgs["p_expected_allocation"] }): Promise<SaleArgs> {
  return { ...args, p_expected_allocation: args.p_expected_allocation ?? (await previewedLots(db, args.p_stock_item_id, args.p_quantity)) };
}

/** Records a sale as the app does: preview, then record_business_sale with those lots. */
export async function recordPreviewedSale(db: Client, args: Omit<SaleArgs, "p_expected_allocation">) {
  return db.rpc("record_business_sale", await previewed(db, args));
}

/**
 * The SQL (for psql, as a signed-in admin) of the preview's lots for a sale:
 * what a bulk script passes as p_expected_allocation.
 */
export const previewedLotsSql = (stockItem: string, quantity: string) =>
  `(select jsonb_agg(jsonb_build_object('purchase_id', l ->> 'purchase_id', 'quantity', (l ->> 'quantity')::int))
     from jsonb_array_elements(public.admin_business_sale_preview(${stockItem}, ${quantity}) -> 'lots') l)`;
