import { AppPage } from "@/components/app-shell/app-shell";
import { InventoryList } from "@/components/admin/inventory-views";
import { requireAdmin } from "@/lib/auth/session";
import { listStock } from "@/lib/inventory/service";
import { createClient } from "@/lib/supabase/server";

/** A4 Inventory, the admin landing screen (admins only; RLS and the database functions also check). */
export default async function InventoryPage() {
  await requireAdmin("/admin/inventory");
  const items = await listStock(await createClient());
  return (
    <AppPage>
      <InventoryList items={items} />
    </AppPage>
  );
}
