import { AppPage } from "@/components/app-shell/app-shell";
import { SalesReportView } from "@/components/admin/inventory-views";
import { SalesFilters } from "@/components/admin/sales-filters";
import { requireAdmin } from "@/lib/auth/session";
import { salesPeriodRange } from "@/lib/inventory/rules";
import { businessToday, salesPeriodOf } from "@/lib/inventory/screens";
import { listSellerTotals } from "@/lib/inventory/sellers";
import { listBuyerAccounts, listSales, listStock } from "@/lib/inventory/service";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * A7 Sales & gross profit (admins only). Filters come from the URL:
 * `period` (month = this month, prev = last month, else all time; months in
 * the business time zone) and `item` (a stock item, else all). The per-seller
 * totals use the same period and item. An outside buyer's sale in the list
 * offers "Link to account…", so the accounts are loaded only when one is listed.
 */
export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("/admin/sales");
  const params = await searchParams;
  const period = salesPeriodOf(params.period);
  const db = await createClient();
  const stock = await listStock(db);
  const item = stock.find((entry) => entry.id === params.item) ?? null;
  const filter = { ...salesPeriodRange(period, businessToday()), stockItemId: item?.id ?? null };
  const [report, sellers] = await Promise.all([listSales(db, filter), listSellerTotals(db, filter)]);
  const linkAccounts = report.sales.some((sale) => sale.buyerType === "outside") ? await listBuyerAccounts(db) : undefined;

  return (
    <AppPage>
      <SalesFilters period={period} item={item?.id ?? ""} items={stock.map((entry) => ({ id: entry.id, label: entry.label }))}>
        <SalesReportView
          report={report}
          sellers={sellers}
          linkAccounts={linkAccounts}
          itemLabels={new Map(stock.map((entry) => [entry.id, entry.label]))}
        />
      </SalesFilters>
    </AppPage>
  );
}
