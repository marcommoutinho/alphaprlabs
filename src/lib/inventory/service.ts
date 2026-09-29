import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";
import type { Database } from "@/lib/supabase/database.types";
import {
  fifoOrder,
  stockItemLabel,
  sumAmounts,
  type FifoLot,
  type UsdConversion,
  type UsdPurchaseEntry,
  type ValidPurchase,
  type ValidSale,
} from "./rules";

export type Db = SupabaseClient<Database>;

/** Rows per request: the API's max_rows (supabase/config.toml). */
export const API_PAGE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `pageSize` overrides API_PAGE (tests prove paging loses no row with a small page). */
export type PageOptions = { pageSize?: number };

/**
 * Every row of a list the API returns at most `pageSize` rows of per request,
 * by keyset paging: `page(after, limit)` returns up to `limit` rows ordered by
 * a unique key, after the row `after` (null: from the start). Unlike offsets,
 * a row written meanwhile can't shift a page, so no row is read twice (which
 * would count a total twice) or skipped.
 */
export async function allPages<Row>(
  page: (after: Row | null, limit: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  what: string,
  pageSize = API_PAGE,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let after: Row | null = null; ; after = rows[rows.length - 1]) {
    const { data, error } = await page(after, pageSize);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

// Business inventory and sales (A4-A7), admin only. `db` is the admin's own
// session client: RLS (is_admin() read policies) and the SQL functions' own
// is_admin() checks apply on top of the caller's role check. Money arrives as
// exact decimal text (`480.00`) and is summed with decimal.js, never floats.

export type StockItemSummary = {
  id: string;
  peptideId: string;
  peptideName: string;
  /** The library entry's availability (stock of a withdrawn peptide stays listed). */
  peptideAvailable: boolean;
  /** mg without trailing zeros, e.g. `8` or `2.5`. */
  strengthMg: string;
  /** `Compound A · 8 mg` */
  label: string;
  purchased: number;
  sold: number;
  onHand: number;
};

export type PurchaseLot = {
  id: string;
  receivedOn: string;
  quantity: number;
  unitCost: string;
  totalCost: string;
  /** Vials of this lot already allocated to sales (their cost is locked). */
  allocated: number;
  remaining: number;
  recordedAt: string;
  /** FIFO tie-break between lots received the same day: the order they were recorded in. */
  recordedOrder: number;
  /** Entered in USD: the USD cost per vial and the Bank of Canada rate `unitCost` was converted with. Null for CAD. */
  usd: UsdConversion | null;
};

export type SaleAllocation = { purchaseId: string; quantity: number; unitCost: string; receivedOn: string };

export type SaleRecord = {
  id: string;
  stockItemId: string;
  soldOn: string;
  quantity: number;
  unitPrice: string;
  revenue: string;
  /** Cost of the vials sold (FIFO), frozen at the time of the sale. */
  cost: string;
  grossProfit: string;
  buyerType: "account" | "outside";
  /** The linked account; null for an outside buyer. (A referenced account cannot be deleted.) */
  buyerProfileId: string | null;
  /** The account's name at the time of the sale (or of the link), or the outside buyer's reference. */
  buyerName: string;
  /** Linked later to an account: the outside buyer's name as recorded. Null otherwise. */
  originalBuyerName: string | null;
  /** The admin who made the sale and their name at the time; null only for sales recorded before sellers existed. */
  sellerId: string | null;
  sellerName: string | null;
  recordedAt: string;
  /** Oldest lot first. */
  allocations: SaleAllocation[];
};

export type SalesTotals = { sales: number; vials: number; revenue: string; cost: string; grossProfit: string };

const toSummary = (row: Database["public"]["Functions"]["admin_business_stock"]["Returns"][number]): StockItemSummary => ({
  id: row.stock_item_id,
  peptideId: row.peptide_id,
  peptideName: row.peptide_name,
  peptideAvailable: row.peptide_available,
  strengthMg: row.strength_mg,
  label: stockItemLabel(row.peptide_name, row.strength_mg),
  purchased: Number(row.purchased),
  sold: Number(row.sold),
  onHand: Number(row.on_hand),
});

/** A4 Inventory: every stock item with vials purchased, sold and on hand, by peptide name then strength. */
export async function listStock(db: Db, options: PageOptions = {}): Promise<StockItemSummary[]> {
  const rows = await allPages<Database["public"]["Functions"]["admin_business_stock"]["Returns"][number]>(
    (after, limit) => {
      const query = db.rpc("admin_business_stock");
      return (after ? query.gt("stock_item_id", after.stock_item_id) : query).order("stock_item_id").limit(limit);
    },
    "inventory",
    options.pageSize,
  );
  return rows.map(toSummary).sort(
    (a, b) =>
      a.peptideName.localeCompare(b.peptideName, "en", { sensitivity: "base" }) ||
      a.peptideId.localeCompare(b.peptideId) ||
      new Decimal(a.strengthMg).comparedTo(b.strengthMg),
  );
}

export const SALE_COLUMNS =
  "id, stock_item_id, sold_on, quantity, unit_price::text, revenue::text, cost::text, gross_profit::text, " +
  "buyer_type, buyer_profile_id, buyer_name, original_buyer_name, seller_id, seller_name, recorded_at, " +
  "business_sale_allocations(purchase_id, quantity, unit_cost::text, received_on, business_purchases(recorded_order))";

export type SaleRow = {
  id: string;
  stock_item_id: string;
  sold_on: string;
  quantity: number;
  unit_price: string;
  revenue: string;
  cost: string;
  gross_profit: string;
  buyer_type: "account" | "outside";
  buyer_profile_id: string | null;
  buyer_name: string;
  original_buyer_name: string | null;
  seller_id: string | null;
  seller_name: string | null;
  recorded_at: string;
  business_sale_allocations: {
    purchase_id: string;
    quantity: number;
    unit_cost: string;
    received_on: string;
    business_purchases: { recorded_order: number };
  }[];
};

export const toSale = (row: SaleRow): SaleRecord => ({
  id: row.id,
  stockItemId: row.stock_item_id,
  soldOn: row.sold_on,
  quantity: row.quantity,
  unitPrice: row.unit_price,
  revenue: row.revenue,
  cost: row.cost,
  grossProfit: row.gross_profit,
  buyerType: row.buyer_type,
  buyerProfileId: row.buyer_profile_id,
  buyerName: row.buyer_name,
  originalBuyerName: row.original_buyer_name,
  sellerId: row.seller_id,
  sellerName: row.seller_name,
  recordedAt: row.recorded_at,
  // FIFO order, the order the sale took them in.
  allocations: row.business_sale_allocations
    .map((a) => ({ receivedOn: a.received_on, recordedOrder: a.business_purchases.recorded_order, a }))
    .sort(fifoOrder)
    .map(({ a }) => ({ purchaseId: a.purchase_id, quantity: a.quantity, unitCost: a.unit_cost, receivedOn: a.received_on })),
});

/** The most sale rows a page loads; totals are computed in the database over all of them. */
export const SALES_PAGE_SIZE = 500;

export type StockItemDetail = {
  item: StockItemSummary;
  /** FIFO order: the order sales allocate in. */
  lots: PurchaseLot[];
  /** Newest first. */
  sales: SaleRecord[];
  /** More sales exist than `sales` holds (SALES_PAGE_SIZE). */
  salesTruncated: boolean;
};

type LotRow = Database["public"]["Functions"]["admin_business_lots"]["Returns"][number];

const toLot = (lot: LotRow): PurchaseLot => ({
  id: lot.purchase_id,
  receivedOn: lot.received_on,
  quantity: lot.quantity,
  unitCost: lot.unit_cost,
  totalCost: lot.total_cost,
  allocated: Number(lot.allocated),
  remaining: Number(lot.remaining),
  recordedAt: lot.recorded_at,
  recordedOrder: lot.recorded_order,
  usd:
    lot.original_currency === "USD" && lot.original_unit_cost !== null && lot.fx_rate !== null && lot.fx_rate_date !== null
      ? { usdUnitCost: lot.original_unit_cost, rate: lot.fx_rate, rateDate: lot.fx_rate_date }
      : null,
});

/**
 * A stock item's purchase lots, every page of them (paged by recording order,
 * which is unique and only grows), in FIFO order: received date, then
 * recording order. `open` keeps only lots with vials left.
 */
async function lotPages(db: Db, stockItemId: string, open: boolean, options: PageOptions): Promise<PurchaseLot[]> {
  const rows = await allPages<LotRow>(
    (after, limit) => {
      let query = db.rpc("admin_business_lots", { p_stock_item_id: stockItemId });
      if (open) query = query.gt("remaining", 0);
      if (after) query = query.gt("recorded_order", after.recorded_order);
      return query.order("recorded_order").limit(limit);
    },
    "purchases",
    options.pageSize,
  );
  return rows.map(toLot).sort(fifoOrder);
}

/** A4 Stock item: the item, all of its purchase lots and its newest sales. Null when unknown. */
export async function getStockItem(db: Db, stockItemId: string, options: PageOptions = {}): Promise<StockItemDetail | null> {
  if (!UUID.test(stockItemId)) return null;
  const [item, lots, sales] = await Promise.all([
    db.rpc("admin_business_stock").eq("stock_item_id", stockItemId).maybeSingle(),
    lotPages(db, stockItemId, false, options),
    db
      .from("business_sales")
      .select(SALE_COLUMNS, { count: "exact" })
      .eq("stock_item_id", stockItemId)
      .order("sold_on", { ascending: false })
      .order("recorded_at", { ascending: false })
      .limit(SALES_PAGE_SIZE)
      .overrideTypes<SaleRow[], { merge: false }>(),
  ]);
  if (item.error) throw new Error(`Could not load the stock item: ${item.error.message}`);
  if (sales.error) throw new Error(`Could not load sales: ${sales.error.message}`);
  if (!item.data) return null;
  return {
    item: toSummary(item.data),
    lots,
    sales: sales.data.map(toSale),
    salesTruncated: (sales.count ?? 0) > sales.data.length,
  };
}

/** The item's lots that still have vials, as FIFO sees them. */
export const openLots = (lots: PurchaseLot[]): FifoLot[] =>
  lots
    .filter((lot) => lot.remaining > 0)
    .map((lot) => ({
      purchaseId: lot.id,
      receivedOn: lot.receivedOn,
      recordedOrder: lot.recordedOrder,
      unitCost: lot.unitCost,
      remaining: lot.remaining,
    }));

/**
 * A6 live preview input: the item's stock and every lot that still has vials,
 * in FIFO order, read from the database (all pages) without the item's
 * history. Null when the item is unknown. `onHand` is the sum of the open
 * lots, so the preview's stock and lots are one consistent reading.
 */
export async function getSaleStock(
  db: Db,
  stockItemId: string,
  options: PageOptions = {},
): Promise<{ onHand: number; lots: FifoLot[] } | null> {
  if (!UUID.test(stockItemId)) return null;
  const lots = openLots(await lotPages(db, stockItemId, true, options));
  return { onHand: lots.reduce((n, lot) => n + lot.remaining, 0), lots };
}

/** One sale by id (the toast after recording it), or null. */
export async function getSale(db: Db, saleId: string): Promise<SaleRecord | null> {
  if (!UUID.test(saleId)) return null;
  const { data, error } = await db
    .from("business_sales")
    .select(SALE_COLUMNS)
    .eq("id", saleId)
    .overrideTypes<SaleRow[], { merge: false }>();
  if (error) throw new Error(`Could not load the sale: ${error.message}`);
  return data[0] ? toSale(data[0]) : null;
}

/** Inclusive `YYYY-MM-DD` bounds (see salesPeriodRange) and an optional item. */
export type SalesFilter = { from?: string | null; to?: string | null; stockItemId?: string | null };

export type SalesReport = {
  totals: SalesTotals;
  /** A7 by-item rows, in inventory order, only items with sales in the view. */
  byItem: (SalesTotals & { stockItemId: string; label: string })[];
  /** Newest first, at most SALES_PAGE_SIZE. */
  sales: SaleRecord[];
  salesTruncated: boolean;
  /** For A7's empty states: "No purchases or sales yet." / "Purchases recorded, no sales yet." */
  hasPurchases: boolean;
  hasSales: boolean;
};

/** A7 Sales & gross profit for a period and item: exact totals, the by-item breakdown and the sales. `options.pageSize` pages the totals. */
export async function listSales(db: Db, filter: SalesFilter = {}, options: PageOptions = {}): Promise<SalesReport> {
  let sales = db.from("business_sales").select(SALE_COLUMNS, { count: "exact" });
  if (filter.from) sales = sales.gte("sold_on", filter.from);
  if (filter.to) sales = sales.lte("sold_on", filter.to);
  if (filter.stockItemId) sales = sales.eq("stock_item_id", filter.stockItemId);

  const [stock, totals, rows] = await Promise.all([
    listStock(db),
    // One row per stock item with sales in the view: every page of them.
    allPages<Database["public"]["Functions"]["admin_business_sales_totals"]["Returns"][number]>(
      (after, limit) => {
        const query = db.rpc("admin_business_sales_totals", {
          ...(filter.from ? { p_from: filter.from } : {}),
          ...(filter.to ? { p_to: filter.to } : {}),
          ...(filter.stockItemId ? { p_stock_item_id: filter.stockItemId } : {}),
        });
        return (after ? query.gt("stock_item_id", after.stock_item_id) : query).order("stock_item_id").limit(limit);
      },
      "sales totals",
      options.pageSize,
    ),
    sales
      .order("sold_on", { ascending: false })
      .order("recorded_at", { ascending: false })
      .limit(SALES_PAGE_SIZE)
      .overrideTypes<SaleRow[], { merge: false }>(),
  ]);
  if (rows.error) throw new Error(`Could not load sales: ${rows.error.message}`);

  // Every totals row counts, in inventory order (an item created after the
  // stock list was read still counts, labelled from nothing: last).
  const order = new Map(stock.map((item, index) => [item.id, index]));
  const labels = new Map(stock.map((item) => [item.id, item.label]));
  const byItem = totals
    .map((row) => ({
      stockItemId: row.stock_item_id,
      label: labels.get(row.stock_item_id) ?? "—",
      sales: Number(row.sales),
      vials: Number(row.vials),
      revenue: row.revenue,
      cost: row.cost,
      grossProfit: row.gross_profit,
    }))
    .sort((a, b) => (order.get(a.stockItemId) ?? Infinity) - (order.get(b.stockItemId) ?? Infinity));
  return {
    totals: {
      sales: byItem.reduce((n, row) => n + row.sales, 0),
      vials: byItem.reduce((n, row) => n + row.vials, 0),
      revenue: sumAmounts(byItem.map((row) => row.revenue)),
      cost: sumAmounts(byItem.map((row) => row.cost)),
      grossProfit: sumAmounts(byItem.map((row) => row.grossProfit)),
    },
    byItem,
    sales: rows.data.map(toSale),
    salesTruncated: (rows.count ?? 0) > rows.data.length,
    hasPurchases: stock.some((item) => item.purchased > 0),
    hasSales: byItem.length > 0 || stock.some((item) => item.sold > 0),
  };
}

export type BuyerAccount = { id: string; name: string; email: string };

/** A6 buyer select (`Name · email`): the minimum identity needed to link a sale to an account. */
export async function listBuyerAccounts(db: Db): Promise<BuyerAccount[]> {
  // Page through: the API returns at most API_PAGE rows per request.
  const accounts: BuyerAccount[] = [];
  for (let from = 0; ; from += API_PAGE) {
    const { data, error } = await db
      .rpc("business_buyer_accounts")
      .order("name")
      .order("email")
      .order("profile_id")
      .range(from, from + API_PAGE - 1);
    if (error) throw new Error(`Could not load accounts: ${error.message}`);
    accounts.push(...data.map((row) => ({ id: row.profile_id, name: row.name, email: row.email })));
    if (data.length < API_PAGE) return accounts;
  }
}

// Refusals from the SQL functions (see the migration header).
const REFUSED = {
  "42501": "not_authorized",
  "22023": "invalid",
  AP001: "insufficient",
  AP002: "unknown_item",
  AP003: "unknown_peptide",
  AP004: "unknown_buyer",
  AP005: "conflict",
  AP006: "future_date",
  // record_business_purchase_fx: a newer Bank of Canada rate was stored for the window; look it up again.
  AP028: "rate_changed",
  // 20260927160000_sellers_admin_invites.sql
  AP029: "seller_not_admin",
  AP030: "not_linkable",
  // 20260929100000_records.sql: the sale would freeze other lots than its preview showed.
  AP037: "stock_changed",
} as const;
export type Refusal = (typeof REFUSED)[keyof typeof REFUSED] | "error";
export const refusal = (code: string | undefined): Refusal => REFUSED[code as keyof typeof REFUSED] ?? "error";

/**
 * The record functions' refusals (nothing was written), or "unsure": no
 * answer from the database (a dropped connection, a gateway error, a
 * timeout) or an error they don't define. It may have committed, so the
 * caller retries with the same idempotency key (a replay), never a new one
 * (V5's rule: src/lib/business/service.ts).
 */
const recordOutcome = (code: string | undefined): Refusal | "unsure" => {
  const kind = refusal(code);
  return kind === "error" ? "unsure" : kind;
};

/** Refusals only a sale or a link can meet: a purchase maps them to "error". */
type SaleOnly = "insufficient" | "unknown_buyer" | "seller_not_admin" | "not_linkable" | "stock_changed";

export type PurchaseResult =
  | { kind: "recorded"; purchaseId: string; stockItemId: string; replayed: boolean }
  | { kind: Exclude<Refusal, SaleOnly> | "unsure" };

/**
 * A5: records a purchase, creating the stock item for a new peptide/strength.
 * `replayed` is true when this idempotency key was already recorded: nothing
 * new was written (the form was submitted twice). A USD purchase (`usd`, with
 * the rate fetched by the server: fx.ts) is recorded with its USD cost, rate
 * and rate date; the database re-checks unitCost = round(USD × rate, 2).
 */
export async function recordPurchase(db: Db, purchase: ValidPurchase): Promise<PurchaseResult> {
  const common = {
    p_idempotency_key: purchase.idempotencyKey,
    p_received_on: purchase.receivedOn,
    p_quantity: purchase.quantity,
    p_unit_cost: purchase.unitCost,
    ...(purchase.supplier ? { p_supplier: purchase.supplier } : {}),
    ...(purchase.stockItemId
      ? { p_stock_item_id: purchase.stockItemId }
      : { p_peptide_id: purchase.peptideId ?? undefined, p_strength_mg: purchase.strengthMg ?? undefined }),
  };
  // One path for both currencies (20260929100000_records.sql): CAD has no conversion.
  const { data, error } = await db
    .rpc(
      "record_business_purchase_fx",
      purchase.usd
        ? {
            ...common,
            p_original_currency: "USD",
            p_original_unit_cost: purchase.usd.usdUnitCost,
            p_fx_rate: purchase.usd.rate,
            p_fx_rate_date: purchase.usd.rateDate,
          }
        : { ...common, p_original_currency: "CAD" },
    )
    .single();
  return purchaseResult(data, error);
}

function purchaseResult(
  data: { purchase_id: string; stock_item_id: string; replayed: boolean } | null,
  error: { code?: string } | null,
): PurchaseResult {
  if (error || !data) {
    const kind = recordOutcome(error?.code);
    const saleOnly: readonly (Refusal | "unsure")[] = ["insufficient", "unknown_buyer", "seller_not_admin", "not_linkable", "stock_changed"];
    return { kind: saleOnly.includes(kind) ? "error" : (kind as Exclude<Refusal, SaleOnly> | "unsure") };
  }
  return { kind: "recorded", purchaseId: data.purchase_id, stockItemId: data.stock_item_id, replayed: data.replayed };
}

/** A purchase as recorded: its CAD cost and, for USD, the conversion it was recorded with. */
export type RecordedPurchase = { id: string; stockItemId: string; quantity: number; unitCost: string; usd: UsdConversion | null };

/** The purchase recorded with this idempotency key, or null (admins only, under RLS). */
export async function purchaseByKey(db: Db, idempotencyKey: string): Promise<RecordedPurchase | null> {
  if (!UUID.test(idempotencyKey)) return null;
  const { data, error } = await db
    .from("business_purchases")
    .select("id, stock_item_id, quantity, unit_cost::text, original_currency, original_unit_cost::text, fx_rate::text, fx_rate_date")
    .eq("idempotency_key", idempotencyKey)
    .overrideTypes<
      {
        id: string;
        stock_item_id: string;
        quantity: number;
        unit_cost: string;
        original_currency: string;
        original_unit_cost: string | null;
        fx_rate: string | null;
        fx_rate_date: string | null;
      }[],
      { merge: false }
    >();
  if (error) throw new Error(`Could not load the purchase: ${error.message}`);
  const row = data[0];
  if (!row) return null;
  return {
    id: row.id,
    stockItemId: row.stock_item_id,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    usd:
      row.original_currency === "USD" && row.original_unit_cost !== null && row.fx_rate !== null && row.fx_rate_date !== null
        ? { usdUnitCost: row.original_unit_cost, rate: row.fx_rate, rateDate: row.fx_rate_date }
        : null,
  };
}

/**
 * A USD entry whose idempotency key is already recorded: the database
 * compares the entered details and replays the recorded purchase (or refuses
 * with `conflict`), without any rate. Used before fetching one, so a retry
 * works while the Bank of Canada is unreachable.
 */
export async function replayUsdPurchase(db: Db, entry: UsdPurchaseEntry): Promise<PurchaseResult> {
  const { data, error } = await db
    .rpc("record_business_purchase_fx", {
      p_idempotency_key: entry.idempotencyKey,
      p_received_on: entry.receivedOn,
      p_quantity: entry.quantity,
      p_original_currency: "USD",
      p_original_unit_cost: entry.usdUnitCost,
      ...(entry.supplier ? { p_supplier: entry.supplier } : {}),
      ...(entry.stockItemId
        ? { p_stock_item_id: entry.stockItemId }
        : { p_peptide_id: entry.peptideId ?? undefined, p_strength_mg: entry.strengthMg ?? undefined }),
    })
    .single();
  return purchaseResult(data, error);
}

export type SaleResult =
  | { kind: "recorded"; saleId: string; replayed: boolean }
  | { kind: "insufficient" | "stock_changed"; onHand: number }
  | { kind: Exclude<Refusal, "insufficient" | "stock_changed" | "unknown_peptide" | "rate_changed" | "not_linkable"> | "unsure" };

/**
 * A6: records a sale with its FIFO allocation, revenue and cost frozen, in one
 * transaction. Refused with `insufficient` (and the vials on hand) when stock
 * is short, and with `seller_not_admin` when the seller is not a current
 * admin; nothing is recorded then. `replayed` is true when this idempotency
 * key was already recorded (the same details, the seller included).
 */
export async function recordSale(db: Db, sale: ValidSale): Promise<SaleResult> {
  // The buyer is exactly an account or an outside buyer; anything else (a
  // caller that skipped validateSale) is refused before reaching the database.
  const buyer: unknown = sale.buyer;
  const buyerType = typeof buyer === "object" && buyer !== null ? (buyer as { type?: unknown }).type : undefined;
  if (buyerType !== "account" && buyerType !== "outside") return { kind: "invalid" };
  const { data, error } = await db
    .rpc("record_business_sale", {
      p_idempotency_key: sale.idempotencyKey,
      p_stock_item_id: sale.stockItemId,
      p_sold_on: sale.soldOn,
      p_quantity: sale.quantity,
      p_unit_price: sale.unitPrice,
      p_seller_id: sale.sellerId,
      ...(sale.buyer.type === "account" ? { p_buyer_profile_id: sale.buyer.profileId } : { p_buyer_name: sale.buyer.name }),
      // Required: the preview's lots (the database refuses a sale without them).
      p_expected_allocation: sale.expectedAllocation.map((lot) => ({ purchase_id: lot.purchaseId, quantity: lot.quantity })),
    })
    .single();
  if (error) {
    const kind = recordOutcome(error.code);
    if (kind === "insufficient" || kind === "stock_changed") return { kind, onHand: Number(error.details) || 0 };
    return { kind: kind === "unknown_peptide" || kind === "rate_changed" || kind === "not_linkable" ? "error" : kind };
  }
  return { kind: "recorded", saleId: data.sale_id, replayed: data.replayed };
}
