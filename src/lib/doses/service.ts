import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/library/service";
import type { LineSpacing, SyringeCapacity } from "@/lib/calculator/calculator";
import type { RecordedConfirmation } from "@/lib/cycles/views";
import type { Database } from "@/lib/supabase/database.types";
import { type SetupLink, type SetupSegment, setupSegments, type SetupVersion } from "./setups";

type Db = SupabaseClient<Database>;

// Recorded doses (S12), read and written with the caller's own session
// client, so RLS decides what is readable: a person's own records, or those
// of a researcher whose active support grant they hold. Callers that mean
// "mine" pass their own id as owner. Amounts are read as text so no decimal
// passes through a float.
//
// For other slices:
//   S10/R2/R4, R3 edits, R7   confirmationsByCycle(await listDoseRecords(db, id))
//                             → the engine's confirmations, per cycle id, with
//                             the recorded amount, site and notes for display.
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

/** A recorded dose as the engine's confirmation, with what was recorded. */
const confirmationOf = (record: DoseRecord): RecordedConfirmation => ({
  key: record.occurrenceKey,
  actualAt: record.actualAt,
  recordedAt: record.recordedAt,
  scheduledAt: record.scheduledAt,
  amountMg: record.amountMg,
  site: record.site,
  notes: record.notes,
});

/** Recorded doses as the engine's confirmations, by cycle id. */
export function confirmationsByCycle(records: readonly DoseRecord[]): Map<string, RecordedConfirmation[]> {
  const byCycle = new Map<string, RecordedConfirmation[]>();
  for (const record of records) {
    const list = byCycle.get(record.cycleId) ?? [];
    list.push(confirmationOf(record));
    byCycle.set(record.cycleId, list);
  }
  return byCycle;
}

/** One cycle's confirmations, for a page that shows one cycle. */
export async function cycleConfirmations(db: Db, cycleId: string): Promise<RecordedConfirmation[]> {
  const rows = await allRows<RecordRow>(
    (from, to) =>
      db
        .from("dose_records")
        .select(RECORD_COLUMNS)
        .eq("cycle_id", cycleId)
        .order("recorded_at")
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: RecordRow[] | null; error: { message: string } | null }>,
    "recorded doses",
  );
  return rows.map((row) => confirmationOf(recordOf(row)));
}

// ── The setups a plan used over time (R5's units and seen version) ──────────

type LinkRow = { plan_id: string; mixture_id: string; linked_at: string; unlinked_at: string | null };
type VersionRow = {
  id: string;
  mixture_id: string;
  number: number;
  vial_mg: string;
  liquid_ml: string;
  syringe_units: number;
  line_spacing: string | null;
  created_at: string;
};

/** Each of `ownerId`'s plans' saved-mixture setups over time, by plan id (see setups.ts). */
export async function planSetups(db: Db, ownerId: string): Promise<Map<string, SetupSegment[]>> {
  const [links, versions] = await Promise.all([
    allRows<LinkRow>(
      (from, to) =>
        db
          .from("cycle_plan_mixtures")
          .select("plan_id, mixture_id, linked_at, unlinked_at")
          .eq("owner_id", ownerId)
          .order("plan_id")
          .order("linked_at")
          .range(from, to),
      "mixture links",
    ),
    allRows<VersionRow>(
      (from, to) =>
        db
          .from("mixture_versions")
          .select("id, mixture_id, number, vial_mg::text, liquid_ml::text, syringe_units, line_spacing::text, created_at")
          .eq("owner_id", ownerId)
          .order("mixture_id")
          .order("number")
          .range(from, to) as unknown as PromiseLike<{ data: VersionRow[] | null; error: { message: string } | null }>,
      "mixture setups",
    ),
  ]);
  const setups: SetupVersion[] = versions.map((row) => ({
    id: row.id,
    mixtureId: row.mixture_id,
    number: row.number,
    createdAt: row.created_at,
    setup: {
      vialMg: row.vial_mg,
      liquidMl: row.liquid_ml,
      syringe: row.syringe_units as SyringeCapacity,
      lineSpacing: (row.line_spacing ?? "unknown") as LineSpacing,
    },
  }));
  const byPlan = new Map<string, SetupLink[]>();
  for (const link of links) {
    const list = byPlan.get(link.plan_id) ?? [];
    list.push({ mixtureId: link.mixture_id, linkedAt: link.linked_at, unlinkedAt: link.unlinked_at });
    byPlan.set(link.plan_id, list);
  }
  return new Map([...byPlan].map(([planId, planLinks]) => [planId, setupSegments(planLinks, setups)]));
}

// ── Confirming ──────────────────────────────────────────────────────────────

export type ConfirmDoseInput = {
  requestKey: string;
  occurrenceKey: string;
  /** What the screen showed, so a changed occurrence is never confirmed blindly. */
  seenScheduledAt: string;
  seenDoseMg: string;
  /** The saved-mixture version whose units were shown, for the actual time (null: none). */
  seenMixtureVersionId: string | null;
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
    // null is "no mixture shown" (the generated type has no null for uuid arguments).
    p_seen_mixture_version_id: input.seenMixtureVersionId as string,
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
