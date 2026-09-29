// V6 records (20260929100000_records.sql) against the real local Supabase:
// A4's sale preview is the allocation record_business_sale freezes (one lot,
// several lots, a USD lot, a zero price, a sale dated before its purchase);
// a sale whose preview is out of date is refused (AP037) and nothing is
// recorded; purchases record their supplier (trimmed, limited, insert-only),
// suppliers are listed to admins only; the Ledger reads (by day and month,
// seller filter, inclusive day ranges); and both record actions replay a
// submission instead of recording it twice, a lost answer included. The
// actions run as the signed-in person, with only the request's cookie session
// swapped for a signed-in client. Over 1,000 rows, Toronto day boundaries and
// the migration rehearsal: records-owner.test.ts.
import { randomBytes, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/business/period";
import { PREVIEW_REQUIRED, PURCHASE_ALREADY_RECORDED, SALE_ALREADY_RECORDED, stockChangedMessage, SUPPLIER_TOO_LONG } from "@/lib/inventory/rules";
import { SUBMISSION_CONFLICT } from "@/lib/inventory/screens";
import type { Db } from "@/lib/inventory/service";
import { expectedAllocation, recordAttempt, SAVE_UNSURE, STOCK_CHANGED, type RecordAttempt, type SalePreview } from "@/lib/records/forms";
import { byDay, byMonth, saleTotals } from "@/lib/records/ledger";
import { ledgerMonthItems, ledgerPurchases, ledgerSales } from "@/lib/records/ledger-service";
import { listSuppliers, salePreview } from "@/lib/records/service";
import { anonClient, answerLostClient, ensureAccount, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import { savePeptideAs } from "../support/admin-writers";

const acting = vi.hoisted(() => ({ client: null as unknown, refreshed: 0, revalidated: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({
  refresh: () => void acting.refreshed++,
  revalidatePath: (path: string) => void acting.revalidated.push(path),
}));
// The Bank of Canada behind the stored rates is the local test stub (never the real API).
const STORED = { "2026-08-26": "1.3876", "2026-08-28": "1.3888" };
process.env.BOC_FX_TEST_RATES = JSON.stringify(STORED);
const { recordPurchaseAction, recordSaleAction } = await import("@/app/(private)/admin/inventory/actions");

const admin = { email: uniqueEmail("v6-rec-int-admin"), name: "Priya Records" };
const second = { email: uniqueEmail("v6-rec-int-second"), name: "Owen Records" };
const researcher = { email: uniqueEmail("v6-rec-int-researcher"), name: "V6 Records Researcher" };
const id = { admin: "", second: "", researcher: "" };
let db: Db;

beforeAll(async () => {
  id.admin = await ensureAccount({ ...admin, role: "admin" });
  id.second = await ensureAccount({ ...second, role: "admin" });
  id.researcher = await ensureAccount({ ...researcher, role: "researcher" });
  db = await signedInClient(admin.email);
  const rates = Object.entries(STORED).map(([date, rate]) => ({ date, rate }));
  const { data, error } = await serviceClient().rpc("store_fx_rates", { p_rates: rates }).single();
  expect(error).toBeNull();
  expect(data).toMatchObject({ invalid: 0, conflicts: [] });
});

beforeEach(() => {
  acting.client = db;
  acting.refreshed = 0;
  acting.revalidated = [];
});

/** A new stock item (its own library peptide) and its first lot, as the Record purchase sheet sends it. */
async function newItem(receivedOn: string, quantity: number, unitCost: string, supplier = ""): Promise<string> {
  const name = `Compound V6 ${randomBytes(4).toString("hex")}`;
  const { data: peptideId, error } = await savePeptideAs(db, {
    p_name: name,
    p_information: `[Supplied information for ${name}]`,
    p_cycling_off_guidance: "",
    p_supplement_guidance: "",
    p_available: true,
  });
  expect(error).toBeNull();
  const bought = await recordPurchaseAction(
    purchase({ stockItemId: "new", peptideId: peptideId!, strengthMg: "10", receivedOn, quantity: String(quantity), unitCost, supplier }),
  );
  expect(bought.tone).toBe("info");
  return bought.stockItemId!;
}

const purchase = (fields: Record<string, string>) => ({
  idempotencyKey: randomUUID(),
  stockItemId: "",
  peptideId: "",
  strengthMg: "",
  currency: "CAD",
  supplier: "",
  ...fields,
});
const buy = (stockItemId: string, receivedOn: string, quantity: number, unitCost: string, fields: Record<string, string> = {}) =>
  recordPurchaseAction(purchase({ stockItemId, receivedOn, quantity: String(quantity), unitCost, ...fields }));

const saleEntry = (stockItemId: string, fields: Record<string, string>) => ({
  stockItemId,
  soldOn: "2026-09-02",
  sellerId: id.admin,
  buyerType: "outside",
  buyerProfileId: "",
  buyerName: "Walk-in V6",
  ...fields,
});

async function preview(stockItemId: string, quantity: number): Promise<SalePreview> {
  const result = await salePreview(db, stockItemId, quantity);
  if (result.kind !== "preview") throw new Error(result.kind);
  return result.preview;
}

/** Previews, then records exactly as the sheet does (the preview's lots sent with the sale). */
async function previewThenSell(stockItemId: string, quantity: number, unitPrice: string, soldOn = "2026-09-02") {
  const shown = await preview(stockItemId, quantity);
  const result = await recordSaleAction({
    ...saleEntry(stockItemId, { soldOn, quantity: String(quantity), unitPrice }),
    idempotencyKey: randomUUID(),
    expectedAllocation: expectedAllocation(shown),
  });
  return { shown, result };
}

const salesOf = async (stockItemId: string) =>
  (
    await serviceClient()
      .from("business_sales")
      .select("id, idempotency_key, quantity, revenue, cost, gross_profit, sold_on, business_sale_allocations(purchase_id, quantity, unit_cost)")
      .eq("stock_item_id", stockItemId)
      .order("recorded_at")
  ).data!;
const purchasesOf = async (stockItemId: string) =>
  (
    await serviceClient()
      .from("business_purchases")
      .select("id, quantity, unit_cost, supplier, original_currency")
      .eq("stock_item_id", stockItemId)
      .order("recorded_order")
  ).data!;

/** A sale's frozen allocation, as the preview lists lots. */
const frozen = (sale: Awaited<ReturnType<typeof salesOf>>[number]) =>
  sale.business_sale_allocations
    .map((lot) => ({ purchaseId: lot.purchase_id, quantity: lot.quantity, unitCost: new Decimal(lot.unit_cost).toFixed(2) }))
    .sort((a, b) => a.purchaseId.localeCompare(b.purchaseId));
const shownLots = (shown: SalePreview) =>
  shown.lots.map((lot) => ({ purchaseId: lot.purchaseId, quantity: lot.quantity, unitCost: lot.unitCost })).sort((a, b) => a.purchaseId.localeCompare(b.purchaseId));

describe("A4: the preview is the allocation the sale freezes", () => {
  it("one lot: the lot, its cost, and the same on the recorded sale", async () => {
    const item = await newItem("2026-08-30", 10, "13.38");
    const { shown, result } = await previewThenSell(item, 3, "120");
    const [lot] = await purchasesOf(item);
    expect(shown).toEqual({
      stockItemId: item,
      quantity: 3,
      onHand: 10,
      short: false,
      cost: "40.14",
      lots: [
        { purchaseId: lot.id, quantity: 3, unitCost: "13.38", receivedOn: "2026-08-30", currency: "CAD", usdUnitCost: null, fxRate: null, supplier: null },
      ],
    });
    expect(result).toEqual({ stockItemId: item, toast: "Sale recorded · 3 vials · $360.00 · gross profit $319.86", tone: "info" });
    const [sale] = await salesOf(item);
    expect(frozen(sale)).toEqual(shownLots(shown));
    expect(new Decimal(sale.cost).toFixed(2)).toBe(shown.cost);
    expect((await preview(item, 7)).onHand).toBe(7);
  });

  it("several lots: every lot the sale takes, oldest first, by date received then recording order", async () => {
    const item = await newItem("2026-08-15", 5, "20");
    await buy(item, "2026-08-01", 5, "13.38", { supplier: "Halcyon Records" });
    // Received the same day as the first, recorded after it: after it in FIFO.
    await buy(item, "2026-08-15", 5, "1.10");
    const shown = await preview(item, 12);
    expect(shown.lots.map((lot) => [lot.receivedOn, lot.quantity, lot.unitCost, lot.supplier])).toEqual([
      ["2026-08-01", 5, "13.38", "Halcyon Records"],
      ["2026-08-15", 5, "20.00", null],
      ["2026-08-15", 2, "1.10", null],
    ]);
    // 5 × 13.38 + 5 × 20.00 + 2 × 1.10 = 169.10
    expect(shown.cost).toBe("169.10");
    const { result } = await previewThenSell(item, 12, "25");
    expect(result.tone).toBe("info");
    const [sale] = await salesOf(item);
    expect(frozen(sale)).toEqual(shownLots(shown));
    expect(sale).toMatchObject({ quantity: 12, revenue: 300, cost: 169.1, gross_profit: 130.9 });
    // The next preview starts where this sale stopped.
    expect((await preview(item, 3)).lots.map((lot) => [lot.unitCost, lot.quantity])).toEqual([["1.10", 3]]);
  });

  it("a lot entered in USD: its CAD cost, with the USD cost and rate it was converted at", async () => {
    const item = await newItem("2026-08-01", 1, "5");
    const usd = await buy(item, "2026-08-26", 10, "11.00", { currency: "USD", supplier: "Northwind Records" });
    expect(usd.toast).toBe("Purchase recorded · 10 vials · $152.60 · US$ 11.00 at 1.3876");
    const shown = await preview(item, 4);
    expect(shown.lots.map((lot) => ({ ...lot, purchaseId: undefined }))).toEqual([
      { purchaseId: undefined, quantity: 1, unitCost: "5.00", receivedOn: "2026-08-01", currency: "CAD", usdUnitCost: null, fxRate: null, supplier: null },
      { purchaseId: undefined, quantity: 3, unitCost: "15.26", receivedOn: "2026-08-26", currency: "USD", usdUnitCost: "11.00", fxRate: "1.3876", supplier: "Northwind Records" },
    ]);
    expect(shown.cost).toBe("50.78");
    await previewThenSell(item, 4, "30");
    const [sale] = await salesOf(item);
    expect(frozen(sale)).toEqual(shownLots(shown));
    expect(new Decimal(sale.cost).toFixed(2)).toBe("50.78");
  });

  it("a zero price: revenue 0 and a gross profit of minus the cost", async () => {
    const item = await newItem("2026-08-01", 3, "10");
    const { shown, result } = await previewThenSell(item, 3, "0");
    expect(result.toast).toBe("Sale recorded · 3 vials · $0.00 · gross profit − $30.00");
    const [sale] = await salesOf(item);
    expect(frozen(sale)).toEqual(shownLots(shown));
    expect(sale).toMatchObject({ revenue: 0, cost: 30, gross_profit: -30 });
  });

  it("a sale dated before the purchase whose stock it uses", async () => {
    const item = await newItem("2026-09-01", 4, "7.25");
    const { shown, result } = await previewThenSell(item, 2, "9", "2026-01-02");
    expect(result.tone).toBe("info");
    const [sale] = await salesOf(item);
    expect(sale.sold_on).toBe("2026-01-02");
    expect(frozen(sale)).toEqual(shownLots(shown));
  });

  it("more than on hand: short, no lots, no cost; the vials must be 1 to 100,000; an unknown item", async () => {
    const item = await newItem("2026-08-01", 2, "10");
    expect(await preview(item, 3)).toEqual({ stockItemId: item, quantity: 3, onHand: 2, short: true, cost: null, lots: [] });
    expect(await sqlState(db.rpc("admin_business_sale_preview", { p_stock_item_id: item, p_quantity: 0 }))).toBe("22023");
    expect(await sqlState(db.rpc("admin_business_sale_preview", { p_stock_item_id: item, p_quantity: 100001 }))).toBe("22023");
    expect(await salePreview(db, randomUUID(), 1)).toEqual({ kind: "unknown_item" });
  });
});

describe("A4: every sale is recorded against its preview", () => {
  it("the action refuses a sale sent without the preview's lots (left out, null or none), and records nothing", async () => {
    const item = await newItem("2026-08-01", 5, "10");
    const entry = saleEntry(item, { quantity: "2", unitPrice: "30" });
    for (const without of [{}, { expectedAllocation: null }, { expectedAllocation: [] }]) {
      const result = await recordSaleAction({ ...entry, idempotencyKey: randomUUID(), ...without });
      expect(result, JSON.stringify(without)).toEqual({ error: PREVIEW_REQUIRED });
    }
    expect(await salesOf(item)).toHaveLength(0);
    // With its preview, the same sale records.
    expect((await previewThenSell(item, 2, "30")).result.tone).toBe("info");
  });

  it("the database refuses one too: no signature takes a sale without it, and null or none is 22023", async () => {
    const item = await newItem("2026-08-01", 5, "10");
    const args = {
      p_idempotency_key: randomUUID(),
      p_stock_item_id: item,
      p_sold_on: "2026-09-02",
      p_quantity: 2,
      p_unit_price: "30",
      p_buyer_name: "Walk-in V6",
      p_seller_id: id.admin,
    };
    // Left out: no function matches the call (the previous signature is dropped).
    const { error } = await db.rpc("record_business_sale", args as never);
    expect(error?.code).toBe("PGRST202");
    for (const empty of [null, []]) {
      expect(await sqlState(db.rpc("record_business_sale", { ...args, p_expected_allocation: empty as never })), JSON.stringify(empty)).toBe("22023");
    }
    expect(await salesOf(item)).toHaveLength(0);
    const lots = expectedAllocation(await preview(item, 2)).map((lot) => ({ purchase_id: lot.purchaseId, quantity: lot.quantity }));
    expect((await db.rpc("record_business_sale", { ...args, p_expected_allocation: lots })).error).toBeNull();
    expect(await salesOf(item)).toHaveLength(1);
  });
});

describe("A4: stock changed between the preview and Record", () => {
  it("another sale in between: refused with AP037, nothing recorded, the vials on hand now; the new preview records", async () => {
    const item = await newItem("2026-08-01", 2, "10");
    await buy(item, "2026-08-10", 5, "20");
    const stale = await preview(item, 3);
    expect(stale.cost).toBe("40.00");
    // Owen sells one from the first lot meanwhile.
    expect((await previewThenSell(item, 1, "30")).result.tone).toBe("info");

    const entry = saleEntry(item, { quantity: "3", unitPrice: "30" });
    const refused = await recordSaleAction({ ...entry, idempotencyKey: randomUUID(), expectedAllocation: expectedAllocation(stale) });
    expect(refused).toEqual({ error: STOCK_CHANGED, stockChanged: { onHand: 6 } });
    expect(acting.refreshed).toBe(1);
    expect(await salesOf(item)).toHaveLength(1);

    const fresh = await preview(item, 3);
    expect(fresh.cost).toBe("50.00");
    const key = randomUUID();
    expect(await recordSaleAction({ ...entry, idempotencyKey: key, expectedAllocation: expectedAllocation(fresh) })).toMatchObject({ tone: "info" });
    // This sale, found by its own key (recorded_at is the clock's, which can step back between two sales).
    const sales = await salesOf(item);
    expect(sales).toHaveLength(2);
    expect(frozen(sales.find((sale) => sale.idempotency_key === key)!)).toEqual(shownLots(fresh));
  });

  it("an older purchase recorded in between changes the lots too; stock short of the vials is still AP001, checked first", async () => {
    const item = await newItem("2026-08-10", 5, "20");
    const stale = await preview(item, 2);
    await buy(item, "2026-08-01", 5, "9");
    const entry = saleEntry(item, { quantity: "2", unitPrice: "30" });
    expect(await recordSaleAction({ ...entry, idempotencyKey: randomUUID(), expectedAllocation: expectedAllocation(stale) })).toEqual({
      error: STOCK_CHANGED,
      stockChanged: { onHand: 10 },
    });
    const many = { ...saleEntry(item, { quantity: "11", unitPrice: "30" }), idempotencyKey: randomUUID(), expectedAllocation: expectedAllocation(stale) };
    expect(await recordSaleAction(many)).toEqual({ error: stockChangedMessage(10), stockChanged: { onHand: 10 } });
    expect(await salesOf(item)).toHaveLength(0);

    // The database itself: AP037 with the vials on hand as its detail; a malformed allocation is 22023.
    const args = {
      p_idempotency_key: randomUUID(),
      p_stock_item_id: item,
      p_sold_on: "2026-09-02",
      p_quantity: 2,
      p_unit_price: "30",
      p_buyer_name: "Walk-in V6",
      p_seller_id: id.admin,
    };
    const expected = stale.lots.map((lot) => ({ purchase_id: lot.purchaseId, quantity: lot.quantity }));
    const { error } = await db.rpc("record_business_sale", { ...args, p_expected_allocation: expected });
    expect(error).toMatchObject({ code: "AP037", details: "10" });
    for (const malformed of [{ purchase_id: stale.lots[0].purchaseId }, [{ purchase_id: "x", quantity: 2 }], [{ purchase_id: stale.lots[0].purchaseId, quantity: "2" }]]) {
      expect(await sqlState(db.rpc("record_business_sale", { ...args, p_expected_allocation: malformed }))).toBe("22023");
    }
    expect(await salesOf(item)).toHaveLength(0);
  });

  it("a replay is compared with the details entered only: a retry with its first preview replays whatever stock did since", async () => {
    const item = await newItem("2026-08-01", 6, "10");
    const shown = await preview(item, 2);
    const sale = { ...saleEntry(item, { quantity: "2", unitPrice: "30" }), idempotencyKey: randomUUID(), expectedAllocation: expectedAllocation(shown) };
    expect(await recordSaleAction(sale)).toMatchObject({ tone: "info" });
    await previewThenSell(item, 1, "30");
    expect(await recordSaleAction(sale)).toEqual({ stockItemId: item, toast: SALE_ALREADY_RECORDED, tone: "warn" });
    expect(await salesOf(item)).toHaveLength(2);
  });
});

describe("A5: the supplier", () => {
  it("is recorded trimmed, blank as none, up to 120 characters; the same request key with another supplier is refused", async () => {
    const item = await newItem("2026-08-01", 1, "5", "  Halcyon   Peptides  ");
    const long = "S".repeat(120);
    expect(await buy(item, "2026-08-02", 1, "5", { supplier: "   " })).toMatchObject({ tone: "info" });
    expect(await buy(item, "2026-08-03", 1, "5", { supplier: long })).toMatchObject({ tone: "info" });
    expect(await buy(item, "2026-08-04", 1, "5", { supplier: `${long}S` })).toEqual({ error: SUPPLIER_TOO_LONG });
    expect((await purchasesOf(item)).map((row) => row.supplier)).toEqual(["Halcyon   Peptides", null, long]);

    // The database checks it again (trim_whitespace, then 1 to 120 characters).
    const args = { p_idempotency_key: randomUUID(), p_stock_item_id: item, p_received_on: "2026-08-05", p_quantity: 1, p_unit_cost: "5", p_original_currency: "CAD" };
    expect(await sqlState(db.rpc("record_business_purchase_fx", { ...args, p_supplier: `${long}S` }))).toBe("22023");
    const { data, error } = await db.rpc("record_business_purchase_fx", { ...args, p_supplier: "  Northwind\t" }).single();
    expect(error).toBeNull();
    expect((await purchasesOf(item)).at(-1)).toMatchObject({ id: data!.purchase_id, supplier: "Northwind" });
    expect(await sqlState(db.rpc("record_business_purchase_fx", { ...args, p_supplier: "Northwind Labs" }))).toBe("AP005");

    // Through the action: the same entry again replays; the same key with another supplier is a conflict.
    const entry = purchase({ stockItemId: item, receivedOn: "2026-08-06", quantity: "2", unitCost: "4", supplier: "Kestrel" });
    expect(await recordPurchaseAction(entry)).toMatchObject({ toast: "Purchase recorded · 2 vials · $8.00", tone: "info" });
    expect(await recordPurchaseAction(entry)).toEqual({ stockItemId: item, toast: PURCHASE_ALREADY_RECORDED, tone: "warn" });
    expect(await recordPurchaseAction({ ...entry, supplier: "Kestrel Labs" })).toEqual({ toast: SUBMISSION_CONFLICT });
    expect((await purchasesOf(item)).filter((row) => row.supplier?.startsWith("Kestrel"))).toHaveLength(1);
  });

  it("is insert-only: no one changes a recorded purchase's supplier through the API", async () => {
    const item = await newItem("2026-08-01", 1, "5", "Original Supplier");
    const [lot] = await purchasesOf(item);
    expect((await db.from("business_purchases").update({ supplier: "Changed" }).eq("id", lot.id)).error?.code).toBe("42501");
    expect((await serviceClient().from("business_purchases").update({ supplier: "Changed" }).eq("id", lot.id)).error?.code).toBe("42501");
    expect((await purchasesOf(item))[0].supplier).toBe("Original Supplier");
  });

  it("past suppliers are listed to admins only: one per name in any case, with its latest spelling; researchers and anon are refused", async () => {
    const tag = randomBytes(3).toString("hex");
    const item = await newItem("2026-07-01", 1, "5", `Aurora ${tag} Labs`);
    await buy(item, "2026-07-20", 1, "5", { supplier: `AURORA ${tag} LABS` });
    await buy(item, "2026-07-10", 1, "5", { supplier: `Borealis ${tag}` });
    const mine = (await listSuppliers(db)).filter((row) => row.key.includes(tag));
    expect(mine).toEqual([
      { key: `aurora ${tag} labs`, name: `AURORA ${tag} LABS`, orders: 2, lastReceived: "2026-07-20" },
      { key: `borealis ${tag}`, name: `Borealis ${tag}`, orders: 1, lastReceived: "2026-07-10" },
    ]);
    expect(await listSuppliers(db, { pageSize: 1 })).toEqual(await listSuppliers(db));

    const researcherDb = await signedInClient(researcher.email);
    expect(await sqlState(researcherDb.rpc("admin_business_suppliers"))).toBe("42501");
    expect(await sqlState(anonClient().rpc("admin_business_suppliers"))).toBe("42501");
    const { data } = await researcherDb.from("business_purchases").select("supplier").eq("stock_item_id", item);
    expect(data ?? []).toEqual([]);
  });
});

describe("the new reads are for admins only", () => {
  it("a researcher and anon are refused every preview and Ledger read; no API role runs the FIFO helper", async () => {
    const item = await newItem("2026-08-01", 1, "5");
    const range = { p_from: "2026-08-01", p_to: "2026-08-31" };
    const calls = (client: Db) => [
      client.rpc("admin_business_sale_preview", { p_stock_item_id: item, p_quantity: 1 }),
      client.rpc("admin_business_ledger_sales", range),
      client.rpc("admin_business_ledger_purchases", range),
      client.rpc("admin_business_ledger_month_items", { ...range, p_kind: "sales" }),
      client.rpc("admin_business_suppliers"),
    ];
    for (const client of [await signedInClient(researcher.email), anonClient() as unknown as Db]) {
      for (const call of calls(client)) expect(await sqlState(call)).toBe("42501");
    }
    const fifo = { p_stock_item_id: item, p_quantity: 1 };
    // Not exposed at all: PostgREST can't find what the role may not execute (or refuses it).
    expect(["42501", "PGRST202"]).toContain(await sqlState(db.rpc("business_fifo_allocation" as never, fifo as never)));
    expect(["42501", "PGRST202"]).toContain(await sqlState(serviceClient().rpc("business_fifo_allocation" as never, fifo as never)));
  });
});

/** Three consecutive past days (1990-1999) with no sales or purchases yet. */
async function freeDays(): Promise<[string, string, string]> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const first = addDays("1990-01-01", Math.floor(Math.random() * 3600));
    const days = [first, addDays(first, 1), addDays(first, 2)] as [string, string, string];
    const sales = await serviceClient().from("business_sales").select("id", { count: "exact", head: true }).in("sold_on", days);
    const bought = await serviceClient().from("business_purchases").select("id", { count: "exact", head: true }).in("received_on", days);
    if (sales.count === 0 && bought.count === 0) return days;
  }
  throw new Error("no free days found");
}

describe("the Ledger reads", () => {
  it("by day: every sale in the inclusive range, newest first, one seller when asked; by month: the item's totals", async () => {
    const [before, day, after] = await freeDays();
    const item = await newItem(before, 50, "2.50", "Ledger Supplier");
    const sell = async (soldOn: string, quantity: number, unitPrice: string, sellerId = id.admin) =>
      recordSaleAction({
        ...saleEntry(item, { soldOn, quantity: String(quantity), unitPrice, sellerId }),
        idempotencyKey: randomUUID(),
        expectedAllocation: expectedAllocation(await preview(item, quantity)),
      });
    await sell(before, 1, "9");
    await sell(day, 3, "9");
    await sell(day, 1, "8", id.second);
    await sell(after, 2, "10");

    const onDay = await ledgerSales(db, { from: day, to: day, item });
    expect(onDay.map((row) => [row.soldOn, row.quantity, row.sellerName])).toEqual([
      [day, 1, second.name],
      [day, 3, admin.name],
    ]);
    expect(saleTotals(onDay)).toEqual({ entries: 2, vials: 4, revenue: "35.00", cost: "10.00", grossProfit: "25.00", total: "35.00" });
    const all = await ledgerSales(db, { from: before, to: after, item });
    expect(all.map((row) => row.soldOn)).toEqual([after, day, day, before]);
    expect(byDay(all).map((group) => group.day)).toEqual([after, day, before]);
    expect(await ledgerSales(db, { from: before, to: after, item }, { pageSize: 1 })).toEqual(all);
    const owens = await ledgerSales(db, { from: before, to: after, item, seller: id.second });
    expect(owens.map((row) => [row.soldOn, row.buyerName, row.unitPrice, row.grossProfit])).toEqual([[day, "Walk-in V6", "8.00", "5.50"]]);

    const months = await ledgerMonthItems(db, "sales", { from: before, to: after, item });
    const sameMonth = before.slice(0, 7) === after.slice(0, 7);
    expect(months.reduce((n, row) => n + row.vials, 0)).toBe(7);
    expect(months.reduce((sum, row) => sum.plus(row.revenue), new Decimal(0)).toFixed(2)).toBe("64.00");
    expect(months).toHaveLength(sameMonth ? 1 : 2);
    expect(byMonth(months).reduce((n, group) => n + group.items.length, 0)).toBe(months.length);
    const owensMonths = await ledgerMonthItems(db, "sales", { from: before, to: after, item, seller: id.second });
    expect(owensMonths.map((row) => [row.entries, row.vials, row.revenue, row.cost, row.grossProfit])).toEqual([[1, 1, "8.00", "2.50", "5.50"]]);

    const bought = await ledgerPurchases(db, { from: before, to: after, item });
    expect(bought.map((row) => [row.receivedOn, row.quantity, row.unitCost, row.totalCost, row.supplier, row.currency])).toEqual([
      [before, 50, "2.50", "125.00", "Ledger Supplier", "CAD"],
    ]);
    const boughtMonths = await ledgerMonthItems(db, "purchases", { from: before, to: before, item });
    expect(boughtMonths.map((row) => [row.entries, row.vials, row.total, row.supplier, row.supplierCount, row.noSupplier])).toEqual([
      [1, 50, "125.00", "Ledger Supplier", 1, 0],
    ]);
    // A range must be given the right way round.
    expect(await sqlState(db.rpc("admin_business_ledger_sales", { p_from: after, p_to: before }))).toBe("22023");
    expect(await sqlState(db.rpc("admin_business_ledger_month_items", { p_kind: "other", p_from: before, p_to: after }))).toBe("22023");
  });
});

describe("both record actions replay a submission instead of recording it twice", () => {
  it.each(["dropped", "gateway"] as const)("a sale whose answer was lost (%s) is unsure; the sheet's retry sends the same key and replays", async (how) => {
    const item = await newItem("2026-08-01", 5, "10");
    const shown = await preview(item, 2);
    let lost = true;
    acting.client = await answerLostClient(admin.email, (url) => (lost && url.includes("/rpc/record_business_sale") ? how : null));
    const entry = saleEntry(item, { quantity: "2", unitPrice: "30" });
    let pending: RecordAttempt | null = null;
    const attempt = recordAttempt(pending, entry, randomUUID);
    pending = attempt;
    expect(await recordSaleAction({ ...entry, idempotencyKey: attempt.key, expectedAllocation: expectedAllocation(shown) })).toEqual({
      error: SAVE_UNSURE,
      unsure: true,
    });
    // It committed; the sheet keeps the attempt, so the same entry keeps its key (its new preview doesn't count).
    expect(await salesOf(item)).toHaveLength(1);
    const retry = recordAttempt(pending, { ...entry }, randomUUID);
    expect(retry).toBe(attempt);
    lost = false;
    const newer = await preview(item, 2);
    expect(await recordSaleAction({ ...entry, idempotencyKey: retry.key, expectedAllocation: expectedAllocation(newer) })).toEqual({
      stockItemId: item,
      toast: SALE_ALREADY_RECORDED,
      tone: "warn",
    });
    expect(await salesOf(item)).toHaveLength(1);
    // A changed entry is a new submission.
    expect(recordAttempt(pending, { ...entry, quantity: "3" }, randomUUID).key).not.toBe(attempt.key);
  });

  it.each(["dropped", "gateway"] as const)("a purchase whose answer was lost (%s) is unsure; the retry replays, with its supplier", async (how) => {
    const item = await newItem("2026-08-01", 1, "5");
    let lost = true;
    acting.client = await answerLostClient(admin.email, (url) => (lost && url.includes("/rpc/record_business_purchase_fx") ? how : null));
    const entry = { stockItemId: item, peptideId: "", strengthMg: "", receivedOn: "2026-08-12", quantity: "4", currency: "CAD", unitCost: "6", supplier: "Lost Answer Labs" };
    const attempt = recordAttempt(null, entry, randomUUID);
    expect(await recordPurchaseAction({ ...entry, idempotencyKey: attempt.key })).toEqual({ error: SAVE_UNSURE, unsure: true });
    expect(await purchasesOf(item)).toHaveLength(2);
    lost = false;
    const retry = recordAttempt(attempt, { ...entry }, randomUUID);
    expect(retry).toBe(attempt);
    expect(await recordPurchaseAction({ ...entry, idempotencyKey: retry.key })).toEqual({ stockItemId: item, toast: PURCHASE_ALREADY_RECORDED, tone: "warn" });
    expect((await purchasesOf(item)).map((row) => [row.quantity, row.supplier])).toEqual([
      [1, null],
      [4, "Lost Answer Labs"],
    ]);
  });

  it("a double submission of a sale records once, with a warning the second time", async () => {
    const item = await newItem("2026-08-01", 5, "10");
    const shown = await preview(item, 1);
    const sale = { ...saleEntry(item, { quantity: "1", unitPrice: "30" }), idempotencyKey: randomUUID(), expectedAllocation: expectedAllocation(shown) };
    const [first, again] = await Promise.all([recordSaleAction(sale), recordSaleAction(sale)]);
    expect([first.tone, again.tone].sort()).toEqual(["info", "warn"]);
    expect(await salesOf(item)).toHaveLength(1);
    expect(acting.revalidated).toContain("/admin/ledger");
  });
});
