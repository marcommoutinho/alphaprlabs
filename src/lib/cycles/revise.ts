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
// unconfirmed. Before E the plan is carried over exactly; from E on the edit
// applies:
//   * a phase that ended before E stays as it was (same id and content);
//   * a phase running across E keeps its id, kind and start. If the edit
//     keeps its kind, time and schedule, the phase continues (same id) with
//     the edited end, and a changed dose becomes a dose change from E: an
//     every-N-days rhythm continues from the last dose (Marco, 2026-09-26),
//     and its earlier occurrence keys stay the same. Otherwise it ends on
//     E - 1 and a new phase (new id) starts on E with the edited settings;
//   * phases that start on or after E are replaced by the edited ones (a kept
//     phase keeps its id); new phases may not start before E.
// So every occurrence before E has the same key (planId:phaseId:index|date)
// and time in the new revision, and confirmations (S12) stay attached.
import { Temporal } from "@js-temporal/polyfill";
import {
  type ActivePhase,
  type Confirmation,
  type DoseChange,
  type Phase,
  type Schedule,
  scheduleOccurrences,
} from "@/lib/schedule/engine";
import { type InstantInput, type LocalDate, localDateOf, toInstant } from "@/lib/schedule/zone";
import { addDays, type CycleRevision, doseAt, type DraftPhase, type DraftPlan, sameDose, type StoredPlan } from "./rules";

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

/** Same kind, and for active phases the same local time and schedule: the phase can simply continue. */
function continues(stored: Phase, edited: DraftPhase): boolean {
  if (stored.kind !== edited.kind) return false;
  if (stored.kind === "break" || edited.kind === "break") return true;
  return stored.time === edited.time && sameSchedule(stored.schedule, edited.schedule);
}

/** The edited phase shows exactly what a phase that has ended looked like (the builder shows it read-only). */
function unchanged(stored: Phase, edited: DraftPhase): boolean {
  if (!continues(stored, edited) || stored.start !== edited.start || stored.end !== edited.end) return false;
  return stored.kind === "break" || edited.kind === "break" || sameDose(doseAt(stored, stored.end), edited.doseMg);
}

const changesBefore = (phase: Phase, date: LocalDate): DoseChange[] =>
  phase.kind === "active" ? (phase.doseChanges ?? []).filter((change) => change.from < date) : [];

/** A stored phase ending on `end` with `changes` (none: no doseChanges at all, as stored). */
function endOn(phase: Phase, end: LocalDate, changes = changesBefore(phase, addDays(end, 1))): DraftPhase {
  if (phase.kind === "break") return { ...phase, end };
  const { doseChanges: _stored, ...rest } = phase;
  void _stored;
  return changes.length ? { ...rest, end, doseChanges: changes } : { ...rest, end };
}

type Composed = { phases: DraftPhase[] | null; issues: EditIssue[] };

/** One plan of the next revision with changes from `from` (see the header); phases null when it is removed. */
function compose(stored: StoredPlan | null, edited: DraftPlan | null, from: LocalDate): Composed {
  const peptideId = (edited ?? stored)!.peptideId;
  const issues: EditIssue[] = [];
  if (!edited) {
    const started = stored!.phases.some((phase) => phase.start < from);
    return { phases: null, issues: started ? [{ code: "plan-started", peptideId }] : [] };
  }
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
      // From `from` on, the edited dose applies: a dose change when it differs
      // from the dose the day before (so a change already stored from `from`
      // is kept when the builder shows it unchanged).
      const changed = next.kind === "active" && !sameDose(doseAt(phase as ActivePhase, dayBefore), next.doseMg);
      const changes = [...changesBefore(phase, from), ...(changed && next.kind === "active" ? [{ from, doseMg: next.doseMg }] : [])];
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

type Dated = { localDate: string; scheduledAt: string; actualAt: string | null };

/** Every occurrence dated `from` or later is still ahead of `now` and unconfirmed. */
const aheadFrom = (occurrences: readonly Dated[], from: LocalDate, now: Temporal.Instant) =>
  occurrences.every(
    (o) => o.localDate < from || (o.actualAt === null && Temporal.Instant.compare(Temporal.Instant.from(o.scheduledAt), now) > 0),
  );

/** The dates an edit could start from: today, tomorrow and the day after. */
const candidates = (today: LocalDate) => [0, 1, 2].map((day) => addDays(today, day));

/**
 * The next revision's plans from the current revision and the edited (and
 * validated) plans, as of `now`. `confirmations` are the cycle's recorded
 * doses (S12); none exist before S12. Plans left out of `edited.plans` are
 * removed, which only a plan that has not started allows.
 *
 * Per plan, the effective date is the first candidate (today, tomorrow or
 * the day after, in the new zone) from which the stored plan's doses are all
 * ahead (what the edit replaces) and the edited plan's are too (what it
 * introduces). Issues are reported against the first candidate the stored
 * plan allows: the date the builder showed its locks for.
 */
export function reviseCycle(
  current: CycleRevision,
  edited: { timeZone: string; plans: DraftPlan[] },
  now: InstantInput,
  confirmations: readonly Confirmation[] = [],
): Revision {
  const at = toInstant(now);
  const days = candidates(localDateOf(at, edited.timeZone));
  const storedById = new Map(current.plans.map((plan) => [plan.planId, plan]));
  const issues: EditIssue[] = [];
  const plans: RevisedPlan[] = [];

  const revise = (stored: StoredPlan | null, next: DraftPlan | null) => {
    const peptideId = (next ?? stored)!.peptideId;
    const replaced = stored
      ? scheduleOccurrences({ planId: stored.planId, timeZone: current.timeZone, phases: stored.phases }, confirmations)
      : [];
    for (const from of days) {
      if (!aheadFrom(replaced, from, at)) continue;
      const composed = compose(stored, next, from);
      if (composed.issues.length) {
        issues.push(...composed.issues);
        return;
      }
      if (!next || !composed.phases) return; // Removed before it started.
      const introduced = scheduleOccurrences(draftToEngine(next.planId, edited.timeZone, composed.phases), confirmations);
      if (aheadFrom(introduced, from, at)) {
        plans.push({ planId: next.planId, peptideId, effectiveFrom: from, phases: composed.phases });
        return;
      }
    }
    issues.push({ code: "no-future-date", peptideId });
  };

  for (const plan of edited.plans) {
    const stored = plan.planId === null ? null : storedById.get(plan.planId);
    if (stored === undefined || (stored && stored.peptideId !== plan.peptideId)) return { ok: false, issues: [{ code: "unknown" }] };
    revise(stored, plan);
  }
  const kept = new Set(edited.plans.map((plan) => plan.planId));
  for (const stored of current.plans) if (!kept.has(stored.planId)) revise(stored, null);
  return issues.length ? { ok: false, issues } : { ok: true, plans };
}

/** How the builder shows a stored phase while editing: ended (read-only), started (start fixed), or free. */
export type PhaseLock = "ended" | "started" | null;

/**
 * For the builder: each plan's earliest effective date as of `now`, judged
 * on the stored plan alone (the first of today, tomorrow or the day after
 * from which its doses are all ahead and unconfirmed), and each stored
 * phase's lock. The save re-checks with the edited plan (reviseCycle).
 */
export function editWindow(
  current: CycleRevision,
  now: InstantInput,
  confirmations: readonly Confirmation[] = [],
): { effective: Map<string, LocalDate>; locks: Map<string, PhaseLock> } {
  const at = toInstant(now);
  const days = candidates(localDateOf(at, current.timeZone));
  const effective = new Map<string, LocalDate>();
  const locks = new Map<string, PhaseLock>();
  for (const plan of current.plans) {
    const occurrences = scheduleOccurrences({ planId: plan.planId, timeZone: current.timeZone, phases: plan.phases }, confirmations);
    const from = days.find((day) => aheadFrom(occurrences, day, at)) ?? days[2];
    effective.set(plan.planId, from);
    for (const phase of plan.phases) locks.set(phase.id, phase.end < from ? "ended" : phase.start < from ? "started" : null);
  }
  return { effective, locks };
}
