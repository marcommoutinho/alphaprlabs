import Link from "next/link";
import { AppPage } from "@/components/app-shell/app-shell";
import { EmptyState } from "@/components/app-shell/form";
import { SaleForm } from "@/components/admin/sale-form";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday, INVENTORY_EMPTY, SALE_INTRO } from "@/lib/inventory/screens";
import { getSaleStock, listBuyerAccounts, listStock } from "@/lib/inventory/service";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * A6 Record sale (admins only). `?item=` chooses the stock item (the form
 * switches it there as the admin picks one); otherwise the first item. The
 * item's open purchase lots (all of them, FIFO order) feed the live preview.
 */
export default async function RecordSalePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("/admin/inventory/sale");
  const { item } = await searchParams;
  const db = await createClient();
  const [stock, accounts] = await Promise.all([listStock(db), listBuyerAccounts(db)]);
  const chosen = stock.find((entry) => entry.id === item) ?? stock[0];
  const saleStock = chosen ? await getSaleStock(db, chosen.id) : null;

  return (
    <AppPage>
      <Link href="/admin/inventory" className="app-inv-back">
        ‹ Inventory
      </Link>
      <h1 className="app-h1">Record sale</h1>
      <p className="app-subtitle">{SALE_INTRO}</p>
      {chosen && saleStock ? (
        <SaleForm
          items={stock.map((entry) => ({ id: entry.id, label: entry.label, onHand: entry.onHand }))}
          accounts={accounts}
          selection={{ itemId: chosen.id, ...saleStock }}
          today={businessToday()}
        />
      ) : (
        <div className="app-inv-empty">
          <EmptyState>{INVENTORY_EMPTY}</EmptyState>
        </div>
      )}
    </AppPage>
  );
}
