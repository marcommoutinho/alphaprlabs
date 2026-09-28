// Progress (design v3 R5 / D3): the cycle picker's rule and the per-day
// lines beside a check-in. Pure. The screen itself is ./screen.
//
// One axis of days (Marco, 2026-09-26): America/Toronto calendar days, as a
// check-in's day always is. With a cycle selected, a check-in's day also shows
//   * that cycle's phases for each peptide in force during that Toronto day,
//     across every revision (phasesDuring): resolved by instant, as the
//     cycle's doses are, with each revision's dates in its own zone, so a
//     dose always sits beside the phase that planned it, and a plan a later
//     edit removed still shows on its earlier days. A day during which the
//     plan changes (an edit's seam falls inside it, or another zone's dates
//     turn over during it) shows each value in time order: "400 mcg → 600 mcg";
//   * every dose actually recorded that day across all the researcher's
//     cycles, placed by the Toronto date of its actual time. For a cycle in
//     Toronto's zone that is the dose's own local day (as Today and the cycle
//     history date it); a dose from a cycle in another zone is placed by its
//     Toronto day, so doses and check-ins share one axis.
// Observations are only shown beside the doses: nothing here links a result
// to a compound. Amounts under 1 mg show in mcg (design v3).
import { massLabel } from "@/lib/alpha/format";
import type { CycleRecord } from "@/lib/cycles/rules";
import { doseAt } from "@/lib/cycles/rules";
import { cycleStatus, phasesDuring } from "@/lib/cycles/schedule";
import { planPeptides, type RecordedConfirmation, type ViewPeptides } from "@/lib/cycles/views";
import { type InstantInput, toInstant } from "@/lib/schedule/zone";
import { checkInDay, PROGRESS_TIME_ZONE } from "./rules";

/** `?cycle=none`: no cycle, check-ins only. */
export const NO_CYCLE_PARAM = "none";

const current = (cycle: CycleRecord) => cycle.revisions[cycle.revisions.length - 1];

/**
 * The cycle shown: the one asked for; none for NO_CYCLE_PARAM; by default the
 * newest current one (Active or In break), else none (between cycles).
 */
export function selectedCycle(cycles: readonly CycleRecord[], selectedId: string | null, now: InstantInput): CycleRecord | null {
  if (selectedId === NO_CYCLE_PARAM) return null;
  const asked = selectedId ? cycles.find((c) => c.id === selectedId.toLowerCase()) : undefined;
  if (asked) return asked;
  return cycles.find((c) => ["Active", "In break"].includes(cycleStatus(current(c), now))) ?? null;
}

/**
 * "Compound A: 400 mcg · Compound B: break": each plan's phases in force
 * during the Toronto `day`, across the cycle's revisions; a change during the
 * day reads "Compound A: 400 mcg → 600 mcg".
 */
export function phaseLine(cycle: CycleRecord, day: string, peptides: ViewPeptides): string {
  return phasesDuring(cycle.revisions, day, PROGRESS_TIME_ZONE)
    .map(({ peptideId, parts }) => {
      const name = peptides.get(peptideId)?.name ?? "Unknown peptide";
      const values = parts.map(({ phase, date }) => (phase.kind === "break" ? "break" : massLabel(doseAt(phase, date))));
      return `${name}: ${values.filter((value, i) => value !== values[i - 1]).join(" → ")}`;
    })
    .join(" · ");
}

/** Every recorded dose by the Toronto day of its actual time (see the header), oldest first within a day. */
export function dosesByDay(
  cycles: readonly CycleRecord[],
  confirmations: ReadonlyMap<string, readonly RecordedConfirmation[]>,
  peptides: ViewPeptides,
  days: { from: string; to: string },
): Map<string, string[]> {
  const found: { day: string; at: number; text: string }[] = [];
  for (const cycle of cycles) {
    const planOf = planPeptides(cycle);
    for (const record of confirmations.get(cycle.id) ?? []) {
      if (record.skipped) continue;
      const at = toInstant(record.actualAt);
      const day = checkInDay(at.toString(), PROGRESS_TIME_ZONE);
      if (day < days.from || day > days.to) continue;
      const name = peptides.get(planOf.get(record.key.split(":")[0]) ?? "")?.name ?? "Unknown peptide";
      found.push({ day, at: at.epochMilliseconds, text: record.amountMg ? `${name} ${massLabel(record.amountMg)}` : name });
    }
  }
  const byDay = new Map<string, string[]>();
  for (const dose of found.sort((a, b) => a.at - b.at)) byDay.set(dose.day, [...(byDay.get(dose.day) ?? []), dose.text]);
  return byDay;
}
