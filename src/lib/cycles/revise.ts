// Editing a cycle: turns the builder's edited plan into the next revision,
// changing future doses only (plan "Routine implementation rules": plan edits
// preserve prior versions and actual history and replace only affected
// future occurrences; handoff R3 "Editing a cycle that already has history
// changes future doses only"). Pure; the server action runs it and
// save_cycle() re-checks the result's structure in the database.
//
// Each plan gets an effective date E: the first of today, tomorrow or the day
// after (in the cycle's new time zone) from which everything the edit
// replaces, and everything it introduces, is still in the future and
// unconfirmed. "From E" means from the seam, the start of E in the new zone
// (schedule.ts): the plan's occurrences so far at or after the seam are
// replaced, and every occurrence the new revision gets there must be ahead.
// So E is today only while none of today's doses is due yet. Before E the
// plan is carried over exactly; from E on the edit applies:
//   * a phase that ended before E stays as it was (same id and content);
//   * a phase running across E keeps its id, kind and start. If the edit
//     keeps its kind and schedule, the phase continues (same id) with the
//     edited end; a changed dose becomes a dose change from E and a changed
//     time a time change from E, so an every-N-days rhythm continues from the
//     last dose and only the amount or clock time moves (Marco, 2026-09-26),
//     and its earlier occurrence keys stay the same. Otherwise (a schedule or
//     kind change) it ends on E - 1 and a new phase (new id) starts on E with
//     the edited settings;
//   * phases that start on or after E are replaced by the edited ones (a kept
//     phase keeps its id); new phases may not start before E.
// So every occurrence before E has the same key (planId:phaseId:index|date)
// and time in the new revision, and confirmations (S12) stay attached.
// A plan can be removed only while none of its doses is due or confirmed.
import { Temporal } from "@js-temporal/polyfill";
import {
  type Confirmation,
  type DoseChange,
  type Occurrence,
  type Phase,
  type Schedule,
  scheduleOccurrences,
  type TimeChange,
  timeOn,
} from "@/lib/schedule/engine";
import { type InstantInput, type LocalDate, localDateOf, toInstant } from "@/lib/schedule/zone";
import { addDays, type CycleRevision, doseAt, type DraftPhase, type DraftPlan, sameDose, type StoredPlan } from "./rules";
import { planOccurrences, seamOf } from "./schedule";

/** A plan of the next revision, with the date its changes start. */
export type RevisedPlan = { planId: string | null; peptideId: string; effectiveFrom: LocalDate; phases: DraftPhase[] };

/** Why an edit cannot apply. `phase` numbers the edited plan's phases by start date, from 1. */
export type EditIssue =
  | { code: "ended-changed"; peptideId: string; phase: number }
  | { code: "ended-removed"; peptideId: string }
  | { code: "started-start"; peptideId: string; phase: number }
  | { code: "started-end"; peptideId: string; phase: number; date: LocalDate }
  | { code: "too-early"; peptideId: string; phase: number; date: LocalDate }
  | { code: "plan-started"; peptideId: string }
  | { code: "no-future-date"; peptideId: string }
  | { code: "unknown" };

export type Revision = { ok: true; plans: RevisedPlan[] } | { ok: false; issues: EditIssue[] };

const sameSchedule = (a: Schedule, b: Schedule) =>
  a.type === "interval" && b.type === "interval"
    ? a.everyDays === b.everyDays
    : a.type === "weekdays" && b.type === "weekdays" && [...a.days].sort().join() === [...b.days].sort().join();

/** Same kind, and for active phases the same schedule: the phase can simply continue. */
function continues(stored: Phase, edited: DraftPhase): boolean {
  if (stored.kind !== edited.kind) return false;
  if (stored.kind === "break" || edited.kind === "break") return true;
  return sameSchedule(stored.schedule, edited.schedule);
}

/** The edited phase shows exactly what a phase that has ended looked like (the builder shows it read-only). */
function unchanged(stored: Phase, edited: DraftPhase): boolean {
  if (!continues(stored, edited) || stored.start !== edited.start || stored.end !== edited.end) return false;
  if (stored.kind === "break" || edited.kind === "break") return true;
  return sameDose(doseAt(stored, stored.end), edited.doseMg) && timeOn(stored, stored.end) === edited.time;
}

type Changes = { doseChanges: DoseChange[]; timeChanges: TimeChange[] };

const changesBefore = (phase: Phase, date: LocalDate): Changes => ({
  doseChanges: phase.kind === "active" ? (phase.doseChanges ?? []).filter((change) => change.from < date) : [],
  timeChanges: phase.kind === "active" ? (phase.timeChanges ?? []).filter((change) => change.from < date) : [],
});

/** A stored phase ending on `end` with `changes` (an empty list is left out, as stored). */
function endOn(phase: Phase, end: LocalDate, changes = changesBefore(phase, addDays(end, 1))): DraftPhase {
  if (phase.kind === "break") return { ...phase, end };
  const { doseChanges: _doses, timeChanges: _times, ...rest } = phase;
  void _doses;
  void _times;
  return {
    ...rest,
    end,
    ...(changes.doseChanges.length ? { doseChanges: changes.doseChanges } : {}),
    ...(changes.timeChanges.length ? { timeChanges: changes.timeChanges } : {}),
  };
}

type Composed = { phases: DraftPhase[] | null; issues: EditIssue[] };

/** One plan of the next revision with changes from `from` (see the header). */
function compose(stored: StoredPlan | null, edited: DraftPlan, from: LocalDate): Composed {
  const peptideId = edited.peptideId;
  const issues: EditIssue[] = [];
  const number = new Map(edited.phases.map((phase, index) => [phase, index + 1]));
  const byId = new Map(edited.phases.filter((phase) => phase.id !== null).map((phase) => [phase.id!, phase]));
  const storedIds = new Set(stored?.phases.map((phase) => phase.id));
  if ([...byId.keys()].some((id) => !storedIds.has(id))) return { phases: null, issues: [{ code: "unknown" }] };

  const phases: DraftPhase[] = [];
  const dayBefore = addDays(from, -1);
  for (const phase of stored?.phases ?? []) {
    const next = byId.get(phase.id);
    if (phase.start >= from) continue; // Not started: replaced by the edited phase below, if kept.
    if (phase.end < from) {
      // Ended: carried over exactly.
      if (!next) issues.push({ code: "ended-removed", peptideId });
      else if (!unchanged(phase, next)) issues.push({ code: "ended-changed", peptideId, phase: number.get(next)! });
      phases.push(phase);
      continue;
    }
    // Running across `from`.
    if (!next) {
      phases.push(endOn(phase, dayBefore));
      continue;
    }
    if (next.start !== phase.start) issues.push({ code: "started-start", peptideId, phase: number.get(next)! });
    if (next.end < dayBefore) issues.push({ code: "started-end", peptideId, phase: number.get(next)!, date: dayBefore });
    if (next.end < from) {
      phases.push(endOn(phase, dayBefore));
    } else if (continues(phase, next)) {
      // From `from` on, the edited dose and time apply: a change when each
      // differs from the day before (so a change already stored from `from`
      // is kept when the builder shows it unchanged).
      const changes = changesBefore(phase, from);
      if (phase.kind === "active" && next.kind === "active") {
        if (!sameDose(doseAt(phase, dayBefore), next.doseMg)) changes.doseChanges.push({ from, doseMg: next.doseMg });
        if (timeOn(phase, dayBefore) !== next.time) changes.timeChanges.push({ from, time: next.time });
      }
      phases.push(endOn(phase, next.end, changes));
    } else {
      phases.push(endOn(phase, dayBefore), { ...next, id: null, start: from });
    }
  }
  for (const phase of edited.phases) {
    const storedPhase = phase.id === null ? undefined : stored?.phases.find((p) => p.id === phase.id);
    if (storedPhase && storedPhase.start < from) continue; // Handled above.
    if (phase.start < from) issues.push({ code: "too-early", peptideId, phase: number.get(phase)!, date: from });
    phases.push(phase);
  }
  phases.sort((a, b) => a.start.localeCompare(b.start));
  return { phases, issues };
}

/** The engine plan of draft phases, with placeholder ids for new ones. */
function draftToEngine(planId: string | null, timeZone: string, phases: DraftPhase[]) {
  return {
    planId: planId ?? "new",
    timeZone,
    phases: phases.map((phase, index) => ({ ...phase, id: phase.id ?? `new${index}` }) as Phase),
  };
}

/** Due (its time has come) or confirmed: an occurrence an edit may no longer change. */
const settled = (o: Occurrence, now: Temporal.Instant) =>
  o.actualAt !== null || Temporal.Instant.compare(Temporal.Instant.from(o.scheduledAt), now) <= 0;

const atOrAfter = (o: Occurrence, seam: Temporal.Instant) => Temporal.Instant.compare(Temporal.Instant.from(o.scheduledAt), seam) >= 0;

/** The occurrences so far that a revision taking over at `seam` would replace are all still ahead. */
const replaceableFrom = (soFar: readonly Occurrence[], seam: Temporal.Instant, now: Temporal.Instant) =>
  soFar.every((o) => !atOrAfter(o, seam) || !settled(o, now));

/** The dates an edit could start from: today, tomorrow and the day after. */
const candidates = (today: LocalDate) => [0, 1, 2].map((day) => addDays(today, day));

/**
 * The next revision's plans from the cycle's revisions (oldest first; the
 * last is current) and the edited (and validated) plans, as of `now`.
 * `confirmations` are the cycle's recorded doses (S12); none exist before
 * S12. Plans left out of `edited.plans` are removed, which only a plan none
 * of whose doses is due or confirmed allows.
 *
 * Per plan, the effective date E is the first candidate (today, tomorrow or
 * the day after, in the new zone) whose seam (its start in the new zone)
 * hands over only doses that are ahead and unconfirmed: the plan's
 * occurrences so far at or after the seam (what the edit replaces) and every
 * occurrence the new revision gets (what it introduces; schedule.ts
 * takeOver). Issues are reported against the first candidate the plan so far
 * allows: the date the builder showed its locks for.
 */
export function reviseCycle(
  revisions: readonly CycleRevision[],
  edited: { timeZone: string; plans: DraftPlan[] },
  now: InstantInput,
  confirmations: readonly Confirmation[] = [],
): Revision {
  const at = toInstant(now);
  const current = revisions[revisions.length - 1];
  const history = planOccurrences(revisions, confirmations);
  const days = candidates(localDateOf(at, edited.timeZone));
  const storedById = new Map(current.plans.map((plan) => [plan.planId, plan]));
  const issues: EditIssue[] = [];
  const plans: RevisedPlan[] = [];

  const revise = (stored: StoredPlan | null, next: DraftPlan) => {
    const soFar = stored ? (history.get(stored.planId) ?? []) : [];
    for (const from of days) {
      const seam = seamOf(from, edited.timeZone);
      if (!replaceableFrom(soFar, seam, at)) continue;
      const composed = compose(stored, next, from);
      if (composed.issues.length) {
        issues.push(...composed.issues);
        return;
      }
      const kept = new Set(soFar.filter((o) => !atOrAfter(o, seam)).map((o) => o.key));
      const introduced = scheduleOccurrences(draftToEngine(next.planId, edited.timeZone, composed.phases!), confirmations);
      if (introduced.every((o) => kept.has(o.key) || !settled(o, at))) {
        plans.push({ planId: next.planId, peptideId: next.peptideId, effectiveFrom: from, phases: composed.phases! });
        return;
      }
    }
    issues.push({ code: "no-future-date", peptideId: next.peptideId });
  };

  for (const plan of edited.plans) {
    const stored = plan.planId === null ? null : storedById.get(plan.planId);
    if (stored === undefined || (stored && stored.peptideId !== plan.peptideId)) return { ok: false, issues: [{ code: "unknown" }] };
    revise(stored, plan);
  }
  const kept = new Set(edited.plans.map((plan) => plan.planId));
  for (const stored of current.plans) {
    if (kept.has(stored.planId)) continue;
    // Removed: only while none of its doses is due or confirmed.
    if ((history.get(stored.planId) ?? []).some((o) => settled(o, at))) issues.push({ code: "plan-started", peptideId: stored.peptideId });
  }
  return issues.length ? { ok: false, issues } : { ok: true, plans };
}

/** How the builder shows a stored phase while editing: ended (read-only), started (start fixed), or free. */
export type PhaseLock = "ended" | "started" | null;

/**
 * For the builder: each plan's earliest effective date as of `now`, judged
 * on the plan so far alone (the first of today, tomorrow or the day after
 * whose seam, in the current zone, replaces only doses that are ahead and
 * unconfirmed), each stored phase's lock, and the plans that have started
 * (a dose due or confirmed: they can't be removed). The save re-checks with
 * the edited plan (reviseCycle).
 */
export function editWindow(
  revisions: readonly CycleRevision[],
  now: InstantInput,
  confirmations: readonly Confirmation[] = [],
): { effective: Map<string, LocalDate>; locks: Map<string, PhaseLock>; started: Set<string> } {
  const at = toInstant(now);
  const current = revisions[revisions.length - 1];
  const history = planOccurrences(revisions, confirmations);
  const days = candidates(localDateOf(at, current.timeZone));
  const effective = new Map<string, LocalDate>();
  const locks = new Map<string, PhaseLock>();
  const started = new Set<string>();
  for (const plan of current.plans) {
    const soFar = history.get(plan.planId) ?? [];
    const from = days.find((day) => replaceableFrom(soFar, seamOf(day, current.timeZone), at)) ?? days[2];
    effective.set(plan.planId, from);
    if (soFar.some((o) => settled(o, at))) started.add(plan.planId);
    for (const phase of plan.phases) locks.set(phase.id, phase.end < from ? "ended" : phase.start < from ? "started" : null);
  }
  return { effective, locks, started };
}
