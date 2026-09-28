// V2 cycle builder (design v3 R4a–c and review): the builder's own model,
// its conversion to and from the stored form (rules.ts CycleForm, which the
// server action validates exactly as before), the mix saved with each
// peptide, and the builder's validation (UI_BREAKDOWN R4c: the first error
// plus "(+N more)"). Pure and client-safe; unit-tested
// (tests/unit/cycle-builder.test.ts).
//
// Phases are placed by cycle day: day 1 is the cycle's start date, and a
// phase runs from its start day for its length in days. The stored form has
// dates; the builder converts on the way in and out, so every existing rule
// (validateCycle, reviseCycle, save_cycle) applies unchanged.
//
// Marco's decisions (tasks/research-app.md) over the v3 mock: one dose time
// per day per phase (no "+ Time" for a second daily dose); a new cycle may
// start in the past; a started peptide can't be removed, only ended by
// shortening its phases.
import { inMassUnit, type MassUnit, massUnit, mgFromUnit } from "@/lib/alpha/format";
import { calculate, DEFAULT_LINE_SPACING, type LineSpacing, type SyringeCapacity } from "@/lib/calculator/calculator";
import { Exact, isPositiveDecimal, normalizeDecimal, parseDecimal, plain } from "@/lib/calculator/decimal";
import {
  LIQUID_TOO_LARGE,
  MIXTURE_LIMITS,
  type Mixture,
  type MixtureSetup,
  VIAL_TOO_LARGE,
} from "@/lib/mixtures/rules";
import { type Confirmation, MAX_EVERY_DAYS, type Phase, type Weekday } from "@/lib/schedule/engine";
import { isLocalDate, isLocalTime, type LocalDate, localDateOf } from "@/lib/schedule/zone";
import { daysBetween, plusDays } from "./geometry";
import { editWindow, type PhaseLock } from "./revise";
import { cycleSpan } from "./schedule";
import { CYCLE_LIMITS, type CycleForm, type CycleRecord, type CyclePhaseForm, DEFAULT_TIME, formOfCycle, GOAL_REQUIRED, GOAL_TOO_LONG, NAME_REQUIRED, NAME_TOO_LONG, BASELINE_TOO_LONG, TIME_ZONE_REQUIRED } from "./rules";

export type Frequency = "daily" | "weekdays" | "every";

export type BuilderPhase = {
  /** A key for the screen: the stored id, or a new one. */
  key: string;
  /** The stored phase id; null for a phase added here. */
  id: string | null;
  kind: "active" | "break";
  /** Start day (1 = the cycle's start) and length in days, as typed. */
  day: string;
  length: string;
  /** The dose as typed, in the plan's unit. */
  dose: string;
  /** "HH:MM" */
  time: string;
  frequency: Frequency;
  /** Every N days, as typed. */
  every: string;
  days: Weekday[];
  /** While editing: ended phases are read-only; started ones keep their start. */
  lock: PhaseLock;
};

export type BuilderMix = {
  /** The saved mixture this peptide uses (or will): null makes a new one. */
  mixtureId: string | null;
  version: number | null;
  vialMg: string;
  liquidMl: string;
  syringe: SyringeCapacity;
  lineSpacing: LineSpacing;
  /** The setup it started from (the plan's, or the saved mixture it reuses); null when fresh. */
  base: MixtureSetup | null;
  /** The plan used this mixture when the builder opened (an edit). */
  linked: boolean;
};

/** A plan's mixture when the builder opened (an edit), as shown: what a save keeps or removes. */
export type MixLink = { mixtureId: string; version: number };

export type BuilderPlan = {
  planId: string | null;
  peptideId: string;
  unit: MassUnit;
  /** R4b's "Dose per injection", in `unit`: the dose new phases take and the syringe reading. */
  dose: string;
  phases: BuilderPhase[];
  mix: BuilderMix;
  /** While editing: a dose is due, taken or skipped, so it can't be removed. */
  started: boolean;
};

export type BuilderState = {
  cycleId: string | null;
  version: number | null;
  templateId: string | null;
  name: string;
  goal: string;
  baseline: string;
  timeZone: string;
  /** Day 1. */
  start: LocalDate;
  plans: BuilderPlan[];
  /**
   * By stored plan id: each plan's mixture when the builder opened (an
   * edit). Fixed while editing, so clearing a mix still knows which link the
   * save ends (mixEntry, through planLink). A plan the save creates has none.
   */
  links: Readonly<Record<string, MixLink>>;
  /**
   * By peptide id: the plans taken out in this session (togglePlan). Adding
   * the peptide back restores its plan as it was (its stored id, phases and
   * mix), so the save edits that plan instead of creating another.
   */
  removed: Readonly<Record<string, BuilderPlan>>;
};

/** New phases: 28 days (a break 7), daily at 08:00. */
export const NEW_PHASE_DAYS = 28;
export const NEW_BREAK_DAYS = 7;

// Random, so keys made on the server (a template copy) and in the browser never meet.
const newKey = () => `new-${Math.random().toString(36).slice(2, 10)}`;

const whole = (text: string): number | null => (/^\s*\d{1,5}\s*$/.test(text) ? Number(text.trim()) : null);

/** The syringe the builder starts a fresh mix on. */
export const DEFAULT_SYRINGE: SyringeCapacity = 100;

export function blankMix(): BuilderMix {
  return { mixtureId: null, version: null, vialMg: "", liquidMl: "", syringe: DEFAULT_SYRINGE, lineSpacing: DEFAULT_LINE_SPACING[DEFAULT_SYRINGE], base: null, linked: false };
}

/** A saved mixture as the starting mix: the plan's own (`linked`), or one to reuse. */
export function mixFrom(mixture: Mixture, linked: boolean): BuilderMix {
  return { mixtureId: mixture.id, version: mixture.version, ...mixture.setup, base: mixture.setup, linked };
}

/** A new syringe size keeps a custom spacing it had; otherwise the size's printed lines. */
export function withSyringe(mix: BuilderMix, syringe: SyringeCapacity): BuilderMix {
  const lineSpacing = mix.base && mix.base.syringe === syringe ? mix.base.lineSpacing : DEFAULT_LINE_SPACING[syringe];
  return { ...mix, syringe, lineSpacing };
}

const schedulePart = (phase: CyclePhaseForm): Pick<BuilderPhase, "frequency" | "every" | "days"> => {
  if (phase.schedule === "weekdays") return { frequency: "weekdays", every: "2", days: [...phase.days] };
  const every = whole(phase.every);
  return every === 1 ? { frequency: "daily", every: "2", days: [1, 3, 5] } : { frequency: "every", every: phase.every, days: [1, 3, 5] };
};

/**
 * The stored form as the builder's model, day 1 on `start`. `locks` and
 * `started` come from editWindow; `mixes` by peptide id (the plan's mixture,
 * or a saved one to reuse).
 */
export function builderFromForm(
  form: CycleForm,
  start: LocalDate,
  options: { locks?: Readonly<Record<string, PhaseLock>>; started?: readonly string[]; mixes?: ReadonlyMap<string, BuilderMix> } = {},
): BuilderState {
  const links: Record<string, MixLink> = {};
  for (const plan of form.plans) {
    const mix = options.mixes?.get(plan.peptideId);
    if (plan.planId && mix?.linked && mix.mixtureId && mix.version !== null) links[plan.planId] = { mixtureId: mix.mixtureId, version: mix.version };
  }
  return {
    links,
    removed: {},
    cycleId: form.cycleId,
    version: form.version,
    templateId: form.templateId,
    name: form.name,
    goal: form.goal,
    baseline: form.baseline,
    timeZone: form.timeZone,
    start,
    plans: form.plans.map((plan) => {
      const sorted = [...plan.phases].sort((a, b) => a.start.localeCompare(b.start));
      const firstDose = sorted.find((phase) => phase.kind === "active" && isPositiveDecimal(phase.mg))?.mg ?? "";
      const unit: MassUnit = firstDose ? massUnit(firstDose) : "mg";
      // The reference dose: the phase in force from the edit on (the first not ended), else the first.
      const reference =
        sorted.find((phase) => phase.kind === "active" && (!phase.id || options.locks?.[phase.id] !== "ended"))?.mg ?? firstDose;
      return {
        planId: plan.planId,
        peptideId: plan.peptideId,
        unit,
        dose: reference ? inMassUnit(reference, unit) : "",
        started: plan.planId !== null && (options.started ?? []).includes(plan.planId),
        mix: options.mixes?.get(plan.peptideId) ?? blankMix(),
        phases: sorted.map((phase) => ({
          key: phase.id ?? newKey(),
          id: phase.id,
          kind: phase.kind,
          day: isLocalDate(phase.start) ? String(daysBetween(start, phase.start) + 1) : "",
          length: isLocalDate(phase.start) && isLocalDate(phase.end) ? String(daysBetween(phase.start, phase.end) + 1) : "",
          dose: phase.kind === "active" && phase.mg ? inMassUnit(phase.mg, unit) : "",
          time: phase.time || DEFAULT_TIME,
          ...schedulePart(phase),
          lock: phase.id ? (options.locks?.[phase.id] ?? null) : null,
        })),
      };
    }),
  };
}

/**
 * "Edit future plan" as its page opens the builder, as of `now`: the
 * owner's cycle with its recorded doses and skips (editWindow: each plan's
 * effective date, ended and started phases) and the owner's saved mixtures
 * (newest first): each plan starts from the mixture it uses now, and a
 * peptide added reuses its newest saved one.
 */
export function builderForEdit(cycle: CycleRecord, confirmations: readonly Confirmation[], mixtures: readonly Mixture[], now: Date) {
  const current = cycle.revisions[cycle.revisions.length - 1];
  const { effective, locks, started } = editWindow(cycle.revisions, now, confirmations);
  const form = formOfCycle(cycle, effective, localDateOf(now, current.timeZone));
  const savedMixes: Record<string, BuilderMix> = {};
  for (const mixture of mixtures) savedMixes[mixture.peptideId] ??= mixFrom(mixture, false);
  const planMixes = new Map<string, BuilderMix>();
  for (const plan of current.plans) {
    const mixture = mixtures.find((m) => m.planIds.includes(plan.planId));
    if (mixture) planMixes.set(plan.peptideId, mixFrom(mixture, true));
  }
  return {
    initial: builderFromForm(form, cycleSpan(current).start, { locks: Object.fromEntries(locks), started: [...started], mixes: planMixes }),
    savedMixes,
    effective: Object.fromEntries(effective) as Record<string, LocalDate>,
    startLocked: [...locks.values()].some((lock) => lock !== null),
  };
}

/** The builder's model as the stored form (rules.ts), for the server action. */
export function formFromBuilder(state: BuilderState): CycleForm {
  return {
    cycleId: state.cycleId,
    version: state.version,
    templateId: state.templateId,
    name: state.name,
    timeZone: state.timeZone,
    goal: state.goal,
    baseline: state.baseline,
    plans: state.plans.map((plan) => ({
      planId: plan.planId,
      peptideId: plan.peptideId,
      phases: plan.phases.map((phase): CyclePhaseForm => {
        const day = whole(phase.day);
        const length = whole(phase.length);
        const start = day !== null && isLocalDate(state.start) ? plusDays(state.start, day - 1) : "";
        const end = start && length !== null ? plusDays(start, length - 1) : "";
        return {
          id: phase.id,
          kind: phase.kind,
          start,
          end,
          mg: phase.kind === "active" ? mgFromUnit(phase.dose, plan.unit) : "",
          time: phase.time,
          schedule: phase.frequency === "weekdays" ? "weekdays" : "interval",
          every: phase.frequency === "daily" ? "1" : phase.every,
          days: [...phase.days],
        };
      }),
    })),
  };
}

// ── Editing the model ───────────────────────────────────────────────────────

/** The day after the plan's last phase ends (day 1 for none). */
export function nextFreeDay(plan: Pick<BuilderPlan, "phases">): number {
  let next = 1;
  for (const phase of plan.phases) {
    const [day, length] = [whole(phase.day), whole(phase.length)];
    if (day !== null && length !== null) next = Math.max(next, day + length);
  }
  return next;
}

export function newPhase(plan: Pick<BuilderPlan, "phases" | "dose">, kind: "active" | "break"): BuilderPhase {
  const previous = [...plan.phases].reverse().find((phase) => phase.kind === "active");
  return {
    key: newKey(),
    id: null,
    kind,
    day: String(nextFreeDay(plan)),
    length: String(kind === "active" ? NEW_PHASE_DAYS : NEW_BREAK_DAYS),
    dose: kind === "active" ? plan.dose : "",
    time: previous?.time ?? DEFAULT_TIME,
    frequency: previous?.frequency ?? "daily",
    every: previous?.every ?? "2",
    days: previous ? [...previous.days] : [1, 3, 5],
    lock: null,
  };
}

/** A peptide added in the builder: one active phase from day 1, and the saved mix to reuse, if any. */
export function newBuilderPlan(peptideId: string, mix: BuilderMix = blankMix()): BuilderPlan {
  const plan: BuilderPlan = { planId: null, peptideId, unit: "mg", dose: "", phases: [], mix, started: false };
  plan.phases = [newPhase(plan, "active")];
  return plan;
}

/**
 * R4a's peptide checkbox. Unchecking takes the plan out (not a started one:
 * it can only be ended by shortening its phases) and keeps it in
 * `removed`; checking it again restores that plan as it was (its stored id,
 * phases and mix), so an edit keeps the same plan and its mixture link.
 * A peptide never in the builder gets `fresh()`.
 */
export function togglePlan(state: BuilderState, peptideId: string, fresh: () => BuilderPlan): BuilderState {
  const index = state.plans.findIndex((p) => p.peptideId === peptideId);
  if (index >= 0) {
    const plan = state.plans[index];
    if (plan.started) return state;
    return { ...state, plans: state.plans.filter((_, i) => i !== index), removed: { ...state.removed, [peptideId]: plan } };
  }
  const { [peptideId]: back, ...rest } = state.removed;
  return { ...state, plans: [...state.plans, back ?? fresh()], removed: rest };
}

/** The plan's mixture when the builder opened (by its stored id): none for a plan the save creates. */
export function planLink(state: Pick<BuilderState, "links">, plan: Pick<BuilderPlan, "planId">): MixLink | null {
  return plan.planId ? (state.links[plan.planId] ?? null) : null;
}

/**
 * "End it now" on a phase under way (an edit): its length so that it ends
 * the day before `effective`, the first date the plan's changes apply from.
 * The phase stays, with its doses so far (history), and nothing is planned
 * after that day; the edit's revision ends it there (reviseCycle). Null when
 * it can't end there (no effective date, or it doesn't start before it).
 */
export function endBefore(phase: Pick<BuilderPhase, "day">, start: LocalDate, effective: LocalDate | null): { length: string } | null {
  const day = whole(phase.day);
  if (!effective || !isLocalDate(effective) || !isLocalDate(start) || day === null || day < 1) return null;
  const length = daysBetween(plusDays(start, day - 1), effective);
  return length >= 1 ? { length: String(length) } : null;
}

/** The phase ends the day before `effective` (as "End it now" leaves it). */
export function endsBefore(phase: Pick<BuilderPhase, "day" | "length">, start: LocalDate, effective: LocalDate | null): boolean {
  const ending = endBefore(phase, start, effective);
  return ending !== null && whole(phase.length) === Number(ending.length);
}

const sameAmount = (a: string, b: string) => {
  const [x, y] = [normalizeDecimal(a), normalizeDecimal(b)];
  return x !== null && y !== null && new Exact(x).equals(new Exact(y));
};

/**
 * R4b's dose changed: phases that still had the previous dose (or none) take
 * the new one; phases already given their own dose, and ended ones, keep it.
 */
export function withDose(plan: BuilderPlan, dose: string): BuilderPlan {
  return {
    ...plan,
    dose,
    phases: plan.phases.map((phase) =>
      phase.kind === "active" && phase.lock !== "ended" && (phase.dose.trim() === "" || sameAmount(phase.dose, plan.dose)) ? { ...phase, dose } : phase,
    ),
  };
}

/** mcg ↔ mg: every amount is shown again in the new unit, the same mass. */
export function withUnit(plan: BuilderPlan, unit: MassUnit): BuilderPlan {
  if (unit === plan.unit) return plan;
  const convert = (text: string) => (parseDecimal(text) ? inMassUnit(mgFromUnit(text, plan.unit), unit) : text);
  return { ...plan, unit, dose: convert(plan.dose), phases: plan.phases.map((phase) => ({ ...phase, dose: convert(phase.dose) })) };
}

/**
 * The plan's phases as the lane preview draws them (R4c): those with a
 * whole start day and length, dated from `start`; an unfinished dose draws
 * as the smallest.
 */
export function previewPhases(plan: Pick<BuilderPlan, "phases" | "unit">, start: LocalDate): Phase[] {
  if (!isLocalDate(start)) return [];
  return plan.phases.flatMap((phase): Phase[] => {
    const [day, length] = [whole(phase.day), whole(phase.length)];
    if (day === null || length === null || day < 1 || length < 1) return [];
    const dates = { id: phase.key, start: plusDays(start, day - 1), end: plusDays(start, day + length - 2) };
    if (phase.kind === "break") return [{ ...dates, kind: "break" }];
    const mg = mgFromUnit(phase.dose, plan.unit);
    return [{ ...dates, kind: "active", doseMg: isPositiveDecimal(mg) ? mg : "0", time: phase.time, schedule: { type: "interval", everyDays: 1 } }];
  });
}

/** The last cycle day any phase reaches (0 for none). */
export function cycleDays(state: Pick<BuilderState, "plans">): number {
  return Math.max(0, ...state.plans.map((plan) => nextFreeDay(plan) - 1));
}

// ── The mix saved with each peptide ─────────────────────────────────────────

/** The mix's reading for a dose (mg): the calculator's result, or null while incomplete. */
export function mixReading(mix: Pick<BuilderMix, "vialMg" | "liquidMl" | "syringe" | "lineSpacing">, doseMg: string) {
  if (!mix.vialMg.trim() || !mix.liquidMl.trim() || !isPositiveDecimal(doseMg)) return null;
  const result = calculate({ vialMg: mix.vialMg, liquidMl: mix.liquidMl, doseMg, syringe: mix.syringe, lineSpacing: mix.lineSpacing });
  return result.ok ? result : null;
}

/**
 * The other syringe sizes that read a dose exactly on a line and hold it
 * ("The 30-unit syringe reads it exactly."), smallest first.
 */
export function exactSyringes(mix: Pick<BuilderMix, "vialMg" | "liquidMl" | "syringe">, doseMg: string): SyringeCapacity[] {
  return ([30, 50, 100] as const).filter((size) => {
    if (size === mix.syringe) return false;
    const result = mixReading({ ...mix, syringe: size, lineSpacing: DEFAULT_LINE_SPACING[size] }, doseMg);
    return result !== null && result.onLine === true && !result.overCapacity;
  });
}

/**
 * What the save sends for a peptide's mix (save_cycle_with_mixtures): `set`
 * a new or changed mix, or another saved one; `keep` the plan's mixture as it
 * is; `remove` it when the mix was cleared. The same shape as CycleMix.
 */
export type MixEntry =
  | { kind: "set"; peptideId: string; mixtureId: string | null; version: number | null; setup: MixtureSetup }
  | { kind: "keep" | "remove"; peptideId: string; mixtureId: string; version: number };

const canonical = (text: string) => normalizeDecimal(text);

/**
 * A peptide's entry, from its mix and the plan's mixture when the builder
 * opened (`link`, planLink): blank with a link is `remove`, blank without
 * one is nothing to send; the linked mixture's setup unchanged is `keep`;
 * anything else is `set`. mixIssues keeps half-filled mixes from saving.
 */
export function mixEntry(plan: Pick<BuilderPlan, "peptideId" | "mix">, link: MixLink | null = null): MixEntry | null {
  const { mix } = plan;
  const [vial, liquid] = [canonical(mix.vialMg), canonical(mix.liquidMl)];
  if (!vial || !liquid) return link ? { kind: "remove", peptideId: plan.peptideId, ...link } : null;
  const setup: MixtureSetup = {
    vialMg: plain(new Exact(vial)),
    liquidMl: plain(new Exact(liquid)),
    syringe: mix.syringe,
    lineSpacing: mix.lineSpacing,
  };
  const same =
    mix.base !== null &&
    sameAmount(mix.base.vialMg, setup.vialMg) &&
    sameAmount(mix.base.liquidMl, setup.liquidMl) &&
    mix.base.syringe === setup.syringe &&
    mix.base.lineSpacing === setup.lineSpacing;
  if (same && link && mix.mixtureId === link.mixtureId && mix.version === link.version) return { kind: "keep", peptideId: plan.peptideId, ...link };
  return { kind: "set", peptideId: plan.peptideId, mixtureId: mix.mixtureId, version: mix.version, setup };
}

// ── Validation (R4c: the first error, plus "(+N more)") ─────────────────────

export const VIAL_MISSING = "enter the vial strength in mg, or leave the mix empty.";
export const WATER_MISSING = "enter the BAC water in mL, or leave the mix empty.";

/** Each phase's name on the screen: active phases "Phase 1", "Phase 2"…; breaks "Break" (numbered when there are several). */
export function phaseNames(phases: readonly Pick<BuilderPhase, "kind">[]): string[] {
  const breaks = phases.filter((phase) => phase.kind === "break").length;
  let active = 0;
  let pause = 0;
  return phases.map((phase) => {
    if (phase.kind === "active") return `Phase ${(active += 1)}`;
    pause += 1;
    return breaks > 1 ? `Break ${pause}` : "Break";
  });
}

/** R4b: the mix is optional, but a half-filled or impossible one is not saved. */
export function mixIssues(plan: BuilderPlan, name: string): string[] {
  const { vialMg, liquidMl } = plan.mix;
  if (!vialMg.trim() && !liquidMl.trim()) return [];
  const issues: string[] = [];
  const vial = parseDecimal(vialMg);
  const liquid = parseDecimal(liquidMl);
  if (!vial || !vial.greaterThan(0)) issues.push(`${name}: ${VIAL_MISSING}`);
  else if (vial.greaterThan(MIXTURE_LIMITS.vialMg)) issues.push(`${name}: ${lower(VIAL_TOO_LARGE)}`);
  if (!liquid || !liquid.greaterThan(0)) issues.push(`${name}: ${WATER_MISSING}`);
  else if (liquid.greaterThan(MIXTURE_LIMITS.liquidMl)) issues.push(`${name}: ${lower(LIQUID_TOO_LARGE)}`);
  return issues;
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * R4c's checks for one peptide, in order: per phase (as listed) its start
 * day, length, dose, frequency and time; then overlaps; then at least one
 * active phase.
 */
export function scheduleIssues(plan: BuilderPlan, name: string): string[] {
  const names = phaseNames(plan.phases);
  const issues: string[] = [];
  plan.phases.forEach((phase, i) => {
    if (phase.lock === "ended") return;
    const label = `${name} · ${names[i]}`;
    const day = whole(phase.day);
    if (day === null || day < 1) issues.push(`${label}: start on day 1 or later.`);
    const length = whole(phase.length);
    if (length === null || length < 1) issues.push(`${label}: needs a length of at least 1 day.`);
    if (phase.kind === "break") return;
    if (!isPositiveDecimal(mgFromUnit(phase.dose, plan.unit))) issues.push(`${label}: needs a dose above 0.`);
    if (phase.frequency === "every") {
      const every = whole(phase.every);
      if (every === null || every < 1) issues.push(`${label}: repeat every 1 day or more.`);
      else if (every > MAX_EVERY_DAYS) issues.push(`${label}: repeat every ${MAX_EVERY_DAYS} days or fewer.`);
    }
    if (phase.frequency === "weekdays" && phase.days.length === 0) issues.push(`${label}: choose at least one weekday.`);
    if (!isLocalTime(phase.time)) issues.push(`${label}: choose a time.`);
  });
  const spans = plan.phases
    .map((phase, i) => ({ i, day: whole(phase.day), length: whole(phase.length) }))
    .filter((s): s is { i: number; day: number; length: number } => s.day !== null && s.length !== null && s.day >= 1 && s.length >= 1);
  for (let a = 0; a < spans.length; a++) {
    for (let b = a + 1; b < spans.length; b++) {
      const [x, y] = [spans[a], spans[b]];
      if (x.day <= y.day + y.length - 1 && y.day <= x.day + x.length - 1) issues.push(`${name}: ${names[x.i]} and ${lower(names[y.i])} overlap.`);
    }
  }
  if (!plan.phases.some((phase) => phase.kind === "active")) issues.push(`${name}: add at least one active phase.`);
  return issues;
}

/** The review's checks: name, time zone, goal and the lengths, then every peptide's mix and schedule. */
export function reviewIssues(state: BuilderState, nameOf: (peptideId: string) => string, zoneValid: boolean): string[] {
  const issues: string[] = [];
  const name = state.name.trim();
  if (!name) issues.push(NAME_REQUIRED);
  if (name.length > CYCLE_LIMITS.name) issues.push(NAME_TOO_LONG);
  if (!zoneValid) issues.push(TIME_ZONE_REQUIRED);
  if (!state.goal.trim()) issues.push(GOAL_REQUIRED);
  if (state.goal.trim().length > CYCLE_LIMITS.goal) issues.push(GOAL_TOO_LONG);
  if (state.baseline.trim().length > CYCLE_LIMITS.baseline) issues.push(BASELINE_TOO_LONG);
  if (!isLocalDate(state.start)) issues.push("Choose the date the cycle starts.");
  for (const plan of state.plans) issues.push(...mixIssues(plan, nameOf(plan.peptideId)), ...scheduleIssues(plan, nameOf(plan.peptideId)));
  return issues;
}

/** "BPC-157 · Phase 2: needs a dose above 0." and "(+2 more)". */
export function firstIssue(issues: readonly string[]): { first: string; more: string } | null {
  if (!issues.length) return null;
  return { first: issues[0], more: issues.length > 1 ? `(+${issues.length - 1} more)` : "" };
}
