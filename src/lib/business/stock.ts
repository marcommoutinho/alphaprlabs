// A3 / D4 Stock and the low-stock parts of A1 / A2 (design v3), pure: the
// server, the browser and the tests share it. Money stays exact decimal text
// (decimal.js).
//
// Low stock (tasks/research-app.md "Design v3 rebuild decisions": a per-item
// threshold, default 10 vials): an item is low when its vials on hand are
// fewer than its threshold. A threshold of 0 never flags the item.
import Decimal from "decimal.js";
import type { StockLevel } from "./service";

export const DEFAULT_THRESHOLD = 10;
export const THRESHOLD_MAX = 100_000;

export const isLow = (item: Pick<StockLevel, "onHand" | "threshold">) => item.onHand < item.threshold;

/** Name, then strength numerically (so 5 mg before 10 mg). */
export function byName(a: Pick<StockLevel, "peptideName" | "peptideId" | "strengthMg">, b: typeof a): number {
  return (
    a.peptideName.localeCompare(b.peptideName, "en", { sensitivity: "base" }) ||
    a.peptideId.localeCompare(b.peptideId) ||
    new Decimal(a.strengthMg).comparedTo(b.strengthMg)
  );
}

/** Low items, fewest on hand first (then by name): A1's Low stock rows. */
export const lowItems = (items: StockLevel[]) =>
  items.filter(isLow).sort((a, b) => a.onHand - b.onHand || byName(a, b));

/** Total vials on hand and their value at cost. */
export function stockTotals(items: Pick<StockLevel, "onHand" | "valueAtCost">[]): { vials: number; value: string } {
  return {
    vials: items.reduce((n, item) => n + item.onHand, 0),
    value: items.reduce((sum, item) => sum.plus(item.valueAtCost), new Decimal(0)).toFixed(2),
  };
}

/** The average cost of a vial on hand, to the cent; null with none on hand. */
export const avgCost = (item: Pick<StockLevel, "onHand" | "valueAtCost">) =>
  item.onHand > 0 ? new Decimal(item.valueAtCost).dividedBy(item.onHand).toFixed(2, Decimal.ROUND_HALF_UP) : null;

/** Search: the name, the strength ("10 mg") or the whole label contains the text, ignoring case. */
export function matchesSearch(item: Pick<StockLevel, "peptideName" | "strengthMg" | "label">, query: string): boolean {
  const text = query.trim().toLocaleLowerCase("en-CA");
  if (!text) return true;
  return [item.peptideName, `${item.strengthMg} mg`, item.label].some((value) => value.toLocaleLowerCase("en-CA").includes(text));
}

export type StockSortKey = "item" | "onHand" | "value" | "avgCost" | "sold30d";
export type StockSort = { key: StockSortKey; direction: "asc" | "desc" };

/** D4's default: low items pinned first, then by name. */
export const DEFAULT_SORT: StockSort = { key: "item", direction: "asc" };

/**
 * D4's sortable table. The default (Item, ascending) pins low items first, as
 * the phone does; any other sort orders every row by that column, ties by
 * name.
 */
export function sortStock(items: StockLevel[], sort: StockSort): StockLevel[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  const value = (item: StockLevel): Decimal => {
    switch (sort.key) {
      case "onHand":
        return new Decimal(item.onHand);
      case "value":
        return new Decimal(item.valueAtCost);
      case "avgCost":
        return new Decimal(avgCost(item) ?? -1);
      case "sold30d":
        return new Decimal(item.sold30d);
      default:
        return new Decimal(0);
    }
  };
  return [...items].sort((a, b) => {
    if (sort.key === "item") {
      if (sort.direction === "asc" && isLow(a) !== isLow(b)) return isLow(a) ? -1 : 1;
      return sign * byName(a, b);
    }
    return sign * value(a).comparedTo(value(b)) || byName(a, b);
  });
}

/** The level bar's fill: on hand as a share of the item with the most on hand (0..1). */
export function levelOf(item: Pick<StockLevel, "onHand">, items: Pick<StockLevel, "onHand">[]): number {
  const most = items.reduce((max, other) => Math.max(max, other.onHand), 0);
  return most > 0 ? item.onHand / most : 0;
}

/** A threshold typed into the sheet: a whole number of vials from 0 to 100,000, or the message. */
export function parseThreshold(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!/^\d{1,6}$/.test(text)) return { ok: false, error: "Enter a whole number of vials, 0 or more." };
  const number = Number(text);
  if (number > THRESHOLD_MAX) return { ok: false, error: "The threshold can be at most 100,000 vials." };
  return { ok: true, value: number };
}

/** One reorder-level submission: its request key and the value it asks for. */
export type ThresholdAttempt = { key: string; value: number };

/**
 * The attempt a Save or Retry sends. Until an answer arrives for `pending`,
 * submitting its value again (Retry, or Save pressed again) reuses its key,
 * so a request that was saved but whose answer was lost replays instead of
 * saving again over a newer change; another value is a new edit, with a new
 * key.
 */
export const attemptFor = (pending: ThresholdAttempt | null, value: number, newKey: () => string): ThresholdAttempt =>
  pending && pending.value === value ? pending : { key: newKey(), value };

/** "4 vials" · "1 vial" */
export const vialCount = (count: number) => `${count.toLocaleString("en-CA")} vial${count === 1 ? "" : "s"}`;

/** "Low · reorder at 10" */
export const reorderLine = (threshold: number) => `Low · reorder at ${threshold.toLocaleString("en-CA")}`;
