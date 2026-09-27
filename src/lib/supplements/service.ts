import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ValidRoutine } from "./rules";

type Db = SupabaseClient<Database>;

// Supplement routines and their Taken records (20260927100000_supplements.sql),
// read and written with the caller's own session client, so RLS decides
// what is readable: a person's own records, or those of a researcher whose
// active support grant they hold (S17's A8 history reads these with that
// researcher's id). Callers that mean "mine" pass their own id as owner.
// Amounts are read as text (no floats). Reads are complete: a page at a time
// by id (keyset), never cut at the API's 1,000-row cap.
//
// For S13: supplement reminders come from due_supplement_occurrences (service
// role); see the migration's header for the rechecks before sending.

/** Rows per request; the API caps a response at 1,000 rows. */
const PAGE = 1000;

export type Routine = {
  id: string;
  name: string;
  amount: string;
  unit: string;
  /** "HH:MM" */
  time: string;
  timeZone: string;
  startDate: string;
  endDate: string | null;
  /** The stale-edit token. */
  version: number;
  createdAt: string;
};

export type TakenRecord = {
  id: string;
  routineId: string;
  occurrenceKey: string;
  localDate: string;
  scheduledAt: string;
  /** The routine as it was when taken. */
  name: string;
  amount: string;
  unit: string;
  actualAt: string;
  recordedAt: string;
};

type RoutineRow = {
  id: string;
  name: string;
  amount: string;
  unit: string;
  time_of_day: string;
  time_zone: string;
  start_date: string;
  end_date: string | null;
  version: number;
  created_at: string;
};

type TakenRow = {
  id: string;
  routine_id: string;
  occurrence_key: string;
  local_date: string;
  scheduled_at: string;
  name: string;
  amount: string;
  unit: string;
  actual_at: string;
  recorded_at: string;
};

const ROUTINE_COLUMNS = "id, name, amount::text, unit, time_of_day, time_zone, start_date, end_date, version, created_at";
const TAKEN_COLUMNS = "id, routine_id, occurrence_key, local_date, scheduled_at, name, amount::text, unit, actual_at, recorded_at";

/** To the microsecond, as the database orders them. */
const byInstant = (a: string, b: string) => Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b));

type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/** Every row, `pageSize` at a time in id order (`page(after, limit)` reads ids after `after`). */
async function keyset<Row extends { id: string }>(page: (after: string | null, limit: number) => Page<Row>, what: string, requested: number): Promise<Row[]> {
  // Never more than the API returns: a short page must mean the last one.
  const pageSize = Math.min(requested, PAGE);
  const rows: Row[] = [];
  for (let after: string | null = null; ; ) {
    const { data, error } = await page(after, pageSize);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return rows;
    after = got[got.length - 1].id;
  }
}

/** R10 "Track supplements" for `ownerId` (off until turned on). */
export async function getSupplementTracking(db: Db, ownerId: string): Promise<boolean> {
  const { data, error } = await db.from("supplement_settings").select("tracking_enabled").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Could not load supplement tracking: ${error.message}`);
  return data?.tracking_enabled ?? false;
}

/** Every routine of `ownerId`, ended ones included, in creation order. `pageSize` is for tests that prove paging. */
export async function listRoutines(db: Db, ownerId: string, pageSize = PAGE): Promise<Routine[]> {
  const rows = await keyset<RoutineRow>(
    (after, limit) => {
      const query = db.from("supplement_routines").select(ROUTINE_COLUMNS).eq("owner_id", ownerId);
      return (after ? query.gt("id", after) : query).order("id").limit(limit) as unknown as Page<RoutineRow>;
    },
    "supplement routines",
    pageSize,
  );
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      amount: row.amount,
      unit: row.unit,
      time: row.time_of_day,
      timeZone: row.time_zone,
      startDate: row.start_date,
      endDate: row.end_date,
      version: row.version,
      createdAt: row.created_at,
    }))
    .sort((a, b) => byInstant(a.createdAt, b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Every Taken record of `ownerId` (only occurrences dated `from` or later,
 * YYYY-MM-DD, when given), oldest actual time first. `pageSize` is for tests
 * that prove paging.
 */
export async function listTaken(db: Db, ownerId: string, range: { from?: string } = {}, pageSize = PAGE): Promise<TakenRecord[]> {
  const rows = await keyset<TakenRow>(
    (after, limit) => {
      let query = db.from("supplement_taken").select(TAKEN_COLUMNS).eq("owner_id", ownerId);
      if (range.from) query = query.gte("local_date", range.from);
      return (after ? query.gt("id", after) : query).order("id").limit(limit) as unknown as Page<TakenRow>;
    },
    "supplement records",
    pageSize,
  );
  return rows
    .map((row) => ({
      id: row.id,
      routineId: row.routine_id,
      occurrenceKey: row.occurrence_key,
      localDate: row.local_date,
      scheduledAt: row.scheduled_at,
      name: row.name,
      amount: row.amount,
      unit: row.unit,
      actualAt: row.actual_at,
      recordedAt: row.recorded_at,
    }))
    .sort((a, b) => byInstant(a.actualAt, b.actualAt) || a.id.localeCompare(b.id));
}

// ── Writes ──────────────────────────────────────────────────────────────────

type Refusal = "changed" | "ended" | "tracking_off" | "not_found" | "invalid" | "error";

const ROUTINE_REFUSALS: Record<string, Refusal> = {
  AP025: "changed",
  AP026: "tracking_off",
  AP027: "ended",
  "22023": "invalid",
};

/** set_supplement_tracking. Throws when it fails. */
export async function setSupplementTracking(db: Db, enabled: boolean): Promise<void> {
  const { error } = await db.rpc("set_supplement_tracking", { p_enabled: enabled });
  if (error) throw new Error(`Could not save supplement tracking: ${error.message}`);
}

export type SaveRoutineResult = { kind: "saved"; id: string; version: number } | { kind: Refusal };

/** save_supplement_routine: create (no id) or edit in place from the version shown. */
export async function saveRoutine(db: Db, routine: ValidRoutine): Promise<SaveRoutineResult> {
  const { data, error } = await db.rpc("save_supplement_routine", {
    // null creates (the generated type has no null for uuid and integer arguments).
    p_id: routine.id as string,
    p_version: routine.version as number,
    p_name: routine.name,
    p_amount: routine.amount,
    p_unit: routine.unit,
    p_time: routine.time,
  });
  if (error) return { kind: ROUTINE_REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  const json = data as unknown as { id: string; version: number };
  return { kind: "saved", id: json.id, version: json.version };
}

export type EndRoutineResult = { kind: "done"; endDate: string } | { kind: Refusal };

/** end_supplement_routine: the routine ends today (its zone), from the version shown. */
export async function endRoutine(db: Db, id: string, version: number): Promise<EndRoutineResult> {
  const { data, error } = await db.rpc("end_supplement_routine", { p_id: id, p_version: version });
  if (error) return { kind: ROUTINE_REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  return { kind: "done", endDate: (data as unknown as { end_date: string }).end_date };
}

export type TakeSupplementInput = {
  requestKey: string;
  occurrenceKey: string;
  seenScheduledAt: string;
  seenAmount: string;
  seenUnit: string;
  /** ISO instant; null means now (the server's clock). */
  actualAt: string | null;
};

export type TakeSupplementResult =
  | { kind: "taken"; actualAt: string; recordedAt: string; name: string; replayed: boolean }
  | { kind: "not_found" | "gone" | "already" | "not_yet" | "changed" | "future" | "too_early" | "tracking_off" | "invalid" | "error" };

const TAKE_REFUSALS: Record<string, Exclude<TakeSupplementResult["kind"], "taken">> = {
  AP017: "gone",
  AP018: "already",
  AP019: "not_yet",
  AP020: "changed",
  AP021: "future",
  AP022: "too_early",
  AP026: "tracking_off",
  "22023": "invalid",
};

type TakenJson = { actual_at: string; recorded_at: string; name: string; replayed: boolean };

/** take_supplement: one Taken record per occurrence, idempotent by request key. */
export async function takeSupplement(db: Db, input: TakeSupplementInput): Promise<TakeSupplementResult> {
  const { data, error } = await db.rpc("take_supplement", {
    p_request_key: input.requestKey,
    p_occurrence_key: input.occurrenceKey,
    p_seen_scheduled_at: input.seenScheduledAt,
    p_seen_amount: input.seenAmount,
    p_seen_unit: input.seenUnit,
    ...(input.actualAt ? { p_actual_at: input.actualAt } : {}),
  });
  if (error) return { kind: TAKE_REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  const json = data as unknown as TakenJson;
  return { kind: "taken", actualAt: json.actual_at, recordedAt: json.recorded_at, name: json.name, replayed: json.replayed };
}
