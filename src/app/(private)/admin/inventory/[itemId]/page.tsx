import { notFound } from "next/navigation";
import { AppPage } from "@/components/app-shell/app-shell";
import { StockItemView } from "@/components/admin/inventory-views";
import { requireAdmin } from "@/lib/auth/session";
import { getStockItem } from "@/lib/inventory/service";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ itemId: string }>;

/** A4 Stock item: on hand, purchase lots and sales (admins only). */
export default async function StockItemPage({ params }: { params: Params }) {
  const { itemId } = await params;
  await requireAdmin(`/admin/inventory/${encodeURIComponent(itemId)}`);
  const detail = await getStockItem(await createClient(), itemId);
  if (!detail) notFound();
  return (
    <AppPage>
      <StockItemView detail={detail} />
    </AppPage>
  );
}
