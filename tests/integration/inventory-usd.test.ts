// USD purchases with Bank of Canada conversion (Marco, 2026-09-27), against
// the real local Supabase: record_business_purchase_fx stores the USD cost,
// rate and rate date beside the CAD cost; the database re-checks the
// conversion against the stored rates (public.fx_rates); CAD purchases are
// unchanged; admin only; idempotency. The actions read the stored rates, with
// the Bank of Canada behind them replaced by the local test stub
// (BOC_FX_TEST_RATES, src/lib/inventory/fx.ts): tests never call the real API.
// public.fx_rates itself, the lookup's fallback and the sync route are in
// tests/integration/fx-rates.test.ts.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getStockItem, recordPurchase, recordSale } from "@/lib/inventory/service";
import { anonClient, ensureAccount, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const acting = vi.hoisted(() => ({ client: null as unknown, revalidated: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({
  refresh: () => undefined,
  revalidatePath: (path: string) => void acting.revalidated.push(path),
}));
// The rate lookup as is, except that a test can make its next answer a stale
// one: what the action would have read just before a newer rate was stored.
const lookup = vi.hoisted(() => ({ stale: null as { rate: string; rateDate: string } | null, calls: 0 }));
vi.mock("@/lib/inventory/fx", async (original) => {
  const fx = await original<typeof import("@/lib/inventory/fx")>();
  return {
    ...fx,
    usdCadRate: async (...args: Parameters<typeof fx.usdCadRate>) => {
      lookup.calls++;
      const stale = lookup.stale;
      lookup.stale = null;
      return stale ? { ok: true as const, ...stale } : fx.usdCadRate(...args);
    },
  };
});

// Real published rates, stored before the tests (as the daily sync would) and
// also served by the stub: Wed Aug 26, Fri Aug 28 and Fri Sep 4 (none for the
// weekends or Labour Day). Nothing is stored for Aug 10-20, and the stub
// answers "down" for Aug 20.
const STORED = { "2026-08-26": "1.3876", "2026-08-28": "1.3888", "2026-09-04": "1.3840" };
const RATES = { ...STORED, "2026-08-20": "unavailable" };
process.env.BOC_FX_TEST_RATES = JSON.stringify(RATES);
const { recordPurchaseAction, usdRatePreviewAction } = await import("@/app/(private)/admin/inventory/actions");

type Client = Awaited<ReturnType<typeof signedInClient>>;

const admin = { email: uniqueEmail("usd-admin"), name: "USD Admin" };
const researcher = { email: uniqueEmail("usd-researcher"), name: "USD Researcher" };
let db: Client;
let adminId: string;

beforeAll(async () => {
  adminId = await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...researcher, role: "researcher" });
  db = await signedInClient(admin.email);
  const rates = Object.entries(STORED).map(([date, rate]) => ({ date, rate }));
  const { data, error } = await serviceClient().rpc("store_fx_rates", { p_rates: rates }).single();
  expect(error).toBeNull();
  expect(data).toMatchObject({ invalid: 0, conflicts: [] });
});

beforeEach(async () => {
  acting.client = db;
  acting.revalidated = [];
});

async function newItem(): Promise<string> {
  const name = `Compound USD ${randomBytes(4).toString("hex")}`;
  const { data: peptideId, error } = await db.rpc("save_library_peptide", {
    p_name: name,
    p_information: `[Supplied information for ${name}]`,
    p_cycling_off_guidance: "",
    p_supplement_guidance: "",
    p_available: true,
  });
  expect(error).toBeNull();
  const bought = await recordPurchase(db, {
    idempotencyKey: randomUUID(),
    stockItemId: null,
    peptideId: peptideId!,
    strengthMg: "10",
    receivedOn: "2026-08-10",
    quantity: 1,
    unitCost: "20",
  });
  if (bought.kind !== "recorded") throw new Error(bought.kind);
  return bought.stockItemId;
}

const PURCHASE_COLUMNS = "unit_cost, total_cost, currency, original_currency, original_unit_cost, fx_rate, fx_rate_date";
const stored = async (id: string) =>
  (await serviceClient().from("business_purchases").select(PURCHASE_COLUMNS).eq("id", id).single()).data!;
const purchasesOf = async (stockItemId: string) =>
  (await serviceClient().from("business_purchases").select("id").eq("stock_item_id", stockItemId)).data!;

/** record_business_purchase_fx arguments for a USD purchase of an item. */
const usdArgs = (stockItemId: string, overrides: Record<string, unknown> = {}) => ({
  p_idempotency_key: randomUUID(),
  p_stock_item_id: stockItemId,
  p_received_on: "2026-08-26",
  p_quantity: 10,
  p_unit_cost: "15.26",
  p_original_currency: "USD",
  p_original_unit_cost: "11.00",
  p_fx_rate: "1.3876",
  p_fx_rate_date: "2026-08-26",
  ...overrides,
});

describe("record_business_purchase_fx", () => {
  it("stores the USD cost, the rate as published and its date beside the CAD cost", async () => {
    const itemId = await newItem();
    const recorded = await recordPurchase(db, {
      idempotencyKey: randomUUID(),
      stockItemId: itemId,
      peptideId: null,
      strengthMg: null,
      receivedOn: "2026-09-07",
      quantity: 10,
      unitCost: "15.22",
      usd: { usdUnitCost: "11.00", rate: "1.3840", rateDate: "2026-09-04" },
    });
    if (recorded.kind !== "recorded") throw new Error(recorded.kind);
    expect(await stored(recorded.purchaseId)).toEqual({
      unit_cost: 15.22,
      total_cost: 152.2,
      currency: "CAD",
      original_currency: "USD",
      original_unit_cost: 11,
      fx_rate: 1.384,
      fx_rate_date: "2026-09-04",
    });
    // Exactly as published (trailing zero kept), read as text by the service.
    const lots = (await getStockItem(db, itemId))!.lots;
    expect(lots.map((l) => [l.unitCost, l.totalCost, l.usd])).toEqual([
      ["20.00", "20.00", null],
      ["15.22", "152.20", { usdUnitCost: "11.00", rate: "1.3840", rateDate: "2026-09-04" }],
    ]);
  });

  it("refuses a CAD cost that isn't round(USD × rate, 2), a rate that isn't the latest stored one (AP028), and other inconsistent conversions", async () => {
    const itemId = await newItem();
    const refused = (overrides: Record<string, unknown>) => sqlState(db.rpc("record_business_purchase_fx", usdArgs(itemId, overrides)));
    expect(await refused({ p_unit_cost: "15.27" })).toBe("22023");
    expect(await refused({ p_unit_cost: "15.2636" })).toBe("22023");
    expect(await refused({ p_fx_rate: "1.3876543" })).toBe("22023");
    expect(await refused({ p_fx_rate: "0" })).toBe("22023");
    // The equation holds (11 × 1.3877 = 15.2647), but the stored Aug 26 rate is 1.3876.
    expect(await refused({ p_fx_rate: "1.3877" })).toBe("AP028");
    // Saturday Aug 22 has no stored rate; the latest stored for the window is Aug 26's.
    expect(await refused({ p_fx_rate_date: "2026-08-22" })).toBe("AP028");
    // Nothing stored for Aug 10-20.
    expect(await refused({ p_received_on: "2026-08-20", p_fx_rate_date: "2026-08-20" })).toBe("22023");
    expect(await refused({ p_fx_rate: null })).toBe("22023");
    expect(await refused({ p_fx_rate_date: null })).toBe("22023");
    expect(await refused({ p_fx_rate_date: "2026-08-27" })).toBe("22023"); // after the date received
    expect(await refused({ p_received_on: "2026-09-06" })).toBe("22023"); // rate 11 days older
    expect(await refused({ p_original_unit_cost: "11.005" })).toBe("22023");
    expect(await refused({ p_original_unit_cost: null })).toBe("22023");
    expect(await refused({ p_original_currency: "EUR" })).toBe("22023");
    expect(await refused({ p_original_currency: "CAD" })).toBe("22023"); // CAD with a conversion
    // Above CAD 1,000,000.00 after conversion.
    expect(await refused({ p_original_unit_cost: "1000000", p_unit_cost: "1387600.00" })).toBe("22023");
    expect(await purchasesOf(itemId)).toHaveLength(1);
    // Aug 26 is still the latest stored rate for a purchase received on Aug 27.
    expect(await refused({ p_received_on: "2026-08-27" })).toBe("ok");
  });

  it("an older stored rate in the window is refused (AP028); only the latest is accepted", async () => {
    const itemId = await newItem();
    // Received Labour Day, Sep 7: Aug 28 (1.3888) is in the window and stored, but Sep 4 (1.3840) is the latest.
    const older = usdArgs(itemId, { p_received_on: "2026-09-07", p_fx_rate: "1.3888", p_fx_rate_date: "2026-08-28", p_unit_cost: "15.28" });
    expect(await sqlState(db.rpc("record_business_purchase_fx", older))).toBe("AP028");
    const service = await recordPurchase(db, {
      idempotencyKey: randomUUID(),
      stockItemId: itemId,
      peptideId: null,
      strengthMg: null,
      receivedOn: "2026-09-07",
      quantity: 10,
      unitCost: "15.28",
      usd: { usdUnitCost: "11.00", rate: "1.3888", rateDate: "2026-08-28" },
    });
    expect(service).toEqual({ kind: "rate_changed" });
    expect(await purchasesOf(itemId)).toHaveLength(1);
    const latest = { ...older, p_idempotency_key: randomUUID(), p_fx_rate: "1.3840", p_fx_rate_date: "2026-09-04", p_unit_cost: "15.22" };
    expect(await sqlState(db.rpc("record_business_purchase_fx", latest))).toBe("ok");
    // The same key after the refusal: nothing was recorded, so the latest rate records it.
    expect(await sqlState(db.rpc("record_business_purchase_fx", { ...latest, p_idempotency_key: older.p_idempotency_key }))).toBe("ok");
    expect(await purchasesOf(itemId)).toHaveLength(3);
  });

  it("CAD purchases are recorded as before, through either function", async () => {
    const itemId = await newItem();
    const cad = await ensureRecorded(db.rpc("record_business_purchase", { p_idempotency_key: randomUUID(), p_stock_item_id: itemId, p_received_on: "2026-08-26", p_quantity: 2, p_unit_cost: "20.5" }).single());
    expect(await stored(cad)).toEqual({ unit_cost: 20.5, total_cost: 41, currency: "CAD", original_currency: "CAD", original_unit_cost: null, fx_rate: null, fx_rate_date: null });
    const viaFx = await ensureRecorded(
      db.rpc("record_business_purchase_fx", { p_idempotency_key: randomUUID(), p_stock_item_id: itemId, p_received_on: "2026-08-26", p_quantity: 2, p_unit_cost: "20.5", p_original_currency: "CAD" }).single(),
    );
    expect(await stored(viaFx)).toMatchObject({ unit_cost: 20.5, original_currency: "CAD", fx_rate: null });
  });

  it("gross profit stays in CAD: FIFO takes a USD lot at its CAD cost", async () => {
    const itemId = await newItem();
    expect(await sqlState(db.rpc("record_business_purchase_fx", usdArgs(itemId)))).toBe("ok");
    const sale = await recordSale(db, {
      idempotencyKey: randomUUID(),
      stockItemId: itemId,
      soldOn: "2026-08-27",
      quantity: 3,
      unitPrice: "40",
      sellerId: adminId,
      buyer: { type: "outside", name: "Walk-in" },
    });
    if (sale.kind !== "recorded") throw new Error(sale.kind);
    const row = (await serviceClient().from("business_sales").select("revenue, cost, gross_profit, currency").eq("id", sale.saleId).single()).data!;
    // 1 × CAD 20.00 (Aug 10) + 2 × CAD 15.26 (the USD lot) = 50.52.
    expect(row).toEqual({ revenue: 120, cost: 50.52, gross_profit: 69.48, currency: "CAD" });
  });

  it("idempotency: the same entry replays (even with a later-published rate); different details are AP005", async () => {
    const itemId = await newItem();
    const args = usdArgs(itemId);
    const first = await ensureRecorded(db.rpc("record_business_purchase_fx", args).single());
    const replay = await db.rpc("record_business_purchase_fx", { ...args, p_fx_rate: "1.3888", p_fx_rate_date: "2026-08-25", p_unit_cost: "15.28" }).single();
    expect(replay.data).toEqual({ purchase_id: first, stock_item_id: itemId, replayed: true });
    expect(await stored(first)).toMatchObject({ unit_cost: 15.26, fx_rate: 1.3876 });
    expect(await sqlState(db.rpc("record_business_purchase_fx", { ...args, p_original_unit_cost: "12.00", p_unit_cost: "16.65" }))).toBe("AP005");
    expect(await sqlState(db.rpc("record_business_purchase_fx", { ...args, p_quantity: 11 }))).toBe("AP005");
    // The CAD function with the same key and CAD cost: the currency differs.
    expect(
      await sqlState(db.rpc("record_business_purchase", { p_idempotency_key: args.p_idempotency_key, p_stock_item_id: itemId, p_received_on: "2026-08-26", p_quantity: 10, p_unit_cost: "15.26" })),
    ).toBe("AP005");
    expect(await purchasesOf(itemId)).toHaveLength(2);
  });

  it("a replay needs no conversion: absent conversion arguments replay; a new key without them is refused", async () => {
    const itemId = await newItem();
    const args = usdArgs(itemId);
    const first = await ensureRecorded(db.rpc("record_business_purchase_fx", args).single());
    const entered = {
      p_idempotency_key: args.p_idempotency_key,
      p_stock_item_id: itemId,
      p_received_on: "2026-08-26",
      p_quantity: 10,
      p_original_currency: "USD",
      p_original_unit_cost: "11",
    };
    expect((await db.rpc("record_business_purchase_fx", entered).single()).data).toEqual({ purchase_id: first, stock_item_id: itemId, replayed: true });
    // Invalid conversion arguments don't matter to a replay either.
    expect(
      (await db.rpc("record_business_purchase_fx", { ...entered, p_fx_rate: "abc", p_fx_rate_date: "2020-01-01", p_unit_cost: "x" }).single()).data,
    ).toMatchObject({ purchase_id: first, replayed: true });
    // The entered details still decide: a different USD cost, date or item is AP005.
    expect(await sqlState(db.rpc("record_business_purchase_fx", { ...entered, p_original_unit_cost: "11.01" }))).toBe("AP005");
    expect(await sqlState(db.rpc("record_business_purchase_fx", { ...entered, p_received_on: "2026-08-27" }))).toBe("AP005");
    expect(await sqlState(db.rpc("record_business_purchase_fx", { ...entered, p_stock_item_id: await newItem() }))).toBe("AP005");
    // A new key must bring its conversion.
    expect(await sqlState(db.rpc("record_business_purchase_fx", { ...entered, p_idempotency_key: randomUUID() }))).toBe("22023");
    expect(await purchasesOf(itemId)).toHaveLength(2);
  });

  it("admins only: researchers and anonymous callers are refused", async () => {
    const itemId = await newItem();
    const researcherDb = await signedInClient(researcher.email);
    expect(await sqlState(researcherDb.rpc("record_business_purchase_fx", usdArgs(itemId)))).toBe("42501");
    expect(await sqlState(anonClient().rpc("record_business_purchase_fx", usdArgs(itemId)))).toBe("42501");
    expect(await purchasesOf(itemId)).toHaveLength(1);
  });
});

async function ensureRecorded(call: PromiseLike<{ data: { purchase_id: string } | null; error: { message: string } | null }>) {
  const { data, error } = await call;
  if (error || !data) throw new Error(error?.message ?? "no purchase");
  return data.purchase_id;
}

describe("the actions, with the Bank of Canada stubbed", () => {
  const entry = (stockItemId: string, fields: Record<string, string>) => ({
    idempotencyKey: randomUUID(),
    stockItemId,
    peptideId: "",
    strengthMg: "",
    quantity: "10",
    currency: "USD",
    unitCost: "11",
    ...fields,
  });

  it("previews the rate for a weekend date with the latest earlier one; refuses a future date", async () => {
    expect(await usdRatePreviewAction("2026-08-29")).toEqual({ rate: "1.3888", rateDate: "2026-08-28" });
    expect(await usdRatePreviewAction("2026-08-26")).toEqual({ rate: "1.3876", rateDate: "2026-08-26" });
    expect(await usdRatePreviewAction("2999-01-01")).toEqual({ error: "The date received can't be in the future." });
    expect((await usdRatePreviewAction("2026-08-20")).error).toMatch(/^Couldn't get the Bank of Canada rate/);
  });

  it("records a USD purchase converted on the server, whatever the client sends", async () => {
    const itemId = await newItem();
    const result = await recordPurchaseAction({ ...entry(itemId, { receivedOn: "2026-08-29", unitCost: "11,5" }), rate: "9.9", fxRate: "9.9" });
    expect(result).toEqual({ stockItemId: itemId, toast: "Purchase recorded · 10 vials at USD 11.50 = CAD 15.97", tone: "info" });
    const lots = (await getStockItem(db, itemId))!.lots;
    expect(lots[1]).toMatchObject({ unitCost: "15.97", totalCost: "159.70", usd: { usdUnitCost: "11.50", rate: "1.3888", rateDate: "2026-08-28" } });
    expect(acting.revalidated).toContain(`/admin/inventory/${itemId}`);
  });

  it("refuses the save when the Bank of Canada can't be reached: nothing recorded, retryable", async () => {
    const itemId = await newItem();
    const result = await recordPurchaseAction(entry(itemId, { receivedOn: "2026-08-20" }));
    expect(result.error).toMatch(/^Couldn't get the Bank of Canada rate, so nothing was recorded/);
    expect(await purchasesOf(itemId)).toHaveLength(1);
  });

  it("a retry after a lost response replays the recorded purchase while no rate can be looked up", async () => {
    const itemId = await newItem();
    const first = entry(itemId, { receivedOn: "2026-08-28" });
    expect(await recordPurchaseAction(first)).toMatchObject({ toast: "Purchase recorded · 10 vials at USD 11.00 = CAD 15.28" });
    // Neither the stored rates (a bad secret key) nor the Bank of Canada can be read now.
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_not-a-valid-key");
    vi.stubEnv("BOC_FX_TEST_RATES", JSON.stringify({ ...RATES, "2026-08-28": "unavailable" }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // The same entry again: no rate is needed, the recorded one is shown.
      expect(await recordPurchaseAction(first)).toEqual({
        stockItemId: itemId,
        toast: "This purchase was already recorded a moment ago. No duplicate created. Recorded as USD 11.00 × 1.3888 (BoC Aug 28) = CAD 15.28.",
        tone: "warn",
      });
      // Different entered details under the same key: refused, nothing new.
      expect(await recordPurchaseAction({ ...first, unitCost: "12" })).toEqual({
        toast: "This form was already saved with different details, so nothing new was recorded. Check the stock item, then reload to start a new entry.",
      });
      // A new entry can't be saved without a rate.
      expect((await recordPurchaseAction(entry(itemId, { receivedOn: "2026-08-28" }))).error).toMatch(/nothing was recorded/);
    } finally {
      vi.unstubAllEnvs();
      quiet.mockRestore();
    }
    const lots = (await getStockItem(db, itemId))!.lots;
    expect(lots.map((lot) => [lot.unitCost, lot.usd?.rate ?? null])).toEqual([
      ["20.00", null],
      ["15.28", "1.3888"],
    ]);
  });

  it("a newer rate stored between the lookup and the save: refused by the database, looked up again, recorded at the latest", async () => {
    const itemId = await newItem();
    lookup.stale = { rate: "1.3888", rateDate: "2026-08-28" };
    lookup.calls = 0;
    expect(await recordPurchaseAction(entry(itemId, { receivedOn: "2026-09-07" }))).toEqual({
      stockItemId: itemId,
      toast: "Purchase recorded · 10 vials at USD 11.00 = CAD 15.22",
      tone: "info",
    });
    expect(lookup.calls).toBe(2);
    const lots = (await getStockItem(db, itemId))!.lots;
    expect(lots[1]).toMatchObject({ unitCost: "15.22", usd: { rate: "1.3840", rateDate: "2026-09-04" } });
  });

  it("researchers are sent to sign in by both actions", async () => {
    acting.client = await signedInClient(researcher.email);
    await expect(usdRatePreviewAction("2026-08-26")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    await expect(recordPurchaseAction(entry(randomUUID(), { receivedOn: "2026-08-26" }))).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});
