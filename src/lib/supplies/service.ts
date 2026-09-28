import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

// R8 personal supplies: the deductions behind each vial's estimate, and the
// reopen writer (20260926210000_personal_supplies.sql). Read with the
// caller's own session client, so RLS decides what is readable: a person's
// own records, or, for an admin, those of a researcher sharing with the team
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

/**
 * One row of a tracked vial's estimate (personal_vial_deductions): what a
 * recorded dose took from it, or a correction the researcher made (R7;
 * 20260928130000_supplies_v3.sql), whose amount is what the estimate moved
 * by (negative when they found more than estimated).
 */
export type VialDeduction = {
  id: string;
  kind: "dose" | "correction";
  /** The recorded dose; null for a correction. */
  doseId: string | null;
  vialId: string;
  /** Its position on its vial (the order the estimate is counted in). */
  sequence: number;
  amountMg: string;
  remainingBeforeMg: string;
  remainingAfterMg: string;
  /** The vial's estimate went below zero with this dose. */
  stockDiscrepancy: boolean;
  recordedAt: string;
};

type Row = {
  id: string;
  kind: string;
  dose_id: string | null;
  vial_id: string;
  vial_sequence: number;
  amount_mg: string;
  remaining_before_mg: string;
  remaining_after_mg: string;
  stock_discrepancy: boolean;
  recorded_at: string;
};

const COLUMNS = "id, kind, dose_id, vial_id, vial_sequence, amount_mg::text, remaining_before_mg::text, remaining_after_mg::text, stock_discrepancy, recorded_at";

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
  kind: row.kind === "correction" ? "correction" : "dose",
  doseId: row.dose_id,
  vialId: row.vial_id,
  sequence: row.vial_sequence,
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

export type CorrectVialResult =
  | { kind: "corrected" | "unchanged"; remainingMg: string }
  | { kind: "not_found" | "tracking_off" | "changed" | "invalid" | "error" };

const CORRECT_REFUSALS: Record<string, "tracking_off" | "changed" | "invalid"> = { AP016: "tracking_off", AP035: "changed", "22023": "invalid" };

/**
 * R7 "Correct remaining" (correct_personal_vial): the vial's estimate set to
 * what the researcher measured, from the estimate they were shown. The same
 * request key again returns the recorded correction.
 */
export async function correctPersonalVial(
  db: Db,
  input: { requestKey: string; vialId: string; seenRemainingMg: string; remainingMg: string },
): Promise<CorrectVialResult> {
  const { data, error } = await db.rpc("correct_personal_vial", {
    p_request_key: input.requestKey,
    p_vial_id: input.vialId,
    p_seen_remaining_mg: input.seenRemainingMg,
    p_remaining_mg: input.remainingMg,
  });
  if (error) return { kind: CORRECT_REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  const json = data as { remaining_mg: string; unchanged: boolean };
  return { kind: json.unchanged ? "unchanged" : "corrected", remainingMg: json.remaining_mg };
}

export type AddVialResult =
  | { kind: "added"; id: string; label: string; replayed: boolean }
  | { kind: "tracking_off" | "strength" | "mixture_has_vial" | "unavailable" | "invalid" | "error" };

const ADD_REFUSALS: Record<string, Exclude<AddVialResult["kind"], "added">> = {
  AP003: "unavailable",
  AP007: "unavailable",
  AP014: "strength",
  AP015: "mixture_has_vial",
  AP016: "tracking_off",
  "22023": "invalid",
};

/**
 * R7's round + (add_personal_vial): a new vial, once per request (its key,
 * and the hash of the submission: a key reused for anything else is
 * refused). A blank label is named "Vial N" by the database; the result is
 * the label stored, on a replay too.
 */
export async function addPersonalVial(
  db: Db,
  vial: { requestKey: string; requestHash: string; label: string; peptideId: string; strengthMg: string; mixtureId: string | null },
): Promise<AddVialResult> {
  const { data, error } = await db.rpc("add_personal_vial", {
    p_request_key: vial.requestKey,
    p_request_hash: vial.requestHash,
    p_label: vial.label,
    p_peptide_id: vial.peptideId,
    p_strength_mg: vial.strengthMg,
    ...(vial.mixtureId ? { p_mixture_id: vial.mixtureId } : {}),
  });
  if (error) return { kind: ADD_REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "error" };
  const json = data as { id: string; label: string; replayed: boolean };
  return { kind: "added", id: json.id, label: json.label, replayed: json.replayed };
}

export type ReopenVialResult ={ kind: "reopened" | "unlinked" | "not_found" | "tracking_off" | "error" };

/** reopen_personal_vial: a finished vial open again (see the migration for when it keeps its mixture). */
export async function reopenPersonalVial(db: Db, vialId: string): Promise<ReopenVialResult> {
  const { data, error } = await db.rpc("reopen_personal_vial", { p_vial_id: vialId });
  if (error) return { kind: error.code === "AP016" ? "tracking_off" : "error" };
  if (data === "reopened" || data === "unlinked") return { kind: data };
  return { kind: "not_found" };
}
