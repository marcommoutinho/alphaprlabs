import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ValidCheckIn } from "./rules";

type Db = SupabaseClient<Database>;

// R9 check-ins (20260926220000_progress.sql), read and written with the
// caller's own session client, so RLS decides what is readable: a person's
// own check-ins, or, for an admin, those of a researcher sharing with the
// team (S17's A8 history uses listCheckIns with that researcher's id).
// Callers that mean "mine" pass their own id as owner. Measurement values are
// read as text (no floats). Reads are complete: a page at a time by day
// (unique per owner, so a keyset), never cut at the API's 1,000-row cap.

/** Rows per request; the API caps a response at 1,000 rows. */
const PAGE = 1000;

/** One day's check-in. */
export type CheckIn = {
  id: string;
  /** The America/Toronto day it covers (YYYY-MM-DD). */
  day: string;
  feeling: number;
  /** As stored: v3 chips, or the earlier ones (effectLabel shows either). */
  effects: string[];
  /** "Other"'s text, or "" (always "" on check-ins saved with the earlier chips). */
  effectsOther: string;
  note: string;
  measurement: { name: string; value: string; unit: string; measuredAt: string } | null;
  /** The stale-edit token. */
  version: number;
  createdAt: string;
  /** When it was last saved. */
  updatedAt: string;
};

type Row = {
  id: string;
  day: string;
  feeling: number;
  effects: string[];
  effects_other: string;
  note: string;
  measurement_name: string | null;
  measurement_value: string | null;
  measurement_unit: string | null;
  measured_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  "id, day, feeling, effects, effects_other, note, measurement_name, measurement_value::text, measurement_unit, measured_at, version, created_at, updated_at";

const checkInOf = (row: Row): CheckIn => ({
  id: row.id,
  day: row.day,
  feeling: row.feeling,
  effects: row.effects,
  effectsOther: row.effects_other,
  note: row.note,
  measurement:
    row.measurement_name !== null && row.measurement_value !== null && row.measurement_unit !== null && row.measured_at !== null
      ? { name: row.measurement_name, value: row.measurement_value, unit: row.measurement_unit, measuredAt: row.measured_at }
      : null,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

type Page = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/**
 * `ownerId`'s check-ins, oldest day first, optionally only days `from` to
 * `to` (inclusive, YYYY-MM-DD). `pageSize` is for tests that prove paging.
 */
export async function listCheckIns(
  db: Db,
  ownerId: string,
  range: { from?: string; to?: string } = {},
  requested = PAGE,
): Promise<CheckIn[]> {
  // Never more than the API returns: a short page must mean the last one.
  const pageSize = Math.min(requested, PAGE);
  const rows: Row[] = [];
  for (let after: string | null = null; ; ) {
    let query = db.from("progress_check_ins").select(COLUMNS).eq("owner_id", ownerId);
    if (range.from) query = query.gte("day", range.from);
    if (range.to) query = query.lte("day", range.to);
    if (after) query = query.gt("day", after);
    const { data, error } = await (query.order("day").limit(pageSize) as unknown as Page);
    if (error) throw new Error(`Could not load check-ins: ${error.message}`);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return rows.map(checkInOf);
    after = got[got.length - 1].day;
  }
}

/** How many check-ins `ownerId` has recorded in all (the "sparse history" note). */
export async function countCheckIns(db: Db, ownerId: string): Promise<number> {
  const { count, error } = await db.from("progress_check_ins").select("id", { count: "exact", head: true }).eq("owner_id", ownerId);
  if (error) throw new Error(`Could not count check-ins: ${error.message}`);
  return count ?? 0;
}

export type SaveCheckInResult =
  | { kind: "saved"; id: string; day: string; version: number; savedAt: string }
  | { kind: "new_day" | "changed" | "invalid" | "error" };

const REFUSALS: Record<string, Exclude<SaveCheckInResult["kind"], "saved">> = {
  AP023: "new_day",
  AP024: "changed",
  "22023": "invalid",
};

type ResultJson = { id: string; day: string; version: number; saved_at: string };

/** save_check_in: the caller's check-in for today (America/Toronto), created or replaced in place (stale versions refused). */
export async function saveCheckIn(db: Db, input: ValidCheckIn): Promise<SaveCheckInResult> {
  const { data, error } = await db.rpc("save_check_in", {
    p_day: input.day,
    // null is "the day's first check-in" (the generated type has no null for integer arguments).
    p_version: input.version as number,
    p_feeling: input.feeling,
    p_effects: input.effects,
    p_effects_other: input.effectsOther,
    p_note: input.note,
    ...(input.measurement
      ? {
          p_measurement_name: input.measurement.name,
          // An exact decimal string: PostgREST passes it to numeric unchanged.
          p_measurement_value: input.measurement.value as unknown as number,
          p_measurement_unit: input.measurement.unit,
        }
      : {}),
  });
  if (error) return { kind: REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "error" };
  const json = data as unknown as ResultJson;
  return { kind: "saved", id: json.id, day: json.day, version: json.version, savedAt: json.saved_at };
}
