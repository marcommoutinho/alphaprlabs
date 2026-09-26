// A cycle's schedule across its revisions, for R2/R4 (S10), Today and
// confirmation (S12) and reminders (S13). Pure.
//
// Occurrences: each revision schedules each of its plans from the plan's
// effective date (effectiveFrom; the whole plan when null) up to the next
// revision's effective date for that plan, each in its own revision's time
// zone. A plan the next revision removed stops at that revision's creation
// (only a plan that had not started can be removed). Before an effective date
// a revision repeats the previous one exactly (revise.ts), so with an
// unchanged time zone this equals the current revision alone; it matters
// when the researcher moved the cycle to another zone: earlier doses keep the
// times they had. Keys are the engine's (planId:phaseId:index|date) and are
// the same in every revision for the same dose.
import { Temporal } from "@js-temporal/polyfill";
import { type Confirmation, type Occurrence, type PeptidePlan, scheduleOccurrences } from "@/lib/schedule/engine";
import { type InstantInput, type LocalDate, localDateOf, toInstant } from "@/lib/schedule/zone";
import type { CycleRevision, StoredPlan } from "./rules";

/** A stored plan as the engine's plan, in its revision's time zone. */
export function enginePlan(revision: Pick<CycleRevision, "timeZone">, plan: StoredPlan): PeptidePlan {
  return { planId: plan.planId, timeZone: revision.timeZone, phases: plan.phases };
}

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
  const byKey = new Map<string, Occurrence>();
  revisions.forEach((revision, index) => {
    const next = revisions[index + 1];
    const nextStart = next ? Temporal.Instant.from(next.createdAt) : null;
    for (const plan of revision.plans) {
      const later = next?.plans.find((p) => p.planId === plan.planId);
      for (const occurrence of scheduleOccurrences(enginePlan(revision, plan), confirmations)) {
        if (plan.effectiveFrom && occurrence.localDate < plan.effectiveFrom) continue;
        if (later?.effectiveFrom && occurrence.localDate >= later.effectiveFrom) continue;
        if (next && !later && Temporal.Instant.compare(Temporal.Instant.from(occurrence.scheduledAt), nextStart!) >= 0) continue;
        // A later revision's occurrence with the same key replaces an earlier one.
        byKey.set(occurrence.key, occurrence);
      }
    }
  });
  return [...byKey.values()]
    .filter((o) => (!range?.from || o.localDate >= range.from) && (!range?.to || o.localDate <= range.to))
    .sort(
      (a, b) =>
        Temporal.Instant.compare(Temporal.Instant.from(a.scheduledAt), Temporal.Instant.from(b.scheduledAt)) || a.key.localeCompare(b.key),
    );
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
