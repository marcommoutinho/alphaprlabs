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
  // One screen asks for the same cycle's schedule several times (Today: its
  // doses, the vial outlook, the badge): worked out once per pair of inputs,
  // each caller gets its own map and arrays.
  let byConfirmations = computed.get(revisions);
  if (!byConfirmations) computed.set(revisions, (byConfirmations = new WeakMap()));
  const key = confirmations.length ? confirmations : NO_CONFIRMATIONS;
  let byPlan = byConfirmations.get(key);
  if (!byPlan) byConfirmations.set(key, (byPlan = computePlanOccurrences(revisions, confirmations)));
  return new Map([...byPlan].map(([planId, occurrences]) => [planId, [...occurrences]]));
}

/**
 * planOccurrences' results by input identity. The inputs are never changed
 * in place (a new revision or confirmation is a new array), and the
 * occurrences are read-only values.
 */
const computed = new WeakMap<readonly CycleRevision[], WeakMap<readonly Confirmation[], ReadonlyMap<string, readonly Occurrence[]>>>();
const NO_CONFIRMATIONS: readonly Confirmation[] = [];

function computePlanOccurrences(revisions: readonly CycleRevision[], confirmations: readonly Confirmation[]): Map<string, Occurrence[]> {
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

/** One phase in force during part of a day, with the local date (in its revision's zone) it applies on there. */
export type PhasePart = { date: LocalDate; phase: Phase };

/** A plan's phases in force during a day (see phasesDuring), in time order. */
export type PlanPhasesDuring = { planId: string; peptideId: string; parts: PhasePart[] };

/**
 * Each plan's phases in force during one local `day` of `timeZone` (e.g. a
 * Progress row, a Toronto day), across every revision, by instant, as
 * planOccurrences resolves occurrences:
 *   * revision 1, and a plan a revision adds, schedules the plan from the
 *     start; a later revision takes it over at its seam, the start of its
 *     effectiveFrom in THAT revision's zone (seamOf), and a later seam cuts
 *     any span that began after it (as takeOver keeps only what came before);
 *   * a plan a revision removed ends at that revision's creation instant.
 * Each span's part of the day is read in its own revision's zone: the local
 * dates it covers there (one, or two when the zones' days are offset), and
 * each date's phase. So a day that straddles a seam, or whose hours fall on
 * two local dates of another zone, lists every phase in force during it, in
 * time order (repeats kept; callers merge equal ones). Plans in the order
 * they first appeared; plans with no phase during the day are left out.
 */
export function phasesDuring(revisions: readonly CycleRevision[], day: LocalDate, timeZone: string): PlanPhasesDuring[] {
  const dayStart = seamOf(day, timeZone);
  const dayEnd = seamOf(Temporal.PlainDate.from(day).add({ days: 1 }).toString(), timeZone);
  type Span = { from: Temporal.Instant | null; timeZone: string; plan: StoredPlan };
  const spans = new Map<string, Span[]>();
  const removedAt = new Map<string, Temporal.Instant>();
  revisions.forEach((revision, index) => {
    const kept = new Set(revision.plans.map((plan) => plan.planId));
    for (const plan of revisions[index - 1]?.plans ?? []) {
      if (!kept.has(plan.planId)) removedAt.set(plan.planId, Temporal.Instant.from(revision.createdAt));
    }
    for (const plan of revision.plans) {
      const list = spans.get(plan.planId);
      if (!list || !plan.effectiveFrom) {
        spans.set(plan.planId, [{ from: null, timeZone: revision.timeZone, plan }]);
      } else {
        const seam = seamOf(plan.effectiveFrom, revision.timeZone);
        spans.set(plan.planId, [
          ...list.filter((span) => span.from === null || Temporal.Instant.compare(span.from, seam) < 0),
          { from: seam, timeZone: revision.timeZone, plan },
        ]);
      }
      removedAt.delete(plan.planId);
    }
  });

  const later = (a: Temporal.Instant, b: Temporal.Instant) => (Temporal.Instant.compare(a, b) >= 0 ? a : b);
  const earlier = (a: Temporal.Instant, b: Temporal.Instant) => (Temporal.Instant.compare(a, b) <= 0 ? a : b);
  const found: PlanPhasesDuring[] = [];
  for (const [planId, list] of spans) {
    const parts: PhasePart[] = [];
    list.forEach((span, i) => {
      const next = list[i + 1]?.from ?? null;
      const removed = removedAt.get(planId) ?? null;
      const from = span.from ? later(dayStart, span.from) : dayStart;
      let to = next ? earlier(dayEnd, next) : dayEnd;
      if (removed) to = earlier(to, removed);
      if (Temporal.Instant.compare(from, to) >= 0) return;
      const first = localDateOf(from, span.timeZone);
      const last = localDateOf(to.subtract({ nanoseconds: 1 }), span.timeZone);
      for (let date = first; date <= last; date = Temporal.PlainDate.from(date).add({ days: 1 }).toString()) {
        const phase = span.plan.phases.find((p) => p.start <= date && p.end >= date);
        if (phase) parts.push({ date, phase });
      }
    });
    if (parts.length) found.push({ planId, peptideId: list[0].plan.peptideId, parts });
  }
  return found;
}
