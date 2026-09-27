// Runs SQL as the database owner with psql (the internal schedule functions
// are not callable through the API). Tests using it run in the
// integration-exclusive project (vitest.config.mts).
import { execFileSync } from "node:child_process";
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

export const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

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
