// 20260929100000_records.sql as the database owner (psql). Committed, in a
// year (1970-1989) no other test uses, on this file's own stock items: 1,050
// sales and 1,010 purchases, read back complete by the Ledger (by day and by
// month, one seller, purchases by supplier) past the API's 1,000-row cap; and
// sales recorded late in the evening in Toronto, which belong to their
// Toronto day and month whatever the UTC date. Rolled back: the Ledger's "no
// seller" filter over a sale from before sellers existed, the supplier
// column's check and the append-only guard even for the owner, and the
// migration re-applied on top of recorded purchases and sales. Runs in the
// integration-exclusive project (vitest.config.mts): the rehearsal drops and
// re-adds a business_purchases column inside its transaction.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/business/period";
import { purchaseSuppliers } from "@/lib/business/service";
import { businessToday } from "@/lib/inventory/screens";
import { recordPurchase, type Db } from "@/lib/inventory/service";
import { byDay, defaultRange, readLedgerView } from "@/lib/records/ledger";
import { ledgerMonthItems, ledgerPurchases, ledgerSales } from "@/lib/records/ledger-service";
import { mulberry32, psql, quote } from "../support/psql";
import { previewedLotsSql } from "../support/sales";
import { ensureAccount, signedInClient, uniqueEmail } from "../support/local-supabase";

const marco = { email: uniqueEmail("rec-owner-marco"), name: "Records Marco" };
const brian = { email: uniqueEmail("rec-owner-brian"), name: "Records Brian" };
const id = { marco: "", brian: "" };
const items = { sold: "", bought: "" };
const lots = { sold: "" };
let YEAR = 0;
const d = (monthDay: string, year = YEAR) => `${year}-${monthDay}`;
let db: Db;

const SALES = 1050;
const PURCHASES = 1010;
const SUPPLIERS = [null, "Halcyon Owner", "HALCYON OWNER", "Northwind Owner"] as const;

const asAdmin = (who = id.marco) => `set local role authenticated;\nset local "request.jwt.claims" to '${JSON.stringify({ sub: who, role: "authenticated" })}';\n`;

/** Runs a statement; reports the SQLSTATE it failed with, or "ok". */
const attempt = (label: string, statement: string) => `do $$
begin
  ${statement};
  perform set_config('rec.${label.replace(/\W/g, "_")}', 'ok', true);
exception when others then
  perform set_config('rec.${label.replace(/\W/g, "_")}', sqlstate, true);
end $$;
select ${quote(label)}, current_setting('rec.${label.replace(/\W/g, "_")}');
`;

/** A year from 1970 to 1989 with no sales or purchases (and the next January free, for the year-end sale). */
function emptyYear(): number {
  const random = mulberry32(Number.parseInt(randomBytes(4).toString("hex"), 16));
  const years = Array.from({ length: 20 }, (_, index) => 1970 + index).sort(() => random() - 0.5);
  for (const year of years) {
    const out = psql(`
      select 'n', (select count(*) from public.business_sales where sold_on between '${year}-01-01' and '${year + 1}-01-31')
        + (select count(*) from public.business_purchases where received_on between '${year}-01-01' and '${year + 1}-01-31');
    `);
    if (out.n === "0") return year;
  }
  throw new Error("No empty year left from 1970 to 1989: reset the local database (supabase db reset).");
}

async function newItem(receivedOn: string, quantity: number, unitCost: string): Promise<{ item: string; lot: string }> {
  const name = `Records Owner ${randomBytes(4).toString("hex")}`;
  const { data: peptideId, error } = await db.rpc("save_library_peptide", {
    p_name: name,
    p_information: `[Supplied information for ${name}]`,
    p_cycling_off_guidance: "",
    p_supplement_guidance: "",
    p_available: true,
  });
  if (error) throw error;
  const bought = await recordPurchase(db, {
    idempotencyKey: randomUUID(),
    stockItemId: null,
    peptideId: peptideId!,
    strengthMg: "5",
    receivedOn,
    quantity,
    unitCost,
    supplier: null,
  });
  if (bought.kind !== "recorded") throw new Error(bought.kind);
  return { item: bought.stockItemId, lot: bought.purchaseId };
}

// Sale i (1-based): sold March 1 + (i % 61) days (to April 30), 1 or 2 vials, CAD (i % 7) + 10.25; Brian every third.
const sale = (i: number) => ({
  soldOn: addDays(d("03-01"), i % 61),
  quantity: 1 + (i % 2),
  unitPrice: `${(i % 7) + 10}.25`,
  seller: i % 3 === 0 ? "brian" : "marco",
});
// Purchase i: received May 1 + (i % 61) days (to June 30), 1 to 3 vials, CAD (i % 5) + 1.10, a supplier in turn (or none).
const bought = (i: number) => ({
  receivedOn: addDays(d("05-01"), i % 61),
  quantity: 1 + (i % 3),
  unitCost: `${(i % 5) + 1}.10`,
  supplier: SUPPLIERS[i % 4],
});
const range = (n: number) => Array.from({ length: n }, (_, index) => index + 1);
const money = (value: Decimal) => value.toFixed(2);

beforeAll(async () => {
  id.marco = await ensureAccount({ ...marco, role: "admin" });
  id.brian = await ensureAccount({ ...brian, role: "admin" });
  db = await signedInClient(marco.email);
  YEAR = emptyYear();
  // Every sale comes from one lot at CAD 2.50.
  const sold = await newItem(d("01-02"), 5000, "2.50");
  items.sold = sold.item;
  lots.sold = sold.lot;
  items.bought = (await newItem(d("01-02"), 1, "1.00")).item;

  psql(`
    begin;
    ${asAdmin()}
    do $$
    begin
      for i in 1..${SALES} loop
        perform public.record_business_sale(
          gen_random_uuid(), ${quote(items.sold)}, date '${d("03-01")}' + (i % 61), 1 + (i % 2), ((i % 7) + 10)::text || '.25',
          ${previewedLotsSql(quote(items.sold), "1 + (i % 2)")}, null, 'Bulk ' || i,
          case when i % 3 = 0 then ${quote(id.brian)}::uuid else ${quote(id.marco)}::uuid end);
      end loop;
      for i in 1..${PURCHASES} loop
        perform public.record_business_purchase_fx(
          p_idempotency_key => gen_random_uuid(), p_received_on => date '${d("05-01")}' + (i % 61), p_quantity => 1 + (i % 3),
          p_original_currency => 'CAD', p_unit_cost => ((i % 5) + 1)::text || '.10', p_stock_item_id => ${quote(items.bought)},
          p_supplier => (array[null, 'Halcyon Owner', 'HALCYON OWNER', 'Northwind Owner'])[(i % 4) + 1]);
      end loop;
    end $$;
    commit;
  `);
}, 180_000);

describe("the Ledger past 1,000 rows", () => {
  it("by day: all 1,050 sales, newest first by a unique key, exact day totals, on more than one page; one seller's 350", async () => {
    const filter = { from: d("03-01"), to: d("04-30"), item: items.sold };
    // afterPage runs after each full page, before the next is read.
    let fullPages = 0;
    const rows = await ledgerSales(db, filter, { afterPage: () => void fullPages++ });
    expect(rows).toHaveLength(SALES);
    expect(fullPages).toBe(1);
    expect(new Set(rows.map((row) => row.sortKey)).size).toBe(SALES);
    expect(rows.every((row, index) => index === 0 || rows[index - 1].sortKey > row.sortKey)).toBe(true);

    const expected = new Map<string, { entries: number; vials: number; revenue: Decimal }>();
    for (const i of range(SALES)) {
      const s = sale(i);
      const day = expected.get(s.soldOn) ?? { entries: 0, vials: 0, revenue: new Decimal(0) };
      expected.set(s.soldOn, { entries: day.entries + 1, vials: day.vials + s.quantity, revenue: day.revenue.plus(new Decimal(s.unitPrice).times(s.quantity)) });
    }
    const days = byDay(rows);
    expect(days.map((group) => group.day)).toEqual([...expected.keys()].sort().reverse());
    for (const group of days) {
      const want = expected.get(group.day)!;
      const cost = new Decimal("2.50").times(want.vials);
      expect(group.totals, group.day).toEqual({
        entries: want.entries,
        vials: want.vials,
        revenue: money(want.revenue),
        cost: money(cost),
        grossProfit: money(want.revenue.minus(cost)),
        total: money(want.revenue),
      });
    }

    const briansRows = await ledgerSales(db, { ...filter, seller: id.brian });
    expect(briansRows).toHaveLength(SALES / 3);
    expect(new Set(briansRows.map((row) => row.sellerName))).toEqual(new Set([brian.name]));
    expect(await ledgerSales(db, filter, { pageSize: 400 })).toEqual(rows);
  });

  it("by month: March and April summed in the database over every sale, for everyone and for one seller", async () => {
    const filter = { from: d("03-01"), to: d("04-30"), item: items.sold };
    const want = (seller?: string) => {
      const months = new Map<string, { entries: number; vials: number; revenue: Decimal }>();
      for (const i of range(SALES)) {
        const s = sale(i);
        if (seller && s.seller !== seller) continue;
        const month = `${s.soldOn.slice(0, 7)}-01`;
        const row = months.get(month) ?? { entries: 0, vials: 0, revenue: new Decimal(0) };
        months.set(month, { entries: row.entries + 1, vials: row.vials + s.quantity, revenue: row.revenue.plus(new Decimal(s.unitPrice).times(s.quantity)) });
      }
      return [...months.entries()].sort().map(([month, row]) => {
        const cost = new Decimal("2.50").times(row.vials);
        return [month, row.entries, row.vials, money(row.revenue), money(cost), money(row.revenue.minus(cost))];
      });
    };
    const shape = (rows: Awaited<ReturnType<typeof ledgerMonthItems>>) => rows.map((row) => [row.month, row.entries, row.vials, row.revenue, row.cost, row.grossProfit]);
    const months = await ledgerMonthItems(db, "sales", filter);
    expect(shape(months)).toEqual(want());
    expect(months.reduce((n, row) => n + row.entries, 0)).toBe(SALES);
    expect(shape(await ledgerMonthItems(db, "sales", { ...filter, seller: id.brian }))).toEqual(want("brian"));
    expect(await ledgerMonthItems(db, "sales", filter, { pageSize: 1 })).toEqual(months);
  });

  it("purchases: all 1,010 by day, by month with their suppliers, and purchases by supplier (one per name in any case)", async () => {
    const filter = { from: d("05-01"), to: d("06-30"), item: items.bought };
    const rows = await ledgerPurchases(db, filter);
    expect(rows).toHaveLength(PURCHASES);
    expect(new Set(rows.map((row) => row.sortKey)).size).toBe(PURCHASES);
    const all = range(PURCHASES).map(bought);
    const totalOf = (list: ReturnType<typeof bought>[]) => money(list.reduce((sum, p) => sum.plus(new Decimal(p.unitCost).times(p.quantity)), new Decimal(0)));
    expect(money(rows.reduce((sum, row) => sum.plus(row.totalCost), new Decimal(0)))).toBe(totalOf(all));
    expect(rows.filter((row) => row.supplier === null)).toHaveLength(all.filter((p) => p.supplier === null).length);

    const months = await ledgerMonthItems(db, "purchases", filter);
    expect(months.map((row) => [row.month, row.entries, row.total, row.supplierCount, row.supplier, row.noSupplier])).toEqual(
      ["05", "06"].map((month) => {
        const inMonth = all.filter((p) => p.receivedOn.slice(5, 7) === month);
        return [d(`${month}-01`), inMonth.length, totalOf(inMonth), 2, null, inMonth.filter((p) => p.supplier === null).length];
      }),
    );

    // Purchases by supplier (A13 / D9) over the same days: this item's purchases are the only ones in them.
    const groups = await purchaseSuppliers(db, { from: d("05-01"), to: d("06-30") });
    const named = (key: string) => all.filter((p) => (p.supplier?.toLowerCase() ?? "") === key);
    expect(groups).toEqual([
      { key: "", name: null, orders: named("").length, total: totalOf(named("")), currencies: ["CAD"] },
      // The spelling of its latest recorded purchase (i = 1010 is HALCYON OWNER).
      { key: "halcyon owner", name: "HALCYON OWNER", orders: named("halcyon owner").length, total: totalOf(named("halcyon owner")), currencies: ["CAD"] },
      { key: "northwind owner", name: "Northwind Owner", orders: named("northwind owner").length, total: totalOf(named("northwind owner")), currencies: ["CAD"] },
    ]);
    expect(groups.reduce((n, group) => n + group.orders, 0)).toBe(PURCHASES);
  });
});

describe("Toronto days", () => {
  it("a sale late in the evening in Toronto is on its Toronto day and month, whatever the UTC date", async () => {
    // June 30 23:30 EDT is July 1 03:30 UTC; Dec 31 23:30 EST is Jan 1 04:30 UTC.
    const late = [
      { soldOn: d("06-30"), recordedAt: `${d("07-01")}T03:30:00Z`, quantity: 3 },
      { soldOn: d("07-01"), recordedAt: `${d("07-01")}T04:30:00Z`, quantity: 4 },
      { soldOn: d("06-30"), recordedAt: `${d("06-30")}T12:00:00Z`, quantity: 5 },
      { soldOn: d("12-31"), recordedAt: `${YEAR + 1}-01-01T04:30:00Z`, quantity: 6 },
    ];
    for (const row of late) expect(businessToday(new Date(row.recordedAt))).toBe(row.soldOn);
    const insert = (row: (typeof late)[number]) =>
      `with s as (insert into public.business_sales (stock_item_id, sold_on, quantity, unit_price, revenue, cost, buyer_type, buyer_name, idempotency_key, recorded_by, seller_id, seller_name, recorded_at)
         values (${quote(items.sold)}, '${row.soldOn}', ${row.quantity}, 10, ${row.quantity * 10}, ${row.quantity * 2.5}, 'outside', 'Late', gen_random_uuid(), ${quote(id.marco)}, ${quote(id.marco)}, ${quote(marco.name)}, '${row.recordedAt}') returning id)
       insert into public.business_sale_allocations (sale_id, purchase_id, quantity, unit_cost, received_on)
       select s.id, ${quote(lots.sold)}, ${row.quantity}, 2.50, '${d("01-02")}' from s;`;
    psql(`begin;\n${late.map(insert).join("\n")}\ncommit;\n`);

    const on = async (from: string, to = from) => (await ledgerSales(db, { from, to, item: items.sold })).map((row) => row.quantity);
    // Newest first within the day: the 23:30 sale, then the noon one.
    expect(await on(d("06-30"))).toEqual([3, 5]);
    expect(await on(d("07-01"))).toEqual([4]);
    expect(await on(d("12-31"))).toEqual([6]);
    expect(await on(`${YEAR + 1}-01-01`)).toEqual([]);
    const months = await ledgerMonthItems(db, "sales", { from: d("06-01"), to: d("12-31"), item: items.sold });
    expect(months.map((row) => [row.month, row.vials])).toEqual([
      [d("06-01"), 8],
      [d("07-01"), 4],
      [d("12-01"), 6],
    ]);

    // The page's own range follows the Toronto date: 23:30 on June 30 is still June.
    const today = businessToday(new Date(`${d("07-01")}T03:30:00Z`));
    expect(defaultRange("day", today)).toEqual({ from: d("06-01"), to: d("06-30") });
    expect(readLedgerView({ group: "month" }, today)).toMatchObject({ group: "month", range: { from: d("07-01", YEAR - 1), to: d("06-30") } });
  });
});

describe("rolled back", () => {
  it("the no-seller filter: only the sales recorded before sellers existed", () => {
    const nil = "00000000-0000-0000-0000-000000000000";
    const out = psql(`
      begin;
      set local session_replication_role = replica;
      with s as (insert into public.business_sales (stock_item_id, sold_on, quantity, unit_price, revenue, cost, buyer_type, buyer_name, idempotency_key, recorded_by)
        values (${quote(items.sold)}, '${d("08-15")}', 2, 10, 20, 5, 'outside', 'Legacy', gen_random_uuid(), ${quote(id.marco)}) returning id)
      insert into public.business_sale_allocations (sale_id, purchase_id, quantity, unit_cost, received_on)
      select s.id, ${quote(lots.sold)}, 2, 2.50, '${d("01-02")}' from s;
      set local session_replication_role = origin;
      ${asAdmin()}
      select 'new', replayed from public.record_business_sale(gen_random_uuid(), ${quote(items.sold)}, '${d("08-15")}', 1, '10',
        ${previewedLotsSql(quote(items.sold), "1")}, null, 'New', ${quote(id.marco)});
      select 'none', string_agg(buyer_name, ',') from public.admin_business_ledger_sales('${d("08-01")}', '${d("08-31")}', '${nil}', ${quote(items.sold)});
      select 'marco', string_agg(buyer_name, ',') from public.admin_business_ledger_sales('${d("08-01")}', '${d("08-31")}', ${quote(id.marco)}, ${quote(items.sold)});
      select 'all', count(*) from public.admin_business_ledger_sales('${d("08-01")}', '${d("08-31")}', null, ${quote(items.sold)});
      select 'month', entries || '/' || vials from public.admin_business_ledger_month_items('sales', '${d("08-01")}', '${d("08-31")}', '${nil}', ${quote(items.sold)});
      rollback;
    `);
    expect(out).toEqual({ new: "f", none: "Legacy", marco: "New", all: "2", month: "1/2" });
  });

  it("the supplier: trimmed and 1 to 120 characters by the table's check, and never changed once recorded, even by the owner", () => {
    const lot = `(select id from public.business_purchases where stock_item_id = ${quote(items.bought)} and supplier is not null limit 1)`;
    const out = psql(`
      begin;
      ${attempt("guarded", `update public.business_purchases set supplier = 'Changed' where id = ${lot}`)}
      ${attempt("guarded_null", `update public.business_purchases set supplier = null where id = ${lot}`)}
      set local session_replication_role = replica;
      ${attempt("untrimmed", `update public.business_purchases set supplier = ' Halcyon' where id = ${lot}`)}
      ${attempt("blank", `update public.business_purchases set supplier = '' where id = ${lot}`)}
      ${attempt("too_long", `update public.business_purchases set supplier = repeat('s', 121) where id = ${lot}`)}
      ${attempt("longest", `update public.business_purchases set supplier = repeat('s', 120) where id = ${lot}`)}
      rollback;
    `);
    expect(out).toEqual({ guarded: "42501", guarded_null: "42501", untrimmed: "23514", blank: "23514", too_long: "23514", longest: "ok" });
  });

  it("the migration applies on top of recorded purchases and sales: none gets a supplier, nothing else changes, and it all works", () => {
    // Each function as production has it, restored before re-applying: its last definition before V6.
    const last = (file: string, name: string) => {
      const source = readFileSync(`supabase/migrations/${file}`, "utf8");
      const found = [...source.matchAll(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "g"))];
      if (found.length === 0) throw new Error(`${name} not in ${file}`);
      return found.at(-1)![0];
    };
    const previous = [
      last("20260927140000_purchase_currency.sql", "record_business_purchase_fx"),
      last("20260927140000_purchase_currency.sql", "record_business_purchase"),
      last("20260928150000_business_overview.sql", "admin_business_purchase_suppliers"),
      last("20260927160000_sellers_admin_invites.sql", "record_business_sale"),
    ];
    const snapshot = (label: string) => `
      select '${label}_purchases', count(*) || '/' || md5(string_agg(concat_ws('|', id, stock_item_id, received_on, quantity, unit_cost, total_cost, original_currency, original_unit_cost, fx_rate, recorded_order), ',' order by id)) from public.business_purchases;
      select '${label}_sales', count(*) || '/' || md5(string_agg(concat_ws('|', id, stock_item_id, sold_on, quantity, unit_price, revenue, cost, seller_id, buyer_name), ',' order by id)) from public.business_sales;`;
    const out = psql(`
      begin;
      drop function public.admin_business_ledger_month_items(text, date, date, uuid, uuid);
      drop function public.admin_business_ledger_purchases(date, date, uuid);
      drop function public.admin_business_ledger_sales(date, date, uuid, uuid);
      drop function public.record_business_sale(uuid, uuid, date, integer, text, jsonb, uuid, text, uuid);
      drop function public.admin_business_sale_preview(uuid, integer);
      drop function public.business_fifo_allocation(uuid, integer);
      drop function public.admin_business_suppliers();
      drop function public.record_business_purchase_fx(uuid, date, integer, text, text, text, text, date, uuid, uuid, text, text);
      drop function public.admin_business_purchase_suppliers(date, date);
      alter table public.business_purchases drop column supplier;
      ${previous.join("\n")}
      ${snapshot("before")}

      \\i supabase/migrations/20260929100000_records.sql

      ${snapshot("after")}
      select 'suppliers', count(*) from public.business_purchases where supplier is not null;
      -- The previous signature is gone: every sale names its preview's lots.
      select 'signatures', string_agg(pg_get_function_identity_arguments(oid), ' | ') from pg_proc
        where proname = 'record_business_sale' and pronamespace = 'public'::regnamespace;
      ${asAdmin()}
      ${attempt("without", `perform public.record_business_sale(p_idempotency_key => gen_random_uuid(), p_stock_item_id => ${quote(items.sold)}, p_sold_on => '${d("09-01")}', p_quantity => 1, p_unit_price => '10', p_buyer_name => 'Old', p_seller_id => ${quote(id.marco)})`)}
      ${attempt("null", `perform public.record_business_sale(gen_random_uuid(), ${quote(items.sold)}, '${d("09-01")}', 1, '10', null, null, 'Old', ${quote(id.marco)})`)}
      select 'preview', (public.admin_business_sale_preview(${quote(items.sold)}, 2)) ->> 'cost';
      select 'sale', replayed from public.record_business_sale(gen_random_uuid(), ${quote(items.sold)}, '${d("09-01")}', 2, '10',
        ${previewedLotsSql(quote(items.sold), "2")}, null, 'After', ${quote(id.marco)});
      select 'purchase', replayed from public.record_business_purchase_fx(p_idempotency_key => gen_random_uuid(), p_received_on => '${d("09-01")}',
        p_quantity => 1, p_original_currency => 'CAD', p_unit_cost => '1', p_stock_item_id => ${quote(items.bought)}, p_supplier => ' After ');
      select 'cad', replayed from public.record_business_purchase(gen_random_uuid(), '${d("09-02")}', 1, '1', ${quote(items.bought)});
      select 'listed', count(*) from public.admin_business_suppliers() where supplier = 'After';
      select 'ledger', count(*) from public.admin_business_ledger_purchases('${d("09-01")}', '${d("09-02")}', ${quote(items.bought)});
      rollback;
    `);
    expect(out.after_purchases).toBe(out.before_purchases);
    expect(out.after_sales).toBe(out.before_sales);
    expect(Number(out.before_purchases.split("/")[0])).toBeGreaterThan(PURCHASES);
    expect(out).toMatchObject({
      signatures:
        "p_idempotency_key uuid, p_stock_item_id uuid, p_sold_on date, p_quantity integer, p_unit_price text, p_expected_allocation jsonb, p_buyer_profile_id uuid, p_buyer_name text, p_seller_id uuid",
      without: "42883",
      null: "22023",
    });
    expect(out).toMatchObject({ suppliers: "0", preview: "5.00", sale: "f", purchase: "f", cad: "f", listed: "1", ledger: "2" });
  });
});
