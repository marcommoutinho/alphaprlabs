// R8 Me · Preferences (design v3 UI_BREAKDOWN "R8 Me"; tasks/research-app.md
// "Design v3 rebuild decisions"): Default syringe, Weight unit, Appearance,
// stored per account (supabase/migrations/20260928140000_me_preferences.sql).
// Pure and client-safe: shared by the screens, the server actions and the
// tests.
import Decimal from "decimal.js";
import { type Appearance, isAppearance } from "@/lib/alpha/appearance";
import { isSyringeCapacity, type SyringeCapacity } from "@/lib/calculator/calculator";
import { Exact, formatAmount, parseDecimal, plain } from "@/lib/calculator/decimal";

export type WeightUnit = "kg" | "lb";
export const WEIGHT_UNITS: readonly WeightUnit[] = ["kg", "lb"];

export type Preferences = {
  /** Preselects the syringe where no saved mixture says otherwise. */
  defaultSyringe: SyringeCapacity;
  /** Weights are shown and entered in it. */
  weightUnit: WeightUnit;
  /** Null: never chosen on the account, so the device keeps its own (the cookie; System without one). */
  appearance: Appearance | null;
};

/** An account that never saved a preference: 100-unit, kg, and the device's own appearance. */
export const DEFAULT_PREFERENCES: Preferences = { defaultSyringe: 100, weightUnit: "kg", appearance: null };

export const isWeightUnit = (value: unknown): value is WeightUnit => value === "kg" || value === "lb";

/** The stored row (account_preferences), or null when there is none, as preferences; anything unexpected reads as the default. */
export function resolvePreferences(row: { default_syringe: number; weight_unit: string; appearance: string | null } | null | undefined): Preferences {
  if (!row) return DEFAULT_PREFERENCES;
  return {
    defaultSyringe: isSyringeCapacity(row.default_syringe) ? row.default_syringe : DEFAULT_PREFERENCES.defaultSyringe,
    weightUnit: isWeightUnit(row.weight_unit) ? row.weight_unit : DEFAULT_PREFERENCES.weightUnit,
    appearance: isAppearance(row.appearance) ? row.appearance : null,
  };
}

/** The syringe a screen starts on: the saved mixture's when there is one, else the account's default. */
export function resolveSyringe(saved: SyringeCapacity | null | undefined, preferred: SyringeCapacity): SyringeCapacity {
  return saved ?? preferred;
}

/** The appearance shown on a device: the account's once chosen there, else the device's cookie. */
export function resolveAppearance(account: Appearance | null, device: Appearance): Appearance {
  return account ?? device;
}

// ── Labels (R8's rows and their choice sheets) ──────────────────────────────

export const SYRINGE_CHOICE_LABEL: Record<SyringeCapacity, string> = { 100: "100-unit", 50: "50-unit", 30: "30-unit" };
export const SYRINGE_CHOICE_NOTE: Record<SyringeCapacity, string> = { 100: "1 mL", 50: "0.5 mL", 30: "0.3 mL" };
export const WEIGHT_UNIT_LABEL: Record<WeightUnit, string> = { kg: "kg", lb: "lb" };
export const WEIGHT_UNIT_NOTE: Record<WeightUnit, string> = { kg: "Kilograms", lb: "Pounds" };
export const APPEARANCE_LABEL: Record<Appearance, string> = { system: "System", light: "Light", dark: "Dark" };
export const APPEARANCE_NOTE: Record<Appearance, string> = {
  system: "Follows your phone or computer",
  light: "Always light",
  dark: "Always dark",
};

/**
 * R8's Appearance row: what the account holds; before the account has a
 * choice, what this device shows, marked as this device's own.
 */
export function appearanceRowLabel(account: Appearance | null, device: Appearance): string {
  return account ? APPEARANCE_LABEL[account] : `${APPEARANCE_LABEL[device]} · this device`;
}

/** What a preference save changes: one or more of the three. */
export type PreferencePatch = Partial<{ defaultSyringe: SyringeCapacity; weightUnit: WeightUnit; appearance: Appearance }>;

/** A patch from untrusted input (a server action), or null when it names nothing valid or anything invalid. */
export function parsePatch(input: unknown): PreferencePatch | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const patch: PreferencePatch = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (key === "defaultSyringe" && isSyringeCapacity(value)) patch.defaultSyringe = value;
    else if (key === "weightUnit" && isWeightUnit(value)) patch.weightUnit = value;
    else if (key === "appearance" && isAppearance(value)) patch.appearance = value;
    else return null;
  }
  return Object.keys(patch).length ? patch : null;
}

// ── Weight ──────────────────────────────────────────────────────────────────

/** 1 lb in kg, exactly (the international avoirdupois pound). */
export const KG_PER_LB = "0.45359237";

/** The weight unit a stored measurement unit names ("kg", "KG", "lbs"), or null for any other unit. */
export function weightUnitOf(unit: string): WeightUnit | null {
  const text = unit.trim().toLowerCase();
  if (text === "kg" || text === "kgs") return "kg";
  if (text === "lb" || text === "lbs") return "lb";
  return null;
}

/** A weight in another unit, exactly (lb → kg multiplies by 0.45359237; kg → lb divides by it, at 200 digits). */
export function convertWeight(value: Decimal.Value, from: WeightUnit, to: WeightUnit): Decimal {
  const exact = new Exact(value);
  if (from === to) return exact;
  return from === "lb" ? exact.times(KG_PER_LB) : exact.dividedBy(KG_PER_LB);
}

/** Decimal places a converted weight is shown to. */
export const CONVERTED_WEIGHT_DECIMALS = 1;

/**
 * A stored weight as text in `to`: exactly as stored when it is already in
 * that unit ("81.4"), else converted exactly and shown to one decimal place,
 * half up ("179.5"). Null when the value is not a decimal.
 */
export function weightIn(value: string, from: WeightUnit, to: WeightUnit): string | null {
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  if (from === to) return formatAmount(parsed);
  return plain(convertWeight(parsed, from, to).toDecimalPlaces(CONVERTED_WEIGHT_DECIMALS, Decimal.ROUND_HALF_UP));
}

/**
 * A stored measurement as shown with the account's weight unit: a Weight
 * entered in kg or lb is shown in `unit` (weightIn), anything else as stored.
 */
export function shownMeasurement<M extends { name: string; value: string; unit: string }>(measurement: M, unit: WeightUnit): M {
  if (measurement.name !== "Weight") return measurement;
  const from = weightUnitOf(measurement.unit);
  if (!from) return measurement;
  const value = weightIn(measurement.value, from, unit);
  return value === null ? measurement : { ...measurement, value, unit };
}
