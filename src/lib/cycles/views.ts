// What a recorded dose shows, and the shared pieces Today, Progress and
// People read about a cycle's doses (the v3 cycle screens are ./screens.ts).
// Pure and shared by the screens and the tests.
//
// Doses always come from the engine across every revision
// (planOccurrences/cycleOccurrences in schedule.ts), never from one revision
// alone. Times are each occurrence's own local date and time (in the zone of
// the revision that scheduled it). Confirmations (S12) attach by key.
import { Exact } from "@/lib/calculator/decimal";
import { formatDay } from "@/lib/format";
import type { Confirmation, Occurrence, OccurrenceState } from "@/lib/schedule/engine";
import type { CycleRecord } from "./rules";

/**
 * A recorded dose (S12) as the engine's confirmation, plus what was recorded:
 * the amount actually taken (shown instead of the planned dose), the site and
 * the notes. The engine reads only the Confirmation fields.
 */
export type RecordedConfirmation = Confirmation & { amountMg?: string; site?: string; notes?: string };

/** What a recorded dose shows: `0.3 mg`, and `(planned 0.4 mg)` only when it differs. */
export function recordedAmount(plannedMg: string, amountMg: string | undefined): { mg: string; planned: string } {
  if (!amountMg) return { mg: `${plannedMg} mg`, planned: "" };
  const same = new Exact(amountMg).equals(new Exact(plannedMg));
  return { mg: `${amountMg} mg`, planned: same ? "" : `(planned ${plannedMg} mg)` };
}

/** Library peptides by id, as the caller may read them (own cycles keep withdrawn ones). */
export type ViewPeptides = ReadonlyMap<string, { name: string; available: boolean; cyclingOff?: string }>;

/** Each plan id's peptide, across every revision (a plan never changes peptide). */
export function planPeptides(cycle: Pick<CycleRecord, "revisions">): Map<string, string> {
  const map = new Map<string, string>();
  for (const revision of cycle.revisions) for (const plan of revision.plans) map.set(plan.planId, plan.peptideId);
  return map;
}

/** `Fri Sep 11 · 20:00`, in the occurrence's own zone. */
export const occurrenceWhen = (o: Pick<Occurrence, "localDate" | "localTime">) => `${formatDay(o.localDate)} · ${o.localTime}`;

/** The handoff's dose state labels. */
export const STATE_LABEL: Record<OccurrenceState, string> = {
  taken: "Taken",
  due: "Due",
  open: "Unconfirmed",
  planned: "Planned",
  skipped: "Skipped",
};
