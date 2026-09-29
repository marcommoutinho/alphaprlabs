import { OutsideBuyersView, OutsideSalesView } from "@/components/admin/outside-buyers";
import { OUTSIDE_HREF } from "@/components/business/frame";
import { requireAdmin } from "@/lib/auth/session";
import { listOutsideBuyers, listOutsideSales } from "@/lib/inventory/sellers";
import { listBuyerAccounts, listStock } from "@/lib/inventory/service";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Outside buyers · Alpha PR Labs" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

/**
 * Outside buyers (admins only): every outside buyer name not yet linked,
 * found by `q` (contains, ignoring case); `name` opens that buyer's sales
 * (exactly that name), each with "Link to account…". Nothing here is capped:
 * an old sale can always be found and linked. Under the Ledger since V6
 * (the old /admin/sales/outside redirects here).
 */
export default async function OutsideBuyersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin(OUTSIDE_HREF);
  const params = await searchParams;
  const db = await createClient();
  const name = one(params.name);

  if (name) {
    const [sales, stock] = await Promise.all([listOutsideSales(db, name), listStock(db)]);
    const accounts = sales.length > 0 ? await listBuyerAccounts(db) : [];
    return <OutsideSalesView name={name} sales={sales} accounts={accounts} itemLabels={new Map(stock.map((item) => [item.id, item.label]))} />;
  }

  const search = one(params.q);
  return <OutsideBuyersView buyers={await listOutsideBuyers(db, search)} search={search} />;
}
