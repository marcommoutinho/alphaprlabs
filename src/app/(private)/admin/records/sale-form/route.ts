import { businessToday } from "@/lib/inventory/screens";
import { saleFormData } from "@/lib/records/service";
import { createClient } from "@/lib/supabase/server";
import { adminOr403, json } from "../respond";

/** A4 / D4 Record sale: the items with their counts, the sellers and the buyer accounts, read when the sheet opens. */
export async function GET(): Promise<Response> {
  const auth = await adminOr403();
  if ("denied" in auth) return auth.denied;
  try {
    return json(await saleFormData(await createClient(), auth.admin.id, businessToday()));
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
