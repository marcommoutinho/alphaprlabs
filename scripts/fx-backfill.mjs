// One-off backfill of Bank of Canada USD→CAD daily rates into public.fx_rates
// (the table the USD purchase form reads; src/lib/inventory/fx.ts). Uses the
// Supabase secret key, so it runs only where that key is available:
//
//   npm run fx:backfill -- --from 2025-01-01 [--to 2026-09-27]
//
// Locally it reads .env.local; for production run it with the production
// NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the environment. The
// deployed app can do the same through its cron route:
//   curl -H "Authorization: Bearer $CRON_SECRET" "https://<app host>/api/cron/fx-rates?from=2025-01-01"
//
// It asks the Valet API a year at a time and stores through store_fx_rates(),
// which validates every rate, adds new dates and keeps any date already stored
// (a different value is reported, never overwritten). Safe to run again.
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const VALET_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" } } });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
const from = values.from;
const to = values.to ?? today;
if (!from || !DATE.test(from) || !DATE.test(to) || from < "2000-01-01" || from > to) {
  console.error("Usage: npm run fx:backfill -- --from YYYY-MM-DD [--to YYYY-MM-DD]  (from 2000-01-01, not after --to)");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. in .env.local).");
  process.exit(1);
}
const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const addDays = (date, days) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const totals = { fetched: 0, stored: 0, unchanged: 0, invalid: 0, conflicts: [] };
for (let start = from; start <= to; start = addDays(start, 366)) {
  const end = addDays(start, 365) < to ? addDays(start, 365) : to;
  const response = await fetch(`${VALET_URL}?start_date=${start}&end_date=${end}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    console.error(`Bank of Canada ${start}..${end}: HTTP ${response.status}. Nothing more stored; run again.`);
    process.exit(1);
  }
  const body = await response.json();
  if (!Array.isArray(body?.observations)) {
    console.error(`Bank of Canada ${start}..${end}: unexpected answer. Nothing more stored; run again.`);
    process.exit(1);
  }
  // Only observations with a value; store_fx_rates validates each one.
  const rates = body.observations
    .filter((o) => typeof o?.d === "string" && typeof o?.FXUSDCAD?.v === "string" && o.FXUSDCAD.v !== "")
    .map((o) => ({ date: o.d, rate: o.FXUSDCAD.v }));
  totals.fetched += rates.length;
  if (rates.length === 0) continue;
  const { data, error } = await supabase.rpc("store_fx_rates", { p_rates: rates }).single();
  if (error) {
    console.error(`Storing ${start}..${end} failed: ${error.message}`);
    process.exit(1);
  }
  totals.stored += data.stored;
  totals.unchanged += data.unchanged;
  totals.invalid += data.invalid;
  totals.conflicts.push(...(data.conflicts ?? []));
  console.log(`${start}..${end}: ${rates.length} rates, ${data.stored} new, ${data.unchanged} already stored`);
}

console.log(
  `Done ${from}..${to}: ${totals.fetched} rates, ${totals.stored} new, ${totals.unchanged} already stored, ${totals.invalid} invalid.`,
);
if (totals.conflicts.length > 0) {
  console.error(`Different values for already stored dates (kept the stored ones): ${totals.conflicts.join(", ")}`);
  process.exit(2);
}
