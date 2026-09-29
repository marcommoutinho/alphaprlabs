// Business inventory rules shared by A5 Record purchase, A6 Record sale and
// the stock item, the service and the tests (handoff
// docs/design/research-app/README.md A4-A7 and the prototype's copy). Pure:
// no database, no React.
//
// Money is CAD (plan D1) as exact decimal strings, calculated with decimal.js
// and never through binary floating point. Quantities are whole vials. Every
// form value arrives as a string (as form fields do; plan "Store amounts as
// decimal strings at application boundaries"): a JS number is refused, never
// converted, so no binary float reaches an amount. The
// database (supabase/migrations/20260926160000_business_inventory.sql and
// 20260926160100_business_inventory_writes.sql) enforces the same limits; these checks give the designed messages first.
//
// USD purchases (Marco, 2026-09-27; 20260927140000_purchase_currency.sql): the
// cost per vial may be entered in USD. The server converts it with the Bank of
// Canada rate for the date received (fx.ts) into the CAD cost FIFO uses:
// round-half-up(USD × rate, 2). Totals and gross profit stay in CAD.
import Decimal from "decimal.js";
import { Dec, normalizeDecimal } from "@/lib/calculator/decimal";

export const INVENTORY_LIMITS = { vials: 100_000, amount: "1000000", buyerName: 120, supplier: 120 } as const;

// A5 Record purchase (handoff copy, first failure wins).
export const PURCHASE_ITEM_REQUIRED = "Choose a stock item.";
export const PURCHASE_PEPTIDE_REQUIRED = "Choose the peptide for the new item.";
export const PURCHASE_STRENGTH_INVALID = "Enter the vial strength in mg for the new item.";
export const PURCHASE_DATE_REQUIRED = "Enter the date received.";
export const PURCHASE_DATE_FUTURE = "The date received can't be in the future.";
export const VIALS_INVALID = "Vials must be a whole number greater than 0.";
export const COST_INVALID = "Enter the cost per vial in CAD (0 or more).";
export const USD_COST_INVALID = "Enter the cost per vial in USD (0 or more).";
export const CURRENCY_REQUIRED = "Choose CAD or USD for the cost.";
// A6 Record sale.
export const SALE_ITEM_REQUIRED = "Choose a stock item.";
export const SALE_DATE_REQUIRED = "Enter the sale date.";
export const SALE_DATE_FUTURE = "The sale date can't be in the future.";
export const PRICE_INVALID = "Enter the selling price per vial in CAD.";
export const BUYER_TYPE_REQUIRED = "Choose Researcher account or Outside buyer.";
export const ACCOUNT_REQUIRED = "Choose the buyer's researcher account.";
export const OUTSIDE_BUYER_REQUIRED = "Name or reference the outside buyer.";
// Sellers (Marco, 2026-09-27): every new sale names its seller, a current admin.
export const SELLER_REQUIRED = "Choose the seller.";
export const SELLER_NOT_ADMIN = "The seller must be a current admin. The list has been refreshed; choose the seller again.";
// Linking a past outside sale to an account.
export const LINK_ACCOUNT_REQUIRED = "Choose the account to link this sale to.";
// Limits the design does not cover.
export const VIALS_TOO_MANY = "Vials can be at most 100,000 in one entry.";
export const AMOUNT_CENTS = "Enter CAD amounts in dollars and cents (at most 2 decimal places).";
export const AMOUNT_TOO_LARGE = "Amounts can be at most CAD 1,000,000.00 per vial.";
export const USD_AMOUNT_CENTS = "Enter USD amounts in dollars and cents (at most 2 decimal places).";
export const USD_AMOUNT_TOO_LARGE = "Amounts can be at most USD 1,000,000.00 per vial.";
export const BUYER_NAME_TOO_LONG = "The buyer name or reference can be up to 120 characters.";
// V6 (design v3 A4 / A5).
export const SUPPLIER_TOO_LONG = "The supplier can be up to 120 characters.";
export const PREVIEW_INVALID = "The cost preview is out of date. Check it and record again.";
/** A sale sent without the lots its preview showed (every sale is recorded against its preview). */
export const PREVIEW_REQUIRED = "A sale is recorded against its cost preview. Check the cost and record again.";
/** The same submission was already recorded (idempotent replay): a warn toast. */
export const SALE_ALREADY_RECORDED = "This sale was already recorded a moment ago. No duplicate created.";
export const PURCHASE_ALREADY_RECORDED = "This purchase was already recorded a moment ago. No duplicate created.";

/** A6 error when stock ran out between the preview and saving (the database refused). */
export function stockChangedMessage(onHand: number): string {
  return `Stock changed before saving — only ${onHand} on hand now. Nothing was recorded.`;
}

/** `Compound A · 8 mg` */
export const stockItemLabel = (peptideName: string, strengthMg: string) => `${peptideName} · ${strengthMg} mg`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const AMOUNT = /^\d+(\.\d+)?$/;
const STRENGTH = /^\d{1,6}(\.\d{1,3})?$/;

/** A form string, trimmed; anything else (a number included) is "" and fails as missing or invalid. */
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const uuid = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);

/** A real calendar date `YYYY-MM-DD`, or null. */
export function calendarDate(value: unknown): string | null {
  const match = DATE.exec(text(value));
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (year < 1 || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return match[0];
}

/** Whole vials 1..100,000 (a whole-number string), or the error. */
export function parseVials(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const raw = text(value);
  if (!/^\d+$/.test(raw) || Number(raw) < 1) return { ok: false, error: VIALS_INVALID };
  if (Number(raw) > INVENTORY_LIMITS.vials) return { ok: false, error: VIALS_TOO_MANY };
  return { ok: true, value: Number(raw) };
}
const vials = parseVials;

/**
 * A CAD amount 0..1,000,000.00 with at most 2 decimals, normalized to
 * `12.50`, or the error. Digits and a point only, as before V6 (a comma
 * decimal is the USD cost's rule, usdAmount: tests/unit/inventory-fx.test.ts).
 */
export function parseCad(value: unknown, invalid: string): { ok: true; value: string } | { ok: false; error: string } {
  const raw = text(value);
  if (!AMOUNT.test(raw)) return { ok: false, error: invalid };
  const decimal = new Decimal(raw);
  if (decimal.decimalPlaces() > 2) return { ok: false, error: AMOUNT_CENTS };
  if (decimal.gt(INVENTORY_LIMITS.amount)) return { ok: false, error: AMOUNT_TOO_LARGE };
  return { ok: true, value: decimal.toFixed(2) };
}
const amount = parseCad;

/** A purchase's supplier as typed: trimmed, blank as none (null), at most 120 characters. */
export function parseSupplier(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = text(value);
  if (!raw) return { ok: true, value: null };
  if (raw.length > INVENTORY_LIMITS.supplier) return { ok: false, error: SUPPLIER_TOO_LONG };
  return { ok: true, value: raw };
}

/** The lots a sale's preview showed, in FIFO order: what the sale must freeze (A4 / D4). */
export type ExpectedLot = { purchaseId: string; quantity: number };

/** The preview's lots sent with a sale: null when none were sent (or none listed); undefined when malformed. */
function expectedLots(value: unknown): ExpectedLot[] | null | undefined {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return null;
  if (!Array.isArray(value)) return undefined;
  const lots: ExpectedLot[] = [];
  for (const entry of value) {
    const raw = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const purchaseId = uuid(raw.purchaseId);
    const quantity = raw.quantity;
    if (!purchaseId || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > INVENTORY_LIMITS.vials) {
      return undefined;
    }
    lots.push({ purchaseId, quantity });
  }
  return lots;
}

/** A vial strength in mg above 0, at most 3 decimals and 100,000 mg, as `8` or `2.5`; or null. */
export function vialStrength(value: unknown): string | null {
  const raw = text(value);
  if (!STRENGTH.test(raw)) return null;
  const mg = new Decimal(raw);
  if (mg.lte(0) || mg.gt(100_000)) return null;
  return mg.toString();
}

/**
 * A USD cost per vial as typed: 0 to 1,000,000.00 with at most 2 decimals,
 * normalized to `11.00`, or the error. A comma works as the decimal point
 * ("11,5" = 11.50) and "1,000"-style grouping is refused rather than guessed
 * (Marco, 2026-09-26, the calculator's rules: normalizeDecimal).
 */
export function usdAmount(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const text = normalizeDecimal(value);
  if (text === null || !AMOUNT.test(text)) return { ok: false, error: USD_COST_INVALID };
  const decimal = new Decimal(text);
  if (decimal.decimalPlaces() > 2) return { ok: false, error: USD_AMOUNT_CENTS };
  if (decimal.gt(INVENTORY_LIMITS.amount)) return { ok: false, error: USD_AMOUNT_TOO_LARGE };
  return { ok: true, value: decimal.toFixed(2) };
}

/**
 * The CAD cost per vial of a USD cost: round-half-up(USD × rate, 2 decimals),
 * exact (decimal.js at 40 significant digits, never binary floating point).
 * The database checks the same equation (20260927140000_purchase_currency.sql).
 */
export function usdToCad(usdUnitCost: string, rate: string): string {
  return new Dec(usdUnitCost).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** A USD purchase's conversion: the USD cost per vial, the Bank of Canada rate and the rate's date. */
export type UsdConversion = { usdUnitCost: string; rate: string; rateDate: string };

export type ValidPurchase = {
  idempotencyKey: string;
  /** An existing item, or null for a new peptide/strength. */
  stockItemId: string | null;
  peptideId: string | null;
  strengthMg: string | null;
  receivedOn: string;
  quantity: number;
  /** CAD per vial (for a USD purchase, its conversion). */
  unitCost: string;
  /** A purchase entered in USD: how `unitCost` was converted. */
  usd?: UsdConversion;
  currency?: undefined;
  /** Who it was bought from (trimmed), or null: optional (V6). */
  supplier?: string | null;
};

/** A validated USD purchase before its rate is known (the server fetches it: fx.ts). */
export type UsdPurchaseEntry = Omit<ValidPurchase, "unitCost" | "usd" | "currency"> & { currency: "USD"; usdUnitCost: string };

/** What validatePurchase accepts: a CAD purchase, or a USD one still to convert. */
export type PurchaseEntry = ValidPurchase | UsdPurchaseEntry;

/**
 * A USD entry converted with the rate the server fetched: CAD per vial =
 * usdToCad(USD, rate). Refused when that exceeds the CAD 1,000,000.00 limit.
 */
export function convertUsdPurchase(
  entry: UsdPurchaseEntry,
  fx: { rate: string; rateDate: string },
): { ok: true; value: ValidPurchase } | { ok: false; error: string } {
  const unitCost = usdToCad(entry.usdUnitCost, fx.rate);
  if (new Decimal(unitCost).gt(INVENTORY_LIMITS.amount)) return { ok: false, error: AMOUNT_TOO_LARGE };
  const { idempotencyKey, stockItemId, peptideId, strengthMg, receivedOn, quantity, usdUnitCost, supplier } = entry;
  return {
    ok: true,
    value: {
      idempotencyKey,
      stockItemId,
      peptideId,
      strengthMg,
      receivedOn,
      quantity,
      unitCost,
      usd: { usdUnitCost, rate: fx.rate, rateDate: fx.rateDate },
      supplier: supplier ?? null,
    },
  };
}

/**
 * A date that is not after `today`: purchases and sales cannot be dated in the
 * future (Marco, 2026-09-26). `today` (`YYYY-MM-DD`) is today in the business
 * time zone, America/Toronto, computed on the server (screens.ts
 * businessToday); the database refuses any later date too
 * (supabase/migrations/20260926160000_business_inventory.sql "Dates").
 */
function notFuture(date: string, today: string): boolean {
  const bound = calendarDate(today);
  if (!bound) throw new RangeError(`Invalid date: ${today}`);
  return date <= bound;
}

/**
 * A5 purchase form, first failure wins: item (or the new item's peptide),
 * date, vials, cost, then the new item's strength (the prototype's order).
 * `stockItemId: "new"` means "New peptide / strength…". The idempotency key is
 * generated once per form (crypto.randomUUID) and resent on every retry.
 * `today` is the business date (America/Toronto); a later date received is refused.
 * `currency: "USD"` makes `unitCost` a USD cost (usdAmount); CAD is the default.
 */
export function validatePurchase(input: unknown, today: string): { ok: true; value: PurchaseEntry } | { ok: false; error: string } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const idempotencyKey = uuid(raw.idempotencyKey);
  if (!idempotencyKey) return { ok: false, error: "This form could not be identified. Reload the page and try again." };
  const isNew = raw.stockItemId === "new";
  const stockItemId = isNew ? null : uuid(raw.stockItemId);
  if (!isNew && !stockItemId) return { ok: false, error: PURCHASE_ITEM_REQUIRED };
  const peptideId = isNew ? uuid(raw.peptideId) : null;
  if (isNew && !peptideId) return { ok: false, error: PURCHASE_PEPTIDE_REQUIRED };
  const receivedOn = calendarDate(raw.receivedOn);
  if (!receivedOn) return { ok: false, error: PURCHASE_DATE_REQUIRED };
  if (!notFuture(receivedOn, today)) return { ok: false, error: PURCHASE_DATE_FUTURE };
  const quantity = vials(raw.quantity);
  if (!quantity.ok) return quantity;
  const currency = raw.currency === undefined || raw.currency === "CAD" ? "CAD" : raw.currency === "USD" ? "USD" : null;
  if (!currency) return { ok: false, error: CURRENCY_REQUIRED };
  const unitCost = currency === "USD" ? usdAmount(raw.unitCost) : amount(raw.unitCost, COST_INVALID);
  if (!unitCost.ok) return unitCost;
  const strengthMg = isNew ? vialStrength(raw.strengthMg) : null;
  if (isNew && !strengthMg) return { ok: false, error: PURCHASE_STRENGTH_INVALID };
  const supplier = parseSupplier(raw.supplier);
  if (!supplier.ok) return supplier;
  const purchase = { idempotencyKey, stockItemId, peptideId, strengthMg, receivedOn, quantity: quantity.value, supplier: supplier.value };
  return {
    ok: true,
    value: currency === "USD" ? { ...purchase, currency, usdUnitCost: unitCost.value } : { ...purchase, unitCost: unitCost.value },
  };
}

export type ValidSale = {
  idempotencyKey: string;
  stockItemId: string;
  soldOn: string;
  quantity: number;
  unitPrice: string;
  /** The admin who made the sale (required; the database checks they are a current admin). */
  sellerId: string;
  buyer: { type: "account"; profileId: string } | { type: "outside"; name: string };
  /**
   * The lots the preview showed (A4 / D4), required: the database refuses a
   * sale without them, or one that would freeze other lots.
   */
  expectedAllocation: ExpectedLot[];
};

/**
 * A6 sale form, first failure wins: item, date, seller, vials, price, buyer. Stock is
 * checked by the preview and again, atomically, by the database. `today` is
 * the business date (America/Toronto); a later sale date is refused. A sale may be dated
 * before the purchases whose stock it uses.
 */
export function validateSale(input: unknown, today: string): { ok: true; value: ValidSale } | { ok: false; error: string } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const idempotencyKey = uuid(raw.idempotencyKey);
  if (!idempotencyKey) return { ok: false, error: "This form could not be identified. Reload the page and try again." };
  const stockItemId = uuid(raw.stockItemId);
  if (!stockItemId) return { ok: false, error: SALE_ITEM_REQUIRED };
  const soldOn = calendarDate(raw.soldOn);
  if (!soldOn) return { ok: false, error: SALE_DATE_REQUIRED };
  if (!notFuture(soldOn, today)) return { ok: false, error: SALE_DATE_FUTURE };
  const sellerId = uuid(raw.sellerId);
  if (!sellerId) return { ok: false, error: SELLER_REQUIRED };
  const quantity = vials(raw.quantity);
  if (!quantity.ok) return quantity;
  const unitPrice = amount(raw.unitPrice, PRICE_INVALID);
  if (!unitPrice.ok) return unitPrice;
  let buyer: ValidSale["buyer"];
  if (raw.buyerType === "account") {
    const profileId = uuid(raw.buyerProfileId);
    if (!profileId) return { ok: false, error: ACCOUNT_REQUIRED };
    buyer = { type: "account", profileId };
  } else if (raw.buyerType === "outside") {
    const name = text(raw.buyerName);
    if (!name) return { ok: false, error: OUTSIDE_BUYER_REQUIRED };
    if (name.length > INVENTORY_LIMITS.buyerName) return { ok: false, error: BUYER_NAME_TOO_LONG };
    buyer = { type: "outside", name };
  } else {
    return { ok: false, error: BUYER_TYPE_REQUIRED };
  }
  const expectedAllocation = expectedLots(raw.expectedAllocation);
  if (expectedAllocation === null) return { ok: false, error: PREVIEW_REQUIRED };
  if (expectedAllocation === undefined) return { ok: false, error: PREVIEW_INVALID };
  return {
    ok: true,
    value: { idempotencyKey, stockItemId, soldOn, sellerId, quantity: quantity.value, unitPrice: unitPrice.value, buyer, expectedAllocation },
  };
}

export type ValidLink = { saleId: string; profileId: string; sameName: boolean };

/**
 * "Link to account…" on an outside buyer's sale: the sale, the chosen
 * account, and whether every other outside sale recorded with the same buyer
 * name is linked too (only an exact `true` asks for that).
 */
export function validateLink(input: unknown): { ok: true; value: ValidLink } | { ok: false; error: string } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const saleId = uuid(raw.saleId);
  if (!saleId) return { ok: false, error: "This sale could not be identified. Reload the page and try again." };
  const profileId = uuid(raw.profileId);
  if (!profileId) return { ok: false, error: LINK_ACCOUNT_REQUIRED };
  return { ok: true, value: { saleId, profileId, sameName: raw.sameName === true } };
}

/**
 * A purchase lot as FIFO sees it. `recordedOrder` is the lot's
 * business_purchases.recorded_order: the order purchases were recorded in.
 */
export type FifoLot = { purchaseId: string; receivedOn: string; recordedOrder: number; unitCost: string; remaining: number };
export type FifoAllocation = { purchaseId: string; receivedOn: string; unitCost: string; quantity: number };

/**
 * FIFO order, exactly as record_business_sale and admin_business_lots order
 * lots: received date, then recording order. The handoff's "by date, then id"
 * (README Business Rules 4) relies on the prototype's insertion-ordered ids;
 * database ids are random UUIDs, so recording order carries that meaning.
 */
export const fifoOrder = (a: Pick<FifoLot, "receivedOn" | "recordedOrder">, b: Pick<FifoLot, "receivedOn" | "recordedOrder">) =>
  a.receivedOn.localeCompare(b.receivedOn) || a.recordedOrder - b.recordedOrder;

/**
 * FIFO allocation of `quantity` vials across `lots` (sorted here by
 * fifoOrder, whatever order they arrive in): the oldest remaining vials first,
 * as record_business_sale does. `short` is how many vials the lots cannot
 * cover (0 when the sale fits). The model the tests check the database
 * against: the database previews the allocation (A6) and repeats it
 * atomically when the sale is saved.
 */
export function allocateFifo(lots: FifoLot[], quantity: number): { allocations: FifoAllocation[]; cost: string; short: number } {
  let need = Math.max(0, Math.floor(quantity));
  let cost = new Decimal(0);
  const allocations: FifoAllocation[] = [];
  for (const lot of [...lots].sort(fifoOrder)) {
    if (need === 0) break;
    if (lot.remaining <= 0) continue;
    const take = Math.min(lot.remaining, need);
    allocations.push({ purchaseId: lot.purchaseId, receivedOn: lot.receivedOn, unitCost: lot.unitCost, quantity: take });
    cost = cost.plus(new Decimal(lot.unitCost).times(take));
    need -= take;
  }
  return { allocations, cost: cost.toFixed(2), short: need };
}

/** Sums decimal strings exactly, as `0.00`. */
export const sumAmounts = (amounts: string[]) => amounts.reduce((total, a) => total.plus(a), new Decimal(0)).toFixed(2);
