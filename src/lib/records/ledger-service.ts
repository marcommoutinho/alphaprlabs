import "server-only";
import { keysetRows, type PageOptions } from "@/lib/keyset";
import type { Db } from "@/lib/inventory/service";
import type { Database } from "@/lib/supabase/database.types";
import type { DateRange } from "@/lib/business/period";
import { itemLabel, NO_SELLER, NO_SELLER_KEY, type LedgerPurchase, type LedgerSale, type LedgerTab, type MonthItem } from "./ledger";

// A7 / A14 / D5 Ledger reads, admin only: each is a database function that
// checks is_admin() itself (20260929100000_records.sql), on top of the page's
// requireAdmin. Lists are read in full, by keyset pages past the API's
// 1,000-row cap; totals are summed exactly (decimal.js) from those rows or
// in the database.

type Fns = Database["public"]["Functions"];
type SaleRow = Fns["admin_business_ledger_sales"]["Returns"][number];
type PurchaseRow = Fns["admin_business_ledger_purchases"]["Returns"][number];
type MonthRow = Fns["admin_business_ledger_month_items"]["Returns"][number];

export type LedgerFilter = DateRange & { seller?: string | null; item?: string | null };

const sellerKey = (seller: string | null | undefined) => (seller === NO_SELLER ? NO_SELLER_KEY : (seller ?? undefined));

/** Every sale in the range (for one seller or item when given), newest first. */
export async function ledgerSales(db: Db, filter: LedgerFilter, options: PageOptions = {}): Promise<LedgerSale[]> {
  const rows = await keysetRows<SaleRow>(
    (after, limit) => {
      const query = db.rpc("admin_business_ledger_sales", {
        p_from: filter.from,
        p_to: filter.to,
        ...(sellerKey(filter.seller) ? { p_seller: sellerKey(filter.seller) } : {}),
        ...(filter.item ? { p_stock_item_id: filter.item } : {}),
      });
      return (after ? query.lt("sort_key", after.sort_key) : query).order("sort_key", { ascending: false }).limit(limit);
    },
    "sales",
    options,
  );
  return rows.map((row) => ({
    id: row.sale_id,
    sortKey: row.sort_key,
    soldOn: row.sold_on,
    itemId: row.stock_item_id,
    item: itemLabel(row.peptide_name, row.strength_mg),
    quantity: Number(row.quantity),
    unitPrice: row.unit_price,
    revenue: row.revenue,
    cost: row.cost,
    grossProfit: row.gross_profit,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    buyerType: row.buyer_type === "account" ? "account" : "outside",
    buyerName: row.buyer_name ?? "",
    originalBuyerName: row.original_buyer_name,
  }));
}

/** Every purchase received in the range (one item when given), newest first. */
export async function ledgerPurchases(db: Db, filter: LedgerFilter, options: PageOptions = {}): Promise<LedgerPurchase[]> {
  const rows = await keysetRows<PurchaseRow>(
    (after, limit) => {
      const query = db.rpc("admin_business_ledger_purchases", {
        p_from: filter.from,
        p_to: filter.to,
        ...(filter.item ? { p_stock_item_id: filter.item } : {}),
      });
      return (after ? query.lt("sort_key", after.sort_key) : query).order("sort_key", { ascending: false }).limit(limit);
    },
    "purchases",
    options,
  );
  return rows.map((row) => ({
    id: row.purchase_id,
    sortKey: row.sort_key,
    receivedOn: row.received_on,
    itemId: row.stock_item_id,
    item: itemLabel(row.peptide_name, row.strength_mg),
    quantity: Number(row.quantity),
    unitCost: row.unit_cost,
    totalCost: row.total_cost,
    currency: row.original_currency === "USD" ? "USD" : "CAD",
    usdUnitCost: row.original_currency === "USD" ? row.original_unit_cost : null,
    fxRate: row.fx_rate,
    fxRateDate: row.fx_rate_date,
    supplier: row.supplier,
  }));
}

/** A14: one row per month and stock item, summed in the database (all pages). */
export async function ledgerMonthItems(db: Db, tab: LedgerTab, filter: LedgerFilter, options: PageOptions = {}): Promise<MonthItem[]> {
  const rows = await keysetRows<MonthRow>(
    (after, limit) => {
      const query = db.rpc("admin_business_ledger_month_items", {
        p_kind: tab,
        p_from: filter.from,
        p_to: filter.to,
        ...(tab === "sales" && sellerKey(filter.seller) ? { p_seller: sellerKey(filter.seller) } : {}),
        ...(filter.item ? { p_stock_item_id: filter.item } : {}),
      });
      return (after ? query.gt("row_key", after.row_key) : query).order("row_key").limit(limit);
    },
    "months",
    options,
  );
  return rows.map((row) => ({
    key: row.row_key,
    month: row.month,
    itemId: row.stock_item_id,
    item: itemLabel(row.peptide_name, row.strength_mg),
    entries: Number(row.entries),
    vials: Number(row.vials),
    // Sales rows have no purchase total and purchase rows no revenue (null).
    revenue: row.revenue ?? "0.00",
    cost: row.cost ?? "0.00",
    grossProfit: row.gross_profit ?? "0.00",
    total: row.total ?? row.revenue ?? "0.00",
    supplier: row.supplier ?? null,
    supplierCount: Number(row.supplier_count),
    noSupplier: Number(row.no_supplier),
  }));
}
