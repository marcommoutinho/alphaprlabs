import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

// R8 personal supplies: the deductions behind each vial's estimate, and the
// reopen writer (20260926210000_personal_supplies.sql). Read with the
// caller's own session client, so RLS decides what is readable: a person's
// own records, or those of a researcher whose active support grant they hold
// (can_read_researcher). Callers that mean "mine" pass their own id as owner.
// The vials, the tracking setting and the other writers live in
// src/lib/mixtures/service.ts (S11).
//
// Every read is complete: rows are read a page at a time by id (keyset), so
// the API's 1,000-row cap never cuts a vial's history short, and id lists
// are sent in bounded chunks. Amounts are read as text (no floats).

/** Rows per request; the API caps a response at 1,000 rows. */
const PAGE = 1000;
/** Ids per `in (...)` filter. */
const CHUNK = 100;

/** Page and chunk sizes; tests lower them to prove paging. */
export type ReadSizes = { pageSize?: number; chunkSize?: number };

/** One estimate a recorded dose took from a tracked vial (personal_vial_deductions). */
export type VialDeduction = {
  id: string;
  doseId: string;
  vialId: string;
  amountMg: string;
  remainingBeforeMg: string;
  remainingAfterMg: string;
  /** The vial's estimate went below zero with this dose. */
  stockDiscrepancy: boolean;
  recordedAt: string;
};

type Row = {
  id: string;
  dose_id: string;
  vial_id: string;
  amount_mg: string;
  remaining_before_mg: string;
  remaining_after_mg: string;
  stock_discrepancy: boolean;
  recorded_at: string;
};

const COLUMNS = "id, dose_id, vial_id, amount_mg::text, remaining_before_mg::text, remaining_after_mg::text, stock_discrepancy, recorded_at";

type Page = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

async function keysetRows(page: (after: string | null, limit: number) => Page, pageSize: number): Promise<Row[]> {
  const rows: Row[] = [];
  for (let after: string | null = null; ; ) {
    const { data, error } = await page(after, pageSize);
    if (error) throw new Error(`Could not load the supply history: ${error.message}`);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return rows;
    after = got[got.length - 1].id;
  }
}

const deductionOf = (row: Row): VialDeduction => ({
  id: row.id,
  doseId: row.dose_id,
  vialId: row.vial_id,
  amountMg: row.amount_mg,
  remainingBeforeMg: row.remaining_before_mg,
  remainingAfterMg: row.remaining_after_mg,
  stockDiscrepancy: row.stock_discrepancy,
  recordedAt: row.recorded_at,
});

/** Oldest first, as recorded (deductions of one vial are serialized, so this is their order). */
const byRecorded = (a: VialDeduction, b: VialDeduction) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id);

/** Every deduction from `ownerId`'s vials, oldest first. */
export async function listDeductions(db: Db, ownerId: string, sizes: ReadSizes = {}): Promise<VialDeduction[]> {
  const rows = await keysetRows((after, limit) => {
    const query = db.from("personal_vial_deductions").select(COLUMNS).eq("owner_id", ownerId);
    return ((after ? query.gt("id", after) : query).order("id").limit(limit)) as unknown as Page;
  }, sizes.pageSize ?? PAGE);
  return rows.map(deductionOf).sort(byRecorded);
}

/** The deductions from the given vials (Today: the open tracked ones), oldest first. */
export async function deductionsOfVials(db: Db, vialIds: readonly string[], sizes: ReadSizes = {}): Promise<VialDeduction[]> {
  const ids = [...new Set(vialIds)];
  const size = sizes.chunkSize ?? CHUNK;
  const chunks = Array.from({ length: Math.ceil(ids.length / size) }, (_, i) => ids.slice(i * size, (i + 1) * size));
  const parts = await Promise.all(
    chunks.map((chunk) =>
      keysetRows((after, limit) => {
        const query = db.from("personal_vial_deductions").select(COLUMNS).in("vial_id", chunk);
        return ((after ? query.gt("id", after) : query).order("id").limit(limit)) as unknown as Page;
      }, sizes.pageSize ?? PAGE),
    ),
  );
  return parts.flat().map(deductionOf).sort(byRecorded);
}

export type ReopenVialResult = { kind: "reopened" | "unlinked" | "not_found" | "tracking_off" | "error" };

/** reopen_personal_vial: a finished vial open again (see the migration for when it keeps its mixture). */
export async function reopenPersonalVial(db: Db, vialId: string): Promise<ReopenVialResult> {
  const { data, error } = await db.rpc("reopen_personal_vial", { p_vial_id: vialId });
  if (error) return { kind: error.code === "AP016" ? "tracking_off" : "error" };
  if (data === "reopened" || data === "unlinked") return { kind: data };
  return { kind: "not_found" };
}
