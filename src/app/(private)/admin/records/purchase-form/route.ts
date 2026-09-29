import { businessToday } from "@/lib/inventory/screens";
import { purchaseFormData } from "@/lib/records/service";
import { createClient } from "@/lib/supabase/server";
import { adminOr403, json } from "../respond";

/** A5 / D4 Record purchase: the items with their counts, the library's peptides and past suppliers. */
export async function GET(): Promise<Response> {
  const auth = await adminOr403();
  if ("denied" in auth) return auth.denied;
  try {
    return json(await purchaseFormData(await createClient(), businessToday()));
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
