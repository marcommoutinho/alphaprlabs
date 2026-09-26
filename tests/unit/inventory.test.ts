// S5 business inventory rules (src/lib/inventory/rules.ts): A5/A6 validation
// order and copy, the FIFO preview, exact CAD arithmetic and A7 periods.
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_REQUIRED,
  AMOUNT_CENTS,
  AMOUNT_TOO_LARGE,
  COST_INVALID,
  OUTSIDE_BUYER_REQUIRED,
  PRICE_INVALID,
  PURCHASE_DATE_REQUIRED,
  PURCHASE_ITEM_REQUIRED,
  PURCHASE_PEPTIDE_REQUIRED,
  PURCHASE_STRENGTH_INVALID,
  SALE_DATE_REQUIRED,
  SALE_ITEM_REQUIRED,
  VIALS_INVALID,
  VIALS_TOO_MANY,
  allocateFifo,
  insufficientStockMessage,
  saleAmounts,
  salesPeriodRange,
  stockItemLabel,
  sumAmounts,
  validatePurchase,
  validateSale,
} from "@/lib/inventory/rules";

const KEY = "0b5b3a3e-6f0e-4c8e-9a51-1f9d7f3b2c10";
const ITEM = "7a51958a-1a5e-4f22-8f55-689ba8ce0a1b";
const PEPTIDE = "ebf3d87b-e81e-48c7-bfe2-59d163dcd2d4";
const error = (result: { ok: boolean; error?: string }) => (result.ok ? "ok" : result.error);

describe("A5 purchase validation", () => {
  const valid = { idempotencyKey: KEY, stockItemId: ITEM, receivedOn: "2026-08-15", quantity: "10", unitCost: "20" };

  it("accepts an existing item and normalizes the cost to cents", () => {
    expect(validatePurchase(valid)).toEqual({
      ok: true,
      value: { idempotencyKey: KEY, stockItemId: ITEM, peptideId: null, strengthMg: null, receivedOn: "2026-08-15", quantity: 10, unitCost: "20.00" },
    });
    expect(validatePurchase({ ...valid, unitCost: " 0 " })).toMatchObject({ ok: true, value: { unitCost: "0.00" } });
  });

  it("accepts a new peptide/strength with the strength without trailing zeros", () => {
    const result = validatePurchase({ ...valid, stockItemId: "new", peptideId: PEPTIDE, strengthMg: "8.50" });
    expect(result).toMatchObject({ ok: true, value: { stockItemId: null, peptideId: PEPTIDE, strengthMg: "8.5" } });
  });

  it("first failure wins, in the designed order with the designed copy", () => {
    expect(error(validatePurchase({ ...valid, stockItemId: "", receivedOn: "", quantity: "0" }))).toBe(PURCHASE_ITEM_REQUIRED);
    expect(error(validatePurchase({ ...valid, stockItemId: "new", peptideId: "" }))).toBe(PURCHASE_PEPTIDE_REQUIRED);
    expect(error(validatePurchase({ ...valid, receivedOn: "", quantity: "0", unitCost: "-1" }))).toBe(PURCHASE_DATE_REQUIRED);
    expect(error(validatePurchase({ ...valid, receivedOn: "2026-02-30" }))).toBe(PURCHASE_DATE_REQUIRED);
    expect(error(validatePurchase({ ...valid, quantity: "0", unitCost: "-1" }))).toBe(VIALS_INVALID);
    for (const quantity of ["-1", "1.5", "abc", "", 2.5]) expect(error(validatePurchase({ ...valid, quantity }))).toBe(VIALS_INVALID);
    expect(error(validatePurchase({ ...valid, quantity: "100001" }))).toBe(VIALS_TOO_MANY);
    for (const unitCost of ["-1", "abc", "", "1e3", "NaN", "1,000"]) expect(error(validatePurchase({ ...valid, unitCost }))).toBe(COST_INVALID);
    expect(error(validatePurchase({ ...valid, unitCost: "20.005" }))).toBe(AMOUNT_CENTS);
    expect(error(validatePurchase({ ...valid, unitCost: "1000000.01" }))).toBe(AMOUNT_TOO_LARGE);
    for (const strengthMg of ["0", "-8", "8.0001", "abc", "", "100001"]) {
      expect(error(validatePurchase({ ...valid, stockItemId: "new", peptideId: PEPTIDE, strengthMg }))).toBe(PURCHASE_STRENGTH_INVALID);
    }
  });
});

describe("A6 sale validation", () => {
  const valid = { idempotencyKey: KEY, stockItemId: ITEM, soldOn: "2026-08-25", quantity: 12, unitPrice: "40", buyerType: "outside", buyerName: "  Walk-in\t" };

  it("accepts an outside buyer (trimmed) or an account", () => {
    expect(validateSale(valid)).toEqual({
      ok: true,
      value: { idempotencyKey: KEY, stockItemId: ITEM, soldOn: "2026-08-25", quantity: 12, unitPrice: "40.00", buyer: { type: "outside", name: "Walk-in" } },
    });
    expect(validateSale({ ...valid, buyerType: "account", buyerProfileId: PEPTIDE })).toMatchObject({
      ok: true,
      value: { buyer: { type: "account", profileId: PEPTIDE } },
    });
  });

  it("first failure wins: item, date, vials, price, buyer", () => {
    expect(error(validateSale({ ...valid, stockItemId: "", soldOn: "" }))).toBe(SALE_ITEM_REQUIRED);
    expect(error(validateSale({ ...valid, soldOn: "", quantity: 0 }))).toBe(SALE_DATE_REQUIRED);
    expect(error(validateSale({ ...valid, quantity: 0, unitPrice: "-1" }))).toBe(VIALS_INVALID);
    expect(error(validateSale({ ...valid, unitPrice: "-1", buyerName: "" }))).toBe(PRICE_INVALID);
    expect(error(validateSale({ ...valid, unitPrice: "0" }))).toBe("ok");
    expect(error(validateSale({ ...valid, buyerName: "  \n" }))).toBe(OUTSIDE_BUYER_REQUIRED);
    expect(error(validateSale({ ...valid, buyerType: "account", buyerProfileId: "" }))).toBe(ACCOUNT_REQUIRED);
  });

  it("the insufficient-stock copy", () => {
    expect(insufficientStockMessage(8, stockItemLabel("Compound A", "8"))).toBe(
      "Only 8 vials are on hand for Compound A · 8 mg. Reduce the quantity or record a purchase first.",
    );
    expect(insufficientStockMessage(1, "X · 2 mg")).toMatch(/^Only 1 vial is on hand/);
  });
});

describe("FIFO preview and gross profit", () => {
  const lots = [
    { purchaseId: "p1", receivedOn: "2026-08-15", unitCost: "20.00", remaining: 10 },
    { purchaseId: "p2", receivedOn: "2026-08-20", unitCost: "25.00", remaining: 10 },
  ];

  it("the handoff scenario: 12 at 40 → revenue 480, cost 250, gross profit 230", () => {
    const fifo = allocateFifo(lots, 12);
    expect(fifo).toEqual({
      allocations: [
        { purchaseId: "p1", receivedOn: "2026-08-15", unitCost: "20.00", quantity: 10 },
        { purchaseId: "p2", receivedOn: "2026-08-20", unitCost: "25.00", quantity: 2 },
      ],
      cost: "250.00",
      short: 0,
    });
    expect(saleAmounts(12, "40.00", fifo.cost)).toEqual({ revenue: "480.00", cost: "250.00", grossProfit: "230.00" });
  });

  it("reports the shortfall; skips exhausted lots; negative profit stays exact", () => {
    expect(allocateFifo([{ ...lots[0], remaining: 0 }, lots[1]], 12)).toMatchObject({ cost: "250.00", short: 2 });
    expect(saleAmounts(3, "0.10", "0.60")).toEqual({ revenue: "0.30", cost: "0.60", grossProfit: "-0.30" });
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30");
    expect(sumAmounts([])).toBe("0.00");
  });
});

describe("A7 periods", () => {
  it("this month, last month (across a year) and all time", () => {
    expect(salesPeriodRange("month", "2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(salesPeriodRange("prev", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(salesPeriodRange("prev", "2028-03-31")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(salesPeriodRange("all", "2026-01-05")).toEqual({ from: null, to: null });
  });
});
