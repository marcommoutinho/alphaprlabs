import { AppPage } from "@/components/app-shell/app-shell";
import { SalesReportView } from "@/components/admin/inventory-views";
import { SalesFilters } from "@/components/admin/sales-filters";
import { requireAdmin } from "@/lib/auth/session";
import { salesPeriodRange } from "@/lib/inventory/rules";
import { businessToday, salesPeriodOf } from "@/lib/inventory/screens";
import { listSales, listStock } from "@/lib/inventory/service";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * A7 Sales & gross profit (admins only). Filters come from the URL:
 * `period` (month = this month, prev = last month, else all time; months in
 * the business time zone) and `item` (a stock item, else all).
 */
export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("/admin/sales");
  const params = await searchParams;
  const period = salesPeriodOf(params.period);
  const db = await createClient();
  const stock = await listStock(db);
  const item = stock.find((entry) => entry.id === params.item) ?? null;
  const report = await listSales(db, { ...salesPeriodRange(period, businessToday()), stockItemId: item?.id ?? null });

  return (
    <AppPage>
      <SalesFilters period={period} item={item?.id ?? ""} items={stock.map((entry) => ({ id: entry.id, label: entry.label }))}>
        <SalesReportView report={report} itemLabels={new Map(stock.map((entry) => [entry.id, entry.label]))} />
      </SalesFilters>
    </AppPage>
  );
}
