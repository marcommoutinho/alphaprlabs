import { notFound } from "next/navigation";
import { StockItemView } from "@/components/admin/inventory-views";
import { requireAdmin } from "@/lib/auth/session";
import { getStockItem, listBuyerAccounts } from "@/lib/inventory/service";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ itemId: string }>;

/**
 * A4 Stock item: on hand, purchase lots and sales (admins only). An outside
 * buyer's sale offers "Link to account…", so the accounts are loaded only
 * when one is listed.
 */
export default async function StockItemPage({ params }: { params: Params }) {
  const { itemId } = await params;
  await requireAdmin(`/admin/inventory/${encodeURIComponent(itemId)}`);
  const db = await createClient();
  const detail = await getStockItem(db, itemId);
  if (!detail) notFound();
  const linkAccounts = detail.sales.some((sale) => sale.buyerType === "outside") ? await listBuyerAccounts(db) : undefined;
  return <StockItemView detail={detail} linkAccounts={linkAccounts} />;
}
