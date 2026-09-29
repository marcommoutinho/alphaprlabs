import type { NextRequest } from "next/server";
import { parseVials } from "@/lib/inventory/rules";
import { salePreview } from "@/lib/records/service";
import { createClient } from "@/lib/supabase/server";
import { adminOr403, json } from "../respond";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A4's Now block: GET ?item=<stock item>&vials=<n> → the lots a sale of n
 * vials would take, oldest first, and their cost (admin_business_sale_preview).
 * Display and a check: the sale sends these lots and is refused if it would
 * freeze others (AP037).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await adminOr403();
  if ("denied" in auth) return auth.denied;
  const item = request.nextUrl.searchParams.get("item") ?? "";
  const vials = parseVials(request.nextUrl.searchParams.get("vials") ?? "");
  if (!UUID.test(item) || !vials.ok) return json({ error: "invalid" }, 400);
  const result = await salePreview(await createClient(), item.toLowerCase(), vials.value);
  if (result.kind === "unknown_item") return json({ error: "unknown_item" }, 404);
  if (result.kind === "error") return json({ error: "unavailable" }, 503);
  return json(result.preview);
}
