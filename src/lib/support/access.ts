import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/**
 * Server-side check before reading another person's records (A8 researcher
 * history checks it on every request): true when the signed-in caller owns
 * them, or holds an active support grant from their owner and is still an
 * admin. The admin role alone never qualifies. `db` must be the caller's own
 * session client, never the secret-key client: the answer comes from the
 * database's can_read_researcher(), the same rule RLS applies to every
 * researcher-owned table. Any failure denies.
 */
export async function canReadResearcher(db: Db, ownerId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) return false;
  const { data, error } = await db.rpc("can_read_researcher", { p_owner: ownerId });
  return !error && data === true;
}
