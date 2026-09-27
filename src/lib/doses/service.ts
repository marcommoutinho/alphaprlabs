import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/library/service";
import type { Confirmation } from "@/lib/schedule/engine";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

// Recorded doses (S12), read and written with the caller's own session
// client, so RLS decides what is readable: a person's own records, or those
// of a researcher whose active support grant they hold. Callers that mean
// "mine" pass their own id as owner. Amounts are read as text so no decimal
// passes through a float.
//
// For other slices:
//   S10/R2/R4, R3 edits, R7   confirmationsByCycle(await listDoseRecords(db, id))
//                             → the engine's confirmations, per cycle id.
//   S13 reminders             a recorded dose stops its reminders; see the
//                             header of 20260926200000_doses.sql.
//   S14 supplies              personal_vial_deductions (estimates per vial).

/** One recorded administration (dose_records). */
export type DoseRecord = {
  id: string;
  cycleId: string;
  planId: string;
  occurrenceKey: string;
  /** The occurrence's scheduled time when it was confirmed (ISO). */
  scheduledAt: string;
  plannedMg: string;
  actualAt: string;
  recordedAt: string;
  amountMg: string;
  site: string;
  notes: string;
  mixtureVersionId: string | null;
};

type RecordRow = {
  id: string;
  cycle_id: string;
  plan_id: string;
  occurrence_key: string;
  scheduled_at: string;
  planned_mg: string;
  actual_at: string;
  recorded_at: string;
  amount_mg: string;
  site: string;
  notes: string;
  mixture_version_id: string | null;
};

const RECORD_COLUMNS =
  "id, cycle_id, plan_id, occurrence_key, scheduled_at, planned_mg::text, actual_at, recorded_at, amount_mg::text, site, notes, mixture_version_id";

const recordOf = (row: RecordRow): DoseRecord => ({
  id: row.id,
  cycleId: row.cycle_id,
  planId: row.plan_id,
  occurrenceKey: row.occurrence_key,
  scheduledAt: row.scheduled_at,
  plannedMg: row.planned_mg,
  actualAt: row.actual_at,
  recordedAt: row.recorded_at,
  amountMg: row.amount_mg,
  site: row.site,
  notes: row.notes,
  mixtureVersionId: row.mixture_version_id,
});

/** Every dose `ownerId` recorded (readable to them, or to an admin they granted), in recording order. */
export async function listDoseRecords(db: Db, ownerId: string): Promise<DoseRecord[]> {
  const rows = await allRows<RecordRow>(
    (from, to) =>
      db
        .from("dose_records")
        .select(RECORD_COLUMNS)
        .eq("owner_id", ownerId)
        .order("recorded_at")
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: RecordRow[] | null; error: { message: string } | null }>,
    "recorded doses",
  );
  return rows.map(recordOf);
}

/** Recorded doses as the engine's confirmations, by cycle id. */
export function confirmationsByCycle(records: readonly DoseRecord[]): Map<string, Confirmation[]> {
  const byCycle = new Map<string, Confirmation[]>();
  for (const record of records) {
    const list = byCycle.get(record.cycleId) ?? [];
    list.push({ key: record.occurrenceKey, actualAt: record.actualAt, recordedAt: record.recordedAt, scheduledAt: record.scheduledAt });
    byCycle.set(record.cycleId, list);
  }
  return byCycle;
}

/** One cycle's confirmations, for a page that shows one cycle. */
export async function cycleConfirmations(db: Db, cycleId: string): Promise<Confirmation[]> {
  const rows = await allRows<Pick<RecordRow, "occurrence_key" | "actual_at" | "recorded_at" | "scheduled_at">>(
    (from, to) =>
      db
        .from("dose_records")
        .select("occurrence_key, actual_at, recorded_at, scheduled_at")
        .eq("cycle_id", cycleId)
        .order("recorded_at")
        .order("id")
        .range(from, to),
    "recorded doses",
  );
  return rows.map((row) => ({ key: row.occurrence_key, actualAt: row.actual_at, recordedAt: row.recorded_at, scheduledAt: row.scheduled_at }));
}

// ── Confirming ──────────────────────────────────────────────────────────────

export type ConfirmDoseInput = {
  requestKey: string;
  occurrenceKey: string;
  /** What the screen showed, so a changed occurrence is never confirmed blindly. */
  seenScheduledAt: string;
  seenDoseMg: string;
  amountMg: string;
  /** ISO instant; null means now (the server's clock). */
  actualAt: string | null;
  site: string;
  notes: string;
};

export type RecordedDose = {
  id: string;
  occurrenceKey: string;
  actualAt: string;
  recordedAt: string;
  amountMg: string;
  /** True when this was a retry of a request already recorded. */
  replayed: boolean;
  deduction: { vialLabel: string; remainingAfterMg: string; stockDiscrepancy: boolean } | null;
};

export type ConfirmDoseResult =
  | { kind: "recorded"; dose: RecordedDose }
  | { kind: "not_found" | "gone" | "already" | "not_yet" | "changed" | "future" | "too_early" | "invalid" | "error" };

const REFUSALS: Record<string, Exclude<ConfirmDoseResult["kind"], "recorded">> = {
  AP017: "gone",
  AP018: "already",
  AP019: "not_yet",
  AP020: "changed",
  AP021: "future",
  AP022: "too_early",
  "22023": "invalid",
};

type ResultJson = {
  id: string;
  occurrence_key: string;
  actual_at: string;
  recorded_at: string;
  amount_mg: string;
  replayed: boolean;
  deduction: { vial_label: string; remaining_after_mg: string; stock_discrepancy: boolean } | null;
};

/** confirm_dose (20260926200100_dose_confirmation.sql): one recorded dose, idempotent by request key. */
export async function confirmDose(db: Db, input: ConfirmDoseInput): Promise<ConfirmDoseResult> {
  const { data, error } = await db.rpc("confirm_dose", {
    p_request_key: input.requestKey,
    p_occurrence_key: input.occurrenceKey,
    p_seen_scheduled_at: input.seenScheduledAt,
    p_seen_dose_mg: input.seenDoseMg,
    p_amount_mg: input.amountMg,
    ...(input.actualAt ? { p_actual_at: input.actualAt } : {}),
    p_site: input.site,
    p_notes: input.notes,
  });
  if (error) return { kind: REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  const json = data as unknown as ResultJson;
  return {
    kind: "recorded",
    dose: {
      id: json.id,
      occurrenceKey: json.occurrence_key,
      actualAt: json.actual_at,
      recordedAt: json.recorded_at,
      amountMg: json.amount_mg,
      replayed: json.replayed,
      deduction: json.deduction
        ? {
            vialLabel: json.deduction.vial_label,
            remainingAfterMg: json.deduction.remaining_after_mg,
            stockDiscrepancy: json.deduction.stock_discrepancy,
          }
        : null,
    },
  };
}
