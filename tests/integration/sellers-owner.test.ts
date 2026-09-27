// 20260927160000_sellers_admin_invites.sql as the database owner (psql): the
// migration applies on top of recorded sales and invitations (always rolled
// back); the append-only guard allows exactly one change to a recorded sale,
// link_business_sale's outside → account link, and nothing else even for the
// owner (rolled back); every inserted sale names a current admin as seller;
// and A7's per-seller totals are exact and complete over 1,050 sales
// (committed, on this file's own stock item). Runs in the
// integration-exclusive project (vitest.config.mts): the rehearsal drops and
// re-adds business_sales and invitations columns inside its transaction.
import { randomBytes, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { beforeAll, describe, expect, it } from "vitest";
import { listSellerTotals } from "@/lib/inventory/sellers";
import { listSales, recordPurchase, recordSale } from "@/lib/inventory/service";
import { psql, quote } from "../support/psql";
import { ensureAccount, seedInvitation, signedInClient, uniqueEmail } from "../support/local-supabase";

const marco = { email: uniqueEmail("sel-owner-marco"), name: "Owner Marco" };
const brian = { email: uniqueEmail("sel-owner-brian"), name: "Owner Brian" };
const kwame = { email: uniqueEmail("sel-owner-kwame"), name: "Owner Kwame" };
const fixture = { marcoId: "", brianId: "", kwameId: "", itemId: "", outsideSale: "", accountSale: "", invitationEmail: "" };

beforeAll(async () => {
  fixture.marcoId = await ensureAccount({ ...marco, role: "admin" });
  fixture.brianId = await ensureAccount({ ...brian, role: "admin" });
  fixture.kwameId = await ensureAccount({ ...kwame, role: "researcher" });
  const db = await signedInClient(marco.email);
  const name = `Seller Owner ${randomBytes(4).toString("hex")}`;
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
    receivedOn: "2026-08-01",
    quantity: 2000,
    unitCost: "3.10",
  });
  if (bought.kind !== "recorded") throw new Error(bought.kind);
  fixture.itemId = bought.stockItemId;
  const sell = async (buyer: Parameters<typeof recordSale>[1]["buyer"]) => {
    const sale = await recordSale(db, {
      idempotencyKey: randomUUID(),
      stockItemId: fixture.itemId,
      soldOn: "2026-08-02",
      quantity: 2,
      unitPrice: "9.99",
      sellerId: fixture.brianId,
      buyer,
    });
    if (sale.kind !== "recorded") throw new Error(sale.kind);
    return sale.saleId;
  };
  fixture.outsideSale = await sell({ type: "outside", name: "K. Osei" });
  fixture.accountSale = await sell({ type: "account", profileId: fixture.kwameId });
  fixture.invitationEmail = uniqueEmail("sel-owner-invitee");
  await seedInvitation({ email: fixture.invitationEmail, name: "Invited Before" });
});

const asAdmin = (id = fixture.marcoId) =>
  `set local role authenticated;\nset local "request.jwt.claims" to '${JSON.stringify({ sub: id, role: "authenticated" })}';\n`;

/** Runs a statement; reports the SQLSTATE it failed with, or "ok". Deferred checks fire inside. */
const attempt = (label: string, statement: string) => `do $$
begin
  ${statement};
  set constraints all immediate;
  perform set_config('sel.result', 'ok', true);
exception when others then
  perform set_config('sel.result', sqlstate, true);
end $$;
select '${label}', current_setting('sel.result');\n`;

describe("the sellers migration", () => {
  it("applies on top of recorded sales and invitations: they keep every value, sales get no seller, invitations stay researcher", () => {
    const item = quote(fixture.itemId);
    const out = psql(`
      begin;
      -- The schema as it was before 20260927160000.
      drop function public.link_business_sale(uuid, uuid, boolean);
      drop function public.business_sellers();
      drop function public.admin_business_seller_totals(date, date, uuid);
      drop function public.record_business_sale(uuid, uuid, date, integer, text, uuid, text, uuid);
      drop function public.invite_researcher(text, text, text, public.app_role);
      drop trigger business_sales_seller on public.business_sales;
      drop function public.business_sale_seller_check();
      drop index public.business_sales_outside_by_name;
      alter table public.business_sales
        drop column seller_id, drop column seller_name, drop column original_buyer_name, drop column linked_at, drop column linked_by;
      alter table public.invitations drop column role;
      -- Stand-ins for the signatures the migration replaces.
      create function public.record_business_sale(uuid, uuid, date, integer, text, uuid default null, text default null)
        returns table (sale_id uuid, replayed boolean) language sql as 'select null::uuid, false';
      create function public.invite_researcher(text, text, text)
        returns table (outcome text, invitation_id uuid) language sql as 'select null::text, null::uuid';
      create temp table before_sales on commit drop as
        select id, stock_item_id, sold_on, quantity, unit_price, revenue, cost, buyer_type, buyer_profile_id, buyer_name, recorded_by, recorded_at
        from public.business_sales;
      select 'sales', count(*) from before_sales;

      \\i supabase/migrations/20260927160000_sellers_admin_invites.sql

      select 'unchanged', count(*) from before_sales b join public.business_sales s using (id)
        where (s.stock_item_id, s.sold_on, s.quantity, s.unit_price, s.revenue, s.cost, s.buyer_type, s.buyer_profile_id, s.buyer_name, s.recorded_by, s.recorded_at)
          is not distinct from (b.stock_item_id, b.sold_on, b.quantity, b.unit_price, b.revenue, b.cost, b.buyer_type, b.buyer_profile_id, b.buyer_name, b.recorded_by, b.recorded_at);
      select 'with seller', count(*) from public.business_sales where seller_id is not null or seller_name is not null or linked_at is not null;
      select 'invalid', count(*) from pg_constraint
        where conrelid in ('public.business_sales'::regclass, 'public.invitations'::regclass) and not convalidated;
      select 'roles', string_agg(distinct role::text, ',') from public.invitations;
      ${asAdmin()}
      -- An older sale shows as "no seller" in the totals and can still be linked; a new sale needs a seller.
      select 'legacy', seller_key || '/' || coalesce(seller_name, '-') || '/' || vials from public.admin_business_seller_totals(null, null, ${item});
      select 'linked', public.link_business_sale(${quote(fixture.outsideSale)}, ${quote(fixture.kwameId)});
      select 'new', replayed from public.record_business_sale(gen_random_uuid(), ${item}, '2026-08-03', 1, '5', null, 'Walk-in', ${quote(fixture.brianId)});
      reset role;
      select 'seller', seller_name from public.business_sales where stock_item_id = ${item} and sold_on = '2026-08-03';
      rollback;
    `);
    expect(Number(out.sales)).toBeGreaterThan(0);
    expect(out.unchanged).toBe(out.sales);
    expect(out["with seller"]).toBe("0");
    expect(out.invalid).toBe("0");
    expect(out.roles).toBe("researcher");
    expect(out.legacy).toBe("00000000-0000-0000-0000-000000000000/-/4");
    expect(out.linked).toBe("1");
    expect(out.new).toBe("f");
    expect(out.seller).toBe(brian.name);
  });
});

describe("a recorded sale is append-only except for its link", () => {
  it("only link_business_sale's marked outside → account change passes the guard, even for the owner", () => {
    const sale = quote(fixture.outsideSale);
    const account = quote(fixture.accountSale);
    const mark = (id: string) => `perform set_config('app.business_sale_link', ${id}::text, true)`;
    /** The link's assignments, with `changes` replacing or adding columns. */
    const link = (id: string, changes: Record<string, string> = {}) => {
      const set = {
        buyer_type: "'account'",
        buyer_profile_id: quote(fixture.kwameId),
        buyer_name: "'Owner Kwame'",
        original_buyer_name: "buyer_name",
        linked_at: "now()",
        linked_by: quote(fixture.marcoId),
        ...changes,
      };
      return `update public.business_sales set ${Object.entries(set).map(([column, value]) => `${column} = ${value}`).join(", ")} where id = ${id}`;
    };
    const out = psql(
      "begin;\n" +
        attempt("link without the marker", link(sale)) +
        attempt("marker for another sale", `${mark(account)}; ${link(sale)}`) +
        attempt("marked, cost changed too", `${mark(sale)}; ${link(sale, { cost: "0" })}`) +
        attempt("marked, revenue changed too", `${mark(sale)}; ${link(sale, { unit_price: "1", revenue: "2" })}`) +
        attempt("marked, date changed too", `${mark(sale)}; ${link(sale, { sold_on: "'2026-08-03'" })}`) +
        attempt("marked, seller changed too", `${mark(sale)}; ${link(sale, { seller_id: quote(fixture.marcoId), seller_name: "'Owner Marco'" })}`) +
        attempt("marked, original name not kept", `${mark(sale)}; ${link(sale, { original_buyer_name: "'Someone'" })}`) +
        attempt("marked, no one linked it", `${mark(sale)}; ${link(sale, { linked_by: "null", linked_at: "null" })}`) +
        attempt("marked, still outside", `${mark(sale)}; update public.business_sales set buyer_name = 'Renamed' where id = ${sale}`) +
        attempt("marked, an account sale", `${mark(account)}; ${link(account)}`) +
        attempt("marked, deleted", `${mark(sale)}; delete from public.business_sales where id = ${sale}`) +
        attempt("marked, an allocation changed", `${mark(sale)}; update public.business_sale_allocations set quantity = 1 where sale_id = ${sale}`) +
        attempt("marked, the link", `${mark(sale)}; ${link(sale)}`) +
        attempt("marked, linked again elsewhere", `${mark(sale)}; update public.business_sales set buyer_profile_id = ${quote(fixture.marcoId)} where id = ${sale}`) +
        `select 'after', buyer_type || '/' || buyer_name || '/' || original_buyer_name || '/' || cost || '/' || quantity from public.business_sales where id = ${sale};\n` +
        "rollback;\n",
    );
    expect(out).toEqual({
      "link without the marker": "42501",
      "marker for another sale": "42501",
      "marked, cost changed too": "42501",
      "marked, revenue changed too": "42501",
      "marked, date changed too": "42501",
      "marked, seller changed too": "42501",
      "marked, original name not kept": "42501",
      "marked, no one linked it": "42501",
      "marked, still outside": "42501",
      "marked, an account sale": "42501",
      "marked, deleted": "42501",
      "marked, an allocation changed": "42501",
      "marked, the link": "ok",
      "marked, linked again elsewhere": "42501",
      after: "account/Owner Kwame/K. Osei/6.20/2",
    });
  });

  it("every inserted sale names a current admin as its seller and is never born linked", () => {
    const item = quote(fixture.itemId);
    const lot = `(select id from public.business_purchases where stock_item_id = ${item} limit 1)`;
    const insert = (seller: string, extra = "", extraValues = "") =>
      `with s as (insert into public.business_sales (stock_item_id, sold_on, quantity, unit_price, revenue, cost, buyer_type, buyer_name, idempotency_key, recorded_by, seller_id, seller_name${extra})
         values (${item}, '2026-08-05', 1, 10, 10, 3.10, 'outside', 'Direct', gen_random_uuid(), ${quote(fixture.marcoId)}, ${seller}${extraValues}) returning id)
       insert into public.business_sale_allocations (sale_id, purchase_id, quantity, unit_cost, received_on)
       select s.id, ${lot}, 1, 3.10, '2026-08-01' from s`;
    const out = psql(
      "begin;\n" +
        attempt("no seller", insert("null, null")) +
        attempt("a seller without a name", insert(`${quote(fixture.marcoId)}, null`)) +
        attempt("a researcher as seller", insert(`${quote(fixture.kwameId)}, 'Owner Kwame'`)) +
        attempt("an unknown seller", insert(`${quote(randomUUID())}, 'Nobody'`)) +
        attempt("born linked", insert(`${quote(fixture.marcoId)}, 'Owner Marco'`, ", original_buyer_name, linked_at, linked_by", `, 'X', now(), ${quote(fixture.marcoId)}`)) +
        attempt("an admin as seller", insert(`${quote(fixture.brianId)}, 'Owner Brian'`)) +
        "rollback;\n",
    );
    expect(out).toEqual({
      "no seller": "23502",
      "a seller without a name": "23502",
      "a researcher as seller": "AP029",
      "an unknown seller": "AP029",
      "born linked": "23514",
      "an admin as seller": "ok",
    });
  });
});

describe("A7 per-seller totals past 1,000 sales", () => {
  it("are exact and complete over 1,050 sales, one row per seller, whatever the page size", async () => {
    const item = quote(fixture.itemId);
    const COUNT = 1050;
    // Committed: 1,050 sales on this file's own item, recorded as Marco through record_business_sale.
    psql(`
      begin;
      ${asAdmin()}
      do $$
      begin
        for i in 1..${COUNT} loop
          perform public.record_business_sale(
            gen_random_uuid(), ${item}, date '2026-09-01' + (i % 20), 1 + (i % 2), ((i % 7) + 10)::text || '.25', null, 'Bulk ' || i,
            case when i % 3 = 0 then ${quote(fixture.brianId)}::uuid else ${quote(fixture.marcoId)}::uuid end);
        end loop;
      end $$;
      commit;
    `);
    const expected = new Map<string, { sales: number; vials: number; revenue: Decimal }>();
    for (let i = 1; i <= COUNT; i++) {
      const seller = i % 3 === 0 ? fixture.brianId : fixture.marcoId;
      const quantity = 1 + (i % 2);
      const row = expected.get(seller) ?? { sales: 0, vials: 0, revenue: new Decimal(0) };
      expected.set(seller, { sales: row.sales + 1, vials: row.vials + quantity, revenue: row.revenue.plus(new Decimal(`${(i % 7) + 10}.25`).times(quantity)) });
    }
    const db = await signedInClient(marco.email);
    const september = { from: "2026-09-01", to: "2026-09-30", stockItemId: fixture.itemId };
    const totals = await listSellerTotals(db, september);
    expect(totals.map((row) => row.sellerName)).toEqual([brian.name, marco.name]);
    for (const row of totals) {
      const want = expected.get(row.sellerId!)!;
      // Every vial came from the one lot at CAD 3.10.
      const cost = new Decimal("3.10").times(want.vials);
      expect(row).toMatchObject({
        sales: want.sales,
        vials: want.vials,
        revenue: want.revenue.toFixed(2),
        cost: cost.toFixed(2),
        grossProfit: want.revenue.minus(cost).toFixed(2),
      });
    }
    expect(totals.reduce((n, row) => n + row.sales, 0)).toBe(COUNT);
    expect(await listSellerTotals(db, september, { pageSize: 1 })).toEqual(totals);
    // The report's totals for the same view agree, and so does the owner's own sum.
    const report = await listSales(db, september);
    expect(report.totals.sales).toBe(COUNT);
    expect(report.totals.revenue).toBe(totals.reduce((sum, row) => sum.plus(row.revenue), new Decimal(0)).toFixed(2));
    const owner = psql(`select 'sum', count(*) || '/' || sum(revenue) from public.business_sales where stock_item_id = ${item} and sold_on >= '2026-09-01';`);
    expect(owner.sum).toBe(`${COUNT}/${report.totals.revenue}`);
  });
});
