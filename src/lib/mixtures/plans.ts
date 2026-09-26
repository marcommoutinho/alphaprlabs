// Cycle peptide plans as the calculator links them to saved mixtures (R7
// "Save mixture" linked to cycle peptides). Pure.
import { Temporal } from "@js-temporal/polyfill";
import type { CycleRecord } from "@/lib/cycles/rules";
import { type CycleStatus, cycleStatus, planOccurrences } from "@/lib/cycles/schedule";
import type { Confirmation, Occurrence } from "@/lib/schedule/engine";
import { type InstantInput, localDateOf, toInstant } from "@/lib/schedule/zone";
import type { Mixture } from "./rules";

/** A plan in a cycle's current revision, with the mixture it uses now. */
export type LinkablePlan = {
  planId: string;
  peptideId: string;
  cycleId: string;
  cycleName: string;
  status: CycleStatus;
  /** The saved mixture this plan uses now, or null. */
  mixtureId: string | null;
  /** The dose of today's occurrence, else the next one's, else the last one's ("." decimal), or null. */
  doseMg: string | null;
};

const instantOf = (occurrence: Occurrence) => Temporal.Instant.from(occurrence.scheduledAt);

/**
 * The planned dose to show for a plan now, from its scheduled occurrences
 * (the S7 engine across the cycle's revisions, S9's planOccurrences): the
 * occurrence on today's date (in its own time zone) if there is one, else
 * the next occurrence, else the last. So a day between doses shows the next
 * dose's amount, including a dose change that starts before it.
 */
export function planDose(occurrences: readonly Occurrence[], now: InstantInput): string | null {
  const at = toInstant(now);
  const sorted = [...occurrences].sort((a, b) => Temporal.Instant.compare(instantOf(a), instantOf(b)));
  const today = sorted.find((o) => o.localDate === localDateOf(at, o.timeZone));
  const next = sorted.find((o) => Temporal.Instant.compare(instantOf(o), at) > 0);
  return (today ?? next ?? sorted[sorted.length - 1])?.doseMg ?? null;
}

/**
 * Every plan in each cycle's current revision, cycles in the given order
 * (newest first from listCycles), with the mixture each uses now and the
 * dose to preload (confirmations, once S12 records them, move every-N-days
 * occurrences; pass them per cycle id).
 */
export function linkablePlans(
  cycles: readonly CycleRecord[],
  mixtures: readonly Mixture[],
  now: InstantInput,
  confirmations: ReadonlyMap<string, readonly Confirmation[]> = new Map(),
): LinkablePlan[] {
  const mixtureOf = new Map<string, string>();
  for (const mixture of mixtures) for (const planId of mixture.planIds) mixtureOf.set(planId, mixture.id);
  return cycles.flatMap((cycle) => {
    const current = cycle.revisions[cycle.revisions.length - 1];
    if (!current) return [];
    const status = cycleStatus(current, now);
    const occurrences = planOccurrences(cycle.revisions, confirmations.get(cycle.id) ?? []);
    return current.plans.map((plan) => ({
      planId: plan.planId,
      peptideId: plan.peptideId,
      cycleId: cycle.id,
      cycleName: cycle.name,
      status,
      mixtureId: mixtureOf.get(plan.planId) ?? null,
      doseMg: planDose(occurrences.get(plan.planId) ?? [], now),
    }));
  });
}

/**
 * The plans offered for linking a mixture of `peptideId`: those not ended,
 * plus any ended one already linked to `mixtureId` (so it can be unticked).
 */
export function plansFor(plans: readonly LinkablePlan[], peptideId: string, mixtureId: string): LinkablePlan[] {
  return plans.filter(
    (plan) => plan.peptideId === peptideId && (plan.status !== "Ended" || (mixtureId !== "" && plan.mixtureId === mixtureId)),
  );
}
