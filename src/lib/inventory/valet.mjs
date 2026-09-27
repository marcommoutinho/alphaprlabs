// The Bank of Canada Valet API (series FXUSDCAD): requests and their strict
// validation, shared by the app (src/lib/inventory/fx.ts: the save-time
// lookup and the daily sync route) and the terminal backfill
// (scripts/fx-backfill.mjs), so all three accept exactly the same answers.
// Plain JavaScript with no imports: Node runs it as is.
//
//   GET https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=…&end_date=…
//   → { "observations": [{ "d": "2026-08-26", "FXUSDCAD": { "v": "1.3876" } }, …], … }
//
// A range's answer is accepted only when it is exactly that: an object with an
// observations list, every observation a real calendar date INSIDE the range
// asked for (each date once) with a rate as published (above 0 and below 100,
// at most 6 decimals, as a string). Anything else fails the whole range; no
// entry is ever filtered out silently. An empty list fails too when the range
// has business days whose rate should already be out.

export const VALET_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json";
/** The series' first observation: nothing earlier exists. */
export const VALET_FIRST_DATE = "2017-01-03";
/** Longest range asked for in one request. */
export const VALET_CHUNK_DAYS = 366;
/**
 * An empty answer is an error when the range holds at least this many
 * weekdays already past. The Bank of Canada never closes 3 weekdays in a row
 * (at most Christmas and Boxing Day), so such a range always has a rate.
 */
export const EMPTY_RANGE_WEEKDAYS = 3;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATE = /^\d{1,2}(\.\d{1,6})?$/;

/**
 * The value when it is a real `YYYY-MM-DD` date, else null.
 * @param {unknown} value
 * @returns {string | null}
 */
export function calendarDay(value) {
  if (typeof value !== "string" || !DATE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

/**
 * `YYYY-MM-DD` plus `days` (calendar arithmetic, no time zone involved).
 * @param {string} date
 * @param {number} days
 * @returns {string}
 */
export function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * A rate as published: a string, above 0 and below 100, at most 6 decimals.
 * @param {unknown} value
 * @returns {value is string}
 */
export function validRate(value) {
  return typeof value === "string" && RATE.test(value) && /[1-9]/.test(value);
}

/**
 * @param {string} start
 * @param {string} end
 * @returns {string}
 */
export function valetRangeUrl(start, end) {
  return `${VALET_URL}?start_date=${start}&end_date=${end}`;
}

/**
 * Weekdays in `start`..`end` before `today` and not before the series began:
 * the days whose rate should already be published (holidays aside).
 * @param {string} start
 * @param {string} end
 * @param {string} today
 * @returns {number}
 */
export function pastWeekdays(start, end, today) {
  let count = 0;
  const first = start > VALET_FIRST_DATE ? start : VALET_FIRST_DATE;
  for (let date = first; date <= end && date < today; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

/** @typedef {{ rate: string, rateDate: string }} ValetRate */
/** @typedef {{ ok: true, rates: ValetRate[] } | { ok: false, error: string }} ValetRange */

/**
 * @param {string} error
 * @returns {{ ok: false, error: string }}
 */
const failure = (error) => ({ ok: false, error });

/**
 * The rates in a Valet answer for `start`..`end`, validated strictly (see the
 * top of this file); `today` (Toronto) decides whether an empty answer is
 * possible. Rates are kept exactly as published ("1.3760" stays "1.3760").
 * @param {unknown} body
 * @param {string} start
 * @param {string} end
 * @param {string} today
 * @returns {ValetRange}
 */
export function validateValetRange(body, start, end, today) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return failure("the answer is not a JSON object");
  const observations = /** @type {{ observations?: unknown }} */ (body).observations;
  if (!Array.isArray(observations)) return failure("the answer has no observations list");
  /** @type {ValetRate[]} */
  const rates = [];
  const seen = new Set();
  for (const [index, observation] of observations.entries()) {
    const what = `observation ${index + 1}`;
    if (typeof observation !== "object" || observation === null || Array.isArray(observation)) return failure(`${what} is not an object`);
    const { d, FXUSDCAD } = /** @type {{ d?: unknown, FXUSDCAD?: unknown }} */ (observation);
    const date = calendarDay(d);
    if (!date) return failure(`${what} has no valid date`);
    if (date < start || date > end) return failure(`${what} (${date}) is outside ${start}..${end}`);
    if (seen.has(date)) return failure(`${date} appears more than once`);
    seen.add(date);
    const value = typeof FXUSDCAD === "object" && FXUSDCAD !== null ? /** @type {{ v?: unknown }} */ (FXUSDCAD).v : undefined;
    if (!validRate(value)) return failure(`${date} has no valid rate`);
    rates.push({ rate: value, rateDate: date });
  }
  if (rates.length === 0 && pastWeekdays(start, end, today) >= EMPTY_RANGE_WEEKDAYS) {
    return failure(`no rates for ${start}..${end}, which has business days already published`);
  }
  return { ok: true, rates };
}

/**
 * The ranges of at most VALET_CHUNK_DAYS days covering `from`..`to`.
 * @param {string} from
 * @param {string} to
 * @returns {{ start: string, end: string }[]}
 */
export function valetChunks(from, to) {
  const chunks = [];
  for (let start = from; start <= to; start = addDays(start, VALET_CHUNK_DAYS)) {
    const last = addDays(start, VALET_CHUNK_DAYS - 1);
    chunks.push({ start, end: last < to ? last : to });
  }
  return chunks;
}

/**
 * @typedef {object} ValetOptions
 * @property {typeof fetch} [fetch] Defaults to the global fetch.
 * @property {number} timeoutMs For each request.
 * @property {string} today Toronto's date, for the empty-answer rule.
 * @property {number} [deadline] Epoch ms after which no request starts and running ones abort.
 */

/**
 * One request (no-store, timed out) for `start`..`end`, validated. Never throws.
 * @param {string} start
 * @param {string} end
 * @param {ValetOptions} options
 * @returns {Promise<ValetRange>}
 */
export async function fetchValetRange(start, end, options) {
  const get = options.fetch ?? fetch;
  const left = options.deadline === undefined ? options.timeoutMs : Math.min(options.timeoutMs, options.deadline - Date.now());
  if (left <= 0) return failure(`out of time before ${start}..${end}`);
  let body;
  try {
    const response = await get(valetRangeUrl(start, end), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(left),
      cache: "no-store",
    });
    if (!response.ok) return failure(`HTTP ${response.status}`);
    body = await response.json();
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
  return validateValetRange(body, start, end, options.today);
}

/**
 * Every rate from `from` to `to`, a chunk at a time; fails as a whole (naming
 * the chunk) if any chunk fails, so a caller stores all of it or nothing.
 * @param {string} from
 * @param {string} to
 * @param {ValetOptions} options
 * @returns {Promise<ValetRange & { chunks?: number }>}
 */
export async function fetchValetRates(from, to, options) {
  /** @type {ValetRate[]} */
  const rates = [];
  const chunks = valetChunks(from, to);
  for (const { start, end } of chunks) {
    const chunk = await fetchValetRange(start, end, options);
    if (!chunk.ok) return failure(`Bank of Canada ${start}..${end}: ${chunk.error}`);
    rates.push(...chunk.rates);
  }
  return { ok: true, rates, chunks: chunks.length };
}

// ── Local test stub ─────────────────────────────────────────────────────────
// Tests must not call the real Bank of Canada. BOC_FX_TEST_RATES holds a JSON
// map of dates to rates ({"2026-08-26":"1.3876"}), served as a Valet answer
// so the validation, choice and storing run unchanged; keys that aren't dates
// are ignored. A value of "unavailable" makes any request whose range ends on
// that date answer HTTP 503, and "invalid" a 200 maintenance page. It is
// honoured only against the local Supabase stack (the app's Supabase URL on
// 127.0.0.1 or localhost) and never on Vercel. Set anywhere else, it is
// refused and the Valet API is never asked: a misconfigured production stores
// no made-up rates and refuses USD saves the table can't serve.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
function localStack(env) {
  if (env.VERCEL) return false;
  try {
    return LOCAL_HOSTS.has(new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname);
  } catch {
    return false;
  }
}

/**
 * The stub fetch when BOC_FX_TEST_RATES is set and allowed, "refused" when set elsewhere, else null.
 * @param {Record<string, string | undefined>} env
 * @returns {typeof fetch | "refused" | null}
 */
export function valetTestFetch(env) {
  const raw = env.BOC_FX_TEST_RATES;
  if (!raw) return null;
  if (!localStack(env)) {
    console.error("BOC_FX_TEST_RATES is set outside local testing: refusing every Bank of Canada request.");
    return "refused";
  }
  /** @type {Record<string, string>} */
  let rates;
  try {
    rates = JSON.parse(raw);
  } catch {
    return "refused";
  }
  /** @param {RequestInfo | URL} input */
  const stub = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const start = url.searchParams.get("start_date") ?? "";
    const end = url.searchParams.get("end_date") ?? "";
    if (rates[end] === "unavailable") return new Response("Service Unavailable", { status: 503 });
    if (rates[end] === "invalid") return new Response("<html>Scheduled maintenance</html>", { status: 200 });
    const observations = Object.entries(rates)
      .filter(([date, value]) => calendarDay(date) && date >= start && date <= end && validRate(value))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ d, FXUSDCAD: { v } }));
    return Response.json({ observations });
  };
  return /** @type {typeof fetch} */ (stub);
}
