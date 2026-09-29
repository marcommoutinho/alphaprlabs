import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The old Record purchase page (V6 replaced it with the A5 sheet): its
 * address opens the sheet over the Ledger's Purchases, with `?item=` still
 * choosing the item. Admins only.
 */
export default async function RecordPurchaseRedirect({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("/admin/inventory/purchase");
  const { item } = await searchParams;
  const query = new URLSearchParams({ tab: "purchases", record: "purchase" });
  if (typeof item === "string" && UUID.test(item)) query.set("recordItem", item);
  redirect(`/admin/ledger?${query}`);
}
