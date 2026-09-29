import { StockScreen } from "@/components/business/stock-screen";
import { OpenRecordFromUrl } from "@/components/records/record-provider";
import { requireAdmin } from "@/lib/auth/session";
import { listStockLevels } from "@/lib/business/service";
import { businessToday } from "@/lib/inventory/screens";
import { recordKindOf } from "@/lib/records/forms";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Stock · Alpha PR Labs" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * A3 / D4 Stock (admins only; the reads check in the database too): every
 * stock item, read in full. `?filter=low` opens on Low. `?record=sale`
 * (with `recordItem=`) opens Record sale over it: the old
 * /admin/inventory/sale address redirects here. Its loading and error
 * states (A6b / A6c) are this route group's own.
 */
export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const { filter, record, recordItem } = await searchParams;
  const low = filter === "low";
  await requireAdmin(low ? "/admin/inventory?filter=low" : "/admin/inventory");
  const items = await listStockLevels(await createClient(), businessToday());
  return (
    <>
      <StockScreen items={items} initialFilter={low ? "low" : "all"} />
      <OpenRecordFromUrl kind={recordKindOf(record)} itemId={typeof recordItem === "string" ? recordItem : null} />
    </>
  );
}
