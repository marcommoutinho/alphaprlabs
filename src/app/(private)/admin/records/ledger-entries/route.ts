import type { NextRequest } from "next/server";
import { businessDate } from "@/lib/business/period";
import { readLedgerView } from "@/lib/records/ledger";
import { ledgerPurchases, ledgerSales } from "@/lib/records/ledger-service";
import { businessToday } from "@/lib/inventory/screens";
import { createClient } from "@/lib/supabase/server";
import { adminOr403, json } from "../respond";

/**
 * A14: an item's sales (or purchases) in one month, opened from the month
 * view. GET ?tab=sales|purchases&from=&to=&item=<stock item>[&seller=] →
 * the entries, newest first, all of them (keyset pages).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await adminOr403();
  if ("denied" in auth) return auth.denied;
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const today = businessToday();
  const from = businessDate(params.from);
  const to = businessDate(params.to);
  // tab, seller and item as the Ledger reads them; the range is the month's (at most 31 days).
  const view = readLedgerView({ tab: params.tab, seller: params.seller, item: params.item }, today);
  if (!from || !to || from > to || to > today || !view.item || Number(new Date(to)) - Number(new Date(from)) > 31 * 86_400_000) {
    return json({ error: "invalid" }, 400);
  }
  try {
    const db = await createClient();
    const filter = { from, to, seller: view.seller, item: view.item };
    return json(view.tab === "sales" ? await ledgerSales(db, filter) : await ledgerPurchases(db, filter));
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
