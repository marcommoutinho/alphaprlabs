// Business inventory rules shared by A5 Record purchase, A6 Record sale (live
// preview) and A7 Sales, the service and the tests (handoff
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
import Decimal from "decimal.js";

export const INVENTORY_LIMITS = { vials: 100_000, amount: "1000000", buyerName: 120 } as const;

// A5 Record purchase (handoff copy, first failure wins).
export const PURCHASE_ITEM_REQUIRED = "Choose a stock item.";
export const PURCHASE_PEPTIDE_REQUIRED = "Choose the peptide for the new item.";
export const PURCHASE_STRENGTH_INVALID = "Enter the vial strength in mg for the new item.";
export const PURCHASE_DATE_REQUIRED = "Enter the date received.";
export const PURCHASE_DATE_FUTURE = "The date received can't be in the future.";
export const VIALS_INVALID = "Vials must be a whole number greater than 0.";
export const COST_INVALID = "Enter the cost per vial in CAD (0 or more).";
// A6 Record sale.
export const SALE_ITEM_REQUIRED = "Choose a stock item.";
export const SALE_DATE_REQUIRED = "Enter the sale date.";
export const SALE_DATE_FUTURE = "The sale date can't be in the future.";
export const PRICE_INVALID = "Enter the selling price per vial in CAD.";
export const BUYER_TYPE_REQUIRED = "Choose Researcher account or Outside buyer.";
export const ACCOUNT_REQUIRED = "Choose the buyer's researcher account.";
export const OUTSIDE_BUYER_REQUIRED = "Name or reference the outside buyer.";
// Limits the design does not cover.
export const VIALS_TOO_MANY = "Vials can be at most 100,000 in one entry.";
export const AMOUNT_CENTS = "Enter CAD amounts in dollars and cents (at most 2 decimal places).";
export const AMOUNT_TOO_LARGE = "Amounts can be at most CAD 1,000,000.00 per vial.";
export const BUYER_NAME_TOO_LONG = "The buyer name or reference can be up to 120 characters.";
/** The same submission was already recorded (idempotent replay): a warn toast. */
export const SALE_ALREADY_RECORDED = "This sale was already recorded a moment ago. No duplicate created.";
export const PURCHASE_ALREADY_RECORDED = "This purchase was already recorded a moment ago. No duplicate created.";

/** A6 inline error while the form asks for more vials than are on hand. */
export function insufficientStockMessage(onHand: number, itemLabel: string): string {
  return `Only ${onHand} vial${onHand === 1 ? " is" : "s are"} on hand for ${itemLabel}. Reduce the quantity or record a purchase first.`;
}

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
function vials(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const raw = text(value);
  if (!/^\d+$/.test(raw) || Number(raw) < 1) return { ok: false, error: VIALS_INVALID };
  if (Number(raw) > INVENTORY_LIMITS.vials) return { ok: false, error: VIALS_TOO_MANY };
  return { ok: true, value: Number(raw) };
}

/** A CAD amount 0..1,000,000.00 with at most 2 decimals, normalized to `12.50`, or the error. */
function amount(value: unknown, invalid: string): { ok: true; value: string } | { ok: false; error: string } {
  const raw = text(value);
  if (!AMOUNT.test(raw)) return { ok: false, error: invalid };
  const decimal = new Decimal(raw);
  if (decimal.decimalPlaces() > 2) return { ok: false, error: AMOUNT_CENTS };
  if (decimal.gt(INVENTORY_LIMITS.amount)) return { ok: false, error: AMOUNT_TOO_LARGE };
  return { ok: true, value: decimal.toFixed(2) };
}

/** A vial strength in mg above 0, at most 3 decimals and 100,000 mg, as `8` or `2.5`; or null. */
export function vialStrength(value: unknown): string | null {
  const raw = text(value);
  if (!STRENGTH.test(raw)) return null;
  const mg = new Decimal(raw);
  if (mg.lte(0) || mg.gt(100_000)) return null;
  return mg.toString();
}

export type ValidPurchase = {
  idempotencyKey: string;
  /** An existing item, or null for a new peptide/strength. */
  stockItemId: string | null;
  peptideId: string | null;
  strengthMg: string | null;
  receivedOn: string;
  quantity: number;
  unitCost: string;
};

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
 */
export function validatePurchase(input: unknown, today: string): { ok: true; value: ValidPurchase } | { ok: false; error: string } {
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
  const unitCost = amount(raw.unitCost, COST_INVALID);
  if (!unitCost.ok) return unitCost;
  const strengthMg = isNew ? vialStrength(raw.strengthMg) : null;
  if (isNew && !strengthMg) return { ok: false, error: PURCHASE_STRENGTH_INVALID };
  return {
    ok: true,
    value: { idempotencyKey, stockItemId, peptideId, strengthMg, receivedOn, quantity: quantity.value, unitCost: unitCost.value },
  };
}

export type ValidSale = {
  idempotencyKey: string;
  stockItemId: string;
  soldOn: string;
  quantity: number;
  unitPrice: string;
  buyer: { type: "account"; profileId: string } | { type: "outside"; name: string };
};

/**
 * A6 sale form, first failure wins: item, date, vials, price, buyer. Stock is
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
  return { ok: true, value: { idempotencyKey, stockItemId, soldOn, quantity: quantity.value, unitPrice: unitPrice.value, buyer } };
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
 * cover (0 when the sale fits). A6's live preview; the database repeats it
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

/** Revenue, cost and gross profit (revenue − cost; never "net") as `0.00` strings. */
export function saleAmounts(quantity: number, unitPrice: string, cost: string) {
  const revenue = new Decimal(unitPrice).times(quantity);
  return { revenue: revenue.toFixed(2), cost: new Decimal(cost).toFixed(2), grossProfit: revenue.minus(cost).toFixed(2) };
}

/** Sums decimal strings exactly, as `0.00`. */
export const sumAmounts = (amounts: string[]) => amounts.reduce((total, a) => total.plus(a), new Decimal(0)).toFixed(2);

export type SalesPeriod = "all" | "month" | "prev";

/**
 * A7 Period filter as an inclusive date range for `today` (`YYYY-MM-DD`, the
 * business date, America/Toronto): This month / Last month / All time (no bounds).
 */
export function salesPeriodRange(period: SalesPeriod, today: string): { from: string | null; to: string | null } {
  if (period === "all") return { from: null, to: null };
  const date = calendarDate(today);
  if (!date) throw new RangeError(`Invalid date: ${today}`);
  let year = Number(date.slice(0, 4));
  let month = Number(date.slice(5, 7));
  if (period === "prev") {
    month -= 1;
    if (month === 0) [year, month] = [year - 1, 12];
  }
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ym = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
