// 20260927140000_purchase_currency.sql as the database owner (psql, always
// rolled back): the migration applies on top of recorded CAD purchases and
// sales, as production holds them (opening stock), and leaves them CAD with no
// conversion; the table's own checks refuse an inconsistent USD row whatever
// writes it; a stored Bank of Canada rate can't be changed or removed, even by
// the owner. Runs in the integration-exclusive project (vitest.config.mts):
// the rehearsal drops and re-adds business_purchases columns inside its
// transaction, which locks the table until the rollback.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { recordPurchase, recordSale } from "@/lib/inventory/service";
import { psql, quote } from "../support/psql";
import { ensureAccount, signedInClient, uniqueEmail } from "../support/local-supabase";

const admin = { email: uniqueEmail("usd-owner-admin"), name: "USD Owner Admin" };
const fixture = { adminId: "", itemId: "" };

beforeAll(async () => {
  fixture.adminId = await ensureAccount({ ...admin, role: "admin" });
  const db = await signedInClient(admin.email);
  const name = `Compound Owner ${randomBytes(4).toString("hex")}`;
  const { data: peptideId, error } = await db.rpc("save_library_peptide", {
    p_name: name,
    p_information: `[Supplied information for ${name}]`,
    p_cycling_off_guidance: "",
    p_supplement_guidance: "",
    p_available: true,
  });
  if (error) throw error;
  // Opening stock: CAD purchases, one of them already allocated to a sale.
  let itemId: string | null = null;
  for (const [unitCost, quantity] of [["11.47", 30], ["25.50", 5]] as const) {
    const bought = await recordPurchase(db, {
      idempotencyKey: randomUUID(),
      stockItemId: itemId,
      peptideId: itemId ? null : peptideId!,
      strengthMg: itemId ? null : "10",
      receivedOn: "2026-09-27",
      quantity,
      unitCost,
    });
    if (bought.kind !== "recorded") throw new Error(bought.kind);
    itemId = bought.stockItemId;
  }
  const sale = await recordSale(db, {
    idempotencyKey: randomUUID(),
    stockItemId: itemId!,
    soldOn: "2026-09-27",
    quantity: 12,
    unitPrice: "40",
    sellerId: fixture.adminId,
    buyer: { type: "outside", name: "Walk-in" },
  });
  if (sale.kind !== "recorded") throw new Error(sale.kind);
  fixture.itemId = itemId!;
});

const asAdmin = () =>
  `set local role authenticated;\nset local "request.jwt.claims" to '${JSON.stringify({ sub: fixture.adminId, role: "authenticated" })}';\n`;

describe("the purchase currency migration", () => {
  it("applies on top of recorded CAD purchases and sales, which stay CAD and keep working", () => {
    const item = quote(fixture.itemId);
    const out = psql(`
      begin;
      -- The schema as it was before 20260927140000 (production today).
      drop function public.record_business_purchase_fx(uuid, date, integer, text, text, text, text, date, uuid, uuid, text);
      drop function public.store_fx_rates(jsonb);
      drop table public.fx_rates;
      drop function public.fx_rates_guard();
      drop function public.parse_fx_rate(text);
      alter table public.business_purchases
        drop column original_currency, drop column original_unit_cost, drop column fx_rate, drop column fx_rate_date;
      select 'before', count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'business_purchases' and column_name like 'fx%';

      \\i supabase/migrations/20260927140000_purchase_currency.sql

      select 'rows', string_agg(concat_ws(':', original_currency, coalesce(original_unit_cost::text, '-'),
               coalesce(fx_rate::text, '-'), coalesce(fx_rate_date::text, '-'), unit_cost::text), ',' order by recorded_order)
        from public.business_purchases where stock_item_id = ${item};
      select 'others', count(*) from public.business_purchases
        where original_currency <> 'CAD' or original_unit_cost is not null or fx_rate is not null or fx_rate_date is not null;
      select 'invalid', count(*) from pg_constraint
        where conrelid = 'public.business_purchases'::regclass and not convalidated;
      select 'rates', count(*) from public.fx_rates;
      -- The real Aug 26 rate, stored as the daily sync would (its function is the secret key's).
      set local role service_role;
      select 'stored', stored from public.store_fx_rates('[{"date": "2026-08-26", "rate": "1.3876"}]');
      reset role;
      ${asAdmin()}
      select 'lots', string_agg(concat_ws('/', unit_cost, original_currency, coalesce(fx_rate, '-'), allocated), ',' order by recorded_order)
        from public.admin_business_lots(${item});
      select 'cad', replayed from public.record_business_purchase(gen_random_uuid(), '2026-09-27', 1, '20', ${item});
      select 'usd', replayed from public.record_business_purchase_fx(gen_random_uuid(), '2026-08-26', 1, 'USD', '15.26', '11', '1.3876', '2026-08-26', ${item});
      rollback;
    `);
    expect(out.before).toBe("0");
    expect(out.rows).toBe("CAD:-:-:-:11.47,CAD:-:-:-:25.50");
    expect(out.others).toBe("0");
    expect(out.invalid).toBe("0");
    expect(out.rates).toBe("0");
    expect(out.stored).toBe("1");
    expect(out.lots).toBe("11.47/CAD/-/12,25.50/CAD/-/0");
    expect(out.cad).toBe("f");
    expect(out.usd).toBe("f");
  });

  it("the table refuses an inconsistent conversion from any writer (the owner included)", () => {
    const item = quote(fixture.itemId);
    const insert = (values: string) => `
      begin;
      insert into public.business_purchases
        (stock_item_id, received_on, quantity, idempotency_key, recorded_by,
         unit_cost, original_currency, original_unit_cost, fx_rate, fx_rate_date)
      values (${item}, '2026-08-26', 1, gen_random_uuid(), ${quote(fixture.adminId)}, ${values});
      select 'ok', 'inserted';
      rollback;
    `;
    const refused = (values: string) => expect(() => psql(insert(values))).toThrow(/business_purchases_(conversion|original_currency)/);
    refused(`15.27, 'USD', 11, 1.3876, '2026-08-26'`); // not round(11 × 1.3876, 2) = 15.26
    refused(`15.26, 'USD', 11, 1.3876, null`);
    refused(`15.26, 'USD', 11, 1.3876, '2026-08-27'`); // rate after the date received
    refused(`15.26, 'USD', 11, 1.3876, '2026-08-15'`); // 11 days before
    refused(`15.26, 'USD', 11, 1.3876543, '2026-08-26'`); // more than 6 decimals
    refused(`15.26, 'CAD', 11, 1.3876, '2026-08-26'`); // a CAD row has no conversion
    refused(`15.26, 'EUR', null, null, null`);
    // Consistent: round(11 × 1.38765, 2) = 15.26 (15.26415), half-up at the cent.
    expect(psql(insert(`15.26, 'USD', 11, 1.38765, '2026-08-26'`)).ok).toBe("inserted");
    expect(psql(insert(`0.02, 'USD', 0.01, 1.5, '2026-08-26'`)).ok).toBe("inserted"); // 0.015 → 0.02
  });

  it("a stored rate is never changed or removed, not even by the owner; the table's checks hold", () => {
    const rate = (sql: string) => `
      begin;
      insert into public.fx_rates (rate_date, usd_cad) values ('2001-06-15', 1.5) on conflict do nothing;
      ${sql};
      select 'ok', 'done';
      rollback;
    `;
    for (const sql of [
      "update public.fx_rates set usd_cad = 1.6 where rate_date = '2001-06-15'",
      "delete from public.fx_rates where rate_date = '2001-06-15'",
      "truncate public.fx_rates",
    ]) {
      expect(() => psql(rate(sql)), sql).toThrow(/a stored Bank of Canada rate cannot be changed or removed/);
    }
    expect(() => psql(rate("insert into public.fx_rates (rate_date, usd_cad) values ('1999-12-31', 1.5)"))).toThrow(/fx_rates_rate_date_check/);
    expect(() => psql(rate("insert into public.fx_rates (rate_date, usd_cad) values ('2001-06-16', 1.1234567)"))).toThrow(/fx_rates_usd_cad_check/);
    expect(() => psql(rate("insert into public.fx_rates (rate_date, usd_cad, source) values ('2001-06-16', 1.5, 'typed')"))).toThrow(/fx_rates_source_check/);
    expect(psql(rate("select 1")).ok).toBe("done");
  });
});
