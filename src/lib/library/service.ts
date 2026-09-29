import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keysetRows, type PageOptions } from "@/lib/keyset";
import type { Database } from "@/lib/supabase/database.types";
import type { AdminPeptide, ValidPeptide } from "./admin";

type Db = SupabaseClient<Database>;

// Admin side of the library (V7: A8 / D6 list, A9 / D6 editor). `db` is the
// admin's own session client: every read and write below is a database
// function that checks is_admin() itself (20260929110000_admin_content.sql),
// on top of the page's requireAdmin. The peptides table itself returns only
// published, offered entries to everyone (admins' research screens included),
// so drafts and withdrawn entries are read here only.

type EntryRow = Database["public"]["Functions"]["admin_library_entries"]["Returns"][number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const entryOf = (row: EntryRow): AdminPeptide => ({
  id: row.id,
  name: row.name,
  shortDescription: row.short_description,
  strengths: row.vial_strengths_mg ?? [],
  information: row.information,
  cyclingOff: row.cycling_off_guidance,
  supplement: row.supplement_guidance,
  offered: row.offered,
  publishedAt: row.published_at,
  version: Number(row.version),
  updatedAt: row.updated_at,
  templateCount: Number(row.template_count),
  cycleCount: Number(row.cycle_count),
});

/** Every library entry, drafts and withdrawn ones included (all pages, by id; callers sort). */
export async function listAdminPeptides(db: Db, options: PageOptions = {}): Promise<AdminPeptide[]> {
  const rows = await keysetRows<EntryRow>(
    (after, limit) => {
      const query = db.rpc("admin_library_entries");
      return (after ? query.gt("id", after.id) : query).order("id").limit(limit);
    },
    "the library",
    options,
  );
  return rows.map(entryOf);
}

/** One entry, or null when there is none. */
export async function adminPeptide(db: Db, id: string): Promise<AdminPeptide | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db.rpc("admin_library_entries").eq("id", id.toLowerCase()).maybeSingle();
  if (error) throw new Error(`Could not load the library entry: ${error.message}`);
  return data ? entryOf(data) : null;
}

/** Rows per request; the API caps a response at 1,000 rows. */
const PAGE = 1000;

/** Reads every row, a page at a time, so a large list is never cut off at the API's row cap. */
export async function allRows<Row>(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  what: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export type SavePeptideResult =
  | { kind: "saved"; id: string; version: number; published: boolean; replayed: boolean }
  /**
   * The database refused it (nothing was written): `changed` the entry is no
   * longer at the version the admin opened (AP038); `duplicate_name` another
   * entry has the name (23505); `not_found` no such entry (P0002);
   * `conflict` the request key was used for other details (AP005).
   */
  | { kind: "not_authorized" | "invalid" | "duplicate_name" | "not_found" | "changed" | "conflict" }
  /**
   * No answer from the database (a dropped connection, a gateway error, a
   * timeout, an error it doesn't define). It may have committed: retry with
   * the same request key (a replay), never a new one.
   */
  | { kind: "unsure" };

/** Creates (id null) or edits an entry, only over the version it was opened at; idempotent by request key. */
export async function savePeptide(
  db: Db,
  input: { requestKey: string; requestHash: string; entry: ValidPeptide },
): Promise<SavePeptideResult> {
  const { entry } = input;
  const { data, error } = await db
    .rpc("admin_save_peptide", {
      p_request_key: input.requestKey,
      p_request_hash: input.requestHash,
      // The generated types can't express a nullable uuid argument.
      p_id: entry.id as string,
      p_expected_version: entry.version as number,
      p_name: entry.name,
      p_short_description: entry.shortDescription,
      p_vial_strengths_mg: entry.strengths,
      p_information: entry.information,
      p_cycling_off_guidance: entry.cyclingOff,
      p_supplement_guidance: entry.supplement,
      p_offered: entry.offered,
      p_publish: entry.publish,
    })
    .single();
  if (error || !data) {
    switch (error?.code) {
      case "42501":
        return { kind: "not_authorized" };
      case "22023":
        return { kind: "invalid" };
      case "23505":
        return { kind: "duplicate_name" };
      case "P0002":
        return { kind: "not_found" };
      case "AP005":
        return { kind: "conflict" };
      case "AP038":
        return { kind: "changed" };
      default:
        return { kind: "unsure" };
    }
  }
  return { kind: "saved", id: data.peptide_id, version: Number(data.version), published: data.published, replayed: data.replayed };
}

export type LastChange = { version: number; updatedAt: string; changedAt: string | null; changedBy: string | null };

/** An entry's or template's current version and who last changed it through the admin screens (null: no such row). */
export async function lastChange(db: Db, kind: "peptide" | "template", id: string): Promise<LastChange | null> {
  const { data, error } = await db.rpc("admin_content_last_change", { p_kind: kind, p_id: id }).maybeSingle();
  if (error) throw new Error(`Could not load the latest change: ${error.message}`);
  if (!data) return null;
  return { version: Number(data.version), updatedAt: data.updated_at, changedAt: data.changed_at, changedBy: data.changed_by_name };
}
