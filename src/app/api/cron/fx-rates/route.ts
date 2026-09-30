// Daily Bank of Canada USD→CAD sync into public.fx_rates (Marco, 2026-09-27;
// src/lib/inventory/fx.ts syncFxRates). Vercel Cron calls it once a day
// (vercel.json) with `Authorization: Bearer $CRON_SECRET`; anything else gets
// 401. It re-reads the last FX_SYNC_DAYS days, so a missed or duplicate run is
// harmless (stored rates are kept, new ones added). `?from=YYYY-MM-DD` reads
// from that date instead (a backfill), no earlier than 2025-01-01 and at most
// about two years back (earliestSyncFrom), so a run is at most two Valet
// requests within FX_SYNC_BUDGET_MS; older history goes through
// scripts/fx-backfill.mjs. Every answer is validated strictly (valet.mjs) and
// nothing is stored unless all of it is valid. Route handlers aren't cached
// (Next 16.2), and this one reads the request's headers, so every call runs.
import { cronAuthorized } from "@/lib/cron-auth";
import { syncFxRates } from "@/lib/inventory/fx";

export const dynamic = "force-dynamic";
/** Seconds; the sync's own budget (FX_SYNC_BUDGET_MS) is 45. Within Vercel's limits on every plan. */
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request, "Bank of Canada rate sync")) return Response.json({ error: "unauthorized" }, { status: 401 });

  const from = new URL(request.url).searchParams.get("from") ?? undefined;
  const result = await syncFxRates({ from });
  if (!result.ok) {
    console.error(`Bank of Canada rate sync ${result.from}..${result.to} failed: ${result.error}`);
    return Response.json(result, { status: result.error === "invalid from date" ? 400 : 502 });
  }
  return Response.json(result);
}
