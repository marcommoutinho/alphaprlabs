import "server-only";
import { keysetRows, type PageOptions } from "@/lib/keyset";
import { listStockLevels } from "@/lib/business/service";
import { listSellers } from "@/lib/inventory/sellers";
import { listBuyerAccounts, type Db } from "@/lib/inventory/service";
import { sellerOptions, defaultSeller } from "@/lib/inventory/seller-screens";
import { listLibrary } from "@/lib/library/service";
import type { Database } from "@/lib/supabase/database.types";
import { toSalePreview, type SalePreview } from "./forms";

// V6 records (A4 / A5 and the laptop drawers), admin only. `db` is the
// admin's own session client: every read is a database function or table
// that checks is_admin() itself (20260929100000_records.sql and earlier), on
// top of each route's currentAdmin check.

export type RecordItem = { id: string; label: string; peptideName: string; strengthMg: string; onHand: number };
export type RecordSeller = { id: string; name: string; label: string };
export type RecordBuyer = { id: string; name: string; email: string };
export type RecordSupplier = { key: string; name: string; orders: number; lastReceived: string };

/** What the Record sale sheet opens with. */
export type SaleFormData = {
  today: string;
  items: RecordItem[];
  sellers: RecordSeller[];
  /** The signed-in admin when they can be chosen, else "". */
  defaultSellerId: string;
  buyers: RecordBuyer[];
};

/** What the Record purchase sheet opens with. */
export type PurchaseFormData = {
  today: string;
  items: RecordItem[];
  peptides: { id: string; name: string }[];
  suppliers: RecordSupplier[];
};

async function recordItems(db: Db, today: string): Promise<RecordItem[]> {
  const levels = await listStockLevels(db, today);
  return levels
    .map((level) => ({
      id: level.id,
      label: level.label,
      peptideName: level.peptideName,
      strengthMg: level.strengthMg,
      onHand: level.onHand,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id));
}

export async function saleFormData(db: Db, adminId: string, today: string): Promise<SaleFormData> {
  const [items, sellers, buyers] = await Promise.all([recordItems(db, today), listSellers(db), listBuyerAccounts(db)]);
  const labels = new Map(sellerOptions(sellers).map((option) => [option.id, option.label]));
  return {
    today,
    items,
    sellers: sellers.map((seller) => ({ id: seller.id, name: seller.name, label: labels.get(seller.id) ?? seller.name })),
    defaultSellerId: defaultSeller(sellers, adminId),
    buyers,
  };
}

export async function purchaseFormData(db: Db, today: string): Promise<PurchaseFormData> {
  const [items, library, suppliers] = await Promise.all([recordItems(db, today), listLibrary(db), listSuppliers(db)]);
  return {
    today,
    items,
    peptides: library
      .map((entry) => ({ id: entry.id, name: entry.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true })),
    suppliers,
  };
}

type SupplierRow = Database["public"]["Functions"]["admin_business_suppliers"]["Returns"][number];

/** Past suppliers, one per name (case and spacing folded), newest spelling, most recent first. */
export async function listSuppliers(db: Db, options: PageOptions = {}): Promise<RecordSupplier[]> {
  const rows = await keysetRows<SupplierRow>(
    (after, limit) => {
      const query = db.rpc("admin_business_suppliers");
      return (after ? query.gt("supplier_key", after.supplier_key) : query).order("supplier_key").limit(limit);
    },
    "suppliers",
    options,
  );
  return rows
    .map((row) => ({ key: row.supplier_key, name: row.supplier, orders: Number(row.orders), lastReceived: row.last_received }))
    .sort((a, b) => b.lastReceived.localeCompare(a.lastReceived) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export type PreviewResult = { kind: "preview"; preview: SalePreview } | { kind: "unknown_item" } | { kind: "error" };

/**
 * The cost a sale of `quantity` vials of the item would freeze now: the
 * lots, oldest first, as record_business_sale allocates them (both use
 * business_fifo_allocation).
 */
export async function salePreview(db: Db, stockItemId: string, quantity: number): Promise<PreviewResult> {
  const { data, error } = await db.rpc("admin_business_sale_preview", { p_stock_item_id: stockItemId, p_quantity: quantity });
  if (error) return { kind: error.code === "AP002" ? "unknown_item" : "error" };
  const preview = toSalePreview(stockItemId, quantity, data);
  return preview ? { kind: "preview", preview } : { kind: "error" };
}
