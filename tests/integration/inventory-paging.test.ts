// S6 review: lists the API returns at most 1,000 rows of per request are read
// page by page, so no stock item drops out of A7's totals and no purchase lot
// out of A6's preview or A4's history. Proven with a tiny page size against
// the real local Supabase (npm run db:start), as a signed-in admin.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { allocateFifo } from "@/lib/inventory/rules";
import { getSale, getSaleStock, getStockItem, listSales, listStock, recordPurchase } from "@/lib/inventory/service";
import { recordSale } from "../support/previewed-sale";
import { listAdminPeptides } from "@/lib/library/service";
import { ensureAccount, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";
import { savePeptideAs } from "../support/admin-writers";

type Client = Awaited<ReturnType<typeof signedInClient>>;
const admin = { email: uniqueEmail("s6-paging-admin"), name: "S6 Paging Admin" };
let db: Client;
let adminId: string;

beforeAll(async () => {
  adminId = await ensureAccount({ ...admin, role: "admin" });
  db = await signedInClient(admin.email);
});

/** A new stock item (own peptide) with purchase lots `[receivedOn, quantity, unitCost]`, in that recording order. */
async function newItem(lots: [string, number, string][]): Promise<string> {
  const name = `Paging ${randomBytes(4).toString("hex")}`;
  const { data: peptideId, error } = await savePeptideAs(db, {
    p_name: name,
    p_information: `[Supplied information for ${name}]`,
    p_cycling_off_guidance: "",
    p_supplement_guidance: "",
    p_available: true,
  });
  expect(error).toBeNull();
  let itemId: string | null = null;
  for (const [receivedOn, quantity, unitCost] of lots) {
    const result = await recordPurchase(db, {
      idempotencyKey: randomUUID(),
      stockItemId: itemId,
      peptideId: itemId ? null : peptideId!,
      strengthMg: itemId ? null : "8",
      receivedOn,
      quantity,
      unitCost,
    });
    if (result.kind !== "recorded") throw new Error(`purchase refused: ${result.kind}`);
    itemId = result.stockItemId;
  }
  return itemId!;
}

async function sell(stockItemId: string, soldOn: string, quantity: number, unitPrice: string): Promise<string> {
  const result = await recordSale(db, {
    idempotencyKey: randomUUID(),
    stockItemId,
    soldOn,
    quantity,
    unitPrice,
    sellerId: adminId,
    buyer: { type: "outside", name: "Paging buyer" },
  });
  if (result.kind !== "recorded") throw new Error(`sale refused: ${result.kind}`);
  return result.saleId;
}

describe("paging", () => {
  it("A7 totals and by-item rows keep every item across pages", async () => {
    // Three items sold on one day nothing else uses (a random day in 2003).
    const day = `2003-${String(1 + (randomBytes(1)[0] % 12)).padStart(2, "0")}-${String(1 + (randomBytes(1)[0] % 28)).padStart(2, "0")}`;
    const items = [await newItem([["2003-01-01", 10, "10"]]), await newItem([["2003-01-01", 10, "20"]]), await newItem([["2003-01-01", 10, "30"]])];
    for (const [index, itemId] of items.entries()) await sell(itemId, day, index + 1, "50");

    const whole = await listSales(db, { from: day, to: day });
    for (const pageSize of [1, 2]) {
      const paged = await listSales(db, { from: day, to: day }, { pageSize });
      expect(paged.totals, `pageSize ${pageSize}`).toEqual(whole.totals);
      expect(paged.byItem, `pageSize ${pageSize}`).toEqual(whole.byItem);
    }
    const mine = whole.byItem.filter((row) => items.includes(row.stockItemId));
    expect(mine.map((row) => [row.vials, row.revenue, row.cost, row.grossProfit]).sort()).toEqual([
      [1, "50.00", "10.00", "40.00"],
      [2, "100.00", "40.00", "60.00"],
      [3, "150.00", "90.00", "60.00"],
    ]);
    // The KPIs add up every row.
    expect(whole.totals.vials).toBe(whole.byItem.reduce((n, row) => n + row.vials, 0));
    expect(whole.byItem.length).toBeGreaterThanOrEqual(3);
    // The stock list pages too (other test files add items meanwhile: keyset
    // paging must neither repeat nor skip one). About four pages keep the
    // request count low on the shared local stack.
    const stock = await listStock(db, { pageSize: Math.max(2, Math.ceil((await listStock(db)).length / 4)) });
    expect(new Set(stock.map((item) => item.id)).size).toBe(stock.length);
    expect(stock.length).toBeGreaterThanOrEqual(whole.byItem.length);
    for (const itemId of items) expect(stock.some((item) => item.id === itemId)).toBe(true);
  });

  it("A6's open lots and A4's purchase history are complete and in FIFO order across pages", async () => {
    const itemId = await newItem([
      ["2026-08-03", 2, "30"],
      ["2026-08-01", 2, "10"],
      ["2026-08-02", 2, "20"],
      ["2026-08-01", 2, "15"],
      ["2026-08-04", 2, "40"],
    ]);
    // Uses the two Aug 1 lots (recording order) and one vial of Aug 2.
    await sell(itemId, "2026-08-10", 5, "50");

    const detail = (await getStockItem(db, itemId, { pageSize: 2 }))!;
    expect(detail.lots.map((lot) => [lot.receivedOn, lot.unitCost, lot.remaining])).toEqual([
      ["2026-08-01", "10.00", 0],
      ["2026-08-01", "15.00", 0],
      ["2026-08-02", "20.00", 1],
      ["2026-08-03", "30.00", 2],
      ["2026-08-04", "40.00", 2],
    ]);
    expect(detail.lots).toEqual((await getStockItem(db, itemId))!.lots);

    const stock = (await getSaleStock(db, itemId, { pageSize: 1 }))!;
    expect(stock.onHand).toBe(5);
    expect(stock.lots.map((lot) => [lot.receivedOn, lot.unitCost, lot.remaining])).toEqual([
      ["2026-08-02", "20.00", 1],
      ["2026-08-03", "30.00", 2],
      ["2026-08-04", "40.00", 2],
    ]);
    // The preview allocates exactly what the database then records.
    const preview = allocateFifo(stock.lots, 4);
    const saleId = await sell(itemId, "2026-08-11", 4, "50");
    const sale = (await getSale(db, saleId))!;
    expect(sale.cost).toBe(preview.cost);
    expect(sale.allocations.map((a) => [a.purchaseId, a.quantity])).toEqual(preview.allocations.map((a) => [a.purchaseId, a.quantity]));
    expect(await getSaleStock(db, randomUUID())).toEqual({ onHand: 0, lots: [] });
    expect(await getSale(db, randomUUID())).toBeNull();
  });

  it("A5 and A8 read every library entry (keyset), not cut off at the API's 1,000-row cap", async () => {
    // Creates a peptide, so the newest entry is last in created order.
    const itemId = await newItem([["2026-08-01", 1, "10"]]);
    const newest = (await getStockItem(db, itemId))!.item.peptideName;
    const { count } = await serviceClient().from("peptides").select("id", { count: "exact", head: true });
    const library = await listAdminPeptides(db);
    expect(library.some((entry) => entry.name === newest)).toBe(true);
    expect(new Set(library.map((entry) => entry.id)).size).toBe(library.length);
    // Other test files add peptides meanwhile, so at least as many as a moment earlier.
    expect(library.length).toBeGreaterThanOrEqual(count!);
  });
});
