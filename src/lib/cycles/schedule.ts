// A cycle's schedule across its revisions, for R2/R4 (S10), Today and
// confirmation (S12) and reminders (S13). Pure.
//
// Occurrences: revision 1 schedules each plan whole. Each later revision
// takes over a plan at ONE instant, its seam: the start of the plan's
// effective date (effectiveFrom) in THAT revision's time zone. Each
// occurrence key belongs to exactly one revision:
//   * an occurrence the plan had (so far) before the seam keeps that
//     version, even when the new revision schedules the same key elsewhere
//     (e.g. in another time zone, or re-anchored by a late confirmation);
//   * every other occurrence is the new revision's: its occurrences for keys
//     not kept above, and nothing else (an earlier occurrence at or after the
//     seam that the new revision does not have was removed by the edit).
// A plan the next revision removed keeps the occurrences before that
// revision's creation (only a plan with no dose yet can be removed).
// The instant decides, never local dates computed separately in two zones,
// so no occurrence is dropped or duplicated across a time zone change.
// reviseCycle (revise.ts) only allows an edit when every occurrence the seam
// hands to the new revision is still ahead and unconfirmed, so past and
// confirmed doses always keep their time. Keys are the engine's
// (planId:phaseId:index|date).
import { Temporal } from "@js-temporal/polyfill";
import { type Confirmation, type Occurrence, type PeptidePlan, type Phase, scheduleOccurrences } from "@/lib/schedule/engine";
import { type InstantInput, type LocalDate, localDateOf, toInstant } from "@/lib/schedule/zone";
import type { CycleRevision, StoredPlan } from "./rules";

/** A stored plan as the engine's plan, in its revision's time zone. */
export function enginePlan(revision: Pick<CycleRevision, "timeZone">, plan: StoredPlan): PeptidePlan {
  return { planId: plan.planId, timeZone: revision.timeZone, phases: plan.phases };
}

/** The seam: the first instant of `effectiveFrom` in the revision's time zone. */
export function seamOf(effectiveFrom: LocalDate, timeZone: string): Temporal.Instant {
  return Temporal.PlainDate.from(effectiveFrom).toZonedDateTime({ timeZone }).toInstant();
}

const instantOf = (occurrence: Occurrence) => Temporal.Instant.from(occurrence.scheduledAt);
const before = (occurrence: Occurrence, at: Temporal.Instant) => Temporal.Instant.compare(instantOf(occurrence), at) < 0;

/**
 * A plan's occurrences so far with a revision taking over at `seam`: those
 * before the seam are kept, every other key is `fresh`'s (see the header).
 */
export function takeOver(soFar: readonly Occurrence[], fresh: readonly Occurrence[], seam: Temporal.Instant): Occurrence[] {
  const kept = soFar.filter((occurrence) => before(occurrence, seam));
  const keys = new Set(kept.map((occurrence) => occurrence.key));
  return [...kept, ...fresh.filter((occurrence) => !keys.has(occurrence.key))];
}

/** Each plan's occurrences across the revisions (see the header), by plan id, unsorted. */
export function planOccurrences(
  revisions: readonly CycleRevision[],
  confirmations: readonly Confirmation[] = [],
): Map<string, Occurrence[]> {
  const byPlan = new Map<string, Occurrence[]>();
  revisions.forEach((revision, index) => {
    const previous = revisions[index - 1];
    const kept = new Set(revision.plans.map((plan) => plan.planId));
    for (const plan of previous?.plans ?? []) {
      if (kept.has(plan.planId)) continue;
      const removedAt = Temporal.Instant.from(revision.createdAt);
      byPlan.set(plan.planId, (byPlan.get(plan.planId) ?? []).filter((occurrence) => before(occurrence, removedAt)));
    }
    for (const plan of revision.plans) {
      const fresh = scheduleOccurrences(enginePlan(revision, plan), confirmations);
      const soFar = byPlan.get(plan.planId);
      // Revision 1, or a plan this revision adds: all of it.
      if (!soFar || !plan.effectiveFrom) byPlan.set(plan.planId, fresh);
      else byPlan.set(plan.planId, takeOver(soFar, fresh, seamOf(plan.effectiveFrom, revision.timeZone)));
    }
  });
  return byPlan;
}

const byTime = (a: Occurrence, b: Occurrence) => Temporal.Instant.compare(instantOf(a), instantOf(b)) || a.key.localeCompare(b.key);

/**
 * Every active-phase occurrence of the cycle, across its revisions (see the
 * header), sorted by scheduled time then key, optionally limited to local
 * dates `from`–`to` (each occurrence's date in its own zone). Confirmations
 * attach by key.
 */
export function cycleOccurrences(
  revisions: readonly CycleRevision[],
  confirmations: readonly Confirmation[] = [],
  range?: { from?: LocalDate; to?: LocalDate },
): Occurrence[] {
  return [...planOccurrences(revisions, confirmations).values()]
    .flat()
    .filter((o) => (!range?.from || o.localDate >= range.from) && (!range?.to || o.localDate <= range.to))
    .sort(byTime);
}

/** R2/R4 status (the prototype's cycleStatus). */
export type CycleStatus = "Upcoming" | "Active" | "In break" | "Ended";

/** The first and last local dates of a revision's phases. */
export function cycleSpan(revision: Pick<CycleRevision, "plans">): { start: LocalDate; end: LocalDate } {
  const phases = revision.plans.flatMap((plan) => plan.phases);
  const starts = phases.map((phase) => phase.start).sort();
  const ends = phases.map((phase) => phase.end).sort();
  return { start: starts[0], end: ends[ends.length - 1] };
}

/**
 * Upcoming before the first phase starts, Ended after the last one ends,
 * otherwise Active when an active phase covers today and In break when not;
 * "today" in the revision's time zone.
 */
export function cycleStatus(revision: Pick<CycleRevision, "plans" | "timeZone">, now: InstantInput): CycleStatus {
  const today = localDateOf(toInstant(now), revision.timeZone);
  const { start, end } = cycleSpan(revision);
  if (today < start) return "Upcoming";
  if (today > end) return "Ended";
  const active = revision.plans.some((plan) =>
    plan.phases.some((phase) => phase.kind === "active" && phase.start <= today && phase.end >= today),
  );
  return active ? "Active" : "In break";
}

/** A plan's phase on a date: the plan's peptide and the phase in force (see phasesOn). */
export type PlanPhaseOn = { planId: string; peptideId: string; phase: Phase };

/**
 * Each plan's phase on a local date, across every revision (the header's
 * takeover rule, by date): a revision schedules a plan from its effectiveFrom
 * on (all of it when it has none), earlier revisions before that; a plan a
 * revision removed keeps its earlier phases through the local date of that
 * revision's creation (in its zone), and has none after. So a day shows what
 * was planned for it then, whatever later edits changed or removed. Plans in
 * the order they first appeared (the current revision's order for plans added
 * together); plans without a phase that day are left out.
 */
export function phasesOn(revisions: readonly CycleRevision[], date: LocalDate): PlanPhaseOn[] {
  const spans = new Map<string, { from: LocalDate | null; plan: StoredPlan }[]>();
  const removedAfter = new Map<string, LocalDate>();
  revisions.forEach((revision, index) => {
    const kept = new Set(revision.plans.map((plan) => plan.planId));
    for (const plan of revisions[index - 1]?.plans ?? []) {
      if (!kept.has(plan.planId)) removedAfter.set(plan.planId, localDateOf(toInstant(revision.createdAt), revision.timeZone));
    }
    for (const plan of revision.plans) {
      const list = spans.get(plan.planId);
      // Revision 1, or a plan this revision adds: all of it.
      if (!list || !plan.effectiveFrom) spans.set(plan.planId, [{ from: null, plan }]);
      else list.push({ from: plan.effectiveFrom, plan });
      removedAfter.delete(plan.planId);
    }
  });
  const found: PlanPhaseOn[] = [];
  for (const [planId, list] of spans) {
    const removed = removedAfter.get(planId);
    if (removed && date > removed) continue;
    const span = list.filter((s) => s.from === null || s.from <= date).at(-1);
    const phase = span?.plan.phases.find((p) => p.start <= date && p.end >= date);
    if (span && phase) found.push({ planId, peptideId: span.plan.peptideId, phase });
  }
  return found;
}
