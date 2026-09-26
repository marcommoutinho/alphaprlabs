import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { LibraryEntry, ValidLibraryEntry } from "./entry";

type Db = SupabaseClient<Database>;

// Admin side (A2). `db` is the admin's own session client: RLS and the SQL
// functions' is_admin() checks apply on top of the caller's role check.

/**
 * Every entry, available or not, oldest first, with its reference counts.
 * Reads through the admin-only admin_library_peptides(): the peptides table
 * itself returns available entries only, to everyone (admins included), so
 * research screens never see withdrawn entries.
 */
export async function listLibrary(db: Db): Promise<LibraryEntry[]> {
  const [entries, counts] = await Promise.all([
    db
      .rpc("admin_library_peptides")
      // A function's result can only be ordered by selected columns.
      .select("id, name, information, cycling_off_guidance, supplement_guidance, available, created_at, updated_at")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    db.rpc("library_reference_counts"),
  ]);
  if (entries.error) throw new Error(`Could not load the library: ${entries.error.message}`);
  if (counts.error) throw new Error(`Could not load library references: ${counts.error.message}`);

  const byId = new Map(counts.data.map((row) => [row.peptide_id, row]));
  return entries.data.map((row) => ({
    id: row.id,
    name: row.name,
    information: row.information,
    cyclingOff: row.cycling_off_guidance,
    supplement: row.supplement_guidance,
    available: row.available,
    updatedAt: row.updated_at,
    templateCount: Number(byId.get(row.id)?.template_count ?? 0),
    cycleCount: Number(byId.get(row.id)?.cycle_count ?? 0),
  }));
}

export type SaveLibraryResult = { kind: "saved"; id: string } | { kind: "not_found" | "duplicate_name" | "error" };

/** save_library_peptide's refusal of a name another entry already has. */
const DUPLICATE_NAME = "23505";

/** Creates (id null) or edits an entry through the admin-only database function. */
export async function saveLibraryEntry(db: Db, entry: ValidLibraryEntry): Promise<SaveLibraryResult> {
  const { data, error } = await db.rpc("save_library_peptide", {
    p_name: entry.name,
    p_information: entry.information,
    p_cycling_off_guidance: entry.cyclingOff,
    p_supplement_guidance: entry.supplement,
    p_available: entry.available,
    ...(entry.id ? { p_id: entry.id } : {}),
  });
  if (error) return { kind: error.code === DUPLICATE_NAME ? "duplicate_name" : "error" };
  if (!data) return { kind: "not_found" };
  return { kind: "saved", id: data };
}
