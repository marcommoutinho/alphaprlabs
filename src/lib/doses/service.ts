import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/library/service";
import type { LineSpacing, SyringeCapacity } from "@/lib/calculator/calculator";
import type { RecordedConfirmation } from "@/lib/cycles/views";
import type { Database } from "@/lib/supabase/database.types";
import { type SetupLink, type SetupSegment, setupSegments, type SetupVersion } from "./setups";

type Db = SupabaseClient<Database>;

// Recorded doses (S12), read and written with the caller's own session
// client, so RLS decides what is readable: a person's own records, or those
// of a researcher sharing with the team, for an admin. Callers that mean
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

/** Rows per request; the API caps a response at 1,000 rows. */
const PAGE = 1000;

type RecordPage = PromiseLike<{ data: RecordRow[] | null; error: { message: string } | null }>;

/**
 * Every recorded dose matching `scope` (the owner's, or one cycle's), in
 * recording order (recorded_at, then id). Read a page at a time by id
 * (keyset: each page starts after the last id read), so the API's 1,000-row
 * cap never cuts the history short, and a dose recorded meanwhile can't
 * shift a page and make a row skip or repeat as offsets could.
 */
/**
 * How a read is paged; for tests. `afterPage` runs after each page is read
 * and before the next is asked for (tests write between pages with it).
 */
export type DoseReadOptions = { pageSize?: number; afterPage?: (page: number) => Promise<void> | void };

async function recordRows(db: Db, scope: { ownerId: string } | { cycleId: string }, options: DoseReadOptions): Promise<RecordRow[]> {
  // Never more than the API returns: a short page must mean the last one.
  const pageSize = Math.min(options.pageSize ?? PAGE, PAGE);
  const rows: RecordRow[] = [];
  for (let after: string | null = null; ; ) {
    const query = db.from("dose_records").select(RECORD_COLUMNS);
    const scoped = "ownerId" in scope ? query.eq("owner_id", scope.ownerId) : query.eq("cycle_id", scope.cycleId);
    const { data, error } = await ((after ? scoped.gt("id", after) : scoped).order("id").limit(pageSize) as unknown as RecordPage);
    if (error) throw new Error(`Could not load recorded doses: ${error.message}`);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < pageSize) break;
    after = got[got.length - 1].id;
    await options.afterPage?.(rows.length / pageSize);
  }
  // To the microsecond, as the database orders them.
  return rows.sort((a, b) => Temporal.Instant.compare(Temporal.Instant.from(a.recorded_at), Temporal.Instant.from(b.recorded_at)) || a.id.localeCompare(b.id));
}

/**
 * Every dose `ownerId` recorded (readable to them, or to admins while they
 * share with the team), in recording order.
 */
export async function listDoseRecords(db: Db, ownerId: string, options: DoseReadOptions = {}): Promise<DoseRecord[]> {
  return (await recordRows(db, { ownerId }, options)).map(recordOf);
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

/** A recorded skip as the engine's (skipped) confirmation: it only marks its occurrence. */
const skipConfirmationOf = (skip: DoseSkip): RecordedConfirmation => ({
  key: skip.occurrenceKey,
  actualAt: skip.recordedAt,
  recordedAt: skip.recordedAt,
  scheduledAt: skip.scheduledAt,
  skipped: true,
});

/** Recorded doses (and skips, V1) as the engine's confirmations, by cycle id. */
export function confirmationsByCycle(records: readonly DoseRecord[], skips: readonly DoseSkip[] = []): Map<string, RecordedConfirmation[]> {
  const byCycle = new Map<string, RecordedConfirmation[]>();
  const add = (cycleId: string, confirmation: RecordedConfirmation) => {
    const list = byCycle.get(cycleId) ?? [];
    list.push(confirmation);
    byCycle.set(cycleId, list);
  };
  for (const record of records) add(record.cycleId, confirmationOf(record));
  for (const skip of skips) add(skip.cycleId, skipConfirmationOf(skip));
  return byCycle;
}

/** One cycle's confirmations (its recorded doses and skips), for a page that shows one cycle. */
export async function cycleConfirmations(db: Db, cycleId: string, options: DoseReadOptions = {}): Promise<RecordedConfirmation[]> {
  const [rows, skips] = await Promise.all([recordRows(db, { cycleId }, options), skipRows(db, { cycleId })]);
  return [...rows.map((row) => confirmationOf(recordOf(row))), ...skips.map(skipConfirmationOf)];
}

// ── Skips (V1: "Skip" / "Mark skipped") ─────────────────────────────────────

/** One recorded skip (dose_skips): the occurrence is resolved, not taken. */
export type DoseSkip = {
  id: string;
  cycleId: string;
  planId: string;
  occurrenceKey: string;
  scheduledAt: string;
  plannedMg: string;
  recordedAt: string;
};

type SkipRow = { id: string; cycle_id: string; plan_id: string; occurrence_key: string; scheduled_at: string; planned_mg: string; recorded_at: string };
const SKIP_COLUMNS = "id, cycle_id, plan_id, occurrence_key, scheduled_at, planned_mg::text, recorded_at";

const skipOf = (row: SkipRow): DoseSkip => ({
  id: row.id,
  cycleId: row.cycle_id,
  planId: row.plan_id,
  occurrenceKey: row.occurrence_key,
  scheduledAt: row.scheduled_at,
  plannedMg: row.planned_mg,
  recordedAt: row.recorded_at,
});

/** Every skip matching `scope`, read a page at a time by id (as recordRows). */
async function skipRows(db: Db, scope: { ownerId: string } | { cycleId: string }): Promise<DoseSkip[]> {
  const rows: SkipRow[] = [];
  for (let after: string | null = null; ; ) {
    const query = db.from("dose_skips").select(SKIP_COLUMNS);
    const scoped = "ownerId" in scope ? query.eq("owner_id", scope.ownerId) : query.eq("cycle_id", scope.cycleId);
    const { data, error } = await ((after ? scoped.gt("id", after) : scoped).order("id").limit(PAGE) as unknown as PromiseLike<{
      data: SkipRow[] | null;
      error: { message: string } | null;
    }>);
    if (error) throw new Error(`Could not load skipped doses: ${error.message}`);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE) break;
    after = got[got.length - 1].id;
  }
  return rows.map(skipOf);
}

/** Every dose `ownerId` skipped (readable to them, or to admins while they share). */
export function listDoseSkips(db: Db, ownerId: string): Promise<DoseSkip[]> {
  return skipRows(db, { ownerId });
}

/** The engine's confirmations for everything `ownerId` recorded (doses and skips), by cycle id. */
export async function ownerConfirmations(db: Db, ownerId: string): Promise<Map<string, RecordedConfirmation[]>> {
  const [records, skips] = await Promise.all([listDoseRecords(db, ownerId), listDoseSkips(db, ownerId)]);
  return confirmationsByCycle(records, skips);
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
  /** The recorded site ("" when none). */
  site: string;
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
  | { kind: "not_found" | "gone" | "already" | "skipped" | "undone" | "not_yet" | "changed" | "future" | "too_early" | "invalid" | "error" };

const REFUSALS: Record<string, Exclude<ConfirmDoseResult["kind"], "recorded">> = {
  AP017: "gone",
  AP018: "already",
  AP019: "not_yet",
  AP020: "changed",
  AP021: "future",
  AP022: "too_early",
  AP031: "skipped",
  AP034: "undone",
  "22023": "invalid",
};

type ResultJson = {
  id: string;
  site: string;
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
      site: json.site,
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

// ── Skipping and undoing (V1) ───────────────────────────────────────────────

export type SkipDoseInput = { requestKey: string; occurrenceKey: string; seenScheduledAt: string; seenDoseMg: string };

export type SkipDoseResult =
  | { kind: "skipped"; skip: { id: string; occurrenceKey: string; recordedAt: string; replayed: boolean } }
  | { kind: "not_found" | "gone" | "already" | "already_skipped" | "undone" | "not_yet" | "changed" | "invalid" | "error" };

const SKIP_REFUSALS: Record<string, Exclude<SkipDoseResult["kind"], "skipped">> = {
  AP017: "gone",
  AP018: "already",
  AP019: "not_yet",
  AP020: "changed",
  AP031: "already_skipped",
  AP034: "undone",
  "22023": "invalid",
};

/** skip_dose (20260928100000_dose_skips_undo_sites.sql): one recorded skip, idempotent by request key. */
export async function skipDose(db: Db, input: SkipDoseInput): Promise<SkipDoseResult> {
  const { data, error } = await db.rpc("skip_dose", {
    p_request_key: input.requestKey,
    p_occurrence_key: input.occurrenceKey,
    p_seen_scheduled_at: input.seenScheduledAt,
    p_seen_dose_mg: input.seenDoseMg,
  });
  if (error) return { kind: SKIP_REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  const json = data as unknown as { id: string; occurrence_key: string; recorded_at: string; replayed: boolean };
  return { kind: "skipped", skip: { id: json.id, occurrenceKey: json.occurrence_key, recordedAt: json.recorded_at, replayed: json.replayed } };
}

export type UndoDoseResult =
  | {
      kind: "undone";
      undo: { id: string; entry: "taken" | "skipped"; occurrenceKey: string; replayed: boolean; vialLabel: string | null };
    }
  | { kind: "not_found" | "too_late" | "depends" | "already" | "invalid" | "error" };

const UNDO_REFUSALS: Record<string, Exclude<UndoDoseResult["kind"], "undone">> = {
  AP032: "too_late",
  AP033: "depends",
  AP034: "already",
  "22023": "invalid",
};

/** undo_dose: retracts a Taken or a skip just recorded, keeping an audit record (see the migration). */
export async function undoDose(db: Db, input: { requestKey: string; entryId: string }): Promise<UndoDoseResult> {
  const { data, error } = await db.rpc("undo_dose", { p_request_key: input.requestKey, p_entry_id: input.entryId });
  if (error) return { kind: UNDO_REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  const json = data as unknown as {
    id: string;
    kind: "taken" | "skipped";
    occurrence_key: string;
    replayed: boolean;
    deduction: { vial_label: string | null } | null;
  };
  return {
    kind: "undone",
    undo: { id: json.id, entry: json.kind, occurrenceKey: json.occurrence_key, replayed: json.replayed, vialLabel: json.deduction?.vial_label ?? null },
  };
}
