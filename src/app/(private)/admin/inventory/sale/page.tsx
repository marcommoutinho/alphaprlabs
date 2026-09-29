import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The old Record sale page (V6 replaced it with the A4 sheet, which opens
 * over any admin page): its address, bookmarks included, opens the sheet
 * over Stock, with `?item=` still choosing the item. Admins only.
 */
export default async function RecordSaleRedirect({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("/admin/inventory/sale");
  const { item } = await searchParams;
  const query = new URLSearchParams({ record: "sale" });
  if (typeof item === "string" && UUID.test(item)) query.set("recordItem", item);
  redirect(`/admin/inventory?${query}`);
}
