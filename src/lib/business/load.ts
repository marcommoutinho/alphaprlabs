import "server-only";
import { listSellerTotals, type SellerTotals } from "@/lib/inventory/sellers";
import type { Db, SaleRecord } from "@/lib/inventory/service";
import { periodOverview, twelveMonths, type PeriodOverview, type TwelveMonths } from "./overview";
import { monthStart, sameDaysWindow, type DateRange, type Period } from "./period";
import { businessMonths, listStockLevels, purchaseSuppliers, recentSales, salesByDay, salesSummary, type StockLevel } from "./service";

/** A1 / A2 show this many of the newest sales. */
export const RECENT_SALES = 3;

export type OverviewData =
  | { kind: "period"; overview: PeriodOverview; stock: StockLevel[]; recent: SaleRecord[]; sellers: SellerTotals[] }
  | { kind: "12m"; months: TwelveMonths; sameDays: DateRange; stock: StockLevel[] };

/** Every read one Business view needs, in parallel (admins only: each read checks in the database too). */
export async function loadOverview(db: Db, period: Period, today: string): Promise<OverviewData> {
  if (period.kind === "12m") {
    const window = sameDaysWindow(today);
    const [months, previous, suppliers, stock] = await Promise.all([
      // 13 months: the one before the first shown gives the oldest its change.
      businessMonths(db, { from: monthStart(today, -12), to: today }),
      salesSummary(db, window.previous),
      purchaseSuppliers(db, { from: monthStart(today, -11), to: today }),
      listStockLevels(db, today),
    ]);
    return {
      kind: "12m",
      months: twelveMonths({ months, sameDays: { previous, window: window.previous }, suppliers }),
      sameDays: window.previous,
      stock,
    };
  }
  const range = { from: period.from, to: period.to };
  const [totals, days, stock, recent, sellers] = await Promise.all([
    salesSummary(db, range),
    salesByDay(db, range),
    listStockLevels(db, today),
    recentSales(db, RECENT_SALES),
    listSellerTotals(db, range),
  ]);
  return { kind: "period", overview: periodOverview({ period, today, totals, days }), stock, recent, sellers };
}

/** D9's month table only (Export CSV). */
export async function loadTwelveMonths(db: Db, today: string): Promise<{ months: TwelveMonths; sameDays: DateRange }> {
  const window = sameDaysWindow(today);
  const [months, previous, suppliers] = await Promise.all([
    businessMonths(db, { from: monthStart(today, -12), to: today }),
    salesSummary(db, window.previous),
    purchaseSuppliers(db, { from: monthStart(today, -11), to: today }),
  ]);
  return { months: twelveMonths({ months, sameDays: { previous, window: window.previous }, suppliers }), sameDays: window.previous };
}
