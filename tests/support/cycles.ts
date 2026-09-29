// Test helpers for S9 cycles against the real local Supabase: peptides,
// templates and cycles in save_cycle()'s shape, and relative local dates.
import { randomBytes } from "node:crypto";
import { addDays } from "../../src/lib/cycles/rules";
import { localDateOf } from "../../src/lib/schedule/zone";
import type { Json } from "../../src/lib/supabase/database.types";
import { ok, type signedInClient } from "./local-supabase";
import { savePeptideAs } from "./admin-writers";

export type Client = Awaited<ReturnType<typeof signedInClient>>;

export const TORONTO = "America/Toronto";
export const tag = () => randomBytes(4).toString("hex");

/** A local date `days` from today in `zone`. */
export const day = (days: number, zone = TORONTO) => addDays(localDateOf(new Date(), zone), days);

/** Creates a library peptide through the admin-only function. */
export async function createPeptide(adminDb: Client, name: string, available = true): Promise<string> {
  const id = await ok(
    savePeptideAs(adminDb, {
      p_name: name,
      p_information: `[Supplied information for ${name}]`,
      p_cycling_off_guidance: "",
      p_supplement_guidance: "",
      p_available: available,
    }),
    `create ${name}`,
  );
  if (!id) throw new Error(`No id for ${name}`);
  return id;
}

/** Turns a peptide off ("Not offered") or on again, keeping its text. */
export async function setAvailable(adminDb: Client, id: string, name: string, available: boolean) {
  await ok(
    savePeptideAs(adminDb, {
      p_id: id,
      p_name: name,
      p_information: `[Supplied information for ${name}]`,
      p_cycling_off_guidance: "",
      p_supplement_guidance: "",
      p_available: available,
    }),
    `availability of ${name}`,
  );
}

type PhaseArg = Record<string, unknown>;

export const interval = (start: string, end: string, dose = "0.4", every = 2, time = "08:00", id: string | null = null): PhaseArg => ({
  phase_id: id,
  kind: "active",
  start_date: start,
  end_date: end,
  dose_mg: dose,
  local_time: time,
  schedule_type: "interval",
  every_days: every,
  dose_changes: [],
});

export const weekdays = (start: string, end: string, days = [1, 3, 5], dose = "0.3", time = "07:30", id: string | null = null): PhaseArg => ({
  phase_id: id,
  kind: "active",
  start_date: start,
  end_date: end,
  dose_mg: dose,
  local_time: time,
  schedule_type: "weekdays",
  weekdays: days,
  dose_changes: [],
});

export const pause = (start: string, end: string, id: string | null = null): PhaseArg => ({
  phase_id: id,
  kind: "break",
  start_date: start,
  end_date: end,
});

export const plan = (peptideId: string, phases: PhaseArg[], planId: string | null = null, effectiveFrom: string | null = null) => ({
  plan_id: planId,
  peptide_id: peptideId,
  effective_from: effectiveFrom,
  phases,
});

export type CycleArgs = {
  name?: string;
  goal?: string;
  baseline?: string;
  timeZone?: string;
  plans: unknown[];
  templateId?: string;
  cycleId?: string;
  version?: number;
};

/** save_cycle's arguments. */
export const cycleArgs = (args: CycleArgs) => ({
  p_name: args.name ?? `Cycle ${tag()}`,
  p_goal: args.goal ?? "Recomposition",
  p_baseline: args.baseline ?? "",
  p_time_zone: args.timeZone ?? TORONTO,
  p_plans: args.plans as Json,
  ...(args.templateId ? { p_template_id: args.templateId } : {}),
  ...(args.cycleId ? { p_cycle_id: args.cycleId } : {}),
  ...(args.version !== undefined ? { p_version: args.version } : {}),
});

export const saveCycle = (db: Client, args: CycleArgs) => db.rpc("save_cycle", cycleArgs(args));

export async function createCycle(db: Client, args: CycleArgs): Promise<string> {
  const id = await ok(saveCycle(db, args), "save_cycle");
  if (!id) throw new Error("save_cycle returned no id");
  return id;
}
