import "server-only";
import type { Database } from "@/lib/supabase/database.types";
import type { ValidLink } from "./rules";
import {
  allPages,
  API_PAGE,
  refusal,
  SALE_COLUMNS,
  toSale,
  type Db,
  type PageOptions,
  type Refusal,
  type SaleRecord,
  type SaleRow,
  type SalesFilter,
  type SalesTotals,
} from "./service";

// Sellers and buyer linking (Marco, 2026-09-27;
// supabase/migrations/20260927160000_sellers_admin_invites.sql), admin only.
// `db` is the admin's own session client; the SQL functions check is_admin()
// themselves. Seller and admin names never reach a researcher: every read
// here is admin-only.

export type Seller = { id: string; name: string; email: string };

/** A6 Seller select: the current admins, by name. */
export async function listSellers(db: Db): Promise<Seller[]> {
  const rows = await allPages<Database["public"]["Functions"]["business_sellers"]["Returns"][number]>(
    (after, limit) => {
      const query = db.rpc("business_sellers");
      return (after ? query.gt("profile_id", after.profile_id) : query).order("profile_id").limit(limit);
    },
    "sellers",
  );
  return rows
    .map((row) => ({ id: row.profile_id, name: row.name, email: row.email }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.email.localeCompare(b.email));
}

/** The nil UUID: the key of sales recorded before sellers existed (no seller). */
const NO_SELLER = "00000000-0000-0000-0000-000000000000";

export type SellerTotals = SalesTotals & {
  /** Null for sales recorded before sellers existed. */
  sellerId: string | null;
  /** The seller's current name (null: no seller recorded). */
  sellerName: string | null;
  /** The seller's email, shown when two sellers share a name (null: no seller, or no profile). */
  sellerEmail: string | null;
};

/**
 * A7 "By seller": revenue, cost, gross profit and vials per seller for the
 * same period and item as the rest of the report. Summed in the database over
 * every sale, one row per seller, read in full by keyset pages (`pageSize`
 * overrides the page size for tests). By name; sales without a seller last.
 */
export async function listSellerTotals(db: Db, filter: SalesFilter = {}, options: PageOptions = {}): Promise<SellerTotals[]> {
  const rows = await allPages<Database["public"]["Functions"]["admin_business_seller_totals"]["Returns"][number]>(
    (after, limit) => {
      const query = db.rpc("admin_business_seller_totals", {
        ...(filter.from ? { p_from: filter.from } : {}),
        ...(filter.to ? { p_to: filter.to } : {}),
        ...(filter.stockItemId ? { p_stock_item_id: filter.stockItemId } : {}),
      });
      return (after ? query.gt("seller_key", after.seller_key) : query).order("seller_key").limit(limit);
    },
    "seller totals",
    options.pageSize ?? API_PAGE,
  );
  return rows
    .map((row) => ({
      sellerId: row.seller_key === NO_SELLER ? null : row.seller_id,
      sellerName: row.seller_key === NO_SELLER ? null : row.seller_name,
      sellerEmail: row.seller_key === NO_SELLER ? null : row.seller_email,
      sales: Number(row.sales),
      vials: Number(row.vials),
      revenue: row.revenue,
      cost: row.cost,
      grossProfit: row.gross_profit,
    }))
    .sort(
      (a, b) =>
        Number(a.sellerId === null) - Number(b.sellerId === null) ||
        (a.sellerName ?? "").localeCompare(b.sellerName ?? "", "en", { sensitivity: "base" }) ||
        (a.sellerId ?? "").localeCompare(b.sellerId ?? ""),
    );
}

export type LinkResult =
  | { kind: "linked"; count: number }
  | { kind: Extract<Refusal, "not_authorized" | "invalid" | "not_linkable" | "unknown_buyer" | "error"> };

/**
 * Links an outside buyer's sale (and, with `sameName`, every other outside
 * sale recorded with exactly the same buyer name) to an account. The link is
 * a buyer reference only: nothing else about the sale changes, it grants no
 * access to the account's history and adds nothing to its supplies. `count`
 * is how many sales were linked now (0: this sale was already linked to
 * that account).
 */
export async function linkSale(db: Db, link: ValidLink): Promise<LinkResult> {
  const { data, error } = await db.rpc("link_business_sale", {
    p_sale_id: link.saleId,
    p_buyer_profile_id: link.profileId,
    p_same_name: link.sameName,
  });
  if (error) {
    const kind = refusal(error.code);
    return { kind: kind === "not_authorized" || kind === "invalid" || kind === "not_linkable" || kind === "unknown_buyer" ? kind : "error" };
  }
  return { kind: "linked", count: data };
}

export type OutsideBuyer = { name: string; sales: number; vials: number; revenue: string; lastSold: string };

/**
 * A7 "Outside buyers": every outside buyer name not yet linked, with its
 * sales, vials, revenue and latest sale date, by name. `search` keeps the
 * names that contain it (ignoring case). Read in full by keyset pages on the
 * name, so every outside sale can be found however many newer sales exist.
 */
export async function listOutsideBuyers(db: Db, search = "", options: PageOptions = {}): Promise<OutsideBuyer[]> {
  const rows = await allPages<Database["public"]["Functions"]["admin_business_outside_buyers"]["Returns"][number]>(
    (after, limit) => {
      const query = db.rpc("admin_business_outside_buyers", search.trim() ? { p_search: search } : {});
      return (after ? query.gt("buyer_name", after.buyer_name) : query).order("buyer_name").limit(limit);
    },
    "outside buyers",
    options.pageSize ?? API_PAGE,
  );
  return rows
    .map((row) => ({ name: row.buyer_name, sales: Number(row.sales), vials: Number(row.vials), revenue: row.revenue, lastSold: row.last_sold }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Every sale still recorded to this outside buyer name (exactly), newest
 * first: read in full by keyset pages on the id, each with its "Link to
 * account…" on the Outside buyers screen.
 */
export async function listOutsideSales(db: Db, name: string, options: PageOptions = {}): Promise<SaleRecord[]> {
  const rows = await allPages<SaleRow>(
    (after, limit) => {
      const query = db.from("business_sales").select(SALE_COLUMNS).eq("buyer_type", "outside").eq("buyer_name", name);
      return (after ? query.gt("id", after.id) : query).order("id").limit(limit).overrideTypes<SaleRow[], { merge: false }>();
    },
    "outside sales",
    options.pageSize ?? API_PAGE,
  );
  return rows
    .map(toSale)
    .sort((a, b) => (a.soldOn === b.soldOn ? b.recordedAt.localeCompare(a.recordedAt) : b.soldOn.localeCompare(a.soldOn)));
}
