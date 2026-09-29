// A3 Cycle templates: the editor's form, its validation and the mapping of
// relative template days onto the S7 schedule engine (handoff
// docs/design/research-app/README.md "A3 Cycle templates"; the prototype's
// template save logic). Pure and shared by the editor, the server action,
// the tests and, later, S9's copy into a researcher's cycle.
//
// Templates store RELATIVE days: a phase's `offset` is 0-based from the
// researcher's start date ("Starts on day" 1 = offset 0) and `len` counts
// days. To validate, each peptide plan is laid onto a synthetic start date
// and checked with the engine's validatePlan, so a template accepted here is
// also a valid plan once S9 converts it to real dates.
import { Temporal } from "@js-temporal/polyfill";
import { Exact, normalizeDecimal, plain } from "@/lib/calculator/decimal";
import {
  MAX_EVERY_DAYS,
  type Phase,
  type PeptidePlan,
  type PlanIssue,
  type Schedule,
  validatePlan,
  type Weekday,
} from "@/lib/schedule/engine";
import type { LocalDate } from "@/lib/schedule/zone";

/** Mirrors the database checks on public.cycle_templates and its phases. */
export const TEMPLATE_LIMITS = { name: 120, guidance: 4000, lastDay: 3660 } as const;

// ── Stored shape ────────────────────────────────────────────────────────────

export type TemplatePhase =
  | { kind: "active"; offset: number; len: number; doseMg: string; time: string; schedule: Schedule }
  | { kind: "break"; offset: number; len: number };

export type TemplatePlan = { peptideId: string; phases: TemplatePhase[] };

/** One template as A3 lists and edits it. */
export type TemplateRecord = {
  id: string;
  name: string;
  guidance: string;
  updatedAt: string;
  /** The compare-and-set token: the version the editor opened (20260929110000). */
  version: number;
  /** In the editor's order; each plan's phases by start day. */
  plans: TemplatePlan[];
  /** Researcher cycles started from it (0 until cycles exist, S9). */
  cycleCount: number;
};

/** A library peptide as the editor needs it (admins see every entry). */
export type TemplatePeptide = { id: string; name: string; available: boolean };

// ── The editor's form ───────────────────────────────────────────────────────

/** A phase as typed. Break phases use `day` and `len` only. */
export type PhaseForm = {
  kind: "active" | "break";
  day: string;
  len: string;
  mg: string;
  time: string;
  schedule: "interval" | "weekdays";
  every: string;
  days: Weekday[];
};

export type PlanForm = { peptideId: string; phases: PhaseForm[] };

export type TemplateForm = { id: string | null; name: string; guidance: string; plans: PlanForm[] };

/** The prototype's default time and weekdays (Mon, Wed, Fri). */
const DEFAULT_TIME = "08:00";
const DEFAULT_DAYS: Weekday[] = [1, 3, 5];

/** A new active phase: 28 days, every 5 days, 08:00, dose blank (the editor's rows and a stored phase's form start from it). */
export const newActivePhase = (day: number): PhaseForm => ({
  kind: "active",
  day: String(day),
  len: "28",
  mg: "",
  time: DEFAULT_TIME,
  schedule: "interval",
  every: "5",
  days: [...DEFAULT_DAYS],
});

/** A new break: 7 days. */
export const newBreak = (day: number): PhaseForm => ({ ...newActivePhase(day), kind: "break", len: "7" });

const wholeNumber = (value: string): number | null => (/^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : null);

/** A stored template as the editor's form. */
export function formOf(template: Pick<TemplateRecord, "name" | "guidance" | "plans"> & { id: string | null }): TemplateForm {
  return {
    id: template.id,
    name: template.name,
    guidance: template.guidance,
    plans: template.plans.map((plan) => ({
      peptideId: plan.peptideId,
      phases: plan.phases.map((phase): PhaseForm => {
        const base = { day: String(phase.offset + 1), len: String(phase.len) };
        if (phase.kind === "break") return { ...newBreak(1), ...base };
        return {
          ...newActivePhase(1),
          ...base,
          mg: phase.doseMg,
          time: phase.time,
          schedule: phase.schedule.type,
          every: phase.schedule.type === "interval" ? String(phase.schedule.everyDays) : "5",
          days: phase.schedule.type === "weekdays" ? [...phase.schedule.days] : [...DEFAULT_DAYS],
        };
      }),
    })),
  };
}

// ── Mapping relative days onto the engine ───────────────────────────────────

/** Local date of relative day `offset` (0-based) from `start`. */
export function dayFrom(start: LocalDate, offset: number): LocalDate {
  return Temporal.PlainDate.from(start).add({ days: offset }).toString();
}

/**
 * A template plan as an engine plan starting on `start` in `timeZone`: each
 * phase runs from start + offset to start + offset + len - 1 (inclusive).
 * Phase ids are `p1`, `p2`, … in the plan's order. S9 uses this to copy a
 * template into a researcher's cycle; validation uses it with a synthetic start.
 */
export function templatePlanToEngine(
  plan: TemplatePlan,
  options: { planId: string; start: LocalDate; timeZone: string },
): PeptidePlan {
  return {
    planId: options.planId,
    timeZone: options.timeZone,
    phases: plan.phases.map((phase, index): Phase => {
      const dates = { id: `p${index + 1}`, start: dayFrom(options.start, phase.offset), end: dayFrom(options.start, phase.offset + phase.len - 1) };
      return phase.kind === "break"
        ? { ...dates, kind: "break" }
        : { ...dates, kind: "active", doseMg: phase.doseMg, time: phase.time, schedule: phase.schedule };
    }),
  };
}

/** The synthetic start date and zone template validation lays plans onto. */
const ANCHOR: LocalDate = "2001-01-01";
const ANCHOR_ZONE = "UTC";

// ── Validation ──────────────────────────────────────────────────────────────

export const NAME_REQUIRED = "Name is required.";
export const PEPTIDE_REQUIRED = "Add at least one peptide — an empty template can't be saved.";
/** A peptide no longer offered can stay in a template that has it, but can't be added (Marco, 2026-09-26). */
export const unavailableAdded = (name: string) => `${name} is no longer offered, so it can't be added. Remove it before saving.`;
export const NAME_TOO_LONG = `Names can be up to ${TEMPLATE_LIMITS.name} characters.`;
export const GUIDANCE_TOO_LONG = "Guidance can be up to 4,000 characters.";
/** Malformed input the editor never sends (a bad id, a repeated peptide). */
export const INVALID_TEMPLATE = "This template could not be saved. Reload the page and try again.";

const phaseMessages = {
  day: "start day must be 1 or later.",
  len: "length must be at least 1 day.",
  // Not in the prototype: the engine's longest phase (plan limits).
  lastDay: `must end by day ${TEMPLATE_LIMITS.lastDay}.`,
  dose: "enter a dose above 0 mg.",
  interval: "interval must be at least 1 day.",
  // Not in the prototype: the engine's longest interval.
  intervalMax: `interval must be ${MAX_EVERY_DAYS} days or fewer.`,
  weekdays: "pick at least one weekday.",
  // Not in the prototype (it saved a blank time as 08:00, as this does).
  time: "enter a local time.",
} as const;

/** A validated template, ready for the database. */
export type ValidTemplate = { id: string | null; name: string; guidance: string; plans: TemplatePlan[] };

export type TemplateValidation = { ok: true; value: ValidTemplate } | { ok: false; error: string; errors: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** "HH:MM" from a time input ("HH:MM" or "HH:MM:SS"); blank is the default 08:00. */
function timeOf(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return DEFAULT_TIME;
  return /^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed) ? trimmed.slice(0, 5) : trimmed;
}

function readPhase(raw: unknown): PhaseForm | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "active" && r.kind !== "break") return null;
  const days = Array.isArray(r.days) ? r.days : [];
  if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
  return {
    kind: r.kind,
    day: str(r.day),
    len: str(r.len),
    mg: str(r.mg),
    time: str(r.time),
    schedule: r.schedule === "weekdays" ? "weekdays" : "interval",
    every: str(r.every),
    days: [...new Set(days as Weekday[])].sort((a, b) => a - b),
  };
}

/** The form as sent, or null when its structure is malformed. */
function readForm(input: unknown): TemplateForm | null {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (raw.id != null && !(typeof raw.id === "string" && UUID.test(raw.id))) return null;
  if (!Array.isArray(raw.plans)) return null;
  const plans: PlanForm[] = [];
  for (const plan of raw.plans as unknown[]) {
    const p = (typeof plan === "object" && plan !== null ? plan : {}) as Record<string, unknown>;
    if (typeof p.peptideId !== "string" || !UUID.test(p.peptideId) || !Array.isArray(p.phases)) return null;
    const phases = (p.phases as unknown[]).map(readPhase);
    if (phases.some((phase) => phase === null)) return null;
    plans.push({ peptideId: p.peptideId.toLowerCase(), phases: phases as PhaseForm[] });
  }
  if (new Set(plans.map((plan) => plan.peptideId)).size !== plans.length) return null;
  return {
    id: typeof raw.id === "string" ? raw.id.toLowerCase() : null,
    name: text(raw.name),
    guidance: text(raw.guidance),
    plans,
  };
}

/** One phase as the engine sees it, with its relative days when they are readable. */
type Draft = { phase: Phase; offset: number | null; stored: TemplatePhase | null };

function draftPhase(form: PhaseForm, index: number): Draft {
  const day = wholeNumber(form.day);
  const len = wholeNumber(form.len);
  const offset = day !== null && day >= 1 ? day - 1 : null;
  const span = offset !== null && len !== null && len >= 1 && offset + len <= TEMPLATE_LIMITS.lastDay;
  const dates = {
    id: `p${index + 1}`,
    start: span ? dayFrom(ANCHOR, offset) : "",
    end: span ? dayFrom(ANCHOR, offset + len - 1) : "",
  };
  if (form.kind === "break") {
    return { phase: { ...dates, kind: "break" }, offset, stored: span ? { kind: "break", offset, len } : null };
  }
  const every = wholeNumber(form.every);
  const schedule: Schedule =
    form.schedule === "weekdays" ? { type: "weekdays", days: form.days } : { type: "interval", everyDays: every ?? Number.NaN };
  const dose = normalizeDecimal(form.mg);
  const time = timeOf(form.time);
  const phase: Phase = { ...dates, kind: "active", doseMg: form.mg, time, schedule };
  const stored: TemplatePhase | null =
    span && dose !== null ? { kind: "active", offset, len, doseMg: plain(new Exact(dose)), time, schedule } : null;
  return { phase, offset, stored };
}

/**
 * The messages for one peptide, in the design's order: per phase (the
 * editor's order) start day, length, dose, then interval or weekdays; then
 * overlapping phases (by start day); then a missing active phase. Dose,
 * interval, weekdays, time, overlap and the active-phase rule come from the
 * engine's validatePlan on the plan laid onto the synthetic start date.
 */
function planMessages(name: string, form: PlanForm, drafts: Draft[]): string[] {
  const enginePhases = drafts.map((draft) => draft.phase);
  const issues = validatePlan({ planId: "template", timeZone: ANCHOR_ZONE, phases: enginePhases });
  // The engine numbers phases 1-based after a stable sort by start date.
  const sorted = enginePhases.map((phase, index) => ({ phase, index })).sort((a, b) => a.phase.start.localeCompare(b.phase.start));
  const formIndex = (n: number) => sorted[n - 1].index;
  const byPhase = new Map<number, PlanIssue[]>();
  for (const issue of issues) {
    if ("phase" in issue) byPhase.set(formIndex(issue.phase), [...(byPhase.get(formIndex(issue.phase)) ?? []), issue]);
  }

  const messages: string[] = [];
  form.phases.forEach((phase, index) => {
    const say = (message: string) => messages.push(`${name}, phase ${index + 1}: ${message}`);
    const day = wholeNumber(phase.day);
    const len = wholeNumber(phase.len);
    if (!(day !== null && day >= 1)) say(phaseMessages.day);
    if (!(len !== null && len >= 1)) say(phaseMessages.len);
    if (day !== null && day >= 1 && len !== null && len >= 1 && day - 1 + len > TEMPLATE_LIMITS.lastDay) say(phaseMessages.lastDay);
    const codes = new Set((byPhase.get(index) ?? []).map((issue) => issue.code));
    if (codes.has("dose")) say(phaseMessages.dose);
    if (codes.has("interval")) {
      const every = wholeNumber(phase.every);
      say(every !== null && every > MAX_EVERY_DAYS ? phaseMessages.intervalMax : phaseMessages.interval);
    }
    if (codes.has("weekdays")) say(phaseMessages.weekdays);
    if (codes.has("time")) say(phaseMessages.time);
  });
  for (const issue of issues) {
    if (issue.code === "overlap") messages.push(`${name}: phases overlap at day ${(drafts[formIndex(issue.phases[1])].offset ?? 0) + 1}.`);
  }
  if (issues.some((issue) => issue.code === "no-active-phase")) messages.push(`${name}: add at least one active phase.`);
  return messages;
}

/**
 * The server action's check, from the submission alone: every rule of
 * validateTemplate except those on the library as it is now (the peptide
 * exists; it is offered, or the stored template already names it). The
 * database checks those (AP003 / AP007) after it has recognised a replay of
 * the same request key or a save over a newer version (AP038), so a retry
 * of a committed save, or a stale one, is answered as such. `names` only
 * words the messages ("Unknown peptide" otherwise).
 */
export function validateTemplateShape(input: unknown, names: ReadonlyMap<string, string>): TemplateValidation {
  const form = readForm(input);
  const peptides = (form?.plans ?? []).map((plan) => ({ id: plan.peptideId, name: names.get(plan.peptideId) ?? "Unknown peptide", available: true }));
  return validateTemplate(input, peptides);
}

/**
 * Validates a template as A3 does. First failure wins for: a malformed form,
 * name required, at least one peptide, no unavailable peptide added (one the
 * stored template already names, `kept`, may stay; then the name and
 * guidance limits). Then every phase and peptide message in order (see
 * planMessages); `error` is the first plus "(+N more)". `peptides` is the
 * whole library (an id not in it counts as unknown).
 */
export function validateTemplate(
  input: unknown,
  peptides: readonly TemplatePeptide[],
  kept: ReadonlySet<string> = new Set(),
): TemplateValidation {
  const fail = (error: string, errors = [error]): TemplateValidation => ({ ok: false, error, errors });
  const form = readForm(input);
  if (!form) return fail(INVALID_TEMPLATE);
  if (!form.name) return fail(NAME_REQUIRED);
  if (form.plans.length === 0) return fail(PEPTIDE_REQUIRED);
  const library = new Map(peptides.map((peptide) => [peptide.id, peptide]));
  if (form.plans.some((plan) => !library.has(plan.peptideId))) return fail(INVALID_TEMPLATE);
  const added = form.plans.find((plan) => !library.get(plan.peptideId)!.available && !kept.has(plan.peptideId));
  if (added) return fail(unavailableAdded(library.get(added.peptideId)!.name));
  if (form.name.length > TEMPLATE_LIMITS.name) return fail(NAME_TOO_LONG);
  if (form.guidance.length > TEMPLATE_LIMITS.guidance) return fail(GUIDANCE_TOO_LONG);

  const errors: string[] = [];
  const plans: TemplatePlan[] = form.plans.map((plan) => {
    const drafts = plan.phases.map(draftPhase);
    errors.push(...planMessages(library.get(plan.peptideId)!.name, plan, drafts));
    const phases = drafts.map((draft) => draft.stored).filter((phase): phase is TemplatePhase => phase !== null);
    return { peptideId: plan.peptideId, phases: phases.sort((a, b) => a.offset - b.offset) };
  });
  if (errors.length) return fail(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ""), errors);
  return { ok: true, value: { id: form.id, name: form.name, guidance: form.guidance, plans } };
}
