import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { checkInsCsv, csvFilename } from "./csv";
import { listCheckIns } from "./service";

/**
 * D3 "Export CSV": the signed-in person's OWN check-ins for the days `from`
 * to `to`. The owner is the session's verified user (auth.getUser), never a
 * parameter, so an admin with a support share still exports only their own
 * (RLS would let them read the researcher's; this never asks for them).
 * Null without a session.
 */
export async function exportOwnCheckIns(
  db: SupabaseClient<Database>,
  range: { from: string; to: string },
): Promise<{ csv: string; filename: string; rows: number } | null> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const checkIns = await listCheckIns(db, user.id, range);
  return { csv: checkInsCsv(checkIns), filename: csvFilename(range.from, range.to), rows: checkIns.length };
}
