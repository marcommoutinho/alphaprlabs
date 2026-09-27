// The Bank of Canada daily USD→CAD rate for USD purchases (tasks/research-app.md
// "Purchase currency decisions", Marco, 2026-09-27). Server-only: the rate a
// purchase is converted with is always chosen here, never taken from the
// browser. The purchase form's preview and the save both come through
// usdCadRate, and the save looks the rate up again (the preview is display only).
//
// Where rates live (Marco, 2026-09-27): our own table, public.fx_rates
// (supabase/migrations/20260927140000_purchase_currency.sql), so saving
// doesn't depend on the Bank of Canada being up. It is filled by the daily
// cron (src/app/api/cron/fx-rates/route.ts → syncFxRates), the one-off
// backfill (scripts/fx-backfill.mjs) and, as a fallback, by usdCadRate itself.
// Writes go only through store_fx_rates(), with the secret key.
//
// Source: the Valet API (public, no key), series FXUSDCAD, one observation per
// business day, published around 16:30 ET:
//   https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=…&end_date=…
//   → { "observations": [{ "d": "2026-08-26", "FXUSDCAD": { "v": "1.3876" } }, …] }
// Every request is `cache: "no-store"`: Next never caches a Valet answer
// (it would keep any 200, a maintenance page included, before validation).
// Only validated rates reach the table.
//
// Which rate: the stored one for the date received, or else the latest stored
// before it within FX_LOOKBACK_DAYS (weekends, holidays, and a purchase dated
// today before today's rate is out). When the table has none in that window,
// the Valet API is asked once for it; what it returns is validated, stored,
// and the stored rate is used. The rate's own date is returned and stored
// with the purchase, and the form says when it differs from the date received.
//
// Failures are never papered over: an unreachable database, or an
// unreachable, slow (FX_TIMEOUT_MS) or malformed Valet answer, is
// "unavailable" (the save is refused and can be retried); a window without
// any rate is "no_rate". There is no fallback rate.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { calendarDate } from "./rules";
import { businessToday } from "./screens";

export const VALET_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json";
/** How many days before the date received a rate may come from (the database checks the same bound). */
export const FX_LOOKBACK_DAYS = 10;
export const FX_TIMEOUT_MS = 8_000;
/** The daily sync re-reads this many days back, so a late or missed run catches up. */
export const FX_SYNC_DAYS = 14;
/** Longest range asked of Valet in one request (backfill). */
const SYNC_CHUNK_DAYS = 366;
const SYNC_TIMEOUT_MS = 20_000;

/** The environment variables read here (process.env by default). */
export type FxEnv = Record<string, string | undefined>;

export type FxRate = { rate: string; rateDate: string };
export type FxResult = ({ ok: true } & FxRate) | { ok: false; reason: "unavailable" | "no_rate" };

/** A rate as published: above 0 and below 100, at most 6 decimals (the database's parse_fx_rate). */
const RATE = /^\d{1,2}(\.\d{1,6})?$/;

/** `YYYY-MM-DD` plus `days` (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The window a date's rate may come from: FX_LOOKBACK_DAYS before it through the date itself. */
export const fxWindow = (date: string) => ({ start: addDays(date, -FX_LOOKBACK_DAYS), end: date });

export const valetRangeUrl = (start: string, end: string) => `${VALET_URL}?start_date=${start}&end_date=${end}`;

/** The Valet request for a date's window. */
export const valetUrl = (date: string) => {
  const { start, end } = fxWindow(date);
  return valetRangeUrl(start, end);
};

/**
 * The rates in a Valet answer, or null when it isn't one (no observations
 * list, a bad date, or a malformed rate). An observation without a FXUSDCAD
 * value is skipped: it carries no rate.
 */
export function parseObservations(body: unknown): FxRate[] | null {
  const observations = (body as { observations?: unknown } | null)?.observations;
  if (!Array.isArray(observations)) return null;
  const rates: FxRate[] = [];
  for (const observation of observations) {
    const date = calendarDate((observation as { d?: unknown } | null)?.d);
    if (!date) return null;
    const value = (observation as { FXUSDCAD?: { v?: unknown } }).FXUSDCAD?.v;
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !RATE.test(value) || !/[1-9]/.test(value)) return null;
    rates.push({ rate: value, rateDate: date });
  }
  return rates;
}

/**
 * The rate for `date`: its own, else the latest earlier one within the window;
 * null when there is none. The same choice the table lookup makes in SQL
 * (databaseFxStore.latest).
 */
export function pickRate(rates: FxRate[], date: string): FxRate | null {
  const { start } = fxWindow(date);
  let best: FxRate | null = null;
  for (const rate of rates) {
    if (rate.rateDate > date || rate.rateDate < start) continue;
    if (!best || rate.rateDate > best.rateDate) best = rate;
  }
  return best;
}

// ── Our table ──────────────────────────────────────────────────────────────
export type FxStoreSummary = { stored: number; unchanged: number; invalid: number; conflicts: string[] };

/** Where rates are kept (public.fx_rates); injectable for tests. */
export type FxStore = {
  /** The latest stored rate dated `start`..`end` (inclusive), or null. */
  latest(start: string, end: string): Promise<FxRate | null>;
  /** Stores rates through store_fx_rates (first value per date wins). */
  save(rates: FxRate[]): Promise<FxStoreSummary>;
};

/** public.fx_rates through a secret-key client: reads, and writes via store_fx_rates only. */
export function databaseFxStore(db: SupabaseClient<Database>): FxStore {
  return {
    async latest(start, end) {
      const { data, error } = await db
        .from("fx_rates")
        .select("rate_date, usd_cad::text")
        .gte("rate_date", start)
        .lte("rate_date", end)
        .order("rate_date", { ascending: false })
        .limit(1)
        .overrideTypes<{ rate_date: string; usd_cad: string }[], { merge: false }>();
      if (error) throw new Error(`Could not read stored rates: ${error.message}`);
      return data[0] ? { rate: data[0].usd_cad, rateDate: data[0].rate_date } : null;
    },
    async save(rates) {
      const { data, error } = await db
        .rpc("store_fx_rates", { p_rates: rates.map((rate) => ({ date: rate.rateDate, rate: rate.rate })) })
        .single();
      if (error) throw new Error(`Could not store rates: ${error.message}`);
      return { stored: data.stored, unchanged: data.unchanged, invalid: data.invalid, conflicts: data.conflicts ?? [] };
    },
  };
}

const defaultStore = () => databaseFxStore(createAdminClient());

function logSummary(what: string, summary: FxStoreSummary) {
  if (summary.conflicts.length > 0) {
    console.error(
      `${what}: the Bank of Canada now reports different rates for ${summary.conflicts.join(", ")}; the first stored rates were kept. Check them.`,
    );
  }
  if (summary.invalid > 0) console.error(`${what}: ${summary.invalid} invalid rate(s) were not stored.`);
}

export type FxDeps = {
  /** Injected in tests; defaults to the local test stub when enabled, else the real fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  env?: FxEnv;
  /** Defaults to public.fx_rates with the secret key. */
  store?: FxStore;
};

/** The validated Valet rates dated `start`..`end` (one no-store request), or null when unavailable. */
export async function fetchValetRates(start: string, end: string, deps: FxDeps = {}): Promise<FxRate[] | null> {
  const stub = fxTestFetch(deps.env);
  if (stub === "refused") return null;
  const get = deps.fetch ?? stub ?? fetch;
  let body: unknown;
  try {
    const response = await get(valetRangeUrl(start, end), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(deps.timeoutMs ?? FX_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn(`Bank of Canada rates ${start}..${end}: HTTP ${response.status}`);
      return null;
    }
    body = await response.json();
  } catch (error) {
    console.warn(`Bank of Canada rates ${start}..${end}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const rates = parseObservations(body);
  if (!rates) {
    console.warn(`Bank of Canada rates ${start}..${end}: unexpected answer`);
    return null;
  }
  return rates.filter((rate) => rate.rateDate >= start && rate.rateDate <= end);
}

/**
 * The Bank of Canada USD→CAD rate for a purchase received on `date`
 * (`YYYY-MM-DD`), from our table; the Valet API is asked (once) only when
 * the table has no rate in the date's window. Never throws for a network,
 * database or data problem: it answers `unavailable` (retry later) or `no_rate`.
 */
export async function usdCadRate(date: string, deps: FxDeps = {}): Promise<FxResult> {
  const day = calendarDate(date);
  if (!day) throw new RangeError(`Invalid date: ${date}`);
  const { start } = fxWindow(day);
  let store: FxStore;
  try {
    store = deps.store ?? defaultStore();
    const stored = await store.latest(start, day);
    if (stored) return { ok: true, ...stored };
  } catch (error) {
    console.error(`Bank of Canada rate for ${day}: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, reason: "unavailable" };
  }

  const fetched = await fetchValetRates(start, day, deps);
  if (!fetched) return { ok: false, reason: "unavailable" };
  if (fetched.length === 0) return { ok: false, reason: "no_rate" };
  try {
    logSummary(`Bank of Canada rate for ${day}`, await store.save(fetched));
    // The stored rate, which is the first one ever stored for its date.
    const stored = await store.latest(start, day);
    return stored ? { ok: true, ...stored } : { ok: false, reason: "no_rate" };
  } catch (error) {
    console.error(`Bank of Canada rate for ${day}: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, reason: "unavailable" };
  }
}

export type FxSyncResult =
  | ({ ok: true; from: string; to: string; fetched: number } & FxStoreSummary)
  | { ok: false; from: string; to: string; error: string };

/**
 * The daily sync and the backfill: fetches the Valet rates dated `from`
 * (default FX_SYNC_DAYS before today, Toronto) through today, in ranges of at
 * most a year, validates them and stores them (store_fx_rates: new dates
 * added, stored ones kept). Idempotent. Nothing is stored unless every range
 * was fetched and valid.
 */
export async function syncFxRates(options: { from?: string; today?: string } & FxDeps = {}): Promise<FxSyncResult> {
  const to = options.today ?? businessToday();
  const from = options.from ?? addDays(to, -FX_SYNC_DAYS);
  if (!calendarDate(from) || from < "2000-01-01" || from > to) return { ok: false, from, to, error: "invalid from date" };
  const rates: FxRate[] = [];
  for (let start = from; start <= to; start = addDays(start, SYNC_CHUNK_DAYS)) {
    const end = addDays(start, SYNC_CHUNK_DAYS - 1) < to ? addDays(start, SYNC_CHUNK_DAYS - 1) : to;
    const chunk = await fetchValetRates(start, end, { timeoutMs: SYNC_TIMEOUT_MS, ...options });
    if (!chunk) return { ok: false, from, to, error: `the Bank of Canada could not be read for ${start}..${end}` };
    rates.push(...chunk);
  }
  if (rates.length === 0) return { ok: true, from, to, fetched: 0, stored: 0, unchanged: 0, invalid: 0, conflicts: [] };
  try {
    const summary = await (options.store ?? defaultStore()).save(rates);
    logSummary(`Bank of Canada sync ${from}..${to}`, summary);
    return { ok: true, from, to, fetched: rates.length, ...summary };
  } catch (error) {
    return { ok: false, from, to, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Local test stub ─────────────────────────────────────────────────────────
// Tests must not call the real Bank of Canada. BOC_FX_TEST_RATES holds a JSON
// map of dates to rates ({"2026-08-26":"1.3876"}), served as a Valet answer
// so the parsing, choice and storing above run unchanged; keys that aren't
// dates are ignored. A value of "unavailable" makes any request whose range
// ends on that date answer HTTP 503, and "invalid" a 200 maintenance page.
// It is honoured only against the local Supabase stack (the app's Supabase
// URL on 127.0.0.1 or localhost) and never on Vercel. Set anywhere else, it
// is refused and the Valet API is never asked: a misconfigured production
// stores no made-up rates and refuses USD saves the table can't serve.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function localStack(env: FxEnv): boolean {
  if (env.VERCEL) return false;
  try {
    return LOCAL_HOSTS.has(new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname);
  } catch {
    return false;
  }
}

/** The stub fetch when BOC_FX_TEST_RATES is set and allowed, "refused" when set elsewhere, else null. */
export function fxTestFetch(env: FxEnv = process.env): typeof fetch | "refused" | null {
  const raw = env.BOC_FX_TEST_RATES;
  if (!raw) return null;
  if (!localStack(env)) {
    console.error("BOC_FX_TEST_RATES is set outside local testing: refusing every Bank of Canada request.");
    return "refused";
  }
  let rates: Record<string, string>;
  try {
    rates = JSON.parse(raw) as Record<string, string>;
  } catch {
    return "refused";
  }
  return (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const start = url.searchParams.get("start_date") ?? "";
    const end = url.searchParams.get("end_date") ?? "";
    if (rates[end] === "unavailable") return new Response("Service Unavailable", { status: 503 });
    if (rates[end] === "invalid") return new Response("<html>Scheduled maintenance</html>", { status: 200 });
    const observations = Object.entries(rates)
      .filter(([date, value]) => calendarDate(date) && date >= start && date <= end && RATE.test(value))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ d, FXUSDCAD: { v } }));
    return Response.json({ observations });
  }) as typeof fetch;
}
