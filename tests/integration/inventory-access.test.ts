// S5 access rules for business inventory, against the real local Supabase:
// admin-only reads and writes, no direct table writes for any API role (the
// secret key included), and append-only records even for the database owner
// (psql, always rolled back). Researchers, acknowledged or not, and anonymous
// callers read nothing, including a sale that names them as the buyer.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { listBuyerAccounts, listSales, listStock, recordPurchase, recordSale } from "@/lib/inventory/service";
import { anonClient, ensureAccount, localSupabase, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

type Client = Awaited<ReturnType<typeof signedInClient>>;

const admin = { email: uniqueEmail("s5-acc-admin"), name: "S5 Access Admin" };
const newAdmin = { email: uniqueEmail("s5-acc-new-admin"), name: "S5 Unacknowledged Admin" };
const buyer = { email: uniqueEmail("s5-acc-buyer"), name: "S5 Buyer Researcher" };
const newResearcher = { email: uniqueEmail("s5-acc-new"), name: "S5 Unacknowledged Researcher" };

const TABLES = ["business_stock_items", "business_purchases", "business_sales", "business_sale_allocations"] as const;
const fixture = { stockItemId: "", purchaseId: "", saleId: "", buyerId: "" };
let adminDb: Client;

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...newAdmin, role: "admin", acknowledged: false });
  fixture.buyerId = await ensureAccount({ ...buyer, role: "researcher" });
  await ensureAccount({ ...newResearcher, role: "researcher", acknowledged: false });
  adminDb = await signedInClient(admin.email);

  const name = `Access ${randomBytes(4).toString("hex")}`;
  const { data: peptideId } = await adminDb.rpc("save_library_peptide", {
    p_name: name,
    p_information: `[Supplied information for ${name}]`,
    p_cycling_off_guidance: "",
    p_supplement_guidance: "",
    p_available: true,
  });
  const purchase = await recordPurchase(adminDb, {
    idempotencyKey: randomUUID(),
    stockItemId: null,
    peptideId: peptideId!,
    strengthMg: "8",
    receivedOn: "2026-08-15",
    quantity: 10,
    unitCost: "20",
  });
  if (purchase.kind !== "recorded") throw new Error(purchase.kind);
  const sale = await recordSale(adminDb, {
    idempotencyKey: randomUUID(),
    stockItemId: purchase.stockItemId,
    soldOn: "2026-08-20",
    quantity: 3,
    unitPrice: "40",
    buyer: { type: "account", profileId: fixture.buyerId },
  });
  if (sale.kind !== "recorded") throw new Error(sale.kind);
  Object.assign(fixture, { stockItemId: purchase.stockItemId, purchaseId: purchase.purchaseId, saleId: sale.saleId });
});

/** Every admin-only function, called with valid arguments for the fixture. */
const calls = (db: Client) => ({
  record_business_purchase: () =>
    db.rpc("record_business_purchase", {
      p_idempotency_key: randomUUID(),
      p_received_on: "2026-08-15",
      p_quantity: 1,
      p_unit_cost: "1",
      p_stock_item_id: fixture.stockItemId,
    }),
  record_business_sale: () =>
    db.rpc("record_business_sale", {
      p_idempotency_key: randomUUID(),
      p_stock_item_id: fixture.stockItemId,
      p_sold_on: "2026-08-20",
      p_quantity: 1,
      p_unit_price: "1",
      p_buyer_name: "Forged",
    }),
  admin_business_stock: () => db.rpc("admin_business_stock"),
  admin_business_lots: () => db.rpc("admin_business_lots", { p_stock_item_id: fixture.stockItemId }),
  admin_business_sales_totals: () => db.rpc("admin_business_sales_totals", {}),
  business_buyer_accounts: () => db.rpc("business_buyer_accounts"),
});

const counts = async () => {
  const service = serviceClient();
  const [purchases, sales] = await Promise.all([
    service.from("business_purchases").select("id").eq("stock_item_id", fixture.stockItemId),
    service.from("business_sales").select("id").eq("stock_item_id", fixture.stockItemId),
  ]);
  return { purchases: purchases.data!.length, sales: sales.data!.length };
};

describe("only admins read or record business inventory", () => {
  it("researchers (acknowledged or not, even the sale's buyer) read no rows and every function refuses them", async () => {
    const before = await counts();
    for (const email of [buyer.email, newResearcher.email]) {
      const db = await signedInClient(email);
      for (const table of TABLES) {
        const { data, error } = await db.from(table).select("*");
        expect(error, `${email} ${table}`).toBeNull();
        expect(data, `${email} ${table}`).toEqual([]);
      }
      for (const [name, call] of Object.entries(calls(db))) {
        expect((await call()).error?.code, `${email} ${name}`).toBe("42501");
      }
      await expect(listStock(db)).rejects.toThrow();
      await expect(listSales(db)).rejects.toThrow();
      await expect(listBuyerAccounts(db)).rejects.toThrow();
      expect((await recordSale(db, { idempotencyKey: randomUUID(), stockItemId: fixture.stockItemId, soldOn: "2026-08-20", quantity: 1, unitPrice: "1", buyer: { type: "outside", name: "x" } })).kind).toBe("not_authorized");
    }
    expect(await counts()).toEqual(before);
  });

  it("anonymous callers have no access at all", async () => {
    const db = anonClient();
    for (const table of TABLES) {
      expect((await db.from(table).select("*")).error?.code, table).toBe("42501");
    }
    for (const [name, call] of Object.entries(calls(db as Client))) {
      expect((await call()).error?.code, name).toBe("42501");
    }
  });

  it("an admin reads every table; the back office does not need the researcher acknowledgement", async () => {
    for (const table of TABLES) {
      const { data, error } = await adminDb.from(table).select("*").limit(1);
      expect(error, table).toBeNull();
      expect(data!.length, table).toBe(1);
    }
    const db = await signedInClient(newAdmin.email);
    for (const [name, call] of Object.entries(calls(db))) {
      expect((await call()).error, name).toBeNull();
    }
  });
});

describe("no direct table writes through the API", () => {
  it("admins and the secret key cannot insert, update or delete any inventory row", async () => {
    const before = await counts();
    for (const db of [adminDb, serviceClient() as unknown as Client]) {
      const rows = {
        business_stock_items: { peptide_id: randomUUID(), strength_mg: 1 },
        business_purchases: { stock_item_id: fixture.stockItemId, received_on: "2026-08-01", quantity: 1, unit_cost: 0, idempotency_key: randomUUID() },
        business_sales: {
          stock_item_id: fixture.stockItemId, sold_on: "2026-08-01", quantity: 1, unit_price: 0, revenue: 0, cost: 0,
          buyer_type: "outside" as const, buyer_name: "Forged", idempotency_key: randomUUID(),
        },
        business_sale_allocations: { sale_id: fixture.saleId, purchase_id: fixture.purchaseId, quantity: 1, unit_cost: 0, received_on: "2026-08-01" },
      };
      for (const table of TABLES) {
        expect((await db.from(table).insert(rows[table] as never)).error?.code, `insert ${table}`).toBe("42501");
      }
      expect((await db.from("business_sales").update({ cost: 0 }).eq("id", fixture.saleId)).error?.code).toBe("42501");
      expect((await db.from("business_purchases").update({ unit_cost: 1 }).eq("id", fixture.purchaseId)).error?.code).toBe("42501");
      expect((await db.from("business_sale_allocations").delete().eq("sale_id", fixture.saleId)).error?.code).toBe("42501");
      expect((await db.from("business_stock_items").delete().eq("id", fixture.stockItemId)).error?.code).toBe("42501");
    }
    expect(await counts()).toEqual(before);
    const { data: sale } = await serviceClient().from("business_sales").select("cost::text, revenue::text").eq("id", fixture.saleId).single();
    expect(sale).toEqual({ cost: "60.00", revenue: "120.00" });
  });
});

/** Runs a script with psql as the database owner; `label\tvalue` rows come back as a map. */
function psql(sql: string): Record<string, string> {
  let out: string;
  try {
    out = execFileSync("psql", [localSupabase().dbUrl, "-X", "-q", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1"], {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const e = error as { code?: string; stderr?: string };
    if (e.code === "ENOENT") throw new Error("psql is required for this test (PostgreSQL client tools).");
    throw new Error(`psql failed: ${e.stderr ?? String(error)}`);
  }
  return Object.fromEntries(out.split("\n").filter(Boolean).map((line) => line.split("\t") as [string, string]));
}

/** Runs a statement; reports the SQLSTATE it failed with, or "ok". Deferred checks fire inside. */
const attempt = (label: string, statement: string) => `do $$
begin
  ${statement};
  set constraints all immediate;
  perform set_config('s5.result', 'ok', true);
exception when others then
  perform set_config('s5.result', sqlstate, true);
end $$;
select '${label}', current_setting('s5.result');\n`;

describe("recorded purchases and sales are append-only, even for the database owner", () => {
  it("updates, deletes and truncation are refused; a sale without matching allocations cannot commit", () => {
    const { saleId, purchaseId, stockItemId } = fixture;
    const result = psql(
      "begin;\n" +
        attempt("sale cost", `update public.business_sales set cost = 0 where id = '${saleId}'`) +
        attempt("sale price", `update public.business_sales set unit_price = 1, revenue = 3 where id = '${saleId}'`) +
        attempt("sale buyer", `update public.business_sales set buyer_name = 'Changed' where id = '${saleId}'`) +
        attempt("sale delete", `delete from public.business_sales where id = '${saleId}'`) +
        attempt("purchase cost", `update public.business_purchases set unit_cost = 1 where id = '${purchaseId}'`) +
        attempt("purchase qty", `update public.business_purchases set quantity = 2 where id = '${purchaseId}'`) +
        attempt("purchase delete", `delete from public.business_purchases where id = '${purchaseId}'`) +
        attempt("allocation qty", `update public.business_sale_allocations set quantity = 1 where sale_id = '${saleId}'`) +
        attempt("allocation delete", `delete from public.business_sale_allocations where sale_id = '${saleId}'`) +
        attempt("item delete", `delete from public.business_stock_items where id = '${stockItemId}'`) +
        attempt("truncate", `truncate public.business_sale_allocations`) +
        attempt(
          "sale without allocations",
          `insert into public.business_sales (stock_item_id, sold_on, quantity, unit_price, revenue, cost, buyer_type, buyer_name, idempotency_key)
           values ('${stockItemId}', '2026-08-21', 1, 10, 10, 0, 'outside', 'Forged', gen_random_uuid())`,
        ) +
        attempt(
          "lot over-allocated",
          `with s as (
             insert into public.business_sales (stock_item_id, sold_on, quantity, unit_price, revenue, cost, buyer_type, buyer_name, idempotency_key)
             values ('${stockItemId}', '2026-08-21', 8, 10, 80, 160, 'outside', 'Forged', gen_random_uuid()) returning id)
           insert into public.business_sale_allocations (sale_id, purchase_id, quantity, unit_cost, received_on)
           select s.id, '${purchaseId}', 8, 20, '2026-08-15' from s`,
        ) +
        `select 'sale', cost || '/' || revenue || '/' || buyer_name from public.business_sales where id = '${saleId}';\n` +
        "rollback;\n",
    );
    expect(result).toEqual({
      "sale cost": "42501",
      "sale price": "42501",
      "sale buyer": "42501",
      "sale delete": "42501",
      "purchase cost": "42501",
      "purchase qty": "42501",
      "purchase delete": "42501",
      "allocation qty": "42501",
      "allocation delete": "42501",
      "item delete": "42501",
      truncate: "42501",
      "sale without allocations": "23514",
      "lot over-allocated": "23514",
      sale: `60.00/120.00/${buyer.name}`,
    });
  });
});
