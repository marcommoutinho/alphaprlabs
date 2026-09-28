import Link from "@/components/alpha/link";
import { AppPage } from "@/components/app-shell/app-shell";
import { PurchaseForm } from "@/components/admin/purchase-form";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday, PURCHASE_SUBTITLE } from "@/lib/inventory/screens";
import { listStock } from "@/lib/inventory/service";
import { listLibrary } from "@/lib/library/service";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * A5 Record purchase (admins only). `?item=` preselects a stock item (from
 * its page); otherwise the first item, or "New peptide / strength…" when
 * there is none. New items can use any library peptide, offered or not.
 */
export default async function RecordPurchasePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("/admin/inventory/purchase");
  const { item } = await searchParams;
  const db = await createClient();
  const [stock, library] = await Promise.all([listStock(db), listLibrary(db)]);
  const preselected = stock.find((entry) => entry.id === item)?.id ?? stock[0]?.id ?? "new";

  return (
    <AppPage width="form">
      <Link href="/admin/inventory" className="app-inv-back">
        ‹ Inventory
      </Link>
      <h1 className="app-h1">Record purchase</h1>
      <p className="app-subtitle">{PURCHASE_SUBTITLE}</p>
      <PurchaseForm
        items={stock.map((entry) => ({ id: entry.id, label: entry.label }))}
        peptides={library.map((entry) => ({ id: entry.id, name: entry.name }))}
        initialItemId={preselected}
        today={businessToday()}
      />
    </AppPage>
  );
}
