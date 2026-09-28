import "server-only";
import { keysetRows, type PageOptions } from "@/lib/keyset";
import { stockItemLabel } from "@/lib/inventory/rules";
import { SALE_COLUMNS, toSale, type Db, type SaleRecord, type SaleRow } from "@/lib/inventory/service";
import type { Database } from "@/lib/supabase/database.types";
import type { DateRange } from "./period";

// Business screens (V5: A1 / A2 Overview, A13 / D9 12 months, A3 / D4 Stock),
// admin only. `db` is the admin's own session client: every read below is a
// database function that checks is_admin() itself (20260928150000), on top
// of the page's requireAdmin. Totals are summed in the database as exact
// decimal text; lists that could pass the API's 1,000-row cap are read in
// keyset pages (src/lib/keyset.ts).

export type Totals = { sales: number; vials: number; revenue: string; cost: string; grossProfit: string };
export type DayTotals = Totals & { day: string };
export type MonthTotals = Totals & { month: string; purchases: string; purchaseOrders: number };
export type SupplierPurchases = { key: string; name: string | null; orders: number; total: string; currencies: string[] };

export type StockLevel = {
  id: string;
  peptideId: string;
  peptideName: string;
  peptideAvailable: boolean;
  /** mg without trailing zeros ("10", "2.5"). */
  strengthMg: string;
  /** "CJC-1295 · 10 mg" */
  label: string;
  onHand: number;
  /** The vials on hand at their purchase lots' CAD cost. */
  valueAtCost: string;
  /** Vials sold in the 30 days ending today. */
  sold30d: number;
  /** Low when on hand is fewer than this. */
  threshold: number;
  /** The threshold's last change: when and by which admin (null: never changed, the default). */
  thresholdChangedAt: string | null;
  thresholdChangedBy: string | null;
};

type LevelRow = Database["public"]["Functions"]["admin_business_stock_levels"]["Returns"][number];
type SummaryRow = Database["public"]["Functions"]["admin_business_sales_summary"]["Returns"][number];
type SupplierRow = Database["public"]["Functions"]["admin_business_purchase_suppliers"]["Returns"][number];

const totals = (row: Pick<SummaryRow, "sales" | "vials" | "revenue" | "cost" | "gross_profit">): Totals => ({
  sales: Number(row.sales),
  vials: Number(row.vials),
  revenue: row.revenue,
  cost: row.cost,
  grossProfit: row.gross_profit,
});

/** Every stock item with its level, value at cost, sales in the last 30 days and threshold (all pages). */
export async function listStockLevels(db: Db, today: string, options: PageOptions = {}): Promise<StockLevel[]> {
  const rows = await keysetRows<LevelRow>(
    (after, limit) => {
      const query = db.rpc("admin_business_stock_levels", { p_today: today });
      return (after ? query.gt("stock_item_id", after.stock_item_id) : query).order("stock_item_id").limit(limit);
    },
    "stock",
    options,
  );
  return rows.map((row) => ({
    id: row.stock_item_id,
    peptideId: row.peptide_id,
    peptideName: row.peptide_name,
    peptideAvailable: row.peptide_available,
    strengthMg: row.strength_mg,
    label: stockItemLabel(row.peptide_name, row.strength_mg),
    onHand: Number(row.on_hand),
    valueAtCost: row.value_at_cost,
    sold30d: Number(row.sold_30d),
    threshold: row.low_stock_threshold,
    thresholdChangedAt: row.threshold_changed_at,
    thresholdChangedBy: row.threshold_changed_by_name,
  }));
}

/** Sales per day of the range (at most 400 days), days without sales as zeros, oldest first. */
export async function salesByDay(db: Db, range: DateRange): Promise<DayTotals[]> {
  const { data, error } = await db.rpc("admin_business_sales_by_day", { p_from: range.from, p_to: range.to }).order("day");
  if (error) throw new Error(`Could not load sales by day: ${error.message}`);
  return data.map((row) => ({ day: row.day, ...totals(row) }));
}

/** Sales totals for a range. */
export async function salesSummary(db: Db, range: DateRange): Promise<Totals> {
  const { data, error } = await db.rpc("admin_business_sales_summary", { p_from: range.from, p_to: range.to }).single();
  if (error) throw new Error(`Could not load sales totals: ${error.message}`);
  return totals(data);
}

/** One row per calendar month from `from`'s month to `to`'s (at most 36), oldest first. */
export async function businessMonths(db: Db, range: DateRange): Promise<MonthTotals[]> {
  const { data, error } = await db.rpc("admin_business_months", { p_from: range.from, p_to: range.to }).order("month");
  if (error) throw new Error(`Could not load months: ${error.message}`);
  return data.map((row) => ({
    month: row.month,
    ...totals(row),
    purchases: row.purchases,
    purchaseOrders: Number(row.purchase_orders),
  }));
}

/** Supplier purchases in the range, one row per supplier (all pages). */
export async function purchaseSuppliers(db: Db, range: DateRange, options: PageOptions = {}): Promise<SupplierPurchases[]> {
  const rows = await keysetRows<SupplierRow>(
    (after, limit) => {
      const query = db.rpc("admin_business_purchase_suppliers", { p_from: range.from, p_to: range.to });
      return (after ? query.gt("supplier_key", after.supplier_key) : query).order("supplier_key").limit(limit);
    },
    "purchases by supplier",
    options,
  );
  return rows.map((row) => ({
    key: row.supplier_key,
    name: row.supplier_name,
    orders: Number(row.orders),
    total: row.total,
    currencies: row.currencies ?? [],
  }));
}

/** The newest sales (by sale date, then when recorded). */
export async function recentSales(db: Db, limit: number): Promise<SaleRecord[]> {
  const { data, error } = await db
    .from("business_sales")
    .select(SALE_COLUMNS)
    .order("sold_on", { ascending: false })
    .order("recorded_at", { ascending: false })
    .limit(limit)
    .overrideTypes<SaleRow[], { merge: false }>();
  if (error) throw new Error(`Could not load recent sales: ${error.message}`);
  return data.map(toSale);
}

export type ThresholdResult =
  | { kind: "saved"; threshold: number; replayed: boolean }
  /** The database refused it (nothing was written). */
  | { kind: "not_authorized" | "invalid" | "unknown_item" | "conflict" }
  /**
   * No answer from the database: a dropped connection, a gateway error, a
   * timeout, or an error it doesn't define. It may have committed, so the
   * caller must retry with the same request key (a replay), never a new one.
   */
  | { kind: "unsure" };

/**
 * Sets a stock item's low-stock threshold (admins only; idempotent by request
 * key). supabase-js reports a lost answer (fetch failed, a 502, a timeout) as
 * an ordinary error, so only the refusals set_business_stock_threshold raises
 * count as "nothing was written"; anything else is `unsure`.
 */
export async function setStockThreshold(
  db: Db,
  input: { requestKey: string; stockItemId: string; threshold: number },
): Promise<ThresholdResult> {
  const { data, error } = await db
    .rpc("set_business_stock_threshold", {
      p_request_key: input.requestKey,
      p_stock_item_id: input.stockItemId,
      p_threshold: input.threshold,
    })
    .single();
  if (error || !data) {
    switch (error?.code) {
      case "42501":
        return { kind: "not_authorized" };
      case "22023":
        return { kind: "invalid" };
      case "AP002":
        return { kind: "unknown_item" };
      case "AP005":
        return { kind: "conflict" };
      default:
        return { kind: "unsure" };
    }
  }
  return { kind: "saved", threshold: data.threshold, replayed: data.replayed };
}
