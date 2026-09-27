// One-off backfill of Bank of Canada USD→CAD daily rates into public.fx_rates
// (the table the USD purchase form reads; src/lib/inventory/fx.ts). Uses the
// Supabase secret key, so it runs only where that key is available:
//
//   npm run fx:backfill -- --from 2025-01-01 [--to 2026-09-27]
//
// Locally it reads .env.local; for production run it with the production
// NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the environment. The
// deployed app can do the same for recent dates through its cron route:
//   curl -H "Authorization: Bearer $CRON_SECRET" "https://<app host>/api/cron/fx-rates?from=2025-01-01"
//
// It asks the Valet API a year at a time and validates every answer strictly
// with the app's own rules (src/lib/inventory/valet.mjs): any malformed,
// out-of-range or missing observation, or an empty answer for dates already
// published, fails the run before anything is stored. Then it stores through
// store_fx_rates(), which adds new dates and keeps any date already stored (a
// different value is reported, never overwritten). Safe to run again.
//
// Exit codes: 0 done; 1 bad arguments or settings, the Bank of Canada could
// not be read or answered something invalid (nothing stored), storing failed,
// or the database rejected rows; 2 the Bank of Canada now reports a different
// rate for dates already stored (the stored ones were kept; check them).
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { calendarDay, fetchValetRates, valetChunks, valetTestFetch, VALET_FIRST_DATE } from "../src/lib/inventory/valet.mjs";

const TIMEOUT_MS = 30_000;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let values;
try {
  ({ values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" } } }));
} catch (error) {
  fail(error.message);
}
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
const from = values.from;
const to = values.to ?? today;
if (!calendarDay(from) || !calendarDay(to) || from < VALET_FIRST_DATE || from > to || to > today) {
  fail(`Usage: npm run fx:backfill -- --from YYYY-MM-DD [--to YYYY-MM-DD]  (from ${VALET_FIRST_DATE}, when the series began, to today at most)`);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. in .env.local).");

// Local tests only (refused against any other database; see valet.mjs).
const stub = valetTestFetch(process.env);
if (stub === "refused") fail("BOC_FX_TEST_RATES is set but this isn't the local stack: nothing done.");

// 1. Read and validate everything first: a bad chunk stores nothing.
const fetched = await fetchValetRates(from, to, { fetch: stub ?? fetch, timeoutMs: TIMEOUT_MS, today });
if (!fetched.ok) fail(`${fetched.error}. Nothing was stored; run again later.`);

// 2. Store, a chunk at a time.
const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const totals = { stored: 0, unchanged: 0, invalid: 0, conflicts: [] };
for (const { start, end } of valetChunks(from, to)) {
  const rates = fetched.rates
    .filter((rate) => rate.rateDate >= start && rate.rateDate <= end)
    .map((rate) => ({ date: rate.rateDate, rate: rate.rate }));
  if (rates.length === 0) continue;
  const { data, error } = await supabase.rpc("store_fx_rates", { p_rates: rates }).single();
  if (error) fail(`Storing ${start}..${end} failed: ${error.message}`);
  totals.stored += data.stored;
  totals.unchanged += data.unchanged;
  totals.invalid += data.invalid;
  totals.conflicts.push(...(data.conflicts ?? []));
  console.log(`${start}..${end}: ${rates.length} rates, ${data.stored} new, ${data.unchanged} already stored`);
}

console.log(
  `Done ${from}..${to}: ${fetched.rates.length} rates, ${totals.stored} new, ${totals.unchanged} already stored, ${totals.invalid} rejected.`,
);
if (totals.invalid > 0) fail(`The database rejected ${totals.invalid} rate(s).`);
if (totals.conflicts.length > 0) {
  console.error(`Different values for already stored dates (kept the stored ones): ${totals.conflicts.join(", ")}`);
  process.exit(2);
}
