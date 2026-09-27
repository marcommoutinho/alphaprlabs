// Test helpers for S12 recorded doses: the current schedule of a cycle as the
// app computes it (engine + recorded doses), and confirm_dose's arguments for
// one of its occurrences. The noon zone helpers live in ./noon.
import { randomUUID } from "node:crypto";
import { cycleOccurrences } from "../../src/lib/cycles/schedule";
import { getCycle } from "../../src/lib/cycles/service";
import { cycleConfirmations } from "../../src/lib/doses/service";
import type { Occurrence } from "../../src/lib/schedule/engine";
import type { Client } from "./cycles";

export { d, NOON, noonZoneInstant } from "./noon";

/** The cycle's occurrences now, from the stored plan and recorded doses (what Today shows). */
export async function occurrencesOf(db: Client, cycleId: string): Promise<Occurrence[]> {
  const cycle = await getCycle(db, cycleId);
  if (!cycle) throw new Error(`Cycle ${cycleId} not readable`);
  return cycleOccurrences(cycle.revisions, await cycleConfirmations(db, cycleId));
}

/** One occurrence by its local date (and plan), failing loudly when absent. */
export async function occurrenceOn(db: Client, cycleId: string, date: string, planId?: string): Promise<Occurrence> {
  const found = (await occurrencesOf(db, cycleId)).filter((o) => o.localDate === date && (!planId || o.planId === planId));
  if (found.length !== 1) throw new Error(`Expected one occurrence on ${date}, found ${found.length}`);
  return found[0];
}

/** confirm_dose's arguments for an occurrence as shown now. */
export const confirmArgs = (o: Occurrence, overrides: Record<string, unknown> = {}) => ({
  p_request_key: randomUUID(),
  p_occurrence_key: o.key,
  p_seen_scheduled_at: o.scheduledAt,
  p_seen_dose_mg: o.doseMg,
  p_amount_mg: o.doseMg,
  ...overrides,
});
