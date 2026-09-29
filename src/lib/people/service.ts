import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keysetRows, type PageOptions } from "@/lib/keyset";
import type { Database } from "@/lib/supabase/database.types";
import type { PeopleAccount } from "./view";

type Db = SupabaseClient<Database>;

type PersonRow = Database["public"]["Functions"]["admin_people"]["Returns"][number];

/**
 * A11 / D8: every account's name, email, role and team-share state, through
 * the admin-only admin_people() (20260929110000), which checks is_admin()
 * itself. Nothing else about a person is read here: their records are read
 * only in A12, only while they share (can_read_researcher).
 */
export async function listPeople(db: Db, options: PageOptions = {}): Promise<PeopleAccount[]> {
  const rows = await keysetRows<PersonRow>(
    (after, limit) => {
      const query = db.rpc("admin_people");
      return (after ? query.gt("profile_id", after.profile_id) : query).order("profile_id").limit(limit);
    },
    "people",
    options,
  );
  return rows.map((row) => ({
    id: row.profile_id,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "researcher",
    sharedSince: row.shared_since ?? null,
    stoppedAt: row.stopped_at ?? null,
  }));
}
