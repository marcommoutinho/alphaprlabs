// Test helpers for S12 recorded doses: the current schedule of a cycle as the
// app computes it (engine + recorded doses), and confirm_dose's arguments for
// one of its occurrences. The noon zone helpers live in ./noon.
import { randomUUID } from "node:crypto";
import { cycleOccurrences } from "../../src/lib/cycles/schedule";
import { getCycle } from "../../src/lib/cycles/service";
import { cycleConfirmations, planSetups } from "../../src/lib/doses/service";
import { setupAt } from "../../src/lib/doses/setups";
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

/** confirm_dose's arguments for an occurrence as shown now, for a plan without a saved mixture. */
export const confirmArgs = (o: Occurrence, overrides: Record<string, unknown> = {}) => ({
  p_request_key: randomUUID(),
  p_occurrence_key: o.key,
  p_seen_scheduled_at: o.scheduledAt,
  p_seen_dose_mg: o.doseMg,
  // The generated type has no null for uuid arguments; null is "no mixture shown".
  p_seen_mixture_version_id: null as unknown as string,
  p_amount_mg: o.doseMg,
  ...overrides,
});

/** The saved-mixture version the page shows for a plan at an instant (now by default), as Today computes it. */
export async function seenVersion(db: Client, planId: string, at = new Date().toISOString()): Promise<string | null> {
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error(`No signed-in user: ${error?.message ?? "none"}`);
  return setupAt((await planSetups(db, data.user.id)).get(planId) ?? [], at)?.versionId ?? null;
}

/** confirmArgs with the mixture version the page would show for the actual time. */
export async function confirmArgsSeen(db: Client, o: Occurrence, overrides: Record<string, unknown> = {}) {
  const at = typeof overrides.p_actual_at === "string" ? overrides.p_actual_at : undefined;
  return confirmArgs(o, { p_seen_mixture_version_id: await seenVersion(db, o.planId, at), ...overrides });
}
