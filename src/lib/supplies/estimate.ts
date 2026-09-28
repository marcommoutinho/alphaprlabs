// R8 personal supplies: a tracked vial's estimated contents and its low-stock
// outlook. Pure: no database, no clock unless passed in.
//
// Plan "Routine implementation rules": personal stock is an estimate. The
// estimate is the vial's strength minus the amounts confirm_dose deducted
// from it (the full amount of each confirmed dose taken while it was the open
// vial of the mixture in effect, with tracking on). It is exact decimal
// arithmetic on the stored numerics, never floats, and it never goes
// silently below zero: deductions beyond the vial's contents are a recorded
// discrepancy, shown as such ("over"), not clamped away.
//
// Low stock is judged against the next PLANNED amount for the plans that use
// the vial's mixture now (their current links): the earliest dose still to
// take, due today or on a later day, in a cycle that has not ended. Earlier
// unconfirmed doses are not counted: they may never be taken. When that is
// unknowable (the vial isn't mixed, no plan uses its mixture, or no dose is
// planned ahead) nothing is guessed. "About N doses left" walks the planned
// doses ahead in time order, so a dose change in a later phase counts at its
// own amount; it is "about" because the amounts actually taken may differ.
import { Temporal } from "@js-temporal/polyfill";
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleStatus, planOccurrences } from "@/lib/cycles/schedule";
import { Exact, formatAmount, formatRatio } from "@/lib/calculator/decimal";
import type { Confirmation, Occurrence } from "@/lib/schedule/engine";
import { type InstantInput, localDateOf, toInstant } from "@/lib/schedule/zone";

/** One recorded deduction's amount (a stored decimal string). */
export type DeductionAmount = { amountMg: string };

export type VialEstimate = {
  /** Sum of the deductions (exact decimal string). */
  usedMg: string;
  /** Strength minus used; negative when more was recorded than the vial held. */
  remainingMg: string;
  /**
   * unused: nothing deducted yet; in-use: some left; empty: exactly nothing
   * left; over: the deductions exceed the vial's contents (a discrepancy).
   */
  state: "unused" | "in-use" | "empty" | "over";
  /** How much more was recorded than the vial held, when over. */
  overMg: string | null;
  /** 0–100, for the bar only (display, never stored or compared). */
  percentLeft: number;
  /** Confirmed doses deducted. */
  uses: number;
};

/** The estimate for a vial of `strengthMg` after `deductions`. */
export function vialEstimate(strengthMg: string, deductions: readonly DeductionAmount[]): VialEstimate {
  const strength = new Exact(strengthMg);
  const used = deductions.reduce((sum, d) => sum.plus(new Exact(d.amountMg)), new Exact(0));
  const remaining = strength.minus(used);
  const state = deductions.length === 0 ? "unused" : remaining.isNegative() ? "over" : remaining.isZero() ? "empty" : "in-use";
  const percent = strength.isZero() || remaining.lte(0) ? 0 : Math.min(100, remaining.dividedBy(strength).times(100).toNumber());
  return {
    usedMg: used.toFixed(),
    remainingMg: remaining.toFixed(),
    state,
    overMg: remaining.isNegative() ? remaining.negated().toFixed() : null,
    percentLeft: percent,
    uses: deductions.length,
  };
}

/** A dose still to take, as the engine plans it. */
export type PlannedDose = Pick<Occurrence, "key" | "planId" | "scheduledAt" | "localDate" | "localTime" | "timeZone" | "doseMg">;

export type StockOutlook =
  | {
      kind: "unknown";
      /** not-mixed: no saved mixture; no-plan: no plan uses it; no-upcoming: no dose planned ahead. */
      reason: "not-mixed" | "no-plan" | "no-upcoming";
    }
  | {
      kind: "known";
      /** The next planned dose from this vial. */
      next: PlannedDose;
      /** The estimate is less than the next planned dose. */
      low: boolean;
      /** Planned doses ahead, in order, that the estimate covers in full. */
      dosesLeft: number;
      /** The estimate covers every planned dose ahead. */
      coversAll: boolean;
      /** Planned doses ahead in all. */
      planned: number;
    };

/**
 * The outlook for an estimate of `remainingMg` and the planned doses ahead
 * (any order; they are taken in time order). No planned dose: unknown.
 */
export function stockOutlook(remainingMg: string, upcoming: readonly PlannedDose[]): StockOutlook {
  if (upcoming.length === 0) return { kind: "unknown", reason: "no-upcoming" };
  const ordered = [...upcoming].sort(byTime);
  let left = new Exact(remainingMg);
  let covered = 0;
  for (const dose of ordered) {
    const amount = new Exact(dose.doseMg);
    if (left.lessThan(amount)) break;
    left = left.minus(amount);
    covered += 1;
  }
  return {
    kind: "known",
    next: ordered[0],
    low: new Exact(remainingMg).lessThan(new Exact(ordered[0].doseMg)),
    dosesLeft: covered,
    coversAll: covered === ordered.length,
    planned: ordered.length,
  };
}

const byTime = (a: PlannedDose, b: PlannedDose) =>
  Temporal.Instant.compare(Temporal.Instant.from(a.scheduledAt), Temporal.Instant.from(b.scheduledAt)) || a.key.localeCompare(b.key);

/**
 * Each plan's doses still to take as of `now`, by plan id: not confirmed,
 * dated today or later in the plan's own zone, in cycles that have not
 * ended. Oldest first.
 */
export function upcomingByPlan(
  cycles: readonly CycleRecord[],
  confirmations: ReadonlyMap<string, readonly Confirmation[]>,
  now: InstantInput,
): Map<string, PlannedDose[]> {
  const at = toInstant(now);
  const byPlan = new Map<string, PlannedDose[]>();
  for (const cycle of cycles) {
    const revision = cycle.revisions.at(-1);
    if (!revision || cycleStatus(revision, at.toString()) === "Ended") continue;
    for (const [planId, occurrences] of planOccurrences(cycle.revisions, confirmations.get(cycle.id) ?? [])) {
      const ahead = occurrences.filter((o) => !o.actualAt && !o.skipped && o.localDate >= localDateOf(at, o.timeZone));
      if (ahead.length) byPlan.set(planId, [...(byPlan.get(planId) ?? []), ...ahead].sort(byTime));
    }
  }
  return byPlan;
}

/** The outlook for a vial on a mixture used by `planIds` (none: unknown). */
export function outlookFor(
  estimate: Pick<VialEstimate, "remainingMg">,
  mixtureId: string | null,
  planIds: readonly string[],
  upcoming: ReadonlyMap<string, readonly PlannedDose[]>,
): StockOutlook {
  if (!mixtureId) return { kind: "unknown", reason: "not-mixed" };
  if (planIds.length === 0) return { kind: "unknown", reason: "no-plan" };
  return stockOutlook(
    estimate.remainingMg,
    planIds.flatMap((planId) => upcoming.get(planId) ?? []),
  );
}

// ── Wording ─────────────────────────────────────────────────────────────────

/** "7.6 mg" (exact up to 6 places, else "≈"). */
export const mgLabel = (mg: string) => `${formatAmount(new Exact(mg))} mg`;

/**
 * "Estimated remaining" as shown: "7.6 mg · 1.9 mL" (the mL at the mixture's
 * concentration, when there is one and something is left), "0 mg", or
 * "0 mg · 0.2 mg over" when the deductions exceed the vial.
 */
export function remainingLabel(estimate: VialEstimate, mixture: { vialMg: string; liquidMl: string } | null): string {
  if (estimate.state === "over") return `0 mg · ${mgLabel(estimate.overMg!)} over`;
  const mg = mgLabel(estimate.remainingMg);
  if (!mixture || !new Exact(estimate.remainingMg).greaterThan(0)) return mg;
  const ml = formatRatio(new Exact(estimate.remainingMg).times(mixture.liquidMl), mixture.vialMg);
  return `${mg} · ${ml} mL`;
}

export const OVER_STATE = "Estimate exceeds vial — check your records";
export const EMPTY_STATE = "Empty (estimate)";
export const LOW_STATE = "Low (estimate)";

/** The state beside an open vial's label, and how loudly to show it. */
export function vialState(
  estimate: VialEstimate,
  outlook: StockOutlook,
  mixed: boolean,
): { text: string; tone: "quiet" | "warn" | "alert" } {
  if (estimate.state === "over") return { text: OVER_STATE, tone: "alert" };
  if (estimate.state === "empty") return { text: EMPTY_STATE, tone: "alert" };
  if (outlook.kind === "known" && outlook.low) return { text: LOW_STATE, tone: "warn" };
  return { text: mixed ? "In use" : "Not mixed yet", tone: "quiet" };
}

const doses = (n: number) => `${n} dose${n === 1 ? "" : "s"}`;

/**
 * The outlook line under an open vial, or null when there is nothing honest
 * to say about it (not mixed: the card says how to link it instead).
 */
export function outlookLine(outlook: StockOutlook, when: (dose: PlannedDose) => string): string | null {
  if (outlook.kind === "unknown") {
    if (outlook.reason === "no-plan") return "No cycle plan uses this mixture, so low stock isn't judged.";
    if (outlook.reason === "no-upcoming") return "No dose is planned ahead, so low stock isn't judged.";
    return null;
  }
  const next = `${outlook.next.doseMg} mg, ${when(outlook.next)}`;
  if (outlook.low) return `Less than the next planned dose (${next}).`;
  if (outlook.coversAll) return `Enough for the ${doses(outlook.planned)} planned ahead. Next: ${next}.`;
  return `About ${doses(outlook.dosesLeft)} left at the planned amounts. Next: ${next}.`;
}

/** Today's note beside a dose whose vial is low, empty or over, else null. */
export function todayStockNote(label: string, estimate: VialEstimate, outlook: StockOutlook): string | null {
  if (estimate.state === "over") return `Vial ${label}: the estimate exceeds the vial — check Personal supplies`;
  if (estimate.state === "empty") return `Vial ${label} is empty (estimate)`;
  if (outlook.kind === "known" && outlook.low) return `Vial ${label} is low · ${mgLabel(estimate.remainingMg)} left (estimate)`;
  return null;
}
