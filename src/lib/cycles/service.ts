import "server-only";
import { randomUUID } from "node:crypto";
import { saveRequestHash as requestHash } from "@/lib/request-hash";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { afterPair, chunks, keysetRows, type PageOptions } from "@/lib/keyset";
import { allRows } from "@/lib/library/service";
import type { DoseChange, Phase, TimeChange, Weekday } from "@/lib/schedule/engine";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { TemplatePhase, TemplatePlan } from "@/lib/templates/rules";
import type { RevisedPlan } from "./revise";
import type { MixtureSetup } from "@/lib/mixtures/rules";
import type { CyclePeptide, CycleRecord, CycleRevision, DraftPhase, DraftPlan, StoredPlan, ValidCycle } from "./rules";
import { type CycleStatus, cycleSpan, cycleStatus } from "./schedule";

type Db = SupabaseClient<Database>;

// Research side (R2, R3, R4; S10 and S12 read through here too). `db` is the
// caller's own session client, so RLS decides what is readable: a person's
// own cycles, or, for an admin, those of a researcher who shares with the
// team (can_read_researcher). Callers that mean "my cycles" filter by owner,
// since an admin can also read a sharing researcher's.

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

type Tables = Database["public"]["Tables"];
type CycleRow = Pick<
  Tables["cycles"]["Row"],
  | "id"
  | "owner_id"
  | "name"
  | "goal"
  | "baseline"
  | "template_id"
  | "template_name"
  | "template_guidance"
  | "template_updated_at"
  | "current_revision"
  | "version"
  | "created_at"
  | "updated_at"
>;
type RevisionRow = Pick<Tables["cycle_revisions"]["Row"], "id" | "cycle_id" | "number" | "time_zone" | "created_at">;
type PlanRow = Pick<Tables["cycle_revision_plans"]["Row"], "revision_id" | "plan_id" | "peptide_id" | "position" | "effective_from">;

/** A timestamptz order, to the microsecond, as the database compares them. */
const byInstant = (a: string, b: string) => Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b));

/**
 * Cycles with every revision, oldest first, for one owner or one cycle id.
 * Every table is read a page at a time by its key (keyset; A8 reads a whole
 * history through here) and put in order here.
 */
async function readCycles(db: Db, filter: { ownerId: string } | { cycleId: string }, options: PageOptions = {}): Promise<CycleRecord[]> {
  const byOwner = "ownerId" in filter;
  const cycles = await keysetRows<CycleRow>(
    (after, limit) => {
      const query = db
        .from("cycles")
        .select("id, owner_id, name, goal, baseline, template_id, template_name, template_guidance, template_updated_at, current_revision, version, created_at, updated_at");
      const scoped = byOwner ? query.eq("owner_id", filter.ownerId) : query.eq("id", filter.cycleId);
      return (after ? scoped.gt("id", after.id) : scoped).order("id").limit(limit);
    },
    "cycles",
    options,
  );
  if (cycles.length === 0) return [];
  // Newest first.
  cycles.sort((a, b) => byInstant(b.created_at, a.created_at) || a.id.localeCompare(b.id));

  const [revisions, plans] = await Promise.all([
    keysetRows<RevisionRow>(
      (after, limit) => {
        const query = db.from("cycle_revisions").select("id, cycle_id, number, time_zone, created_at");
        const scoped = byOwner ? query.eq("owner_id", filter.ownerId) : query.eq("cycle_id", filter.cycleId);
        return (after ? scoped.gt("id", after.id) : scoped).order("id").limit(limit);
      },
      "cycle revisions",
      options,
    ),
    keysetRows<PlanRow>(
      (after, limit) => {
        const query = db.from("cycle_revision_plans").select("revision_id, plan_id, peptide_id, position, effective_from");
        const scoped = byOwner ? query.eq("owner_id", filter.ownerId) : query.eq("cycle_id", filter.cycleId);
        return (after ? scoped.or(afterPair("revision_id", after.revision_id, "plan_id", after.plan_id)) : scoped)
          .order("revision_id")
          .order("plan_id")
          .limit(limit);
      },
      "cycle plans",
      options,
    ),
  ]);
  revisions.sort((a, b) => a.cycle_id.localeCompare(b.cycle_id) || a.number - b.number);
  plans.sort((a, b) => a.revision_id.localeCompare(b.revision_id) || a.position - b.position);
  // One cycle's phases are found by its revision ids: in bounded chunks, so a
  // cycle with hundreds of revisions never outgrows the request's URL.
  const ownerId = "ownerId" in filter ? filter.ownerId : "";
  const phaseRows = (revisionIds: string[] | null) =>
    keysetRows<PhaseRow>(
      (after, limit) => {
        const query = db.from("cycle_revision_phases").select(PHASE_COLUMNS);
        const scoped = revisionIds ? query.in("revision_id", revisionIds) : query.eq("owner_id", ownerId);
        return (after ? scoped.or(afterPair("revision_id", after.revision_id, "phase_id", after.phase_id)) : scoped)
          .order("revision_id")
          .order("phase_id")
          .limit(limit) as unknown as PromiseLike<{
          data: PhaseRow[] | null;
          error: { message: string } | null;
        }>;
      },
      "cycle phases",
      options,
    );
  const phases = byOwner
    ? await phaseRows(null)
    : (await Promise.all(chunks(revisions.map((revision) => revision.id), options.chunkSize).map(phaseRows))).flat();

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

/** One cycle with every revision (the owner's, or a sharing researcher's for an admin), or null. */
export async function getCycle(db: Db, cycleId: string): Promise<CycleRecord | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cycleId)) return null;
  const [cycle] = await readCycles(db, { cycleId: cycleId.toLowerCase() });
  return cycle ?? null;
}

/** Every cycle `ownerId` owns (readable to them, or to admins while they share), newest first. */
export function listCycles(db: Db, ownerId: string, options: PageOptions = {}): Promise<CycleRecord[]> {
  return readCycles(db, { ownerId }, options);
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
 * The cycle alone, with no mix entries (tests and scripts): its own request
 * key, so every call is a new submission.
 */
export async function saveCycle(db: Db, cycle: ValidCycle, revised?: readonly RevisedPlan[]): Promise<SaveCycleResult> {
  const key = randomUUID();
  const result = await saveCycleWithMixes(db, cycle, revised, [], { key, hash: requestHash({ key }) });
  switch (result.kind) {
    case "mixture_stale":
    case "vial_strength":
      return { kind: "error" };
    default:
      return result;
  }
}

/**
 * What the builder says about a peptide's mix (R4b), so "left as it was" and
 * "cleared" are never the same: `set` a new mixture, or a saved one at the
 * version shown, with its setup (a change is its next version); `keep` the
 * plan's current mixture unchanged; `remove` the plan's current mixture from
 * the plan (the mixture and the doses logged with it stay). A peptide with
 * no entry is left as it is.
 */
export type CycleMix =
  | { kind: "set"; peptideId: string; mixtureId: string | null; version: number | null; setup: MixtureSetup }
  | { kind: "keep" | "remove"; peptideId: string; mixtureId: string; version: number };

/**
 * One builder submission (20260928120000_save_cycle_mixtures.sql,
 * "Idempotency"): `key` is made once in the browser and sent again on a
 * retry; `hash` is saveRequestHash of what was sent. A retry of a submission
 * that saved returns that save; the key with other details, or from another
 * account, is refused.
 */
export type SaveRequest = { key: string; hash: string };

export { saveRequestHash } from "@/lib/request-hash";

export type SaveReplay = { kind: "new" } | { kind: "saved"; id: string } | { kind: "used" | "error" };

/**
 * Whether this submission already saved (cycle_save_replay): the cycle it
 * saved, "new" when its key is unclaimed, "used" when the key was claimed
 * with other details or by another account.
 */
export async function replayedSave(db: Db, request: SaveRequest): Promise<SaveReplay> {
  const { data, error } = await db.rpc("cycle_save_replay", { p_request_key: request.key, p_request_hash: request.hash });
  if (error) return { kind: error.code === "22023" ? "used" : "error" };
  return data ? { kind: "saved", id: data } : { kind: "new" };
}

export type SaveCycleWithMixesResult = SaveCycleResult | { kind: "mixture_stale" | "vial_strength" };

const MIX_REFUSALS: Record<string, "mixture_stale" | "vial_strength"> = { AP011: "mixture_stale", AP014: "vial_strength" };

/**
 * Creates a cycle (from the validated form, optionally copying a template),
 * or saves an edit as the next revision (`revised`: reviseCycle's plans),
 * with each peptide's mix entry: save_cycle_with_mixtures()
 * (20260928120000_save_cycle_mixtures.sql), the cycle and the mixes in one
 * transaction (a refused mix saves nothing, the cycle included), once per
 * `request` (a retry returns the first save).
 */
export async function saveCycleWithMixes(
  db: Db,
  cycle: ValidCycle,
  revised: readonly RevisedPlan[] | undefined,
  mixes: readonly CycleMix[],
  request: SaveRequest,
): Promise<SaveCycleWithMixesResult> {
  const { data, error } = await db.rpc("save_cycle_with_mixtures", {
    p_request_key: request.key,
    p_request_hash: request.hash,
    p_name: cycle.name,
    p_goal: cycle.goal,
    p_baseline: cycle.baseline,
    p_time_zone: cycle.timeZone,
    p_plans: plansArgument(revised ?? cycle.plans),
    p_mixtures: mixesArgument(mixes),
    ...(cycle.templateId ? { p_template_id: cycle.templateId } : {}),
    ...(cycle.cycleId ? { p_cycle_id: cycle.cycleId, p_version: cycle.version ?? undefined } : {}),
  });
  if (error) return { kind: MIX_REFUSALS[error.code] ?? REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  return { kind: "saved", id: data };
}

/** save_cycle_with_mixtures()'s p_mixtures argument. */
export function mixesArgument(mixes: readonly CycleMix[]): Json {
  return mixes.map((mix) =>
    mix.kind === "set"
      ? {
          kind: "set",
          peptide_id: mix.peptideId,
          mixture_id: mix.mixtureId,
          version: mix.version,
          vial_mg: mix.setup.vialMg,
          liquid_ml: mix.setup.liquidMl,
          syringe_units: mix.setup.syringe,
          line_spacing: mix.setup.lineSpacing,
        }
      : { kind: mix.kind, peptide_id: mix.peptideId, mixture_id: mix.mixtureId, version: mix.version },
  ) as Json;
}
