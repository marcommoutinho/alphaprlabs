// S5 business inventory and FIFO sales against the real local Supabase (npm
// run db:start), as a signed-in admin through the service module and the
// database functions it calls. No mocked database. Every test uses its own
// library peptide (unique name), so runs never depend on each other.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { allocateFifo } from "@/lib/inventory/rules";
import { businessToday } from "@/lib/inventory/screens";
import { getStockItem, listBuyerAccounts, listSales, listStock, openLots, recordPurchase } from "@/lib/inventory/service";
import { recordSale } from "../support/previewed-sale";
import { previewed } from "../support/sales";
import { ensureAccount, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

type Client = Awaited<ReturnType<typeof signedInClient>>;

const admin = { email: uniqueEmail("s5-inv-admin"), name: "S5 Inventory Admin" };
const jordan = { email: uniqueEmail("s5-inv-jordan"), name: "Jordan Reyes" };
let db: Client;
let jordanId: string;
let adminId: string;

beforeAll(async () => {
  adminId = await ensureAccount({ ...admin, role: "admin" });
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
  sellerId: adminId,
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

    const grantsBefore = (await serviceClient().from("support_shares").select("id").eq("researcher_id", jordanId)).data!;
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
    expect((await serviceClient().from("support_shares").select("id").eq("researcher_id", jordanId)).data).toEqual(grantsBefore);
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

  it("purchases recorded while sales run: every sale is covered by lots, none overdrawn", async () => {
    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "3" }, "2026-08-01", 2, "10");
    const clients = await Promise.all([1, 2, 3, 4].map(() => signedInClient(admin.email)));
    const purchase = (i: number) =>
      recordPurchase(clients[i % clients.length], {
        idempotencyKey: randomUUID(),
        stockItemId: itemId,
        peptideId: null,
        strengthMg: null,
        receivedOn: `2026-08-0${2 + i}`,
        quantity: 2,
        unitCost: String(11 + i),
      });
    const sales = Array.from({ length: 8 }, (_, i) => recordSale(clients[(i + 1) % clients.length], saleInput(itemId, 2, "30")));
    const results = await Promise.all([...[0, 1, 2, 3, 4].map(purchase), ...sales]);
    const purchases = results.slice(0, 5);
    const saleResults = results.slice(5) as Awaited<ReturnType<typeof recordSale>>[];
    expect(purchases.every((r) => r.kind === "recorded")).toBe(true);
    const recorded = saleResults.filter((r) => r.kind === "recorded").length;
    expect(recorded).toBeGreaterThanOrEqual(1);
    // Every vial count is even, so a refused sale always saw exactly 0 on hand.
    for (const r of saleResults) if (r.kind !== "recorded") expect(r).toEqual({ kind: "insufficient", onHand: 0 });

    const detail = (await getStockItem(db, itemId))!;
    expect(detail.item).toMatchObject({ purchased: 12, sold: 2 * recorded, onHand: 12 - 2 * recorded });
    for (const lot of detail.lots) expect(lot.allocated).toBeLessThanOrEqual(lot.quantity);
    expect(detail.lots.reduce((n, lot) => n + lot.allocated, 0)).toBe(2 * recorded);
    for (const sale of detail.sales) expect(sale.allocations.reduce((n, a) => n + a.quantity, 0)).toBe(sale.quantity);
  });
});

describe("FIFO tie order", () => {
  it("lots received the same day are used in recording order, and the A6 preview allocates exactly as the database", async () => {
    const peptideId = await newPeptide();
    // Recorded in this order, all received on Aug 15, at prices in no particular order.
    const prices = ["30.00", "10.00", "50.00", "20.00", "40.00"];
    const itemId = await buy({ peptideId, strengthMg: "4" }, "2026-08-15", 2, prices[0]);
    for (const price of prices.slice(1)) await buy({ stockItemId: itemId }, "2026-08-15", 2, price);
    await buy({ stockItemId: itemId }, "2026-08-14", 1, "99.00"); // received earlier, recorded last: goes first

    const before = (await getStockItem(db, itemId))!;
    expect(before.lots.map((l) => l.unitCost)).toEqual(["99.00", ...prices]);
    // The preview sorts for itself: shuffled input gives the same allocation.
    const preview = allocateFifo([...openLots(before.lots)].reverse(), 6);
    expect(preview.allocations.map((a) => [a.quantity, a.unitCost])).toEqual([
      [1, "99.00"],
      [2, "30.00"],
      [2, "10.00"],
      [1, "50.00"],
    ]);

    const sale = await recordSale(db, saleInput(itemId, 6, "60"));
    expect(sale.kind).toBe("recorded");
    const recorded = (await getStockItem(db, itemId))!.sales[0];
    expect(recorded.cost).toBe(preview.cost);
    expect(recorded.cost).toBe("229.00");
    expect(recorded.allocations).toEqual(preview.allocations.map(({ purchaseId, quantity, unitCost, receivedOn }) => ({ purchaseId, quantity, unitCost, receivedOn })));

    // The next sale continues from the partly used 50.00 lot, and the preview still matches.
    const after = (await getStockItem(db, itemId))!;
    const next = allocateFifo(openLots(after.lots), 3);
    expect(next.allocations.map((a) => [a.quantity, a.unitCost])).toEqual([
      [1, "50.00"],
      [2, "20.00"],
    ]);
    expect((await recordSale(db, saleInput(itemId, 3, "60"))).kind).toBe("recorded");
    expect((await getStockItem(db, itemId))!.sales[0]).toMatchObject({ cost: next.cost, allocations: next.allocations });
  });
});

/** Today in the business time zone, America/Toronto (the database's bound), shifted by `days`. */
const latestDate = (days = 0) =>
  new Date(Date.parse(`${businessToday()}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe("dates", () => {
  it("purchases and sales cannot be dated after today in Toronto; Toronto's today is accepted", async () => {
    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "8" }, "2026-08-15", 10, "20");
    const purchase = (receivedOn: string) =>
      recordPurchase(db, { idempotencyKey: randomUUID(), stockItemId: itemId, peptideId: null, strengthMg: null, receivedOn, quantity: 1, unitCost: "20" });
    for (const days of [1, 2, 400]) {
      expect(await purchase(latestDate(days)), `purchase +${days}`).toEqual({ kind: "future_date" });
      expect(await recordSale(db, saleInput(itemId, 1, "30", { soldOn: latestDate(days) })), `sale +${days}`).toEqual({ kind: "future_date" });
    }
    const peptideId = await newPeptide();
    expect(
      await recordPurchase(db, { idempotencyKey: randomUUID(), stockItemId: null, peptideId, strengthMg: "8", receivedOn: latestDate(1), quantity: 1, unitCost: "1" }),
    ).toEqual({ kind: "future_date" });
    expect((await listStock(db)).some((s) => s.peptideId === peptideId)).toBe(false);
    expect(await salesOf(itemId)).toEqual([]);

    for (const date of [latestDate(), latestDate(-1)]) {
      expect((await purchase(date)).kind, date).toBe("recorded");
      expect((await recordSale(db, saleInput(itemId, 1, "30", { soldOn: date }))).kind, date).toBe("recorded");
    }
  });

  it("a sale may be dated before the purchase whose stock it uses", async () => {
    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "8" }, "2026-08-20", 3, "20");
    expect((await recordSale(db, saleInput(itemId, 2, "30", { soldOn: "2026-08-01" }))).kind).toBe("recorded");
    const detail = (await getStockItem(db, itemId))!;
    expect(detail.sales[0]).toMatchObject({ soldOn: "2026-08-01", cost: "40.00", allocations: [{ quantity: 2, receivedOn: "2026-08-20" }] });
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
    const sale = async (args: Record<string, unknown>) =>
      db.rpc("record_business_sale", await previewed(db, {
        p_idempotency_key: randomUUID(),
        p_stock_item_id: itemId,
        p_sold_on: "2026-08-20",
        p_quantity: 1,
        p_unit_price: "1",
        p_buyer_name: "Walk-in",
        p_seller_id: adminId,
        ...args,
      } as Parameters<typeof previewed>[1]));

    for (const quantity of [0, -1, 100_001, null]) {
      expect(await sqlState(purchase({ p_quantity: quantity })), `purchase qty ${quantity}`).toBe("22023");
      expect(await sqlState(sale({ p_quantity: quantity })), `sale qty ${quantity}`).toBe("22023");
    }
    expect(await sqlState(purchase({ p_quantity: 1.5 })), "fractional vials").toBe("22P02");
    for (const amount of ["-1", "-0.01", "1.005", "abc", "", " ", "NaN", "Infinity", "1e3", "1,000", "1000000.01", null]) {
      expect(await sqlState(purchase({ p_unit_cost: amount })), `cost ${amount}`).toBe("22023");
      expect(await sqlState(sale({ p_unit_price: amount })), `price ${amount}`).toBe("22023");
    }
    // Zero is allowed (A5 "0 or more"; A6 "price ≥ 0"), and surrounding whitespace is trimmed.
    expect(await sqlState(purchase({ p_unit_cost: "0" }))).toBe("ok");
    expect(await sqlState(sale({ p_unit_price: "\t0.00 " }))).toBe("ok");
    expect(await sqlState(purchase({ p_unit_cost: " 1000000 " }))).toBe("ok");

    const newItem = (strength: unknown) => purchase({ p_stock_item_id: undefined, p_peptide_id: peptideId, p_strength_mg: strength });
    for (const strength of ["0", "-8", "8.0001", "abc", "", "　", "100001", null]) {
      expect(await sqlState(newItem(strength)), `strength ${strength}`).toBe("22023");
    }
    // '8.0' and ' 8.000 ' are the existing 8 mg item.
    expect((await newItem("8.0")).data).toEqual([expect.objectContaining({ stock_item_id: itemId })]);
    expect((await newItem(" 8.000 ")).data).toEqual([expect.objectContaining({ stock_item_id: itemId })]);
    expect(await sqlState(purchase({ p_peptide_id: peptideId }))).toBe("22023"); // item and peptide both given
    expect(await sqlState(purchase({ p_stock_item_id: undefined }))).toBe("22023"); // neither
    expect(await sqlState(purchase({ p_received_on: null }))).toBe("22023");
    expect(await sqlState(sale({ p_sold_on: null }))).toBe("22023");
    expect(await sqlState(purchase({ p_idempotency_key: null }))).toBe("22023");
    expect(await sqlState(sale({ p_idempotency_key: null }))).toBe("22023");
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
    const both = await db.rpc("record_business_sale", await previewed(db, {
      p_idempotency_key: randomUUID(),
      p_stock_item_id: itemId,
      p_sold_on: "2026-08-20",
      p_quantity: 1,
      p_unit_price: "1",
      p_buyer_profile_id: jordanId,
      p_buyer_name: "Also outside",
      p_seller_id: adminId,
    }));
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
  it("lists accounts with the minimum identity; an account a sale names cannot be deleted, so the sale and its replay stay intact", async () => {
    const buyer = { email: uniqueEmail("s5-inv-buyer"), name: "Temporary Buyer" };
    const buyerId = await ensureAccount({ ...buyer, role: "researcher" });
    const accounts = await listBuyerAccounts(db);
    expect(accounts.find((a) => a.id === buyerId)).toEqual({ id: buyerId, name: buyer.name, email: buyer.email });

    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "8" }, "2026-08-15", 5, "20");
    const input = saleInput(itemId, 2, "30", { buyer: { type: "account", profileId: buyerId } });
    const first = await recordSale(db, input);
    if (first.kind !== "recorded") throw new Error(first.kind);

    // Accounts are never hard-deleted (closing is a soft delete): the ledger's reference refuses it.
    // (Auth reports the refused delete as a database error; the profile check below proves why.)
    expect((await serviceClient().auth.admin.deleteUser(buyerId)).error?.message).toBe("Database error deleting user");
    expect((await serviceClient().from("profiles").select("id").eq("id", buyerId)).data).toHaveLength(1);
    const sale = (await getStockItem(db, itemId))!.sales[0];
    expect(sale).toMatchObject({ buyerType: "account", buyerProfileId: buyerId, buyerName: "Temporary Buyer", cost: "40.00" });

    expect(await recordSale(db, input)).toEqual({ kind: "recorded", saleId: first.saleId, replayed: true });
    const otherAccount = await recordSale(db, { ...input, buyer: { type: "account", profileId: jordanId } });
    expect(otherAccount).toEqual({ kind: "conflict" });
  });

  it("a replay is looked up before the buyer account is checked", async () => {
    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "8" }, "2026-08-15", 5, "20");
    const input = saleInput(itemId, 1, "30");
    expect((await recordSale(db, input)).kind).toBe("recorded");
    // The same key with an unknown account: the recorded sale's details differ (conflict), not "unknown buyer".
    expect(await recordSale(db, { ...input, buyer: { type: "account", profileId: randomUUID() } })).toEqual({ kind: "conflict" });
    // Without a recorded sale, the unknown account is refused as before.
    expect(await recordSale(db, saleInput(itemId, 1, "30", { buyer: { type: "account", profileId: randomUUID() } }))).toEqual({ kind: "unknown_buyer" });
    expect(await salesOf(itemId)).toHaveLength(1);
  });

  it("the service refuses a buyer that is neither an account nor an outside buyer, without calling the database", async () => {
    const itemId = await buy({ peptideId: await newPeptide(), strengthMg: "8" }, "2026-08-15", 5, "20");
    for (const buyer of [{ type: "other", name: "X" }, { type: "Outside", name: "X" }, { name: "X" }, null]) {
      const sale = { ...saleInput(itemId, 1, "30"), buyer } as unknown as Parameters<typeof recordSale>[1];
      expect(await recordSale(db, sale), JSON.stringify(buyer)).toEqual({ kind: "invalid" });
    }
    expect(await salesOf(itemId)).toEqual([]);
  });
});
