import { StockScreen } from "@/components/business/stock-screen";
import { requireAdmin } from "@/lib/auth/session";
import { listStockLevels } from "@/lib/business/service";
import { businessToday } from "@/lib/inventory/screens";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Stock · Alpha PR Labs" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * A3 / D4 Stock (admins only; the reads check in the database too): every
 * stock item, read in full. `?filter=low` opens on Low. Its loading and
 * error states (A6b / A6c) are this route group's own; the item, sale and
 * purchase pages keep theirs.
 */
export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const { filter } = await searchParams;
  const low = filter === "low";
  await requireAdmin(low ? "/admin/inventory?filter=low" : "/admin/inventory");
  const items = await listStockLevels(await createClient(), businessToday());
  return <StockScreen items={items} initialFilter={low ? "low" : "all"} />;
}
