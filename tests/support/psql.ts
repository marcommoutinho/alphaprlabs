// Runs SQL as the database owner with psql (the internal schedule functions
// are not callable through the API). Tests using it run in the
// integration-exclusive project (vitest.config.mts).
import { execFile, execFileSync } from "node:child_process";
import { Temporal } from "@js-temporal/polyfill";
import { localSupabase } from "./local-supabase";

/** Runs SQL with psql as the database owner; `label\tvalue` rows come back as a map. */
export function psql(sql: string): Record<string, string> {
  let out: string;
  try {
    out = execFileSync("psql", [localSupabase().dbUrl, "-X", "-q", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1"], {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const e = error as { code?: string; stderr?: string };
    if (e.code === "ENOENT") throw new Error("psql is required for this test (PostgreSQL client tools).");
    throw new Error(`psql failed: ${e.stderr ?? String(error)}`);
  }
  return Object.fromEntries(out.split("\n").filter(Boolean).map((line) => line.split("\t") as [string, string]));
}

/** psql in the background: resolves with its `label\tvalue` rows once the script ends (for lock tests). */
export function psqlAsync(sql: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "psql",
      [localSupabase().dbUrl, "-X", "-q", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`psql failed: ${stderr || String(error)}`));
        else resolve(Object.fromEntries(stdout.split("\n").filter(Boolean).map((line) => line.split("\t") as [string, string])));
      },
    );
    child.stdin?.end(sql);
  });
}

export const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Lock tests (dose-locks, supplies-locks): proof that a call waited for a
 * transaction, with no clock involved. This machine's wall clock steps back
 * now and then, so an elapsed time (Date.now(), or the database's
 * clock_timestamp(), the same kernel clock) once read a 2 s wait as −291 ms.
 *
 * HOLD_FUNCTION, run first in the psql transaction, creates
 * pg_temp.hold_until_waited(seconds); holdUntilWaited(), run once the
 * transaction holds its locks, returns `waited` = t as soon as another
 * session is waiting on one of this transaction's locks (pg_blocking_pids),
 * or f after `seconds`; the script then goes on (commits). HOLDING is what
 * the test polls pg_stat_activity for before sending the concurrent call.
 */
export const HOLD_FUNCTION = `
  create function pg_temp.hold_until_waited(seconds float) returns boolean language plpgsql as $hold$
  declare
    tries integer := greatest(1, ceil(seconds / 0.05)::integer);
  begin
    for i in 1..tries loop
      if exists (select 1 from pg_stat_activity a where pg_backend_pid() = any (pg_blocking_pids(a.pid))) then
        return true;
      end if;
      perform pg_sleep(0.05);
    end loop;
    return false;
  end
  $hold$;`;

/** Back to the owner (pg_stat_activity in full), then hold until a session waits on this transaction: `waited`. */
export const holdUntilWaited = (seconds = 15) => `reset role; select 'waited', pg_temp.hold_until_waited(${seconds});`;

/** The statement holdUntilWaited() runs, as a LIKE pattern for pg_stat_activity.query. */
export const HOLDING = "%select ''waited'', pg_temp.hold_until_waited(%";

/** Waits until a psql session is running holdUntilWaited() inside its transaction (so it holds its locks). */
export async function holdingLocks() {
  for (let i = 0; i < 200; i++) {
    const out = psql(`select 'n', count(*) from pg_stat_activity where state = 'active' and query like '${HOLDING}' and pid <> pg_backend_pid();`);
    if (out.n !== "0") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The psql session never started holding its locks");
}

/** An instant as epoch microseconds (the database's precision), for exact comparison. */
export const micros = (iso: string) => (Temporal.Instant.from(iso).epochNanoseconds / BigInt(1000)).toString();

/** SQL for a timestamptz as epoch microseconds, matching `micros`. */
export const sqlMicros = (expression: string) => `(extract(epoch from ${expression}) * 1000000)::bigint::text`;

/** Deterministic pseudo-random numbers for reproducible cases. */
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
