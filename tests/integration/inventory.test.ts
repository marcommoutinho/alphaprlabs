// S5 business inventory and FIFO sales against the real local Supabase (npm
// run db:start), as a signed-in admin through the service module and the
// database functions it calls. No mocked database. Every test uses its own
// library peptide (unique name), so runs never depend on each other.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getStockItem, listBuyerAccounts, listSales, listStock, recordPurchase, recordSale } from "@/lib/inventory/service";
import { ensureAccount, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

type Client = Awaited<ReturnType<typeof signedInClient>>;

const admin = { email: uniqueEmail("s5-inv-admin"), name: "S5 Inventory Admin" };
const jordan = { email: uniqueEmail("s5-inv-jordan"), name: "Jordan Reyes" };
let db: Client;
let jordanId: string;

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  jordanId = await ensureAccount({ ...jordan, role: "researcher" });
  db = await signedInClient(admin.email);
});

const tag = () => randomBytes(4).toString("hex");

async function newPeptide(name = `Compound ${tag()}`, available = true): Promise<string> {
  const { data, error } = await db.rpc("save_library_peptide", {
    p_name: name,
    p_information: `[Supplied information for ${name}]`,
    p_cycling_off_guidance: "",
    p_supplement_guidance: "",
    p_available: available,
  });
  expect(error).toBeNull();
  return data!;
}

/** Records a purchase through the service; returns its stock item id. */
async function buy(item: { stockItemId: string } | { peptideId: string; strengthMg: string }, receivedOn: string, quantity: number, unitCost: string) {
  const result = await recordPurchase(db, {
    idempotencyKey: randomUUID(),
    stockItemId: "stockItemId" in item ? item.stockItemId : null,
    peptideId: "peptideId" in item ? item.peptideId : null,
    strengthMg: "strengthMg" in item ? item.strengthMg : null,
    receivedOn,
    quantity,
    unitCost,
  });
  if (result.kind !== "recorded") throw new Error(`purchase refused: ${result.kind}`);
  return result.stockItemId;
}

const saleInput = (stockItemId: string, quantity: number, unitPrice: string, extra: Partial<Parameters<typeof recordSale>[1]> = {}) => ({
  idempotencyKey: randomUUID(),
  stockItemId,
  soldOn: "2026-08-25",
  quantity,
  unitPrice,
  buyer: { type: "outside" as const, name: "Outside buyer" },
  ...extra,
});

const salesOf = async (stockItemId: string) =>
  (await serviceClient().from("business_sales").select("id, quantity, cost").eq("stock_item_id", stockItemId)).data!;

describe("the handoff FIFO scenario", () => {
  it("10 × 20 then 10 × 25; 12 sold at 40 → revenue 480, cost 250, gross profit 230, 8 left; 9 more → blocked", async () => {
    const peptideId = await newPeptide(`Compound A ${tag()}`);
    const itemId = await buy({ peptideId, strengthMg: "8" }, "2026-08-15", 10, "20");
    expect(await buy({ stockItemId: itemId }, "2026-08-20", 10, "25.00")).toBe(itemId);

    const grantsBefore = (await serviceClient().from("support_grants").select("id").eq("researcher_id", jordanId)).data!;
    const sale = await recordSale(db, saleInput(itemId, 12, "40", { buyer: { type: "account", profileId: jordanId } }));
    expect(sale).toMatchObject({ kind: "recorded", replayed: false });

    const detail = (await getStockItem(db, itemId))!;
    expect(detail.item).toMatchObject({ strengthMg: "8", purchased: 20, sold: 12, onHand: 8 });
    expect(detail.item.label).toMatch(/^Compound A [0-9a-f]{8} · 8 mg$/);
    expect(detail.lots.map((l) => [l.receivedOn, l.quantity, l.unitCost, l.totalCost, l.allocated, l.remaining])).toEqual([
      ["2026-08-15", 10, "20.00", "200.00", 10, 0],
      ["2026-08-20", 10, "25.00", "250.00", 2, 8],
    ]);
    expect(detail.sales).toHaveLength(1);
    expect(detail.sales[0]).toMatchObject({
      quantity: 12,
      unitPrice: "40.00",
      revenue: "480.00",
      cost: "250.00",
      grossProfit: "230.00",
      buyerType: "account",
      buyerProfileId: jordanId,
      buyerName: "Jordan Reyes",
    });
    expect(detail.sales[0].allocations.map((a) => [a.quantity, a.unitCost, a.receivedOn])).toEqual([
      [10, "20.00", "2026-08-15"],
      [2, "25.00", "2026-08-20"],
    ]);

    // An outside buyer for 9 → insufficient stock; nothing is recorded.
    expect(await recordSale(db, saleInput(itemId, 9, "40", { buyer: { type: "outside", name: "Walk-in" } }))).toEqual({
      kind: "insufficient",
      onHand: 8,
    });
    expect(await salesOf(itemId)).toHaveLength(1);
    expect((await getStockItem(db, itemId))!.item.onHand).toBe(8);

    // A7 for this item: exact totals and one by-item row.
    const report = await listSales(db, { stockItemId: itemId });
    expect(report.totals).toEqual({ sales: 1, vials: 12, revenue: "480.00", cost: "250.00", grossProfit: "230.00" });
    expect(report.byItem).toEqual([{ stockItemId: itemId, label: detail.item.label, ...report.totals }]);
    expect(report.sales.map((s) => s.id)).toEqual([detail.sales[0].id]);
    expect(report).toMatchObject({ hasPurchases: true, hasSales: true, salesTruncated: false });

    // Linking Jordan's account granted nothing.
    expect((await serviceClient().from("support_grants").select("id").eq("researcher_id", jordanId)).data).toEqual(grantsBefore);
  });

  it("the 8 left sell exactly, then the item shows 0 on hand and refuses even 1", async () => {
    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "8" }, "2026-08-15", 10, "20");
    await buy({ stockItemId: itemId }, "2026-08-20", 10, "25");
    expect((await recordSale(db, saleInput(itemId, 12, "40"))).kind).toBe("recorded");
    const rest = await recordSale(db, saleInput(itemId, 8, "30"));
    expect(rest.kind).toBe("recorded");
    const detail = (await getStockItem(db, itemId))!;
    expect(detail.item.onHand).toBe(0);
    expect(detail.sales[0]).toMatchObject({ revenue: "240.00", cost: "200.00", grossProfit: "40.00" });
    expect(await recordSale(db, saleInput(itemId, 1, "30"))).toEqual({ kind: "insufficient", onHand: 0 });
  });
});

describe("historical cost and profit are frozen", () => {
  it("a later purchase (even backdated and cheaper) never changes a past sale; the next sale uses it first", async () => {
    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "8" }, "2026-08-15", 10, "20");
    await buy({ stockItemId: itemId }, "2026-08-20", 10, "25");
    const first = await recordSale(db, saleInput(itemId, 12, "40"));
    if (first.kind !== "recorded") throw new Error(first.kind);
    const before = (await getStockItem(db, itemId))!.sales[0];

    await buy({ stockItemId: itemId }, "2026-08-01", 10, "5");
    await buy({ stockItemId: itemId }, "2026-09-01", 10, "99.99");
    const after = (await getStockItem(db, itemId))!;
    expect(after.sales).toEqual([before]);
    expect(after.sales[0]).toMatchObject({ cost: "250.00", grossProfit: "230.00" });
    expect((await listSales(db, { stockItemId: itemId })).totals).toMatchObject({ cost: "250.00", grossProfit: "230.00" });

    // FIFO is by received date: the backdated Aug 1 lot goes first, then 2 of Aug 20's 8.
    const next = await recordSale(db, saleInput(itemId, 12, "40", { soldOn: "2026-09-02" }));
    expect(next.kind).toBe("recorded");
    const latest = (await getStockItem(db, itemId))!;
    expect(latest.sales[0]).toMatchObject({ quantity: 12, cost: "100.00", grossProfit: "380.00" });
    expect(latest.sales[0].allocations.map((a) => [a.quantity, a.unitCost])).toEqual([
      [10, "5.00"],
      [2, "25.00"],
    ]);
    expect(latest.sales[1]).toEqual(before);
  });
});

describe("duplicate submission records once", () => {
  it("the same sale key sent again (and in parallel) returns the recorded sale; different details are refused", async () => {
    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "5" }, "2026-08-15", 20, "10");
    const input = saleInput(itemId, 4, "15.50");
    const first = await recordSale(db, input);
    if (first.kind !== "recorded") throw new Error(first.kind);
    expect(first.replayed).toBe(false);
    expect(await recordSale(db, input)).toEqual({ kind: "recorded", saleId: first.saleId, replayed: true });

    const clients = await Promise.all([1, 2, 3].map(() => signedInClient(admin.email)));
    const parallelInput = saleInput(itemId, 3, "15.50");
    const parallel = await Promise.all([...clients, db, ...clients].map((c) => recordSale(c, parallelInput)));
    const ids = new Set(parallel.map((r) => (r.kind === "recorded" ? r.saleId : r.kind)));
    expect(ids.size).toBe(1);
    expect(parallel.filter((r) => r.kind === "recorded" && !r.replayed)).toHaveLength(1);

    expect(await recordSale(db, { ...input, quantity: 5 })).toEqual({ kind: "conflict" });
    expect(await recordSale(db, { ...input, buyer: { type: "outside", name: "Someone else" } })).toEqual({ kind: "conflict" });
    expect((await salesOf(itemId)).map((s) => s.quantity).sort()).toEqual([3, 4]);
    expect((await getStockItem(db, itemId))!.item.onHand).toBe(13);
  });

  it("a replayed sale returns its record even after stock ran out", async () => {
    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "5" }, "2026-08-15", 2, "10");
    const input = saleInput(itemId, 2, "15");
    const first = await recordSale(db, input);
    expect(first.kind).toBe("recorded");
    expect(await recordSale(db, input)).toMatchObject({ kind: "recorded", replayed: true });
    expect(await salesOf(itemId)).toHaveLength(1);
  });

  it("the same purchase key records one purchase", async () => {
    const peptideId = await newPeptide();
    const input = {
      idempotencyKey: randomUUID(),
      stockItemId: null,
      peptideId,
      strengthMg: "10",
      receivedOn: "2026-08-15",
      quantity: 10,
      unitCost: "20.00",
    };
    const first = await recordPurchase(db, input);
    if (first.kind !== "recorded") throw new Error(first.kind);
    expect(await recordPurchase(db, input)).toEqual({ ...first, replayed: true });
    const parallel = await Promise.all([1, 2, 3, 4].map(() => recordPurchase(db, input)));
    expect(parallel.every((r) => r.kind === "recorded" && r.purchaseId === first.purchaseId && r.replayed)).toBe(true);
    expect(await recordPurchase(db, { ...input, unitCost: "21.00" })).toEqual({ kind: "conflict" });
    const lots = (await getStockItem(db, first.stockItemId))!.lots;
    expect(lots.map((l) => l.quantity)).toEqual([10]);
  });
});

describe("concurrent sales cannot oversell", () => {
  it("parallel sales from several admin sessions: exactly the stock on hand is sold, every lot within its quantity", async () => {
    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "2.5" }, "2026-08-10", 4, "10");
    await buy({ stockItemId: itemId }, "2026-08-11", 3, "12");
    await buy({ stockItemId: itemId }, "2026-08-12", 3, "14"); // 10 on hand
    const clients = await Promise.all([1, 2, 3, 4].map(() => signedInClient(admin.email)));

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => recordSale(clients[i % clients.length], saleInput(itemId, 3, "20"))),
    );
    const recorded = results.filter((r) => r.kind === "recorded");
    expect(recorded).toHaveLength(3);
    expect(results.filter((r) => r.kind === "insufficient")).toHaveLength(9);
    for (const r of results) if (r.kind === "insufficient") expect([1, 4, 7, 10]).toContain(r.onHand);

    const detail = (await getStockItem(db, itemId))!;
    expect(detail.item).toMatchObject({ purchased: 10, sold: 9, onHand: 1 });
    expect(detail.lots.map((l) => l.allocated)).toEqual([4, 3, 2]);
    // All costs together are exactly the cost of the oldest 9 vials.
    expect((await listSales(db, { stockItemId: itemId })).totals).toMatchObject({ vials: 9, cost: "104.00" });
  });
});

describe("validation", () => {
  it("refuses non-positive or fractional quantities, negative, malformed and sub-cent amounts, and bad strengths", async () => {
    const peptideId = await newPeptide();
    const itemId = await buy({ peptideId, strengthMg: "8" }, "2026-08-15", 10, "20");
    const purchase = (args: Record<string, unknown>) =>
      db.rpc("record_business_purchase", {
        p_idempotency_key: randomUUID(),
        p_received_on: "2026-08-15",
        p_quantity: 1,
        p_unit_cost: "1",
        p_stock_item_id: itemId,
        ...args,
      });
    const sale = (args: Record<string, unknown>) =>
      db.rpc("record_business_sale", {
        p_idempotency_key: randomUUID(),
        p_stock_item_id: itemId,
        p_sold_on: "2026-08-20",
        p_quantity: 1,
        p_unit_price: "1",
        p_buyer_name: "Walk-in",
        ...args,
      });
    const code = async (call: PromiseLike<{ error: { code: string } | null }>) => (await call).error?.code ?? "ok";

    for (const quantity of [0, -1, 100_001, null]) {
      expect(await code(purchase({ p_quantity: quantity })), `purchase qty ${quantity}`).toBe("22023");
      expect(await code(sale({ p_quantity: quantity })), `sale qty ${quantity}`).toBe("22023");
    }
    expect(await code(purchase({ p_quantity: 1.5 })), "fractional vials").toBe("22P02");
    for (const amount of ["-1", "-0.01", "1.005", "abc", "", " ", "NaN", "Infinity", "1e3", "1,000", "1000000.01", null]) {
      expect(await code(purchase({ p_unit_cost: amount })), `cost ${amount}`).toBe("22023");
      expect(await code(sale({ p_unit_price: amount })), `price ${amount}`).toBe("22023");
    }
    // Zero is allowed (A5 "0 or more"; A6 "price ≥ 0"), and surrounding whitespace is trimmed.
    expect(await code(purchase({ p_unit_cost: "0" }))).toBe("ok");
    expect(await code(sale({ p_unit_price: "\t0.00 " }))).toBe("ok");
    expect(await code(purchase({ p_unit_cost: " 1000000 " }))).toBe("ok");

    const newItem = (strength: unknown) => purchase({ p_stock_item_id: undefined, p_peptide_id: peptideId, p_strength_mg: strength });
    for (const strength of ["0", "-8", "8.0001", "abc", "", "　", "100001", null]) {
      expect(await code(newItem(strength)), `strength ${strength}`).toBe("22023");
    }
    // '8.0' and ' 8.000 ' are the existing 8 mg item.
    expect((await newItem("8.0")).data).toEqual([expect.objectContaining({ stock_item_id: itemId })]);
    expect((await newItem(" 8.000 ")).data).toEqual([expect.objectContaining({ stock_item_id: itemId })]);
    expect(await code(purchase({ p_peptide_id: peptideId }))).toBe("22023"); // item and peptide both given
    expect(await code(purchase({ p_stock_item_id: undefined }))).toBe("22023"); // neither
    expect(await code(purchase({ p_received_on: null }))).toBe("22023");
    expect(await code(sale({ p_sold_on: null }))).toBe("22023");
    expect(await code(purchase({ p_idempotency_key: null }))).toBe("22023");
    expect(await code(sale({ p_idempotency_key: null }))).toBe("22023");
  });

  it("unknown stock items, peptides and buyer accounts are refused; whitespace-only buyers are empty", async () => {
    const peptideId = await newPeptide();
    const itemId = await buy({ peptideId, strengthMg: "8" }, "2026-08-15", 10, "20");
    const missing = randomUUID();
    const base = { idempotencyKey: randomUUID(), receivedOn: "2026-08-15", quantity: 1, unitCost: "1.00" };
    expect(await recordPurchase(db, { ...base, stockItemId: missing, peptideId: null, strengthMg: null })).toEqual({ kind: "unknown_item" });
    expect(await recordPurchase(db, { ...base, stockItemId: null, peptideId: missing, strengthMg: "8" })).toEqual({ kind: "unknown_peptide" });
    expect(await recordSale(db, saleInput(missing, 1, "1"))).toEqual({ kind: "unknown_item" });
    expect(await recordSale(db, saleInput(itemId, 1, "1", { buyer: { type: "account", profileId: missing } }))).toEqual({
      kind: "unknown_buyer",
    });
    expect(await getStockItem(db, missing)).toBeNull();
    expect(await getStockItem(db, "not-a-uuid")).toBeNull();

    for (const blank of ["", " ", "\t", "\r\n", " ", " 　﻿"]) {
      expect(await recordSale(db, saleInput(itemId, 1, "1", { buyer: { type: "outside", name: blank } })), JSON.stringify(blank)).toEqual({
        kind: "invalid",
      });
    }
    // A buyer is an account or an outside name, never both.
    const both = await db.rpc("record_business_sale", {
      p_idempotency_key: randomUUID(),
      p_stock_item_id: itemId,
      p_sold_on: "2026-08-20",
      p_quantity: 1,
      p_unit_price: "1",
      p_buyer_profile_id: jordanId,
      p_buyer_name: "Also outside",
    });
    expect(both.error?.code).toBe("22023");
    expect(await salesOf(itemId)).toEqual([]);

    // Outside names are stored trimmed of every kind of whitespace.
    expect((await recordSale(db, saleInput(itemId, 1, "1", { buyer: { type: "outside", name: "  Clinic 7\t\n" } }))).kind).toBe("recorded");
    expect((await getStockItem(db, itemId))!.sales[0]).toMatchObject({ buyerType: "outside", buyerName: "Clinic 7", buyerProfileId: null });
  });

  it("any library peptide can be bought and sold, including one no longer offered (A5 lists all peptides)", async () => {
    const peptideId = await newPeptide(`Withdrawn ${tag()}`, false);
    const itemId = await buy({ peptideId, strengthMg: "8" }, "2026-08-15", 2, "20");
    expect((await recordSale(db, saleInput(itemId, 1, "30"))).kind).toBe("recorded");
    expect((await listStock(db)).find((s) => s.id === itemId)).toMatchObject({ peptideAvailable: false, onHand: 1 });
  });
});

describe("buyer accounts", () => {
  it("lists accounts with the minimum identity; a sale keeps the buyer's name if the account is later deleted", async () => {
    const buyer = { email: uniqueEmail("s5-inv-buyer"), name: "Temporary Buyer" };
    const buyerId = await ensureAccount({ ...buyer, role: "researcher" });
    const accounts = await listBuyerAccounts(db);
    expect(accounts.find((a) => a.id === buyerId)).toEqual({ id: buyerId, name: buyer.name, email: buyer.email });

    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "8" }, "2026-08-15", 5, "20");
    expect((await recordSale(db, saleInput(itemId, 2, "30", { buyer: { type: "account", profileId: buyerId } }))).kind).toBe("recorded");
    expect((await serviceClient().auth.admin.deleteUser(buyerId)).error).toBeNull();
    const sale = (await getStockItem(db, itemId))!.sales[0];
    expect(sale).toMatchObject({ buyerType: "account", buyerProfileId: null, buyerName: "Temporary Buyer", cost: "40.00" });
  });
});
