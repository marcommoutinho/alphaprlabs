// R3 Cycle builder: the stored cycle shape, the builder's form, its
// validation and the copy of a template into a new cycle (handoff
// docs/design/research-app/README.md "R3 Cycle builder"; the prototype's
// saveBuilder). Pure and shared by the builder, the server action and tests.
//
// Stored plans are S7 engine plans: dated phases in the cycle's IANA time
// zone, with stable uuid plan and phase ids (see revise.ts for how ids and
// occurrence keys survive an edit).
import { Temporal } from "@js-temporal/polyfill";
import { Exact, normalizeDecimal, plain } from "@/lib/calculator/decimal";
import {
  type ActivePhase,
  type BreakPhase,
  MAX_EVERY_DAYS,
  type Phase,
  type PlanIssue,
  type Schedule,
  timeOn,
  validatePlan,
  type Weekday,
} from "@/lib/schedule/engine";
import { isLocalDate, isValidTimeZone, type LocalDate, localDateOf } from "@/lib/schedule/zone";
import { templatePlanToEngine, type TemplatePlan } from "@/lib/templates/rules";

/** Mirrors the database checks (20260926180000_cycles.sql, save_cycle). */
export const CYCLE_LIMITS = { name: 120, goal: 500, baseline: 500, plans: 20, phases: 100 } as const;

// ── Stored shape ────────────────────────────────────────────────────────────

/** One peptide plan in a revision. Phase ids are stable uuids. */
export type StoredPlan = {
  planId: string;
  peptideId: string;
  /** First local date this revision schedules for the plan; null when it schedules the whole plan. */
  effectiveFrom: LocalDate | null;
  phases: Phase[];
};

export type CycleRevision = {
  id: string;
  number: number;
  timeZone: string;
  /** When it took effect (ISO). */
  createdAt: string;
  /** In the builder's order. */
  plans: StoredPlan[];
};

export type CycleRecord = {
  id: string;
  ownerId: string;
  name: string;
  goal: string;
  baseline: string;
  /** The template it was copied from, and that template as it was then. */
  templateId: string | null;
  templateName: string;
  templateGuidance: string;
  templateUpdatedAt: string | null;
  currentRevision: number;
  /** The concurrency token: advances on every successful edit, metadata-only included. */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Oldest first; the last is the current revision. */
  revisions: CycleRevision[];
};

/** A library peptide as the builder needs it. */
export type CyclePeptide = { id: string; name: string; available: boolean };

// ── The builder's form ──────────────────────────────────────────────────────

export type CyclePhaseForm = {
  /** The stored phase id, or null for a phase added in the builder. */
  id: string | null;
  kind: "active" | "break";
  start: string;
  end: string;
  mg: string;
  time: string;
  schedule: "interval" | "weekdays";
  every: string;
  days: Weekday[];
};

export type CyclePlanForm = { planId: string | null; peptideId: string; phases: CyclePhaseForm[] };

export type CycleForm = {
  cycleId: string | null;
  /** The cycle version the edit starts from (CycleRecord.version; null for a new cycle). */
  version: number | null;
  templateId: string | null;
  name: string;
  timeZone: string;
  goal: string;
  baseline: string;
  plans: CyclePlanForm[];
};

/** The prototype's defaults. */
export const DEFAULT_TIME = "08:00";
const DEFAULT_DAYS: Weekday[] = [1, 3, 5];

export const addDays = (date: LocalDate, days: number): LocalDate => Temporal.PlainDate.from(date).add({ days }).toString();

/** Tomorrow in `timeZone` as of `now` (ISO): where a new cycle's first phases start (the prototype). */
export const tomorrowIn = (now: string, timeZone: string): LocalDate => addDays(localDateOf(now, timeZone), 1);

/** The zone default dates are computed in before the builder knows the cycle's (server rendering). */
export const DATES_ZONE = "UTC";

/** A plan with every phase date moved by `days` (the builder's default dates, on a time zone change). */
export function shiftPlan(plan: CyclePlanForm, days: number): CyclePlanForm {
  const move = (date: string) => (isLocalDate(date) ? addDays(date, days) : date);
  return { ...plan, phases: plan.phases.map((phase) => ({ ...phase, start: move(phase.start), end: move(phase.end) })) };
}

/** "+ Phase (change amount or frequency)": active, 28 days, every 5 days, 08:00, dose blank. */
export const newActivePhase = (start: LocalDate): CyclePhaseForm => ({
  id: null,
  kind: "active",
  start,
  end: addDays(start, 27),
  mg: "",
  time: DEFAULT_TIME,
  schedule: "interval",
  every: "5",
  days: [...DEFAULT_DAYS],
});

/** "+ Break": 7 days. */
export const newBreak = (start: LocalDate): CyclePhaseForm => ({ ...newActivePhase(start), kind: "break", end: addDays(start, 6) });

/** "+ Add peptide from library": one active phase from `start` (the prototype: tomorrow). */
export const newPlan = (peptideId: string, start: LocalDate): CyclePlanForm => ({ planId: null, peptideId, phases: [newActivePhase(start)] });

/** Where "+ Phase" and "+ Break" start: the day after the last phase ends, else `fallback`. */
export function nextPhaseStart(plan: CyclePlanForm, fallback: LocalDate): LocalDate {
  const ends = plan.phases.map((phase) => phase.end).filter(isLocalDate).sort();
  return ends.length ? addDays(ends[ends.length - 1], 1) : fallback;
}

/** An active phase's dose on a local date (its dose changes applied), "." decimal point. */
export function doseAt(phase: ActivePhase, date: LocalDate): string {
  let dose = phase.doseMg;
  let from = "";
  for (const change of phase.doseChanges ?? []) {
    if (change.from <= date && change.from > from) {
      dose = change.doseMg;
      from = change.from;
    }
  }
  return normalizeDecimal(dose) ?? dose;
}

/** A stored phase as the form shows it; an active phase shows its dose and time from `from` on. */
export function phaseForm(phase: Phase, from: LocalDate): CyclePhaseForm {
  const base = { ...newActivePhase(phase.start), id: phase.id, start: phase.start, end: phase.end };
  if (phase.kind === "break") return { ...base, kind: "break" };
  const on = from < phase.start ? phase.start : from > phase.end ? phase.end : from;
  return {
    ...base,
    mg: doseAt(phase, on),
    time: timeOn(phase, on),
    schedule: phase.schedule.type,
    every: phase.schedule.type === "interval" ? String(phase.schedule.everyDays) : "5",
    days: phase.schedule.type === "weekdays" ? [...phase.schedule.days] : [...DEFAULT_DAYS],
  };
}

/**
 * The current revision as the builder's form. Active phases show the dose in
 * force on the plan's effective date (`effective`, default today).
 */
export function formOfCycle(cycle: CycleRecord, effective: ReadonlyMap<string, LocalDate>, today: LocalDate): CycleForm {
  const revision = cycle.revisions[cycle.revisions.length - 1];
  return {
    cycleId: cycle.id,
    version: cycle.version,
    templateId: null,
    name: cycle.name,
    timeZone: revision.timeZone,
    goal: cycle.goal,
    baseline: cycle.baseline,
    plans: revision.plans.map((plan) => ({
      planId: plan.planId,
      peptideId: plan.peptideId,
      phases: plan.phases.map((phase) => phaseForm(phase, effective.get(plan.planId) ?? today)),
    })),
  };
}

/**
 * "Use as starting point": a template copied into a new cycle's form. Each
 * phase's relative days become dates from `start` (the prototype: tomorrow),
 * with S8's templatePlanToEngine. Nothing links back to the template's rows,
 * so later template edits never reach the cycle.
 */
export function formFromTemplate(
  template: { id: string; name: string; plans: TemplatePlan[] },
  start: LocalDate,
  timeZone: string,
): CycleForm {
  return {
    cycleId: null,
    version: null,
    templateId: template.id,
    name: template.name,
    timeZone,
    goal: "",
    baseline: "",
    plans: template.plans.map((plan) => ({
      planId: null,
      peptideId: plan.peptideId,
      phases: templatePlanToEngine(plan, { planId: "template", start, timeZone }).phases.map((phase) => ({
        ...phaseForm(phase, phase.start),
        id: null,
      })),
    })),
  };
}

// ── Validation ──────────────────────────────────────────────────────────────

/** A phase ready to store: an engine phase whose id is null until the database assigns one. */
export type DraftPhase =
  | (Omit<ActivePhase, "id"> & { id: string | null })
  | (Omit<BreakPhase, "id"> & { id: string | null });

export type DraftPlan = { planId: string | null; peptideId: string; phases: DraftPhase[] };

export type ValidCycle = Omit<CycleForm, "plans"> & { plans: DraftPlan[] };

export type CycleValidation = { ok: true; value: ValidCycle } | { ok: false; errors: string[] };

export const NAME_REQUIRED = "Give the cycle a name.";
export const GOAL_REQUIRED = "Add a goal — results are reviewed against it.";
export const PEPTIDE_REQUIRED = "Add at least one peptide.";
// Not in the prototype (it had a fixed list of zones and no limits).
export const TIME_ZONE_REQUIRED = "Choose the time zone this cycle follows.";
export const NAME_TOO_LONG = `Cycle names can be up to ${CYCLE_LIMITS.name} characters.`;
export const GOAL_TOO_LONG = `Goals can be up to ${CYCLE_LIMITS.goal} characters.`;
export const BASELINE_TOO_LONG = `Baselines can be up to ${CYCLE_LIMITS.baseline} characters.`;
export const TOO_MANY_PEPTIDES = `A cycle can have up to ${CYCLE_LIMITS.plans} peptides.`;
export const INVALID_CYCLE = "This cycle could not be saved. Reload the page and try again.";
export const unavailableMessage = (name: string) => `${name} is no longer offered for new cycles. Remove it before saving.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const wholeNumber = (value: string): number | null => (/^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : null);
const optionalId = (value: unknown): string | null | undefined =>
  value == null ? null : typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined;

/** "HH:MM" from a time input ("HH:MM" or "HH:MM:SS"). */
function timeOf(value: string): string {
  const trimmed = value.trim();
  return /^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed) ? trimmed.slice(0, 5) : trimmed;
}

function readPhase(raw: unknown): CyclePhaseForm | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = optionalId(r.id);
  if (id === undefined || (r.kind !== "active" && r.kind !== "break")) return null;
  const days = Array.isArray(r.days) ? r.days : [];
  if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
  return {
    id,
    kind: r.kind,
    start: str(r.start).trim(),
    end: str(r.end).trim(),
    mg: str(r.mg),
    time: str(r.time),
    schedule: r.schedule === "weekdays" ? "weekdays" : "interval",
    every: str(r.every),
    days: [...new Set(days as Weekday[])].sort((a, b) => a - b),
  };
}

/** The form as sent, or null when its structure is malformed. */
export function readCycleForm(input: unknown): CycleForm | null {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const cycleId = optionalId(raw.cycleId);
  const templateId = optionalId(raw.templateId);
  if (cycleId === undefined || templateId === undefined || !Array.isArray(raw.plans)) return null;
  if (cycleId !== null && templateId !== null) return null;
  const version = raw.version == null ? null : Number.isInteger(raw.version) && (raw.version as number) >= 1 ? (raw.version as number) : undefined;
  if (version === undefined || (cycleId === null) !== (version === null)) return null;
  const plans: CyclePlanForm[] = [];
  for (const plan of raw.plans as unknown[]) {
    const p = (typeof plan === "object" && plan !== null ? plan : {}) as Record<string, unknown>;
    const planId = optionalId(p.planId);
    if (planId === undefined || typeof p.peptideId !== "string" || !UUID.test(p.peptideId) || !Array.isArray(p.phases)) return null;
    if (p.phases.length > CYCLE_LIMITS.phases) return null;
    const phases = (p.phases as unknown[]).map(readPhase);
    if (phases.some((phase) => phase === null)) return null;
    plans.push({ planId, peptideId: p.peptideId.toLowerCase(), phases: phases as CyclePhaseForm[] });
  }
  // A peptide once per cycle; ids at most once.
  if (new Set(plans.map((plan) => plan.peptideId)).size !== plans.length) return null;
  const ids = plans.flatMap((plan) => [plan.planId, ...plan.phases.map((phase) => phase.id)]).filter((id) => id !== null);
  if (new Set(ids).size !== ids.length) return null;
  if (cycleId === null && ids.length > 0) return null;
  return {
    cycleId,
    version,
    templateId,
    name: str(raw.name).trim(),
    timeZone: str(raw.timeZone),
    goal: str(raw.goal).trim(),
    baseline: str(raw.baseline).trim(),
    plans,
  };
}

/** One form phase as the engine sees it (placeholder id `f<n>`, form order). */
function enginePhase(form: CyclePhaseForm, index: number): Phase {
  const dates = { id: `f${index + 1}`, start: form.start, end: form.end };
  if (form.kind === "break") return { ...dates, kind: "break" };
  const schedule: Schedule =
    form.schedule === "weekdays"
      ? { type: "weekdays", days: form.days }
      : { type: "interval", everyDays: wholeNumber(form.every) ?? Number.NaN };
  return { ...dates, kind: "active", doseMg: form.mg, time: timeOf(form.time), schedule };
}

/**
 * One peptide's messages, in the prototype's order: at least one active
 * phase, then per phase (sorted by start date, numbered from 1) its dates,
 * overlap with the previous phase, and for active phases dose, interval or
 * weekdays, and time. All come from the engine's validatePlan, which checks
 * in that order.
 */
function planMessages(name: string, issues: PlanIssue[], form: CyclePlanForm): string[] {
  const phase = (n: number) => `${name}: phase ${n}`;
  const sorted = [...form.phases].sort((a, b) => a.start.localeCompare(b.start));
  const messages: string[] = [];
  for (const issue of issues) {
    switch (issue.code) {
      case "no-active-phase":
        messages.push(`${name}: add at least one active phase.`);
        break;
      case "dates-missing":
        messages.push(`${phase(issue.phase)} needs start and end dates.`);
        break;
      case "ends-before-start":
        messages.push(`${phase(issue.phase)} ends before it starts.`);
        break;
      // Not in the prototype: the engine's date range and longest phase.
      case "dates-out-of-range":
        messages.push(`${phase(issue.phase)} must fall between 2000 and 2100.`);
        break;
      case "phase-too-long":
        messages.push(`${phase(issue.phase)} can last up to 3,660 days.`);
        break;
      case "overlap":
        messages.push(`${name}: phases ${issue.phases[0]} and ${issue.phases[1]} overlap.`);
        break;
      case "dose":
        messages.push(`${phase(issue.phase)} needs a dose in mg.`);
        break;
      case "interval": {
        const every = wholeNumber(sorted[issue.phase - 1]?.every ?? "");
        messages.push(
          every !== null && every > MAX_EVERY_DAYS
            ? `${phase(issue.phase)} needs an interval of ${MAX_EVERY_DAYS} days or fewer.`
            : `${phase(issue.phase)} needs an interval of at least 1 day.`,
        );
        break;
      }
      case "weekdays":
        messages.push(`${phase(issue.phase)} needs at least one weekday.`);
        break;
      case "time":
        messages.push(`${phase(issue.phase)} needs a time.`);
        break;
      default:
        // Ids, kinds and the plan's own fields are the form's structure (readCycleForm).
        break;
    }
  }
  return messages;
}

/**
 * Validates the builder as R3 does and returns every message in order:
 * name, time zone, goal, the limits, at least one peptide, peptides no longer
 * offered (only for plans the save would add, except those a new cycle copies
 * from its template: `templatePeptides`, the peptides that template names),
 * then each peptide's messages (planMessages). `peptides` holds the names the
 * caller may read.
 */
export function validateCycle(
  input: unknown,
  peptides: readonly CyclePeptide[],
  templatePeptides: ReadonlySet<string> = new Set(),
): CycleValidation {
  const form = readCycleForm(input);
  if (!form) return { ok: false, errors: [INVALID_CYCLE] };
  const errors: string[] = [];
  if (!form.name) errors.push(NAME_REQUIRED);
  if (form.name.length > CYCLE_LIMITS.name) errors.push(NAME_TOO_LONG);
  const zoneValid = isValidTimeZone(form.timeZone);
  if (!zoneValid) errors.push(TIME_ZONE_REQUIRED);
  if (!form.goal) errors.push(GOAL_REQUIRED);
  if (form.goal.length > CYCLE_LIMITS.goal) errors.push(GOAL_TOO_LONG);
  if (form.baseline.length > CYCLE_LIMITS.baseline) errors.push(BASELINE_TOO_LONG);
  if (form.plans.length === 0) errors.push(PEPTIDE_REQUIRED);
  if (form.plans.length > CYCLE_LIMITS.plans) errors.push(TOO_MANY_PEPTIDES);

  const library = new Map(peptides.map((peptide) => [peptide.id, peptide]));
  const nameOf = (id: string) => library.get(id)?.name ?? "Unknown peptide";
  const copied = (id: string) => form.cycleId === null && form.templateId !== null && templatePeptides.has(id);
  for (const plan of form.plans) {
    if (plan.planId === null && !library.get(plan.peptideId)?.available && !copied(plan.peptideId)) {
      errors.push(unavailableMessage(nameOf(plan.peptideId)));
    }
  }

  const plans: DraftPlan[] = form.plans.map((plan) => {
    const phases = plan.phases.map(enginePhase);
    const issues = validatePlan({ planId: "plan", timeZone: zoneValid ? form.timeZone : "UTC", phases });
    errors.push(...planMessages(nameOf(plan.peptideId), issues, plan));
    return {
      planId: plan.planId,
      peptideId: plan.peptideId,
      phases: phases
        .map((phase, index): DraftPhase => {
          const id = plan.phases[index].id;
          if (phase.kind === "break") return { ...phase, id };
          const dose = normalizeDecimal(phase.doseMg);
          return { ...phase, id, doseMg: dose === null ? phase.doseMg : plain(new Exact(dose)) };
        })
        .sort((a, b) => a.start.localeCompare(b.start)),
    };
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...form, plans } };
}

/** The same dose, compared exactly ("0.40" = "0,4"). */
export function sameDose(a: string, b: string): boolean {
  const x = normalizeDecimal(a);
  const y = normalizeDecimal(b);
  return x !== null && y !== null && new Exact(x).equals(new Exact(y));
}
