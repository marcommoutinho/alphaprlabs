import { Suspense } from "react";
import { OverviewScreen } from "@/components/business/overview-screen";
import { OverviewSkeleton } from "@/components/business/overview-skeleton";
import { requireAdmin } from "@/lib/auth/session";
import { loadOverview } from "@/lib/business/load";
import { periodQuery, readPeriod, type Period } from "@/lib/business/period";
import { businessToday } from "@/lib/inventory/screens";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Business · Alpha PR Labs" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * A1 / A2 Business overview and A13 / D9 12 months (admins only; every read
 * is also checked in the database). `?range=week|12m`, or `?from=&to=` for a
 * custom range; this month to date by default. Dates are business dates in
 * America/Toronto; all figures are CAD.
 *
 * The skeleton is this page's own Suspense fallback, keyed by the period, not
 * a loading.tsx: with a route loading boundary here, Next.js 16.2 sometimes
 * never committed a period change (a tap on Week or 12 months fetched the new
 * page, then React stayed suspended until another tap; about 1 in 20 under
 * load, 0 in 300 without it). The Ledger's tabs, under their loading.tsx,
 * didn't show it (0 in 100).
 */
export default async function BusinessPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const today = businessToday();
  const period = readPeriod({ range: params.range, from: params.from, to: params.to }, today);
  const query = periodQuery(period);
  return (
    <Suspense key={query} fallback={<OverviewSkeleton />}>
      <Overview period={period} query={query} today={today} />
    </Suspense>
  );
}

async function Overview({ period, query, today }: { period: Period; query: string; today: string }) {
  const admin = await requireAdmin(`/admin/business${query ? `?${query}` : ""}`);
  const data = await loadOverview(await createClient(), period, today);
  return <OverviewScreen data={data} period={period} today={today} admin={{ name: admin.name }} />;
}
