// Cycle peptide plans as the calculator links them to saved mixtures (R7
// "Save mixture" linked to cycle peptides). Pure.
import { doseAt, type CycleRecord, type StoredPlan } from "@/lib/cycles/rules";
import { type CycleStatus, cycleStatus } from "@/lib/cycles/schedule";
import type { ActivePhase } from "@/lib/schedule/engine";
import { type InstantInput, type LocalDate, localDateOf } from "@/lib/schedule/zone";
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
  /** The plan's dose today, else its next planned dose, else its last ("." decimal), or null. */
  doseMg: string | null;
};

/**
 * The planned dose to show for a plan on a local date: the active phase's
 * dose that day (dose changes applied); between or before phases, the next
 * active phase's first dose; after the last phase, its final dose.
 */
export function planDoseOn(plan: Pick<StoredPlan, "phases">, date: LocalDate): string | null {
  const active = plan.phases.filter((phase): phase is ActivePhase => phase.kind === "active").sort((a, b) => a.start.localeCompare(b.start));
  const current = active.find((phase) => phase.start <= date && date <= phase.end);
  if (current) return doseAt(current, date);
  const next = active.find((phase) => phase.start > date);
  if (next) return doseAt(next, next.start);
  const last = active[active.length - 1];
  return last ? doseAt(last, last.end) : null;
}

/**
 * Every plan in each cycle's current revision, cycles in the given order
 * (newest first from listCycles), with the mixture each uses now.
 */
export function linkablePlans(cycles: readonly CycleRecord[], mixtures: readonly Mixture[], now: InstantInput): LinkablePlan[] {
  const mixtureOf = new Map<string, string>();
  for (const mixture of mixtures) for (const planId of mixture.planIds) mixtureOf.set(planId, mixture.id);
  return cycles.flatMap((cycle) => {
    const current = cycle.revisions[cycle.revisions.length - 1];
    if (!current) return [];
    const status = cycleStatus(current, now);
    const today = localDateOf(now, current.timeZone);
    return current.plans.map((plan) => ({
      planId: plan.planId,
      peptideId: plan.peptideId,
      cycleId: cycle.id,
      cycleName: cycle.name,
      status,
      mixtureId: mixtureOf.get(plan.planId) ?? null,
      doseMg: planDoseOn(plan, today),
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
