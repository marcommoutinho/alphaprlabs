// A4 / A5 (and the laptop drawers): the Record sale and Record purchase
// sheets' copy, their Now blocks and how a submission keeps its request key.
// Pure: no database, no React, so the browser, the server and the tests
// share it. Money is exact decimal text (decimal.js), shown with `money`
// ("$360.00", "− $40.14"); dates are business dates (America/Toronto).
import Decimal from "decimal.js";
import { money, monthDay } from "@/lib/alpha/format";
import { parseCad, parseVials, usdAmount, usdToCad } from "@/lib/inventory/rules";

/** `?record=sale|purchase`: a record sheet to open when the page loads (the old form addresses redirect with it). */
export type RecordKind = "sale" | "purchase";
export const recordKindOf = (value: unknown): RecordKind | null => (value === "sale" || value === "purchase" ? value : null);

// ── Copy ─────────────────────────────────────────────────────────────────────
export const BUYER_HELPER = "Pick a researcher or type any buyer name.";
export const BUYER_REQUIRED = "Pick a researcher or type the buyer's name.";
export const BUYER_PLACEHOLDER = "Name or email";
export const BUYER_NO_MATCH = "No researcher matches. Record it to this name.";
export const SUPPLIER_PLACEHOLDER = "Supplier · optional";
export const ITEM_REQUIRED = "Choose the item.";
export const NEW_ITEM = "New peptide / strength…";
export const FILLED_AUTOMATICALLY = "Filled automatically";
export const RECORDING_PAUSED = "Stock counts couldn't load, so recording is paused. Nothing was lost.";
export const PREVIEW_UNAVAILABLE = "Couldn't work out the cost. Try again.";
export const STOCK_CHANGED =
  "Stock changed since this preview, so nothing was recorded. Check the new cost and record again.";
export const SAVE_UNSURE = "Couldn't confirm it was recorded. Retry sends the same entry, so it's never recorded twice.";
export const NO_ITEMS = "No stock items yet. Record a purchase to create one.";

/** "Only 58 on hand." */
export const onlyOnHand = (onHand: number) => `Only ${onHand.toLocaleString("en-CA")} on hand.`;

/** "58 on hand" */
export const onHandLabel = (onHand: number) => `${onHand.toLocaleString("en-CA")} on hand`;

/** "US$ 9.20" (A5's USD amounts). */
export function usd(amount: string | Decimal): string {
  const text = money(amount);
  return text.startsWith("−") ? text.replace("$", "US$ ") : `US${text.replace("$", "$ ")}`;
}

// ── A4 Record sale ───────────────────────────────────────────────────────────

/** One lot the sale would take vials from, oldest first (admin_business_sale_preview). */
export type PreviewLot = {
  purchaseId: string;
  quantity: number;
  /** CAD per vial. */
  unitCost: string;
  receivedOn: string;
  currency: "CAD" | "USD";
  usdUnitCost: string | null;
  fxRate: string | null;
  supplier: string | null;
};

/** The server's FIFO preview for an item and a number of vials. */
export type SalePreview = {
  stockItemId: string;
  quantity: number;
  onHand: number;
  /** More vials than are on hand: no lots, no cost. */
  short: boolean;
  /** The cost of the lots, exact (`40.14`), or null when short. */
  cost: string | null;
  lots: PreviewLot[];
};

type PreviewJson = {
  on_hand?: unknown;
  short?: unknown;
  cost?: unknown;
  lots?: unknown;
};

/** The database's preview (jsonb) as a SalePreview, or null when it isn't one. */
export function toSalePreview(stockItemId: string, quantity: number, value: unknown): SalePreview | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as PreviewJson;
  if (typeof raw.on_hand !== "number" || typeof raw.short !== "boolean" || !Array.isArray(raw.lots)) return null;
  const lots: PreviewLot[] = [];
  for (const entry of raw.lots as Record<string, unknown>[]) {
    if (typeof entry?.purchase_id !== "string" || typeof entry.quantity !== "number" || typeof entry.unit_cost !== "string") return null;
    lots.push({
      purchaseId: entry.purchase_id,
      quantity: entry.quantity,
      unitCost: entry.unit_cost,
      receivedOn: String(entry.received_on),
      currency: entry.currency === "USD" ? "USD" : "CAD",
      usdUnitCost: typeof entry.usd_unit_cost === "string" ? entry.usd_unit_cost : null,
      fxRate: typeof entry.fx_rate === "string" ? entry.fx_rate : null,
      supplier: typeof entry.supplier === "string" ? entry.supplier : null,
    });
  }
  return {
    stockItemId,
    quantity,
    onHand: raw.on_hand,
    short: raw.short,
    cost: typeof raw.cost === "string" ? raw.cost : null,
    lots,
  };
}

/** "3 from Aug 30 lot at $13.38" */
export const costLine = (lot: Pick<PreviewLot, "quantity" | "receivedOn" | "unitCost">) =>
  `${lot.quantity.toLocaleString("en-CA")} from ${monthDay(lot.receivedOn)} lot at ${money(lot.unitCost)}`;

/** A whole number of vials 1..100,000 as typed, or null. */
export function vialsOf(text: string): number | null {
  const parsed = parseVials(text);
  return parsed.ok ? parsed.value : null;
}

/** A CAD amount as typed (comma decimals, no grouping), exact, or null. */
export function cadOf(text: string): string | null {
  const parsed = parseCad(text, "");
  return parsed.ok ? parsed.value : null;
}

export type SaleNow = {
  /** Exact, or null until the entry gives one. */
  revenue: string | null;
  cost: string | null;
  grossProfit: string | null;
  /** "Revenue · 3 × $120.00" */
  revenueLabel: string;
  /** One line per lot. */
  costLines: { key: string; label: string; amount: string }[];
};

/**
 * A4's Now block: revenue = vials × price; cost = the lots the server
 * previewed for exactly these vials (never computed here); gross profit =
 * revenue − cost. A preview for other vials or another item shows no cost.
 */
export function saleNow(input: { quantity: number | null; price: string | null; preview: SalePreview | null }): SaleNow {
  const { quantity, price } = input;
  const preview = input.preview && input.preview.quantity === quantity && !input.preview.short ? input.preview : null;
  const revenue = quantity !== null && price !== null ? new Decimal(price).times(quantity).toFixed(2) : null;
  const cost = preview?.cost ?? null;
  return {
    revenue,
    cost,
    grossProfit: revenue !== null && cost !== null ? new Decimal(revenue).minus(cost).toFixed(2) : null,
    revenueLabel: quantity !== null && price !== null ? `Revenue · ${quantity.toLocaleString("en-CA")} × ${money(price)}` : "Revenue",
    costLines: (preview?.lots ?? []).map((lot) => ({
      key: lot.purchaseId,
      label: `Cost · ${costLine(lot)}`,
      amount: money(new Decimal(lot.unitCost).times(lot.quantity).negated()),
    })),
  };
}

/** The lots a sale sends so the database refuses it if it would freeze others (AP037). */
export const expectedAllocation = (preview: SalePreview) =>
  preview.lots.map((lot) => ({ purchaseId: lot.purchaseId, quantity: lot.quantity }));

/** "Record sale · $360.00" */
export const recordSaleLabel = (revenue: string | null) => (revenue === null ? "Record sale" : `Record sale · ${money(revenue)}`);

/** "Sale recorded · 3 vials · $360.00 · gross profit $319.86" (the amounts the database froze). */
export const saleRecordedToast = (sale: { quantity: number; revenue: string; grossProfit: string }) =>
  `Sale recorded · ${vialsText(sale.quantity)} · ${money(sale.revenue)} · gross profit ${money(sale.grossProfit)}`;

// ── A5 Record purchase ───────────────────────────────────────────────────────

export type PurchaseNow = {
  /** CAD total, exact, or null until the entry (and a USD rate) gives one. */
  total: string | null;
  /** CAD per vial. */
  unitCost: string | null;
  /** USD: "50 × US$ 9.20" and "US$ 460.00". */
  usdLine: { label: string; amount: string } | null;
  /** "$12.64 · 72" */
  perVialAfter: string | null;
};

/**
 * A5's Now block. CAD: total = vials × cost. USD: CAD per vial =
 * round-half-up(USD × stored rate) as the save converts it (usdToCad), and
 * total = vials × that; the USD line shows vials × USD.
 */
export function purchaseNow(input: {
  quantity: number | null;
  currency: "CAD" | "USD";
  cost: string;
  rate: string | null;
  onHand: number | null;
}): PurchaseNow {
  const { quantity } = input;
  let unitCost: string | null = null;
  let usdLine: PurchaseNow["usdLine"] = null;
  if (input.currency === "USD") {
    const parsed = usdAmount(input.cost);
    if (parsed.ok && input.rate) unitCost = usdToCad(parsed.value, input.rate);
    if (parsed.ok && quantity !== null) {
      usdLine = {
        label: `${quantity.toLocaleString("en-CA")} × ${usd(parsed.value)}`,
        amount: usd(new Decimal(parsed.value).times(quantity)),
      };
    }
  } else {
    unitCost = cadOf(input.cost);
  }
  const total = unitCost !== null && quantity !== null ? new Decimal(unitCost).times(quantity).toFixed(2) : null;
  const after = quantity !== null ? (input.onHand ?? 0) + quantity : null;
  return {
    total,
    unitCost,
    usdLine,
    perVialAfter: unitCost !== null && after !== null ? `${money(unitCost)} · ${after.toLocaleString("en-CA")}` : null,
  };
}

/** "Record purchase · $632.09" */
export const recordPurchaseLabel = (total: string | null) => (total === null ? "Record purchase" : `Record purchase · ${money(total)}`);

/** "Purchase recorded · 50 vials · $632.09", and for USD "… · US$ 9.20 at 1.3741" (the rate it was converted with). */
export const purchaseRecordedToast = (purchase: { quantity: number; unitCost: string; usd?: { usdUnitCost: string; rate: string } }) =>
  `Purchase recorded · ${vialsText(purchase.quantity)} · ${money(new Decimal(purchase.unitCost).times(purchase.quantity))}` +
  (purchase.usd ? ` · ${usd(purchase.usd.usdUnitCost)} at ${purchase.usd.rate}` : "");

/** "1 USD = 1.3741 CAD" */
export const rateLine = (rate: string) => `1 USD = ${rate} CAD`;

/** "for Sep 23" */
export const rateFor = (rateDate: string) => `for ${monthDay(rateDate)}`;

// ── Request keys ─────────────────────────────────────────────────────────────

/** One submission: its request key and the entry it was made for. */
export type RecordAttempt = { key: string; entry: string };

/**
 * The attempt Record (or Retry) sends. Until a sure answer arrives for
 * `pending`, submitting the same entry reuses its key, so a sale or purchase
 * that was recorded but whose answer was lost replays instead of recording
 * twice; a changed entry is a new submission with a new key. Like V5's
 * reorder levels (src/lib/business/stock.ts attemptFor).
 */
export const recordAttempt = (pending: RecordAttempt | null, entry: unknown, newKey: () => string): RecordAttempt => {
  const fingerprint = JSON.stringify(entry);
  return pending && pending.entry === fingerprint ? pending : { key: newKey(), entry: fingerprint };
};

const vialsText = (count: number) => `${count.toLocaleString("en-CA")} vial${count === 1 ? "" : "s"}`;
