// V5 Business (20260928150000_business_overview.sql) as the database owner
// (psql), against the real local Supabase:
//   * every Business aggregate is exact and complete over 1,210 sales
//     (committed) in a past year no other test uses (Dec of the year before
//     through Dec): CAD and USD purchases, buyers with accounts, outside
//     buyers and one linked since, two sellers, a month sold at a loss. The
//     expected figures are computed here, independently, by replaying the
//     recorded order through FIFO with decimal.js;
//   * the same-days rule over month-length edges (Mar 30 against Feb, Jan
//     against Dec);
//   * the append-only guard's new exception lets only the threshold change,
//     only for the item set_business_stock_threshold marked (rolled back);
//   * the migration applies on top of recorded stock (rolled back).
// Runs in the integration-exclusive project (vitest.config.mts): the
// rehearsal drops and re-adds a business_stock_items column in its
// transaction.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOverview, loadTwelveMonths } from "@/lib/business/load";
import { addDays, datesOf, monthStart, sameDaysWindow, type DateRange } from "@/lib/business/period";
import { businessMonths, listStockLevels, purchaseSuppliers, salesByDay, salesSummary, type Totals } from "@/lib/business/service";
import { linkSale, listSellerTotals } from "@/lib/inventory/sellers";
import { recordPurchase } from "@/lib/inventory/service";
import { mulberry32, psql, quote } from "../support/psql";
import { previewedLotsSql } from "../support/sales";
import { ensureAccount, ok, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";
import { savePeptideAs } from "../support/admin-writers";

const marco = { email: uniqueEmail("biz-owner-marco"), name: "Owner Marco" };
const priya = { email: uniqueEmail("biz-owner-priya"), name: "Priya Sandhu" };
const kwame = { email: uniqueEmail("biz-owner-kwame"), name: "Kwame Osei" };
const jordan = { email: uniqueEmail("biz-owner-jordan"), name: "Jordan Reyes" };
const id = { marco: "", priya: "", kwame: "", jordan: "" };

const COUNT = 1210;
/** The year every row below is dated in (its December before included), one no other test uses. */
let YEAR = 0;
const d = (monthDay: string, year = YEAR) => `${year}-${monthDay}`;

type Lot = {
  item: "A" | "B";
  receivedOn: string;
  quantity: number;
  unitCost: string;
  usd?: { usdUnitCost: string; rate: string; rateDate: string };
  supplier?: string;
};
type Sale = {
  key: string;
  item: "A" | "B";
  soldOn: string;
  quantity: number;
  unitPrice: string;
  buyer: { profileId: string } | { name: string };
  seller: string;
};
type Expected = { soldOn: string; item: "A" | "B"; quantity: number; revenue: Decimal; cost: Decimal; seller: string };

const items = { A: "", B: "" };
let lots: Lot[] = [];
let sales: Sale[] = [];
let expected: Expected[] = [];

/** A year from 2001 to 2019 with no sales, purchases or rates from its November before through its December. */
function emptyYear(): number {
  const random = mulberry32(Number.parseInt(randomBytes(4).toString("hex"), 16));
  const years = Array.from({ length: 19 }, (_, index) => 2001 + index).sort(() => random() - 0.5);
  for (const year of years) {
    const out = psql(`
      select 'n', (select count(*) from public.business_sales where sold_on between '${year - 1}-11-01' and '${year}-12-31')
        + (select count(*) from public.business_purchases where received_on between '${year - 1}-11-01' and '${year}-12-31')
        + (select count(*) from public.fx_rates where rate_date between '${year - 1}-11-01' and '${year}-12-31');
    `);
    if (out.n === "0") return year;
  }
  throw new Error("No empty year left from 2001 to 2019: reset the local database (supabase db reset).");
}

const cadOf = (usd: string, rate: string) => new Decimal(usd).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/** The sale inputs, in recording order (sale dates never go back). */
function saleInputs(): Sale[] {
  const start = d("12-01", YEAR - 1);
  return Array.from({ length: COUNT }, (_, index) => {
    const i = index + 1;
    let offset = Math.floor((index * 396) / COUNT);
    // Leave some days without sales: the by-day reads must return them as zeros.
    if (offset % 11 === 5) offset += 1;
    const soldOn = addDays(start, offset);
    const item = i % 4 === 0 ? "B" : "A";
    // August sells below cost: a month with a negative gross profit.
    const loss = soldOn.startsWith(d("08"));
    const unitPrice = loss ? (item === "A" ? "2.00" : "1.00") : item === "A" ? `${(i % 7) + 10}.25` : `${(i % 5) + 8}.50`;
    return {
      key: randomUUID(),
      item,
      soldOn,
      quantity: 1 + (i % 3),
      unitPrice,
      buyer: i % 5 === 0 ? { profileId: i % 10 === 0 ? id.kwame : id.jordan } : { name: `Bulk ${i}` },
      seller: i % 3 === 0 ? id.priya : id.marco,
    };
  });
}

/** FIFO by (received date, recording order), in recording order: what record_business_sale should have allocated. */
function replay(): Expected[] {
  const remaining = lots.map((lot) => ({ ...lot, left: lot.quantity }));
  const ordered = (item: "A" | "B") =>
    remaining.filter((lot) => lot.item === item).sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));
  return sales.map((sale) => {
    let need = sale.quantity;
    let cost = new Decimal(0);
    for (const lot of ordered(sale.item)) {
      const take = Math.min(lot.left, need);
      if (take <= 0) continue;
      lot.left -= take;
      need -= take;
      cost = cost.plus(new Decimal(lot.unitCost).times(take));
    }
    if (need > 0) throw new Error("the seed sells more than it bought");
    return { soldOn: sale.soldOn, item: sale.item, quantity: sale.quantity, revenue: new Decimal(sale.unitPrice).times(sale.quantity), cost, seller: sale.seller };
  });
}

function totalsOf(rows: Expected[]): Totals {
  const revenue = rows.reduce((sum, row) => sum.plus(row.revenue), new Decimal(0));
  const cost = rows.reduce((sum, row) => sum.plus(row.cost), new Decimal(0));
  return {
    sales: rows.length,
    vials: rows.reduce((n, row) => n + row.quantity, 0),
    revenue: revenue.toFixed(2),
    cost: cost.toFixed(2),
    grossProfit: revenue.minus(cost).toFixed(2),
  };
}
const within = (range: DateRange) => expected.filter((row) => row.soldOn >= range.from && row.soldOn <= range.to);

beforeAll(async () => {
  id.marco = await ensureAccount({ ...marco, role: "admin" });
  id.priya = await ensureAccount({ ...priya, role: "admin" });
  id.kwame = await ensureAccount({ ...kwame, role: "researcher" });
  id.jordan = await ensureAccount({ ...jordan, role: "researcher" });
  YEAR = emptyYear();

  // The Bank of Canada rates the USD purchases were converted at.
  const rates = [
    { date: d("01-02"), rate: "1.3571" },
    { date: d("06-15"), rate: "1.3645" },
  ];
  expect(await ok(serviceClient().rpc("store_fx_rates", { p_rates: rates }).single())).toMatchObject({ stored: 2 });

  lots = [
    // Item A (CAD): Nov of the year before (outside the 13 months read) and March.
    // Suppliers (V6): Halcyon in two spellings (one supplier, shown as its latest recorded), Northwind, and none.
    { item: "A", receivedOn: d("11-20", YEAR - 1), quantity: 300, unitCost: "3.10", supplier: "Halcyon Peptides" },
    { item: "A", receivedOn: d("03-01"), quantity: 2500, unitCost: "4.05", supplier: "Halcyon Peptides" },
    // Item B: two USD purchases (one converted at a rate from two days before it arrived), one CAD.
    {
      item: "B",
      receivedOn: d("01-02"),
      quantity: 400,
      unitCost: cadOf("2.35", "1.3571"),
      usd: { usdUnitCost: "2.35", rate: "1.3571", rateDate: d("01-02") },
      supplier: "HALCYON Peptides",
    },
    {
      item: "B",
      receivedOn: d("06-17"),
      quantity: 500,
      unitCost: cadOf("2.10", "1.3645"),
      usd: { usdUnitCost: "2.10", rate: "1.3645", rateDate: d("06-15") },
      supplier: "Northwind Labs",
    },
    { item: "B", receivedOn: d("10-05"), quantity: 50, unitCost: "5.00" },
  ];
  expect(lots[2].unitCost).toBe("3.19");
  expect(lots[3].unitCost).toBe("2.87");

  const db = await signedInClient(marco.email);
  for (const [key, strength] of [["A", "10"], ["B", "5"]] as const) {
    const name = `Business Owner ${key} ${randomBytes(4).toString("hex")}`;
    const peptideId = await ok(
      savePeptideAs(db, {
        p_name: name,
        p_information: `[Supplied information for ${name}]`,
        p_cycling_off_guidance: "",
        p_supplement_guidance: "",
        p_available: true,
      }),
    );
    for (const lot of lots.filter((row) => row.item === key)) {
      const bought = await recordPurchase(db, {
        idempotencyKey: randomUUID(),
        stockItemId: items[key] || null,
        peptideId: items[key] ? null : peptideId,
        strengthMg: items[key] ? null : strength,
        receivedOn: lot.receivedOn,
        quantity: lot.quantity,
        unitCost: lot.unitCost,
        usd: lot.usd,
        supplier: lot.supplier ?? null,
      });
      if (bought.kind !== "recorded") throw new Error(`purchase: ${bought.kind}`);
      items[key] = bought.stockItemId;
    }
  }

  sales = saleInputs();
  expected = replay();
  // Committed: every sale through record_business_sale, as Marco, in this order.
  const asMarco = `set local role authenticated;\nset local "request.jwt.claims" to '${JSON.stringify({ sub: id.marco, role: "authenticated" })}';\n`;
  const statements = sales.map((sale) => {
    const buyer = "profileId" in sale.buyer ? `${quote(sale.buyer.profileId)}::uuid, null` : `null, ${quote(sale.buyer.name)}`;
    return `perform public.record_business_sale(${quote(sale.key)}::uuid, ${quote(items[sale.item])}::uuid, date ${quote(sale.soldOn)}, ${sale.quantity}, ${quote(sale.unitPrice)}, ${previewedLotsSql(`${quote(items[sale.item])}::uuid`, String(sale.quantity))}, ${buyer}, ${quote(sale.seller)}::uuid);`;
  });
  psql(`begin;\n${asMarco}do $$\nbegin\n${statements.join("\n")}\nend $$;\ncommit;\n`);

  // One outside buyer's sale linked to an account since: its figures don't move.
  const first = psql(`select 'id', id from public.business_sales where idempotency_key = ${quote(sales[0].key)};`).id;
  const linked = await linkSale(db, { saleId: first, profileId: id.kwame, sameName: false });
  expect(linked.kind).toBe("linked");
}, 180_000);

const admin = () => signedInClient(marco.email);

describe("the seed", () => {
  it("is what the database recorded: every sale's revenue and FIFO cost", () => {
    const out = psql(`
      select 'n', count(*) from public.business_sales where sold_on between '${YEAR - 1}-12-01' and '${YEAR}-12-31';
      select 'rows', string_agg(concat_ws('/', idempotency_key, revenue, cost), ',' order by idempotency_key)
        from public.business_sales where stock_item_id in (${quote(items.A)}, ${quote(items.B)});
      select 'buyers', count(*) filter (where buyer_type = 'account') || '/' || count(*) filter (where linked_at is not null)
        from public.business_sales where stock_item_id in (${quote(items.A)}, ${quote(items.B)});
    `);
    expect(Number(out.n)).toBe(COUNT);
    const byKey = sales.map((sale, index) => `${sale.key}/${expected[index].revenue.toFixed(2)}/${expected[index].cost.toFixed(2)}`);
    expect(out.rows).toBe(byKey.sort().join(","));
    expect(out.buyers).toBe(`${COUNT / 5 + 1}/1`);
    // A month at a loss, and months without purchases.
    expect(new Decimal(totalsOf(within({ from: d("08-01"), to: d("08-31") })).grossProfit).isNegative()).toBe(true);
  });
});

describe("Business aggregates over 1,210 sales", () => {
  it("sales totals for any range are exact and complete", async () => {
    const db = await admin();
    const everything = { from: d("12-01", YEAR - 1), to: d("12-31") };
    const all = await salesSummary(db, everything);
    expect(all.sales).toBe(COUNT);
    expect(all).toEqual(totalsOf(expected));
    for (const range of [
      { from: d("08-01"), to: d("08-31") },
      { from: d("12-28", YEAR - 1), to: d("01-03") },
      { from: d("02-10"), to: d("02-10") },
      { from: d("12-02"), to: d("12-31") },
    ]) {
      expect(await salesSummary(db, range), JSON.stringify(range)).toEqual(totalsOf(within(range)));
    }
    expect((await salesSummary(db, { from: d("08-01"), to: d("08-31") })).grossProfit).toMatch(/^-/);
  });

  it("sales by day: every day of the range, days without sales as zeros", async () => {
    const db = await admin();
    const year = { from: d("01-01"), to: d("12-31") };
    const days = await salesByDay(db, year);
    expect(days.map((row) => row.day)).toEqual(datesOf(year));
    const empty = days.filter((row) => row.sales === 0);
    expect(empty.length).toBeGreaterThan(20);
    expect(empty.every((row) => row.revenue === "0.00" && row.cost === "0.00" && row.grossProfit === "0.00" && row.vials === 0)).toBe(true);
    for (const row of days) {
      const { sales: count, vials, revenue, cost, grossProfit } = totalsOf(within({ from: row.day, to: row.day }));
      expect({ ...row }, row.day).toEqual({ day: row.day, sales: count, vials, revenue, cost, grossProfit });
    }
  });

  it("months: sales and supplier purchases per month, only those dated in the range", async () => {
    const db = await admin();
    const months = await businessMonths(db, { from: d("12-01", YEAR - 1), to: d("12-31") });
    expect(months.map((row) => row.month)).toEqual(Array.from({ length: 13 }, (_, index) => monthStart(d("12-01", YEAR - 1), index)));
    for (const row of months) {
      const range = { from: row.month, to: addDays(monthStart(row.month, 1), -1) };
      const bought = lots.filter((lot) => lot.receivedOn >= range.from && lot.receivedOn <= range.to);
      expect(row, row.month).toEqual({
        month: row.month,
        ...totalsOf(within(range)),
        purchases: bought.reduce((sum, lot) => sum.plus(new Decimal(lot.unitCost).times(lot.quantity)), new Decimal(0)).toFixed(2),
        purchaseOrders: bought.length,
      });
    }
    expect(months.find((row) => row.month === d("08-01"))!.grossProfit).toMatch(/^-/);
    // A range ending mid-month counts that month to date only.
    const toDate = await businessMonths(db, { from: d("11-01"), to: d("12-24") });
    expect(toDate.map((row) => row.month)).toEqual([d("11-01"), d("12-01")]);
    expect(toDate[1]).toMatchObject(totalsOf(within({ from: d("12-01"), to: d("12-24") })));
  });

  it("purchases by supplier: grouped by the recorded supplier in any case, no supplier as its own group, CAD totals, currencies, however it is paged", async () => {
    const db = await admin();
    const year = { from: d("01-01"), to: d("12-31") };
    const inYear = lots.filter((lot) => lot.receivedOn >= year.from);
    const totalOf = (rows: Lot[]) => rows.reduce((sum, lot) => sum.plus(new Decimal(lot.unitCost).times(lot.quantity)), new Decimal(0)).toFixed(2);
    const groups = await purchaseSuppliers(db, year);
    // Keyed by library_name_key: '' (none) first. Halcyon's November lot is before the year.
    expect(groups).toEqual([
      { key: "", name: null, orders: 1, total: totalOf(inYear.filter((lot) => !lot.supplier)), currencies: ["CAD"] },
      {
        key: "halcyon peptides",
        name: "HALCYON Peptides",
        orders: 2,
        total: totalOf(inYear.filter((lot) => lot.supplier?.toLowerCase() === "halcyon peptides")),
        currencies: ["CAD", "USD"],
      },
      { key: "northwind labs", name: "Northwind Labs", orders: 1, total: totalOf(inYear.filter((lot) => lot.supplier === "Northwind Labs")), currencies: ["USD"] },
    ]);
    expect(groups.map((group) => group.total)).toEqual(["250.00", "11401.00", "1435.00"]);
    expect(await purchaseSuppliers(db, year, { pageSize: 1 })).toEqual(groups);
    expect(await purchaseSuppliers(db, { from: d("07-01"), to: d("09-30") })).toEqual([]);
  });

  it("stock levels: on hand, value at cost of what is left (FIFO), sold in the last 30 days, threshold; all pages", async () => {
    const db = await admin();
    const today = d("12-31");
    const levels = await listStockLevels(db, today);
    expect(await listStockLevels(db, today, { pageSize: 7 })).toEqual(levels);
    // Replay FIFO for what is left per lot.
    const remaining = lots.map((lot) => ({ ...lot, left: lot.quantity }));
    for (const sale of sales) {
      let need = sale.quantity;
      for (const lot of remaining.filter((row) => row.item === sale.item).sort((a, b) => a.receivedOn.localeCompare(b.receivedOn))) {
        const take = Math.min(lot.left, need);
        lot.left -= take;
        need -= take;
      }
    }
    for (const key of ["A", "B"] as const) {
      const level = levels.find((row) => row.id === items[key])!;
      const mine = remaining.filter((lot) => lot.item === key);
      expect(level, key).toMatchObject({
        onHand: mine.reduce((n, lot) => n + lot.left, 0),
        valueAtCost: mine.reduce((sum, lot) => sum.plus(new Decimal(lot.unitCost).times(lot.left)), new Decimal(0)).toFixed(2),
        sold30d: within({ from: addDays(today, -29), to: today })
          .filter((row) => row.item === key)
          .reduce((n, row) => n + row.quantity, 0),
        threshold: 10,
        thresholdChangedAt: null,
      });
      expect(level.onHand).toBeGreaterThan(0);
    }
    // Item A's first lot is used up: what is left is all at the second lot's cost.
    const a = levels.find((row) => row.id === items.A)!;
    expect(a.valueAtCost).toBe(new Decimal("4.05").times(a.onHand).toFixed(2));
  });

  it("the same-days rule over month-length edges: Mar 30 against Feb 1-28/29, Jan 24 against Dec 1-24", async () => {
    const db = await admin();
    const leap = new Date(Date.UTC(YEAR, 1, 29)).getUTCMonth() === 1;
    for (const [today, previous] of [
      [d("03-30"), { from: d("02-01"), to: leap ? d("02-29") : d("02-28") }],
      [d("03-31"), { from: d("02-01"), to: leap ? d("02-29") : d("02-28") }],
      [d("01-24"), { from: d("12-01", YEAR - 1), to: d("12-24", YEAR - 1) }],
      [d("10-31"), { from: d("09-01"), to: d("09-30") }],
    ] as const) {
      const window = sameDaysWindow(today);
      expect(window.previous).toEqual(previous);
      expect(await salesSummary(db, window.previous)).toEqual(totalsOf(within(previous)));
    }
  });

  it("12 months (A13 / D9) end to end: the current month to date against its same days, changes, best month", async () => {
    const db = await admin();
    const today = d("12-24");
    const { months: view, sameDays } = await loadTwelveMonths(db, today);
    expect(sameDays).toEqual({ from: d("11-01"), to: d("11-24") });
    expect(view.months.map((m) => m.month)).toEqual(Array.from({ length: 12 }, (_, index) => d(`${String(index + 1).padStart(2, "0")}-01`)));
    const monthTotals = (month: string, to?: string) => totalsOf(within({ from: month, to: to ?? addDays(monthStart(month, 1), -1) }));
    const december = monthTotals(d("12-01"), today);
    expect(view.current).toMatchObject({
      name: "December",
      grossProfit: december.grossProfit,
      vials: december.vials,
      previousGrossProfit: monthTotals(d("11-01"), d("11-24")).grossProfit,
      vsLabel: "Nov 1–24",
    });
    const change = new Decimal(december.grossProfit).minus(monthTotals(d("11-01"), d("11-24")).grossProfit);
    expect(view.current.change).toEqual({ direction: change.isNegative() ? "down" : "up", amount: change.abs().toFixed(2) });
    // January compares with the December before it (the 13th month read).
    const january = new Decimal(monthTotals(d("01-01")).grossProfit).minus(monthTotals(d("12-01", YEAR - 1)).grossProfit);
    expect(view.months[0].change).toEqual({ direction: january.isNegative() ? "down" : "up", amount: january.abs().toFixed(2) });
    const august = view.months[7];
    expect(august).toMatchObject({ label: "Aug", costShare: 1 });
    expect(august.margin).toMatch(/^−/);
    expect(view.totals.revenue).toBe(totalsOf(within({ from: d("01-01"), to: today })).revenue);
    // Purchases in Jan, Mar, Jun and Oct only.
    expect(view.noPurchases).toBe("none in 8 months");
    // Named suppliers by CAD total, then no supplier.
    expect(view.suppliers.map((row) => [row.name, row.total, row.currency])).toEqual([
      ["HALCYON Peptides", "11401.00", "CAD + USD"],
      ["Northwind Labs", "1435.00", "USD"],
      [null, "250.00", null],
    ]);
  });

  it("a custom period (A1 / A2) into a month at a loss: totals, days and per-seller totals agree", async () => {
    const db = await admin();
    const period = { kind: "custom" as const, from: d("07-20"), to: d("08-31") };
    const data = await loadOverview(db, period, d("08-31"));
    if (data.kind !== "period") throw new Error(data.kind);
    const want = totalsOf(within(period));
    expect(data.overview.totals).toEqual(want);
    expect(data.overview.days).toHaveLength(43);
    expect(data.overview.days.reduce((sum, day) => sum.plus(day.revenue), new Decimal(0)).toFixed(2)).toBe(want.revenue);
    expect(data.overview.axis).toEqual(["Jul 20", "Today"]);
    const bySeller = new Map(data.sellers.map((row) => [row.sellerId, row]));
    for (const seller of [id.marco, id.priya]) {
      const rows = within(period).filter((row) => row.seller === seller);
      expect(bySeller.get(seller), seller).toMatchObject(totalsOf(rows));
    }
    expect(await listSellerTotals(db, period)).toEqual(data.sellers);
  });
});

/** Runs a statement; reports the SQLSTATE it failed with, or "ok". */
const attempt = (label: string, statement: string) => `do $$
begin
  ${statement};
  perform set_config('biz.result', 'ok', true);
exception when others then
  perform set_config('biz.result', sqlstate, true);
end $$;
select '${label}', current_setting('biz.result');\n`;

describe("the append-only guard's threshold exception (as the owner, rolled back)", () => {
  it("lets only the threshold change, only for the item marked, and never a delete", () => {
    const a = quote(items.A);
    const b = quote(items.B);
    const mark = (item: string) => `perform set_config('app.business_stock_threshold', ${item}, true)`;
    const out = psql(`
      begin;
      ${attempt("unmarked", `update public.business_stock_items set low_stock_threshold = 3 where id = ${a}`)}
      ${attempt("marked", `${mark(a)}; update public.business_stock_items set low_stock_threshold = 3 where id = ${a}`)}
      ${attempt("same value", `${mark(a)}; update public.business_stock_items set low_stock_threshold = low_stock_threshold where id = ${a}`)}
      ${attempt("another item marked", `${mark(b)}; update public.business_stock_items set low_stock_threshold = 4 where id = ${a}`)}
      ${attempt("another column too", `${mark(a)}; update public.business_stock_items set low_stock_threshold = 5, strength_mg = strength_mg + 1 where id = ${a}`)}
      ${attempt("another column only", `${mark(a)}; update public.business_stock_items set strength_mg = 99 where id = ${a}`)}
      ${attempt("out of range", `${mark(a)}; update public.business_stock_items set low_stock_threshold = 100001 where id = ${a}`)}
      ${attempt("delete marked", `${mark(a)}; delete from public.business_stock_items where id = ${a}`)}
      -- A recorded change to try to rewrite (the row triggers fire only on rows).
      set local role authenticated;
      set local "request.jwt.claims" to '${JSON.stringify({ sub: id.marco, role: "authenticated" })}';
      select 'recorded', threshold from public.set_business_stock_threshold(gen_random_uuid(), ${b}, 10, 8);
      reset role;
      ${attempt("change updated", `update public.business_stock_threshold_changes set threshold = 1 where stock_item_id = ${b}`)}
      ${attempt("change deleted", `delete from public.business_stock_threshold_changes where stock_item_id = ${b}`)}
      ${attempt("changes truncated", `truncate public.business_stock_threshold_changes`)}
      select 'threshold', low_stock_threshold from public.business_stock_items where id = ${a};
      rollback;
    `);
    expect(out).toEqual({
      unmarked: "42501",
      marked: "ok",
      "same value": "ok",
      "another item marked": "42501",
      "another column too": "42501",
      "another column only": "42501",
      "out of range": "23514",
      "delete marked": "42501",
      recorded: "8",
      "change updated": "42501",
      "change deleted": "42501",
      "changes truncated": "42501",
      threshold: "3",
    });
    expect(psql(`select 't', low_stock_threshold from public.business_stock_items where id = ${a};`).t).toBe("10");
  });

  it("set_business_stock_threshold clears its mark: a later update in the same transaction is refused", () => {
    const a = quote(items.A);
    const out = psql(`
      begin;
      set local role authenticated;
      set local "request.jwt.claims" to '${JSON.stringify({ sub: id.marco, role: "authenticated" })}';
      select 'set', threshold || '/' || replayed from public.set_business_stock_threshold(gen_random_uuid(), ${a}, 10, 6);
      reset role;
      select 'mark', coalesce(current_setting('app.business_stock_threshold', true), '');
      ${attempt("after", `update public.business_stock_items set low_stock_threshold = 7 where id = ${a}`)}
      select 'threshold', low_stock_threshold from public.business_stock_items where id = ${a};
      rollback;
    `);
    expect(out).toEqual({ set: "6/false", mark: "", after: "42501", threshold: "6" });
  });
});

describe("the migration", () => {
  it("applies on top of recorded stock: every item reads 10, nothing else changes, and it all works", () => {
    // The guard as production has it (20260927160000), restored before re-applying.
    const previous = readFileSync("supabase/migrations/20260927160000_sellers_admin_invites.sql", "utf8");
    const guard = /create or replace function public\.business_records_guard\(\)[\s\S]*?\n\$\$;/.exec(previous)![0];
    const snapshot = `select 'items', md5(string_agg(concat_ws('|', id, peptide_id, strength_mg, created_at), ',' order by id)) from public.business_stock_items;`;
    const a = quote(items.A);
    const out = psql(`
      begin;
      drop function public.set_business_stock_threshold(uuid, uuid, integer, integer);
      drop function public.admin_business_stock_levels(date);
      drop function public.admin_business_sales_by_day(date, date);
      drop function public.admin_business_sales_summary(date, date);
      drop function public.admin_business_months(date, date);
      drop function public.admin_business_purchase_suppliers(date, date);
      drop table public.business_stock_threshold_changes;
      alter table public.business_stock_items drop column low_stock_threshold;
      ${guard}
      ${snapshot.replace("'items'", "'before'")}
      select 'count', count(*) from public.business_stock_items;

      \\i supabase/migrations/20260928150000_business_overview.sql

      ${snapshot.replace("'items'", "'after'")}
      select 'thresholds', string_agg(distinct low_stock_threshold::text, ',') from public.business_stock_items;
      select 'history', count(*) from public.business_stock_threshold_changes;
      set local role authenticated;
      set local "request.jwt.claims" to '${JSON.stringify({ sub: id.marco, role: "authenticated" })}';
      select 'set', threshold from public.set_business_stock_threshold(gen_random_uuid(), ${a}, 10, 12);
      select 'level', on_hand || '/' || low_stock_threshold from public.admin_business_stock_levels('${YEAR}-12-31') where stock_item_id = ${a};
      select 'sales', sales from public.admin_business_sales_summary('${YEAR - 1}-12-01', '${YEAR}-12-31');
      rollback;
    `);
    expect(Number(out.count)).toBeGreaterThan(1);
    expect(out.after).toBe(out.before);
    expect(out.thresholds).toBe("10");
    expect(out.history).toBe("0");
    expect(out.set).toBe("12");
    expect(out.level).toMatch(/^\d+\/12$/);
    expect(out.sales).toBe(String(COUNT));
  });
});
