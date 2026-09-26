import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/library/service";
import type { DoseChange, Phase, TimeChange, Weekday } from "@/lib/schedule/engine";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { TemplatePhase, TemplatePlan } from "@/lib/templates/rules";
import type { RevisedPlan } from "./revise";
import type { CyclePeptide, CycleRecord, CycleRevision, DraftPhase, DraftPlan, StoredPlan, ValidCycle } from "./rules";
import { type CycleStatus, cycleSpan, cycleStatus } from "./schedule";

type Db = SupabaseClient<Database>;

// Research side (R2, R3, R4; S10 and S12 read through here too). `db` is the
// caller's own session client, so RLS decides what is readable: a person's
// own cycles, or those of a researcher whose active support grant they hold
// (can_read_researcher). Callers that mean "my cycles" filter by owner, since
// a granted admin can also read the granting researcher's.

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Library peptides for the builder: every available entry, plus those no
 * longer offered that the caller's own cycles still refer to (the S9
 * peptides policy). Names for the builder and its messages, availability for
 * "+ Add peptide from library".
 */
export async function listCyclePeptides(db: Db): Promise<CyclePeptide[]> {
  const rows = await allRows(
    (from, to) => db.from("peptides").select("id, name, available").order("name").order("id").range(from, to),
    "the library",
  );
  return rows.map(({ id, name, available }) => ({ id, name, available }));
}

type PhaseRow = {
  revision_id: string;
  phase_id: string;
  plan_id: string;
  kind: string;
  start_date: string;
  end_date: string;
  dose_mg: string | null;
  local_time: string | null;
  schedule_type: string | null;
  every_days: number | null;
  weekdays: number[] | null;
  dose_change_from: string[];
  dose_change_mg: string;
  time_change_from: string[];
  time_change_time: string[];
};

/** "{0.5,0.75}" (numeric[] read as text, so no decimal passes through a float) as strings. */
const textArray = (value: string) => (value === "{}" ? [] : value.replace(/^\{|\}$/g, "").split(","));

function phaseOf(row: PhaseRow): Phase {
  const dates = { id: row.phase_id, start: row.start_date, end: row.end_date };
  if (row.kind === "break") return { ...dates, kind: "break" };
  const doses = textArray(row.dose_change_mg);
  const doseChanges: DoseChange[] = row.dose_change_from.map((from, index) => ({ from, doseMg: doses[index] }));
  const timeChanges: TimeChange[] = row.time_change_from.map((from, index) => ({ from, time: row.time_change_time[index] }));
  return {
    ...dates,
    kind: "active",
    doseMg: row.dose_mg ?? "",
    time: row.local_time ?? "",
    schedule:
      row.schedule_type === "weekdays"
        ? { type: "weekdays", days: (row.weekdays ?? []) as Weekday[] }
        : { type: "interval", everyDays: row.every_days ?? 0 },
    ...(doseChanges.length ? { doseChanges } : {}),
    ...(timeChanges.length ? { timeChanges } : {}),
  };
}

const PHASE_COLUMNS =
  "revision_id, phase_id, plan_id, kind, start_date, end_date, dose_mg::text, local_time, schedule_type, every_days, weekdays, dose_change_from, dose_change_mg::text, time_change_from, time_change_time";

/** Cycles with every revision, oldest first, for one owner or one cycle id. */
async function readCycles(db: Db, filter: { ownerId: string } | { cycleId: string }): Promise<CycleRecord[]> {
  const byOwner = "ownerId" in filter;
  const cycles = await allRows(
    (from, to) => {
      const query = db
        .from("cycles")
        .select("id, owner_id, name, goal, baseline, template_id, template_name, template_guidance, template_updated_at, current_revision, version, created_at, updated_at");
      return (byOwner ? query.eq("owner_id", filter.ownerId) : query.eq("id", filter.cycleId))
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to);
    },
    "cycles",
  );
  if (cycles.length === 0) return [];

  const [revisions, plans] = await Promise.all([
    allRows(
      (from, to) => {
        const query = db.from("cycle_revisions").select("id, cycle_id, number, time_zone, created_at");
        return (byOwner ? query.eq("owner_id", filter.ownerId) : query.eq("cycle_id", filter.cycleId))
          .order("cycle_id")
          .order("number")
          .range(from, to);
      },
      "cycle revisions",
    ),
    allRows(
      (from, to) => {
        const query = db.from("cycle_revision_plans").select("revision_id, plan_id, peptide_id, position, effective_from");
        return (byOwner ? query.eq("owner_id", filter.ownerId) : query.eq("cycle_id", filter.cycleId))
          .order("revision_id")
          .order("position")
          .range(from, to);
      },
      "cycle plans",
    ),
  ]);
  const phases = await allRows<PhaseRow>(
    (from, to) => {
      const query = db.from("cycle_revision_phases").select(PHASE_COLUMNS);
      const scoped = byOwner
        ? query.eq("owner_id", filter.ownerId)
        : query.in(
            "revision_id",
            revisions.map((revision) => revision.id),
          );
      return scoped.order("revision_id").order("phase_id").range(from, to) as unknown as PromiseLike<{
        data: PhaseRow[] | null;
        error: { message: string } | null;
      }>;
    },
    "cycle phases",
  );

  const phasesOf = new Map<string, Phase[]>();
  for (const row of phases) {
    const key = `${row.revision_id}/${row.plan_id}`;
    phasesOf.set(key, [...(phasesOf.get(key) ?? []), phaseOf(row)]);
  }
  const plansOf = new Map<string, StoredPlan[]>();
  for (const row of plans) {
    const list = plansOf.get(row.revision_id) ?? [];
    list.push({
      planId: row.plan_id,
      peptideId: row.peptide_id,
      effectiveFrom: row.effective_from,
      phases: (phasesOf.get(`${row.revision_id}/${row.plan_id}`) ?? []).sort((a, b) => a.start.localeCompare(b.start)),
    });
    plansOf.set(row.revision_id, list);
  }
  const revisionsOf = new Map<string, CycleRevision[]>();
  for (const row of revisions) {
    const list = revisionsOf.get(row.cycle_id) ?? [];
    list.push({ id: row.id, number: row.number, timeZone: row.time_zone, createdAt: row.created_at, plans: plansOf.get(row.id) ?? [] });
    revisionsOf.set(row.cycle_id, list);
  }

  return cycles.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      goal: row.goal,
      baseline: row.baseline,
      templateId: row.template_id,
      templateName: row.template_name,
      templateGuidance: row.template_guidance,
      templateUpdatedAt: row.template_updated_at,
      currentRevision: row.current_revision,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Up to the current revision: one saved concurrently is not current yet.
      revisions: (revisionsOf.get(row.id) ?? []).filter((revision) => revision.number <= row.current_revision),
    }));
}

/** One cycle with every revision (the owner's, or a granting researcher's for a granted admin), or null. */
export async function getCycle(db: Db, cycleId: string): Promise<CycleRecord | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cycleId)) return null;
  const [cycle] = await readCycles(db, { cycleId: cycleId.toLowerCase() });
  return cycle ?? null;
}

/** Every cycle `ownerId` owns (readable to them, or to an admin they granted), newest first. */
export function listCycles(db: Db, ownerId: string): Promise<CycleRecord[]> {
  return readCycles(db, { ownerId });
}

/** R2's row data: name, status, dates, peptides and the current time zone. */
export type CycleSummary = {
  id: string;
  name: string;
  goal: string;
  status: CycleStatus;
  start: string;
  end: string;
  timeZone: string;
  peptideIds: string[];
  templateName: string;
};

export function cycleSummary(cycle: CycleRecord, now: Date | string): CycleSummary {
  const current = cycle.revisions[cycle.revisions.length - 1];
  return {
    id: cycle.id,
    name: cycle.name,
    goal: cycle.goal,
    status: cycleStatus(current, now),
    ...cycleSpan(current),
    timeZone: current.timeZone,
    peptideIds: current.plans.map((plan) => plan.peptideId),
    templateName: cycle.templateName,
  };
}

/**
 * A template to copy, as the researcher reads it, or null when there is no
 * such template. The copy includes every peptide it names, even one no
 * longer offered (Marco, 2026-09-26); `peptides` are those peptides' names
 * and availability (template_peptides(): readable for this template only,
 * while the library itself still hides withdrawn entries).
 */
export async function getTemplateForCopy(
  db: Db,
  templateId: string,
): Promise<{ id: string; name: string; plans: TemplatePlan[]; peptides: CyclePeptide[] } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) return null;
  const { data, error } = await db
    .from("cycle_templates")
    .select(
      "id, name, cycle_template_plans(peptide_id, position, cycle_template_phases(kind, offset_days, length_days, dose_mg::text, local_time, schedule_type, every_days, weekdays))",
    )
    .eq("id", templateId.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(`Could not load the template: ${error.message}`);
  if (!data) return null;
  const plans: TemplatePlan[] = [...data.cycle_template_plans]
    .sort((a, b) => a.position - b.position)
    .map((plan) => ({
      peptideId: plan.peptide_id,
      phases: [...plan.cycle_template_phases]
        .sort((a, b) => a.offset_days - b.offset_days)
        .map((row): TemplatePhase => {
          const days = { offset: row.offset_days, len: row.length_days };
          if (row.kind === "break") return { kind: "break", ...days };
          return {
            kind: "active",
            ...days,
            doseMg: row.dose_mg ?? "",
            time: row.local_time ?? "",
            schedule:
              row.schedule_type === "weekdays"
                ? { type: "weekdays", days: (row.weekdays ?? []) as Weekday[] }
                : { type: "interval", everyDays: row.every_days ?? 0 },
          };
        }),
    }));
  const named = await db.rpc("template_peptides", { p_template_id: data.id });
  if (named.error) throw new Error(`Could not load the template's peptides: ${named.error.message}`);
  const peptides = (named.data ?? []).map(({ id, name, available }) => ({ id, name, available }));
  return { id: data.id, name: data.name, plans, peptides };
}

// ── Writes ──────────────────────────────────────────────────────────────────

function phaseArgument(phase: DraftPhase) {
  const base = { phase_id: phase.id, kind: phase.kind, start_date: phase.start, end_date: phase.end };
  if (phase.kind === "break") return base;
  return {
    ...base,
    dose_mg: phase.doseMg,
    local_time: phase.time,
    schedule_type: phase.schedule.type,
    ...(phase.schedule.type === "interval" ? { every_days: phase.schedule.everyDays } : { weekdays: phase.schedule.days }),
    dose_changes: (phase.doseChanges ?? []).map((change) => ({ from: change.from, dose_mg: change.doseMg })),
    time_changes: (phase.timeChanges ?? []).map((change) => ({ from: change.from, local_time: change.time })),
  };
}

/** save_cycle's plans argument (see 20260926180100_cycle_writes.sql). */
export function plansArgument(plans: readonly (DraftPlan | RevisedPlan)[]): Json {
  return plans.map((plan) => ({
    plan_id: plan.planId,
    peptide_id: plan.peptideId,
    effective_from: "effectiveFrom" in plan ? plan.effectiveFrom : null,
    phases: plan.phases.map(phaseArgument),
  })) as Json;
}

export type SaveCycleResult =
  | { kind: "saved"; id: string }
  | { kind: "not_found" | "unavailable" | "stale" | "past" | "template" | "error" };

const REFUSALS: Record<string, Exclude<SaveCycleResult["kind"], "saved">> = {
  AP003: "unavailable",
  AP007: "unavailable",
  AP008: "template",
  AP009: "past",
  AP010: "stale",
};

/**
 * Creates a cycle (from the validated form, optionally copying a template),
 * or saves an edit as the next revision (`revised`: reviseCycle's plans).
 */
export async function saveCycle(db: Db, cycle: ValidCycle, revised?: readonly RevisedPlan[]): Promise<SaveCycleResult> {
  const { data, error } = await db.rpc("save_cycle", {
    p_name: cycle.name,
    p_goal: cycle.goal,
    p_baseline: cycle.baseline,
    p_time_zone: cycle.timeZone,
    p_plans: plansArgument(revised ?? cycle.plans),
    ...(cycle.templateId ? { p_template_id: cycle.templateId } : {}),
    ...(cycle.cycleId ? { p_cycle_id: cycle.cycleId, p_version: cycle.version ?? undefined } : {}),
  });
  if (error) return { kind: REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  return { kind: "saved", id: data };
}
