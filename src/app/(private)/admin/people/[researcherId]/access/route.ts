import type { NextRequest } from "next/server";
import { currentAdmin } from "@/lib/auth/session";
import { canReadResearcher } from "@/lib/support/access";
import { getSupportAccount } from "@/lib/support/service";
import { createClient } from "@/lib/supabase/server";

const noStore = { "Cache-Control": "private, no-store" } as const;

/**
 * A12's check for a history put back on screen without the server (back or
 * forward: see HistoryGate): GET → { shared } — whether the signed-in admin
 * may read this researcher's history now, by the same rule as the page (the
 * share, then can_read_researcher as the admin). Admins only, never cached,
 * and it says nothing else about the person.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ researcherId: string }> }): Promise<Response> {
  if (!(await currentAdmin())) return Response.json({ error: "Only admins can do this." }, { status: 403, headers: noStore });
  const { researcherId } = await params;
  const db = await createClient();
  const account = await getSupportAccount(db, researcherId);
  const shared = Boolean(account?.sharedSince) && (await canReadResearcher(db, account!.id));
  return Response.json({ shared }, { headers: noStore });
}
