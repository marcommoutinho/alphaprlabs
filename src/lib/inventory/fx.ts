// The Bank of Canada daily USD→CAD rate for USD purchases (tasks/research-app.md
// "Purchase currency decisions", Marco, 2026-09-27). Server-only: the rate a
// purchase is converted with is always fetched here, never taken from the
// browser. The purchase form's preview and the save both come through this
// module, and the save fetches again (the preview is display only).
//
// Source: the Valet API (public, no key), series FXUSDCAD, one observation per
// business day, published around 16:30 ET:
//   https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=…&end_date=…
//   → { "observations": [{ "d": "2026-08-26", "FXUSDCAD": { "v": "1.3876" } }, …] }
//
// Which rate: the one published for the date received, or else the latest one
// published before it within FX_LOOKBACK_DAYS (weekends, holidays, and a
// purchase dated today before today's rate is out). The rate's own date is
// returned and stored with the purchase, and the form says when it differs.
//
// Failures are never papered over: an unreachable, slow (FX_TIMEOUT_MS) or
// malformed answer is "unavailable" (the save is refused and can be retried),
// and a window without any rate is "no_rate". There is no fallback rate.
//
// Caching: a window ending at least FX_SETTLED_DAYS before today (Toronto) can
// no longer change, so Next's fetch cache keeps it (per URL, i.e. per date;
// only 200 answers are cached). A more recent window is fetched every time,
// since its rate may not be published yet.
import "server-only";
import { calendarDate } from "./rules";
import { businessToday } from "./screens";

export const VALET_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json";
/** How many days before the date received a rate may come from (the database checks the same bound). */
export const FX_LOOKBACK_DAYS = 10;
export const FX_TIMEOUT_MS = 8_000;
/** Windows ending this many days before today or earlier are final and cached. */
export const FX_SETTLED_DAYS = 2;
const CACHE_SECONDS = 30 * 24 * 60 * 60;

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

/** The observation window for a date: FX_LOOKBACK_DAYS before it through the date itself. */
export const fxWindow = (date: string) => ({ start: addDays(date, -FX_LOOKBACK_DAYS), end: date });

export const valetUrl = (date: string) => {
  const { start, end } = fxWindow(date);
  return `${VALET_URL}?start_date=${start}&end_date=${end}`;
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

/** The rate for `date`: its own, else the latest earlier one within the window; null when there is none. */
export function pickRate(rates: FxRate[], date: string): FxRate | null {
  const { start } = fxWindow(date);
  let best: FxRate | null = null;
  for (const rate of rates) {
    if (rate.rateDate > date || rate.rateDate < start) continue;
    if (!best || rate.rateDate > best.rateDate) best = rate;
  }
  return best;
}

export type FxDeps = {
  /** Injected in tests; defaults to the local test stub when enabled, else the real fetch. */
  fetch?: typeof fetch;
  /** Today in the business time zone (decides caching). */
  today?: string;
  timeoutMs?: number;
  env?: FxEnv;
};

/**
 * The Bank of Canada USD→CAD rate for a purchase received on `date`
 * (`YYYY-MM-DD`). Never throws for a network or data problem: it answers
 * `unavailable` (retry later) or `no_rate`.
 */
export async function usdCadRate(date: string, deps: FxDeps = {}): Promise<FxResult> {
  const day = calendarDate(date);
  if (!day) throw new RangeError(`Invalid date: ${date}`);
  const today = deps.today ?? businessToday();
  const stub = fxTestFetch(deps.env);
  if (stub === "refused") return { ok: false, reason: "unavailable" };
  const get = deps.fetch ?? stub ?? fetch;
  const settled = day <= addDays(today, -FX_SETTLED_DAYS);
  const url = valetUrl(day);

  let body: unknown;
  try {
    const response = await get(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(deps.timeoutMs ?? FX_TIMEOUT_MS),
      ...(settled ? { next: { revalidate: CACHE_SECONDS } } : { cache: "no-store" }),
    });
    if (!response.ok) {
      console.warn(`Bank of Canada rate for ${day}: HTTP ${response.status}`);
      return { ok: false, reason: "unavailable" };
    }
    body = await response.json();
  } catch (error) {
    console.warn(`Bank of Canada rate for ${day}: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, reason: "unavailable" };
  }
  const rates = parseObservations(body);
  if (!rates) {
    console.warn(`Bank of Canada rate for ${day}: unexpected answer`);
    return { ok: false, reason: "unavailable" };
  }
  const rate = pickRate(rates, day);
  return rate ? { ok: true, ...rate } : { ok: false, reason: "no_rate" };
}

// ── Local test stub ─────────────────────────────────────────────────────────
// Browser tests must not call the real Bank of Canada. BOC_FX_TEST_RATES holds
// a JSON map of dates to rates ({"2026-08-26":"1.3876"}; "unavailable" makes
// windows ending on that date answer HTTP 503), served as a Valet answer so
// the parsing and choice above run unchanged. It is honoured only against the
// local Supabase stack (the app's Supabase URL on 127.0.0.1 or localhost) and
// never on Vercel. Set anywhere else, it is refused and every rate is
// "unavailable": a misconfigured production refuses USD saves instead of
// using made-up rates.
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
    console.error("BOC_FX_TEST_RATES is set outside local testing: refusing every USD rate.");
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
    const observations = Object.entries(rates)
      .filter(([date, rate]) => date >= start && date <= end && rate !== "unavailable")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ d, FXUSDCAD: { v } }));
    return Response.json({ observations });
  }) as typeof fetch;
}
