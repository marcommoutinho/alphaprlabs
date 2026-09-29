import { LedgerScreen, type LedgerData } from "@/components/records/ledger-screen";
import { OpenRecordFromUrl } from "@/components/records/record-provider";
import { requireAdmin } from "@/lib/auth/session";
import { stockLevelOf } from "@/lib/business/service";
import { businessToday } from "@/lib/inventory/screens";
import { listSellerTotals } from "@/lib/inventory/sellers";
import { recordKindOf } from "@/lib/records/forms";
import { ledgerHref, NO_SELLER, readLedgerView } from "@/lib/records/ledger";
import { ledgerMonthItems, ledgerPurchases, ledgerSales } from "@/lib/records/ledger-service";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Ledger · Alpha PR Labs" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * A7 / A14 / D5 Ledger (admins only; every read checks in the database
 * too): sales or purchases in a range, by day (each day with its total) or
 * by month (each month opens to its items, each item to its entries). Sales
 * filter by seller; the seller menu shows each seller's totals for the
 * range, so per-seller figures stay one tap away (Overview keeps its seller
 * table). Read-only: recording happens in the A4 / A5 sheets.
 */
export default async function LedgerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const today = businessToday();
  const view = readLedgerView(params, today);
  await requireAdmin(ledgerHref(view));
  const db = await createClient();
  const filter = { ...view.range, seller: view.seller, item: view.item };

  const [sellerTotals, entries, months, item] = await Promise.all([
    listSellerTotals(db, { from: view.range.from, to: view.range.to, stockItemId: view.item }),
    view.group === "day" ? (view.tab === "sales" ? ledgerSales(db, filter) : ledgerPurchases(db, filter)) : Promise.resolve(null),
    view.group === "month" ? ledgerMonthItems(db, view.tab, filter) : Promise.resolve(null),
    view.item ? stockLevelOf(db, today, view.item) : Promise.resolve(null),
  ]);

  const sellers = sellerTotals.map((row) => ({
    key: row.sellerId ?? NO_SELLER,
    name: row.sellerName,
    vials: row.vials,
    revenue: row.revenue,
    grossProfit: row.grossProfit,
  }));
  const data: LedgerData = {
    today,
    view,
    sellers,
    salesVials: sellers.filter((row) => !view.seller || row.key === view.seller).reduce((sum, row) => sum + row.vials, 0),
    itemLabel: item?.label ?? null,
    entries,
    months,
  };
  const record = recordKindOf(params.record);
  return (
    <>
      <LedgerScreen data={data} />
      <OpenRecordFromUrl kind={record} itemId={typeof params.recordItem === "string" ? params.recordItem : null} />
    </>
  );
}
