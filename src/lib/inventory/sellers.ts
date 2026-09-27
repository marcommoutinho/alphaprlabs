import "server-only";
import type { Database } from "@/lib/supabase/database.types";
import type { ValidLink } from "./rules";
import { allPages, API_PAGE, refusal, type Db, type PageOptions, type Refusal, type SalesFilter, type SalesTotals } from "./service";

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
