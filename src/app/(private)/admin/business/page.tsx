import { OverviewScreen } from "@/components/business/overview-screen";
import { requireAdmin } from "@/lib/auth/session";
import { loadOverview } from "@/lib/business/load";
import { periodQuery, readPeriod } from "@/lib/business/period";
import { businessToday } from "@/lib/inventory/screens";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Business · Alpha PR Labs" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * A1 / A2 Business overview and A13 / D9 12 months (admins only; every read
 * is also checked in the database). `?range=week|12m`, or `?from=&to=` for a
 * custom range; this month to date by default. Dates are business dates in
 * America/Toronto; all figures are CAD.
 */
export default async function BusinessPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const today = businessToday();
  const period = readPeriod({ range: params.range, from: params.from, to: params.to }, today);
  const query = periodQuery(period);
  const admin = await requireAdmin(`/admin/business${query ? `?${query}` : ""}`);
  const data = await loadOverview(await createClient(), period, today);
  return <OverviewScreen data={data} period={period} today={today} admin={{ name: admin.name }} />;
}
