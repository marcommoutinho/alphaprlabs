// V2 adherence (R10 cards, R3 tiles and peptide cards, D2 tiles): how many
// of a cycle's settled doses were taken. Pure and client-safe.
//
// It reads the same occurrences the server resolves (planOccurrences across
// every revision, with recorded doses and skips attached as confirmations),
// with the engine's states as of `now`:
//   taken    recorded (counts, and counts as taken)
//   skipped  resolved on purpose (counts, not taken)
//   open     an earlier local day, neither taken nor skipped: missed
//            (counts, not taken)
//   due      today's, not yet taken or skipped: not counted yet; it is
//            still on Today
//   planned  a later day: not counted
// So adherence = taken ÷ (taken + skipped + missed), rounded to a whole
// percent, and null until a dose is settled. An edit never changes it for
// the past: occurrences before an edit keep their keys and state
// (schedule.ts), breaks have no occurrences, and a phase's dose changes
// only move amounts, not counts.
import { type Occurrence, occurrenceState } from "@/lib/schedule/engine";
import type { InstantInput } from "@/lib/schedule/zone";

export type Adherence = {
  taken: number;
  skipped: number;
  missed: number;
  /** taken + skipped + missed: the doses whose outcome is settled. */
  counted: number;
  /** 0–100, or null when nothing is settled yet. */
  percent: number | null;
  /** The latest missed and skipped doses, by scheduled time (the tiles' context). */
  lastMissed: Occurrence | null;
  lastSkipped: Occurrence | null;
};

const later = (a: Occurrence | null, b: Occurrence) =>
  !a || Date.parse(b.scheduledAt) > Date.parse(a.scheduledAt) || (b.scheduledAt === a.scheduledAt && b.key > a.key) ? b : a;

export function adherence(occurrences: readonly Occurrence[], now: InstantInput): Adherence {
  let taken = 0;
  let skipped = 0;
  let missed = 0;
  let lastMissed: Occurrence | null = null;
  let lastSkipped: Occurrence | null = null;
  for (const o of occurrences) {
    const state = occurrenceState(o, now);
    if (state === "taken") taken += 1;
    else if (state === "skipped") {
      skipped += 1;
      lastSkipped = later(lastSkipped, o);
    } else if (state === "open") {
      missed += 1;
      lastMissed = later(lastMissed, o);
    }
  }
  const counted = taken + skipped + missed;
  return { taken, skipped, missed, counted, percent: counted ? Math.round((taken / counted) * 100) : null, lastMissed, lastSkipped };
}

/** "96%", or "—" before any dose is settled. */
export const percentLabel = (value: Adherence) => (value.percent === null ? "—" : `${value.percent}%`);

/** "51 of 53 doses" (R3's tile), "45 of 47" (a peptide card), or "No doses yet". */
export function adherenceCount(value: Adherence, unit = true): string {
  if (!value.counted) return unit ? "No doses yet" : "0 of 0";
  return `${value.taken} of ${value.counted}${unit ? ` dose${value.counted === 1 ? "" : "s"}` : ""}`;
}
