// S5 business inventory rules (src/lib/inventory/rules.ts): A5/A6 validation
// order and copy, strings-only form values, no future dates, the FIFO preview
// and its order, exact CAD arithmetic and A7 periods.
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_REQUIRED,
  AMOUNT_CENTS,
  BUYER_TYPE_REQUIRED,
  AMOUNT_TOO_LARGE,
  COST_INVALID,
  OUTSIDE_BUYER_REQUIRED,
  PRICE_INVALID,
  PURCHASE_DATE_FUTURE,
  PURCHASE_DATE_REQUIRED,
  PURCHASE_ITEM_REQUIRED,
  PURCHASE_PEPTIDE_REQUIRED,
  PURCHASE_STRENGTH_INVALID,
  SALE_DATE_FUTURE,
  SALE_DATE_REQUIRED,
  SALE_ITEM_REQUIRED,
  VIALS_INVALID,
  VIALS_TOO_MANY,
  allocateFifo,
  fifoOrder,
  insufficientStockMessage,
  saleAmounts,
  salesPeriodRange,
  stockItemLabel,
  sumAmounts,
  validatePurchase as validate,
  validateSale as validateSaleOn,
} from "@/lib/inventory/rules";

const KEY = "0b5b3a3e-6f0e-4c8e-9a51-1f9d7f3b2c10";
const ITEM = "7a51958a-1a5e-4f22-8f55-689ba8ce0a1b";
const PEPTIDE = "ebf3d87b-e81e-48c7-bfe2-59d163dcd2d4";
/** The admin's local date the forms pass in. */
const TODAY = "2026-09-26";
const error = (result: { ok: boolean; error?: string }) => (result.ok ? "ok" : result.error);

describe("A5 purchase validation", () => {
  const valid = { idempotencyKey: KEY, stockItemId: ITEM, receivedOn: "2026-08-15", quantity: "10", unitCost: "20" };
  const validatePurchase = (input: unknown) => validate(input, TODAY);

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
    for (const quantity of ["-1", "1.5", "abc", ""]) expect(error(validatePurchase({ ...valid, quantity }))).toBe(VIALS_INVALID);
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
  const valid = { idempotencyKey: KEY, stockItemId: ITEM, soldOn: "2026-08-25", quantity: "12", unitPrice: "40", buyerType: "outside", buyerName: "  Walk-in\t" };
  const validateSale = (input: unknown) => validateSaleOn(input, TODAY);

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
    expect(error(validateSale({ ...valid, soldOn: "", quantity: "0" }))).toBe(SALE_DATE_REQUIRED);
    expect(error(validateSale({ ...valid, quantity: "0", unitPrice: "-1" }))).toBe(VIALS_INVALID);
    expect(error(validateSale({ ...valid, unitPrice: "-1", buyerName: "" }))).toBe(PRICE_INVALID);
    expect(error(validateSale({ ...valid, unitPrice: "0" }))).toBe("ok");
    expect(error(validateSale({ ...valid, buyerName: "  \n" }))).toBe(OUTSIDE_BUYER_REQUIRED);
    expect(error(validateSale({ ...valid, buyerType: "account", buyerProfileId: "" }))).toBe(ACCOUNT_REQUIRED);
  });

  it("the buyer type is exactly account or outside; anything else is refused, not read as outside", () => {
    for (const buyerType of [undefined, "", "Outside", "ACCOUNT", "other", "outside ", 1, true, null, {}]) {
      expect(error(validateSale({ ...valid, buyerType })), String(buyerType)).toBe(BUYER_TYPE_REQUIRED);
    }
    expect(error(validateSale({ ...valid, buyerType: "outside" }))).toBe("ok");
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
    { purchaseId: "p1", receivedOn: "2026-08-15", recordedOrder: 1, unitCost: "20.00", remaining: 10 },
    { purchaseId: "p2", receivedOn: "2026-08-20", recordedOrder: 2, unitCost: "25.00", remaining: 10 },
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

  it("orders lots by received date, then recording order, whatever order they are passed in", () => {
    // Recorded 7, 3, 9 on the same day: recording order is 3, 7, 9, not id or price order.
    const sameDay = [
      { purchaseId: "zz", receivedOn: "2026-08-15", recordedOrder: 7, unitCost: "30.00", remaining: 1 },
      { purchaseId: "aa", receivedOn: "2026-08-15", recordedOrder: 9, unitCost: "10.00", remaining: 1 },
      { purchaseId: "mm", receivedOn: "2026-08-15", recordedOrder: 3, unitCost: "50.00", remaining: 1 },
      { purchaseId: "older", receivedOn: "2026-08-14", recordedOrder: 12, unitCost: "1.00", remaining: 1 },
    ];
    const expected = ["older", "mm", "zz", "aa"];
    for (const order of [sameDay, [...sameDay].reverse(), [sameDay[2], sameDay[0], sameDay[3], sameDay[1]]]) {
      const fifo = allocateFifo(order, 4);
      expect(fifo.allocations.map((a) => a.purchaseId)).toEqual(expected);
      expect(fifo.cost).toBe("91.00");
      expect(allocateFifo(order, 2).cost).toBe("51.00");
    }
    expect([...sameDay].sort(fifoOrder).map((l) => l.purchaseId)).toEqual(expected);
  });
});

describe("form values are strings only", () => {
  const purchase = { idempotencyKey: KEY, stockItemId: ITEM, receivedOn: "2026-08-15", quantity: "10", unitCost: "20" };
  const sale = { idempotencyKey: KEY, stockItemId: ITEM, soldOn: "2026-08-25", quantity: "12", unitPrice: "40", buyerType: "outside", buyerName: "Walk-in" };

  it("refuses numbers for amounts, strength, vials and dates instead of converting them", () => {
    for (const unitCost of [20, 0, 20.5, 0.1 + 0.2]) expect(error(validate({ ...purchase, unitCost }, TODAY))).toBe(COST_INVALID);
    for (const unitPrice of [40, 0, 40.5]) expect(error(validateSaleOn({ ...sale, unitPrice }, TODAY))).toBe(PRICE_INVALID);
    for (const strengthMg of [8, 2.5]) {
      expect(error(validate({ ...purchase, stockItemId: "new", peptideId: PEPTIDE, strengthMg }, TODAY))).toBe(PURCHASE_STRENGTH_INVALID);
    }
    for (const quantity of [10, 1, 2.5]) {
      expect(error(validate({ ...purchase, quantity }, TODAY))).toBe(VIALS_INVALID);
      expect(error(validateSaleOn({ ...sale, quantity }, TODAY))).toBe(VIALS_INVALID);
    }
    expect(error(validate({ ...purchase, receivedOn: 20260815 }, TODAY))).toBe(PURCHASE_DATE_REQUIRED);
    expect(error(validateSaleOn({ ...sale, buyerName: 7 }, TODAY))).toBe(OUTSIDE_BUYER_REQUIRED);
    // The same values as strings are accepted.
    expect(error(validate(purchase, TODAY))).toBe("ok");
    expect(error(validateSaleOn(sale, TODAY))).toBe("ok");
  });
});

describe("no future dates", () => {
  const purchase = { idempotencyKey: KEY, stockItemId: ITEM, receivedOn: TODAY, quantity: "10", unitCost: "20" };
  const sale = { idempotencyKey: KEY, stockItemId: ITEM, soldOn: TODAY, quantity: "1", unitPrice: "40", buyerType: "outside", buyerName: "Walk-in" };

  it("today and earlier are accepted; after the admin's local today is refused", () => {
    expect(error(validate(purchase, TODAY))).toBe("ok");
    expect(error(validateSaleOn(sale, TODAY))).toBe("ok");
    expect(error(validate({ ...purchase, receivedOn: "2020-01-01" }, TODAY))).toBe("ok");
    for (const date of ["2026-09-27", "2026-10-01", "2027-01-01"]) {
      expect(error(validate({ ...purchase, receivedOn: date }, TODAY))).toBe(PURCHASE_DATE_FUTURE);
      expect(error(validateSaleOn({ ...sale, soldOn: date }, TODAY))).toBe(SALE_DATE_FUTURE);
    }
    // Checked right after the date is required, before vials (first failure wins).
    expect(error(validateSaleOn({ ...sale, soldOn: "2026-09-27", quantity: "0" }, TODAY))).toBe(SALE_DATE_FUTURE);
    // The admin's own local date decides: the same date is fine a day later.
    expect(error(validateSaleOn({ ...sale, soldOn: "2026-09-27" }, "2026-09-27"))).toBe("ok");
  });

  it("a sale may be dated before the purchases it uses (validation never compares them)", () => {
    expect(error(validateSaleOn({ ...sale, soldOn: "2026-01-02" }, TODAY))).toBe("ok");
  });

  it("an invalid today is a programming error", () => {
    expect(() => validate(purchase, "")).toThrow(RangeError);
    expect(() => validateSaleOn(sale, "2026-02-30")).toThrow(RangeError);
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
