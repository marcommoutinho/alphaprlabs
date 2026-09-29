import { describe, expect, it } from "vitest";
import { money, percentOf } from "@/lib/alpha/format";
import {
  bestDayLine,
  bestMonthLine,
  marginLine,
  buyerShort,
  changeOf,
  changeWords,
  monthsCsv,
  monthsCsvFilename,
  MONTHS_CSV_HEADER,
  ordersLabel,
  periodOverview,
  sellerFirst,
  sellerShort,
  twelveMonths,
} from "@/lib/business/overview";
import {
  addDays,
  businessDate,
  checkCustomRange,
  CUSTOM_MAX_DAYS,
  datesOf,
  monthLength,
  monthStart,
  periodHeader,
  periodQuery,
  rangeLabel,
  readPeriod,
  sameDaysWindow,
  twelveMonths as twelveMonthStarts,
} from "@/lib/business/period";
import type { MonthTotals, StockLevel, Totals } from "@/lib/business/service";
import {
  attemptFor,
  settles,
  avgCost,
  DEFAULT_SORT,
  isLow,
  levelOf,
  lowItems,
  matchesSearch,
  parseThreshold,
  reorderLine,
  sortStock,
  stockTotals,
  vialCount,
} from "@/lib/business/stock";

const TODAY = "2026-09-24";
const NO_SALES: Totals = { sales: 0, vials: 0, revenue: "0.00", cost: "0.00", grossProfit: "0.00" };

describe("business periods (period.ts)", () => {
  it("reads Week, Month (the default), 12 months and a custom range from the URL", () => {
    expect(readPeriod({}, TODAY)).toEqual({ kind: "month", from: "2026-09-01", to: TODAY });
    expect(readPeriod({ range: "month" }, TODAY)).toEqual({ kind: "month", from: "2026-09-01", to: TODAY });
    expect(readPeriod({ range: "week" }, TODAY)).toEqual({ kind: "week", from: "2026-09-18", to: TODAY });
    expect(readPeriod({ range: "12m" }, TODAY)).toEqual({ kind: "12m", from: "2025-10-01", to: TODAY });
    expect(readPeriod({ from: "2026-09-15", to: "2026-09-24" }, TODAY)).toEqual({ kind: "custom", from: "2026-09-15", to: TODAY });
    // Anything invalid falls back to the month.
    expect(readPeriod({ range: "year" }, TODAY).kind).toBe("month");
    expect(readPeriod({ from: "2026-09-24", to: "2026-09-15" }, TODAY).kind).toBe("month");
    expect(readPeriod({ from: "2026-02-30", to: "2026-03-01" }, TODAY).kind).toBe("month");
    expect(readPeriod({ from: "2026-09-01", to: "2026-09-25" }, TODAY).kind).toBe("month");
    expect(readPeriod({ from: ["2026-09-01"], to: TODAY }, TODAY).kind).toBe("month");
  });

  it("Week crosses months and years; January's 12 months start in February", () => {
    expect(readPeriod({ range: "week" }, "2026-01-03")).toMatchObject({ from: "2025-12-28", to: "2026-01-03" });
    expect(readPeriod({ range: "12m" }, "2026-01-15")).toMatchObject({ from: "2025-02-01", to: "2026-01-15" });
    expect(twelveMonthStarts("2026-01-15")).toEqual([
      "2025-02-01",
      "2025-03-01",
      "2025-04-01",
      "2025-05-01",
      "2025-06-01",
      "2025-07-01",
      "2025-08-01",
      "2025-09-01",
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
    ]);
  });

  it("checks a custom range: both dates, in order, not after today, at most 92 days", () => {
    expect(checkCustomRange("", TODAY, TODAY)).toEqual({ ok: false, error: "Choose a start and an end date." });
    expect(checkCustomRange("2026-09-10", "2026-09-09", TODAY)).toMatchObject({ ok: false, error: expect.stringContaining("on or before") });
    expect(checkCustomRange("2026-09-10", "2026-09-25", TODAY)).toMatchObject({ ok: false, error: expect.stringContaining("after today") });
    const last = TODAY;
    const first = addDays(last, -(CUSTOM_MAX_DAYS - 1));
    expect(checkCustomRange(first, last, TODAY)).toEqual({ ok: true, range: { from: first, to: last } });
    expect(checkCustomRange(addDays(first, -1), last, TODAY)).toMatchObject({ ok: false, error: expect.stringContaining("92 days") });
    expect(checkCustomRange(TODAY, TODAY, TODAY)).toEqual({ ok: true, range: { from: TODAY, to: TODAY } });
  });

  it("only real calendar dates count", () => {
    expect(businessDate("2028-02-29")).toBe("2028-02-29");
    expect(businessDate("2026-02-29")).toBeNull();
    expect(businessDate("2026-9-4")).toBeNull();
    expect(businessDate(20260904)).toBeNull();
    expect(monthLength("2028-02-10")).toBe(29);
    expect(monthLength("2026-02-10")).toBe(28);
    expect(monthStart("2026-01-31", -1)).toBe("2025-12-01");
    expect(datesOf({ from: "2026-02-27", to: "2026-03-02" })).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });

  it("builds each period's URL query", () => {
    expect(periodQuery({ kind: "month", from: "2026-09-01", to: TODAY })).toBe("");
    expect(periodQuery({ kind: "week", from: "2026-09-18", to: TODAY })).toBe("range=week");
    expect(periodQuery({ kind: "12m", from: "2025-10-01", to: TODAY })).toBe("range=12m");
    expect(periodQuery({ kind: "custom", from: "2026-09-15", to: TODAY })).toBe("from=2026-09-15&to=2026-09-24");
  });

  describe("the same-days rule: days 1..d against the previous month's days 1..min(d, its length)", () => {
    const cases: [string, string, string][] = [
      ["2026-09-24", "2026-08-01", "2026-08-24"],
      ["2026-03-30", "2026-02-01", "2026-02-28"],
      ["2026-03-31", "2026-02-01", "2026-02-28"],
      ["2028-03-30", "2028-02-01", "2028-02-29"],
      ["2028-03-29", "2028-02-01", "2028-02-29"],
      ["2026-03-28", "2026-02-01", "2026-02-28"],
      ["2026-09-30", "2026-08-01", "2026-08-30"],
      ["2026-10-31", "2026-09-01", "2026-09-30"],
      ["2026-05-31", "2026-04-01", "2026-04-30"],
      ["2026-01-24", "2025-12-01", "2025-12-24"],
      ["2026-01-31", "2025-12-01", "2025-12-31"],
      ["2026-09-01", "2026-08-01", "2026-08-01"],
    ];
    it.each(cases)("%s compares with %s to %s", (today, from, to) => {
      const window = sameDaysWindow(today);
      expect(window.previous).toEqual({ from, to });
      expect(window.current).toEqual({ from: monthStart(today), to: today });
    });
  });

  it("labels ranges compactly and for headers", () => {
    expect(rangeLabel({ from: "2026-09-15", to: TODAY })).toBe("Sep 15–24");
    expect(rangeLabel({ from: "2026-08-28", to: "2026-09-03" })).toBe("Aug 28–Sep 3");
    expect(rangeLabel({ from: "2025-12-28", to: "2026-01-03" })).toBe("Dec 28–Jan 3");
    expect(rangeLabel({ from: TODAY, to: TODAY })).toBe("Sep 24");
    expect(rangeLabel({ from: "2026-09-15", to: TODAY }, "header")).toBe("Sep 15 – 24, 2026");
    expect(rangeLabel({ from: "2026-08-28", to: "2026-09-03" }, "header")).toBe("Aug 28 – Sep 3, 2026");
    expect(rangeLabel({ from: "2025-12-28", to: "2026-01-03" }, "header")).toBe("Dec 28, 2025 – Jan 3, 2026");
    expect(periodHeader({ kind: "12m", from: "2025-10-01", to: TODAY })).toBe("Oct 2025 – Sep 2026");
    expect(periodHeader({ kind: "month", from: "2026-09-01", to: TODAY })).toBe("Sep 1 – 24, 2026");
  });
});

describe("business money and shares (format.ts)", () => {
  it("money: dollars with cents, grouped, a true minus sign, half-up, never minus zero", () => {
    expect(money("3925")).toBe("$3,925.00");
    expect(money("1234567.891")).toBe("$1,234,567.89");
    expect(money("-40.14")).toBe("− $40.14");
    expect(money("0.005")).toBe("$0.01");
    expect(money("-0.004")).toBe("$0.00");
    expect(money("890.50", 0)).toBe("$891");
  });

  it("percentOf: one decimal, half-up, null without a whole, a minus sign on a loss", () => {
    expect(percentOf("3497.00", "3925.00")).toBe("89.1%");
    expect(percentOf("1", "8")).toBe("12.5%");
    expect(percentOf("-40.14", "100.00")).toBe("−40.1%");
    expect(percentOf("5", "0.00")).toBeNull();
  });
});

describe("business overview (overview.ts)", () => {
  it("changes read Up, Down or No change", () => {
    expect(changeOf("1500.00", "463.99")).toEqual({ direction: "up", amount: "1036.01" });
    expect(changeWords(changeOf("1500.00", "463.99"))).toBe("Up $1,036.01");
    expect(changeWords(changeOf("-40.00", "40.00"))).toBe("Down $80.00");
    expect(changeWords(changeOf("12.00", "12"))).toBe("No change");
  });

  it("shortens sellers and buyers as A1 / A2 show them", () => {
    expect(sellerShort("Priya Sandhu")).toBe("Priya S.");
    expect(sellerShort("Marco")).toBe("Marco");
    expect(sellerShort(null)).toBe("No seller");
    expect(sellerFirst("Priya Sandhu")).toBe("Priya");
    expect(buyerShort("Jordan Reyes")).toBe("J. Reyes");
    expect(buyerShort("A. Moreau")).toBe("A. Moreau");
    expect(buyerShort("Cher")).toBe("Cher");
    expect(buyerShort("Mary Anne Smith")).toBe("M. Anne Smith");
  });

  it("a month: zero-filled days, the best day, margin, split and today", () => {
    const period = readPeriod({}, TODAY);
    const view = periodOverview({
      period,
      today: TODAY,
      totals: { sales: 3, vials: 8, revenue: "1000.00", cost: "250.00", grossProfit: "750.00" },
      days: [
        { day: "2026-09-03", sales: 1, vials: 2, revenue: "200.00", cost: "50.00", grossProfit: "150.00" },
        { day: "2026-09-21", sales: 1, vials: 4, revenue: "400.00", cost: "100.00", grossProfit: "300.00" },
        { day: "2026-09-22", sales: 1, vials: 2, revenue: "400.00", cost: "100.00", grossProfit: "300.00" },
      ],
    });
    expect(view.days).toHaveLength(24);
    expect(view.days[0]).toMatchObject({ day: "2026-09-01", revenue: "0.00", height: 0, today: false });
    expect(view.days[2]).toMatchObject({ day: "2026-09-03", height: 0.5 });
    expect(view.days[23]).toMatchObject({ day: TODAY, today: true });
    // Equal days: the earliest is the best.
    expect(view.best).toEqual({ day: "2026-09-21", revenue: "400.00" });
    expect(bestDayLine(view)).toBe("best Sep 21 · $400.00");
    expect(view.max).toBe("400.00");
    expect(view.margin).toBe("75.0%");
    expect(view.profitShare).toBe(0.75);
    expect(view.avgPrice).toBe("125.00");
    expect(view.negative).toBe(false);
    expect(view.axis).toEqual(["Sep 1", "Today"]);
    expect(view.header).toBe("Sep 1 – 24, 2026");
  });

  it("a period with a loss or without sales", () => {
    const loss = periodOverview({
      period: { kind: "custom", from: "2026-08-28", to: "2026-09-03" },
      today: TODAY,
      totals: { sales: 1, vials: 3, revenue: "59.86", cost: "100.00", grossProfit: "-40.14" },
      days: [{ day: "2026-08-30", sales: 1, vials: 3, revenue: "59.86", cost: "100.00", grossProfit: "-40.14" }],
    });
    expect(loss.negative).toBe(true);
    expect(loss.margin).toBe("−67.1%");
    expect(loss.profitShare).toBe(0);
    expect(loss.avgPrice).toBe("19.95");
    expect(loss.axis).toEqual(["Aug 28", "Sep 3"]);

    const none = periodOverview({ period: readPeriod({ range: "week" }, TODAY), today: TODAY, totals: NO_SALES, days: [] });
    expect(none.days).toHaveLength(7);
    expect(none.best).toBeNull();
    expect(bestDayLine(none)).toBe("no sales yet");
    expect(none.margin).toBeNull();
    expect(none.profitShare).toBeNull();
    expect(none.avgPrice).toBeNull();
    expect(marginLine(none)).toBe("No sales in this period");
    expect(marginLine(loss)).toBe("−67.1% of revenue");
  });

  it("a period whose only sale is a free sample: sold, no revenue, a negative gross profit, no margin", () => {
    const sample = { sales: 1, vials: 1, revenue: "0.00", cost: "4.05", grossProfit: "-4.05" };
    const view = periodOverview({
      period: { kind: "custom", from: "2026-09-10", to: "2026-09-11" },
      today: TODAY,
      totals: sample,
      days: [{ day: "2026-09-10", ...sample }],
    });
    expect(view.negative).toBe(true);
    expect(money(view.totals.grossProfit)).toBe("− $4.05");
    // No share of no revenue: the margin is not a number, never a division by zero.
    expect(view.margin).toBeNull();
    expect(marginLine(view)).toBe("— of revenue");
    // All cost: the split bar draws no profit.
    expect(view.profitShare).toBe(0);
    expect(view.avgPrice).toBe("0.00");
    expect(view.best).toBeNull();
    expect(bestDayLine(view)).toBe("no revenue");
    expect(view.days.map((day) => day.height)).toEqual([0, 0]);
  });

  const month = (month: string, fields: Partial<MonthTotals> = {}): MonthTotals => ({
    month,
    sales: 0,
    vials: 0,
    revenue: "0.00",
    cost: "0.00",
    grossProfit: "0.00",
    purchases: "0.00",
    purchaseOrders: 0,
    ...fields,
  });
  const thirteen = () =>
    Array.from({ length: 13 }, (_, index) =>
      month(monthStart(TODAY, index - 12), {
        sales: 2,
        vials: 10,
        revenue: "1000.00",
        cost: "400.00",
        grossProfit: "600.00",
        purchases: "500.00",
        purchaseOrders: 1,
      }),
    );

  it("12 months: bars, changes (the current month on its same days), totals, best and purchases", () => {
    const rows = thirteen();
    rows[12] = month("2026-09-01", { sales: 1, vials: 4, revenue: "300.00", cost: "340.14", grossProfit: "-40.14" });
    rows[11] = month("2026-08-01", { sales: 3, vials: 20, revenue: "2000.00", cost: "500.00", grossProfit: "1500.00", purchases: "1000.00", purchaseOrders: 2 });
    rows[1] = month("2025-10-01", { revenue: "0.00", cost: "0.00", grossProfit: "0.00" });
    const window = sameDaysWindow(TODAY).previous;
    const view = twelveMonths({
      months: rows,
      sameDays: { previous: { sales: 1, vials: 5, revenue: "700.00", cost: "236.01", grossProfit: "463.99" }, window },
      suppliers: [{ key: "", name: null, orders: 12, total: "6000.00", currencies: [] }],
    });
    expect(view.header).toBe("Oct 2025 – Sep 2026");
    expect(view.months.map((m) => m.initial).join("")).toBe("ONDJFMAMJJAS");
    expect(view.months).toHaveLength(12);
    // The oldest shown month compares with the 13th row (Sep 2025).
    expect(view.months[0]).toMatchObject({ month: "2025-10-01", change: { direction: "down", amount: "600.00" }, barHeight: 0, costShare: 0 });
    expect(view.months[1].change).toEqual({ direction: "up", amount: "600.00" });
    expect(view.months[10]).toMatchObject({ label: "Aug", barHeight: 1, costShare: 0.25, purchasesHeight: 1, margin: "75.0%" });
    // A loss draws the bar all as cost, at the cost's height.
    const now = view.months[11];
    expect(now).toMatchObject({ current: true, label: "Sep", margin: "−13.4%", costShare: 1, purchasesHeight: 0 });
    expect(now.barHeight).toBeCloseTo(340.14 / 2000);
    expect(now.change).toEqual({ direction: "down", amount: "504.13" });
    expect(view.current).toMatchObject({
      name: "September",
      grossProfit: "-40.14",
      negative: true,
      vials: 4,
      vsLabel: "Aug 1–24",
      previousGrossProfit: "463.99",
      previousName: "August",
    });
    expect(view.totals).toEqual({ revenue: "11300.00", grossProfit: "6859.86", purchases: "5500.00" });
    expect(view.best).toEqual({ label: "Aug", revenue: "2000.00" });
    expect(view.noPurchases).toBe("none in Oct, Sep");
    expect(view.suppliers).toEqual([
      { name: null, total: "6000.00", share: 1, percent: "100.0%", percentWhole: "100%", currency: null, orders: 12 },
    ]);
  });

  it("12 months: named suppliers by total, the no-supplier group last; empty months", () => {
    const view = twelveMonths({
      months: thirteen().map((m, index) => (index % 2 ? m : { ...m, purchases: "0.00", purchaseOrders: 0 })),
      sameDays: { previous: NO_SALES, window: sameDaysWindow(TODAY).previous },
      suppliers: [
        { key: "", name: null, orders: 1, total: "900.00", currencies: [] },
        { key: "b", name: "Peptide Co", orders: 3, total: "1000.00", currencies: ["CAD"] },
        { key: "a", name: "Aurora Labs", orders: 14, total: "2100.00", currencies: ["USD", "CAD"] },
      ],
    });
    expect(view.suppliers.map((s) => s.name)).toEqual(["Aurora Labs", "Peptide Co", null]);
    expect(view.suppliers[0]).toMatchObject({ percent: "52.5%", percentWhole: "53%", currency: "CAD + USD" });
    expect(view.suppliers[2]).toMatchObject({ percent: "22.5%", currency: null });
    expect(view.noPurchases).toBe("none in 6 months");
    expect(ordersLabel(1)).toBe("1 order");
    expect(ordersLabel(1400)).toBe("1,400 orders");

    const quiet = twelveMonths({
      months: Array.from({ length: 12 }, (_, index) => month(monthStart(TODAY, index - 11))),
      sameDays: { previous: NO_SALES, window: sameDaysWindow(TODAY).previous },
      suppliers: [],
    });
    expect(quiet.best).toBeNull();
    expect(bestMonthLine(quiet)).toBe("no sales yet");
    // Only free samples this month: sold, but no revenue.
    const samples = twelveMonths({
      months: Array.from({ length: 12 }, (_, index) =>
        month(monthStart(TODAY, index - 11), index === 11 ? { sales: 2, vials: 2, cost: "8.10", grossProfit: "-8.10" } : {}),
      ),
      sameDays: { previous: NO_SALES, window: sameDaysWindow(TODAY).previous },
      suppliers: [],
    });
    expect(samples.best).toBeNull();
    expect(bestMonthLine(samples)).toBe("no revenue yet");
    expect(samples.current).toMatchObject({ grossProfit: "-8.10", negative: true, change: { direction: "down", amount: "8.10" } });
    expect(samples.months[11]).toMatchObject({ margin: null, costShare: 1, barHeight: 1 });
    expect(quiet.months.every((m) => m.barHeight === 0 && m.change.direction === "flat" && m.margin === null)).toBe(true);
    expect(quiet.suppliers).toEqual([]);
  });

  it("the month table exports as CSV, newest first, exact amounts, signed changes", () => {
    const rows = thirteen();
    rows[12] = month("2026-09-01", { sales: 1, vials: 4, revenue: "300.00", cost: "340.14", grossProfit: "-40.14" });
    const window = sameDaysWindow(TODAY).previous;
    const view = twelveMonths({
      months: rows,
      sameDays: { previous: { ...NO_SALES, grossProfit: "463.99" }, window },
      suppliers: [],
    });
    const csv = monthsCsv(view, window);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(14);
    expect(lines[13]).toBe("");
    expect(lines[0]).toBe(MONTHS_CSV_HEADER.join(","));
    expect(lines[1]).toBe("2026-09 (to date),4,300.00,340.14,-40.14,-13.4%,0.00,0,-504.13,2026-08-01 to 2026-08-24");
    expect(lines[2]).toBe("2026-08,10,1000.00,400.00,600.00,60.0%,500.00,1,0.00,2026-07");
    expect(lines[12]).toBe("2025-10,10,1000.00,400.00,600.00,60.0%,500.00,1,0.00,2025-09");
    expect(monthsCsvFilename(view)).toBe("alpha-business-months_2025-10_to_2026-09.csv");
  });
});

describe("business stock (stock.ts)", () => {
  let n = 0;
  const item = (name: string, strength: string, onHand: number, fields: Partial<StockLevel> = {}): StockLevel => ({
    id: `id-${++n}`,
    peptideId: `p-${name}`,
    peptideName: name,
    peptideAvailable: true,
    strengthMg: strength,
    label: `${name} · ${strength} mg`,
    onHand,
    valueAtCost: "0.00",
    sold30d: 0,
    threshold: 10,
    thresholdChangedAt: null,
    thresholdChangedBy: null,
    ...fields,
  });

  const items = [
    item("Retatrutide", "10", 24, { valueAtCost: "1044.00", sold30d: 9 }),
    item("BPC-157", "10", 4, { valueAtCost: "112.00", sold30d: 12 }),
    item("BPC-157", "5", 40, { valueAtCost: "600.00", sold30d: 2 }),
    item("CJC-1295", "2", 3, { valueAtCost: "40.00", sold30d: 1 }),
    item("TB-500", "5", 0, { threshold: 0 }),
    item("Semaglutide", "5", 12, { threshold: 15, valueAtCost: "301.00" }),
  ];

  it("low: fewer on hand than the threshold; a threshold of 0 never flags", () => {
    expect(isLow({ onHand: 9, threshold: 10 })).toBe(true);
    expect(isLow({ onHand: 10, threshold: 10 })).toBe(false);
    expect(isLow({ onHand: 0, threshold: 0 })).toBe(false);
    expect(lowItems(items).map((i) => i.label)).toEqual(["CJC-1295 · 2 mg", "BPC-157 · 10 mg", "Semaglutide · 5 mg"]);
    expect(reorderLine(1000)).toBe("Low · reorder at 1,000");
  });

  it("totals, average cost, level and counts", () => {
    expect(stockTotals(items)).toEqual({ vials: 83, value: "2097.00" });
    expect(avgCost(items[0])).toBe("43.50");
    expect(avgCost(items[5])).toBe("25.08");
    expect(avgCost(items[4])).toBeNull();
    expect(levelOf(items[2], items)).toBe(1);
    expect(levelOf(items[1], items)).toBe(0.1);
    expect(levelOf(items[0], [{ onHand: 0 }])).toBe(0);
    expect(vialCount(1)).toBe("1 vial");
    expect(vialCount(1200)).toBe("1,200 vials");
  });

  it("searches the name, the strength or the label", () => {
    expect(items.filter((i) => matchesSearch(i, "bpc")).map((i) => i.id)).toEqual([items[1].id, items[2].id]);
    expect(items.filter((i) => matchesSearch(i, "5 mg"))).toHaveLength(3);
    expect(items.filter((i) => matchesSearch(i, "BPC-157 · 10"))).toHaveLength(1);
    expect(items.filter((i) => matchesSearch(i, "  "))).toHaveLength(6);
    expect(items.filter((i) => matchesSearch(i, "ipamorelin"))).toHaveLength(0);
  });

  it("sorts: the default pins low items, then by name and strength; columns sort every row", () => {
    const labels = (sorted: StockLevel[]) => sorted.map((i) => i.label);
    expect(labels(sortStock(items, DEFAULT_SORT))).toEqual([
      "BPC-157 · 10 mg",
      "CJC-1295 · 2 mg",
      "Semaglutide · 5 mg",
      "BPC-157 · 5 mg",
      "Retatrutide · 10 mg",
      "TB-500 · 5 mg",
    ]);
    expect(labels(sortStock(items, { key: "item", direction: "desc" }))).toEqual([
      "TB-500 · 5 mg",
      "Semaglutide · 5 mg",
      "Retatrutide · 10 mg",
      "CJC-1295 · 2 mg",
      "BPC-157 · 10 mg",
      "BPC-157 · 5 mg",
    ]);
    expect(labels(sortStock(items, { key: "onHand", direction: "desc" }))[0]).toBe("BPC-157 · 5 mg");
    expect(sortStock(items, { key: "value", direction: "desc" }).map((i) => i.valueAtCost)).toEqual([
      "1044.00",
      "600.00",
      "301.00",
      "112.00",
      "40.00",
      "0.00",
    ]);
    expect(labels(sortStock(items, { key: "sold30d", direction: "desc" })).slice(0, 2)).toEqual(["BPC-157 · 10 mg", "Retatrutide · 10 mg"]);
    // Nothing on hand has no average cost: it sorts below every cost.
    expect(labels(sortStock(items, { key: "avgCost", direction: "asc" }))[0]).toBe("TB-500 · 5 mg");
    expect(labels(sortStock(items, { key: "avgCost", direction: "desc" }))[0]).toBe("Retatrutide · 10 mg");
  });

  it("a reorder-level submission keeps its request key until answered; another value or expected level is a new edit", () => {
    let n = 0;
    const newKey = () => `key-${++n}`;
    const first = attemptFor(null, 5, 10, newKey);
    expect(first).toEqual({ key: "key-1", value: 5, expected: 10 });
    // Retry, or Save again, with no answer yet: the same key (the server replays it if it was saved).
    expect(attemptFor(first, 5, 10, newKey)).toBe(first);
    // A different value is a new edit.
    const second = attemptFor(first, 6, 10, newKey);
    expect(second).toEqual({ key: "key-2", value: 6, expected: 10 });
    // Back to the first value after editing: still a new edit, never the old key for a newer intent.
    expect(attemptFor(second, 5, 10, newKey)).toEqual({ key: "key-3", value: 5, expected: 10 });
    // The same value over another level (after a refusal showed it): a new edit too.
    expect(attemptFor(first, 5, 8, newKey)).toEqual({ key: "key-4", value: 5, expected: 8 });
  });

  it("only a sure answer ends an attempt: saved, replayed or refused; an unsure one keeps its key", () => {
    type Answer = { error?: string; saved?: boolean; replayed?: boolean; unsure?: boolean; changed?: { threshold: number | null } };
    const sure: Answer[] = [
      { saved: true },
      { saved: true, replayed: true },
      { error: "This stock item no longer exists." },
      { error: "Changed by Owen Marchetti to 8. Nothing was saved.", changed: { threshold: 8 } },
    ];
    for (const answer of sure) expect(settles(answer)).toBe(true);
    // Maybe committed (a dropped connection, a gateway error): Retry or Save with 5 again replays the same key.
    const kept = { key: "key-1", value: 5, expected: 10 };
    const unsure = { error: "Couldn't save.", unsure: true };
    expect(settles(unsure)).toBe(false);
    expect(attemptFor(settles(unsure) ? null : kept, 5, 10, () => "key-2")).toBe(kept);
  });

  it("parses a threshold: a whole number of vials, 0 to 100,000", () => {
    expect(parseThreshold("12")).toEqual({ ok: true, value: 12 });
    expect(parseThreshold(" 0 ")).toEqual({ ok: true, value: 0 });
    expect(parseThreshold(100000)).toEqual({ ok: true, value: 100000 });
    expect(parseThreshold("100001")).toMatchObject({ ok: false, error: expect.stringContaining("at most 100,000") });
    for (const bad of ["", "-1", "2.5", "1e3", "ten", null, undefined, 1.5]) {
      expect(parseThreshold(bad)).toMatchObject({ ok: false, error: "Enter a whole number of vials, 0 or more." });
    }
  });
});
