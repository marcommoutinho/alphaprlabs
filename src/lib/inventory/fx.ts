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
// business day, published around 16:30 ET. Requests and their strict
// validation live in ./valet.mjs, shared with scripts/fx-backfill.mjs: an
// answer is used only when every observation is a real date inside the range
// asked for with a rate as published, and an empty answer is an error when
// the range has business days already past. Every request is
// `cache: "no-store"`: Next never caches a Valet answer. Only validated rates
// reach the table.
//
// Which rate: the stored one for the date received, or else the latest stored
// before it within FX_LOOKBACK_DAYS (weekends, holidays, and a purchase dated
// today before today's rate is out). When the table has none in that window,
// the Valet API is asked once for it; what it returns is validated, stored,
// and the stored rate is used. The rate's own date is returned and stored
// with the purchase, and the form says when it differs from the date received.
// The database accepts exactly this choice (record_business_purchase_fx: the
// latest stored rate in the window) and refuses an older one.
//
// Failures are never papered over: an unreachable database, or an
// unreachable, slow (FX_TIMEOUT_MS) or malformed Valet answer, is
// "unavailable" (the save is refused and can be retried); a window without
// any rate (before the series began, or only holidays and today) is
// "no_rate". There is no fallback rate.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { calendarDate } from "./rules";
import { businessToday } from "./screens";
import { addDays, fetchValetRange, fetchValetRates as fetchValetChunks, valetRangeUrl, valetTestFetch } from "./valet.mjs";

export { addDays, validateValetRange, valetRangeUrl, VALET_URL } from "./valet.mjs";

/** How many days before the date received a rate may come from (the database checks the same bound). */
export const FX_LOOKBACK_DAYS = 10;
export const FX_TIMEOUT_MS = 8_000;
/** The daily sync re-reads this many days back, so a late or missed run catches up. */
export const FX_SYNC_DAYS = 14;
/** The earliest `from` the sync route takes: 2025-01-01, and at most about two years back. */
export const FX_SYNC_EARLIEST = "2025-01-01";
export const FX_SYNC_MAX_DAYS = 730;
const SYNC_TIMEOUT_MS = 15_000;
/** The whole sync's Valet requests fit in this, well inside the route's maxDuration (60 s). */
export const FX_SYNC_BUDGET_MS = 45_000;

/** The environment variables read here (process.env by default). */
export type FxEnv = Record<string, string | undefined>;

export type FxRate = { rate: string; rateDate: string };
export type FxResult = ({ ok: true } & FxRate) | { ok: false; reason: "unavailable" | "no_rate" };

/** The window a date's rate may come from: FX_LOOKBACK_DAYS before it through the date itself. */
export const fxWindow = (date: string) => ({ start: addDays(date, -FX_LOOKBACK_DAYS), end: date });

/** The Valet request for a date's window. */
export const valetUrl = (date: string) => {
  const { start, end } = fxWindow(date);
  return valetRangeUrl(start, end);
};

/**
 * The rate for `date`: its own, else the latest earlier one within the window;
 * null when there is none. The same choice the table lookup makes in SQL
 * (databaseFxStore.latest) and record_business_purchase_fx enforces.
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
  /** Toronto's date (businessToday); injected in tests. */
  today?: string;
};

/** The fetch to use: the injected one, else the local stub when allowed, else the real one; null when the stub is refused. */
function valetFetch(deps: FxDeps): typeof fetch | null {
  const stub = fxTestFetch(deps.env);
  if (stub === "refused") return null;
  return deps.fetch ?? stub ?? fetch;
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

  const get = valetFetch(deps);
  if (!get) return { ok: false, reason: "unavailable" };
  const fetched = await fetchValetRange(start, day, {
    fetch: get,
    timeoutMs: deps.timeoutMs ?? FX_TIMEOUT_MS,
    today: deps.today ?? businessToday(),
  });
  if (!fetched.ok) {
    console.warn(`Bank of Canada rates ${start}..${day}: ${fetched.error}`);
    return { ok: false, reason: "unavailable" };
  }
  if (fetched.rates.length === 0) return { ok: false, reason: "no_rate" };
  try {
    logSummary(`Bank of Canada rate for ${day}`, await store.save(fetched.rates));
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

/** The earliest `from` the sync takes on `today`: FX_SYNC_EARLIEST, and no more than FX_SYNC_MAX_DAYS back. */
export function earliestSyncFrom(today: string): string {
  const back = addDays(today, -FX_SYNC_MAX_DAYS);
  return back > FX_SYNC_EARLIEST ? back : FX_SYNC_EARLIEST;
}

/**
 * The daily sync (and the route's `?from=` backfill): fetches the Valet rates
 * dated `from` (default FX_SYNC_DAYS before today, Toronto; never before
 * earliestSyncFrom) through today, a year at a time within FX_SYNC_BUDGET_MS,
 * validates them strictly (./valet.mjs) and stores them (store_fx_rates: new
 * dates added, stored ones kept). Idempotent. Nothing is stored unless every
 * range was fetched and valid. Older history: scripts/fx-backfill.mjs.
 */
export async function syncFxRates(options: { from?: string } & FxDeps = {}): Promise<FxSyncResult> {
  const to = options.today ?? businessToday();
  const from = options.from ?? addDays(to, -FX_SYNC_DAYS);
  if (!calendarDate(from) || from < earliestSyncFrom(to) || from > to) return { ok: false, from, to, error: "invalid from date" };
  const get = valetFetch(options);
  if (!get) return { ok: false, from, to, error: "the Bank of Canada test stub is refused here" };
  const fetched = await fetchValetChunks(from, to, {
    fetch: get,
    timeoutMs: options.timeoutMs ?? SYNC_TIMEOUT_MS,
    today: to,
    deadline: Date.now() + FX_SYNC_BUDGET_MS,
  });
  if (!fetched.ok) return { ok: false, from, to, error: fetched.error };
  if (fetched.rates.length === 0) return { ok: true, from, to, fetched: 0, stored: 0, unchanged: 0, invalid: 0, conflicts: [] };
  try {
    const summary = await (options.store ?? defaultStore()).save(fetched.rates);
    logSummary(`Bank of Canada sync ${from}..${to}`, summary);
    return { ok: true, from, to, fetched: fetched.rates.length, ...summary };
  } catch (error) {
    return { ok: false, from, to, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The local test stub (./valet.mjs valetTestFetch): the stub fetch, "refused", or null when not set. */
export function fxTestFetch(env: FxEnv = process.env): typeof fetch | "refused" | null {
  return valetTestFetch(env);
}
