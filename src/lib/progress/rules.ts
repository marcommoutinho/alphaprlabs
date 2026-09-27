// R9 Progress: copy, the check-in's fixed choices and its validation. Pure
// and client-safe (no Temporal): shared by the screen, the server action and
// the tests. The database re-checks everything (save_check_in in
// 20260926220000_progress.sql).
//
// Which day (Marco, 2026-09-26): always the America/Toronto calendar day (the
// app is strictly local), whatever zone the researcher's cycles use, so there
// is one check-in per researcher per day. A check-in needs no cycle. Only
// today's check-in can be saved or edited.
//
// Lengths are counted in characters (Unicode code points), as PostgreSQL's
// char_length counts them: an emoji such as U+1F600 is one character, though
// JavaScript's .length (and an input's maxLength) count it as two.
import { normalizeDecimal, parseDecimal, plain } from "@/lib/calculator/decimal";

/** The zone that defines a check-in's day (the business zone, src/lib/inventory/screens.ts BUSINESS_TIME_ZONE). */
export const PROGRESS_TIME_ZONE = "America/Toronto";

/** R9's unwanted-effect chips, in the screen's order. "None noticed" is picked alone. */
export const EFFECTS = ["None noticed", "Injection-site redness", "Mild headache", "Nausea", "Fatigue", "Appetite change", "Other"] as const;
export type Effect = (typeof EFFECTS)[number];
export const NONE_NOTICED: Effect = "None noticed";

/** R9's measurement names, each with the unit the form suggests. */
export const MEASUREMENTS = [
  { name: "Sleep", unit: "h" },
  { name: "Weight", unit: "kg" },
  { name: "Waist", unit: "cm" },
  { name: "Other", unit: "" },
] as const;
export type MeasurementName = (typeof MEASUREMENTS)[number]["name"];

export const FEELINGS = [1, 2, 3, 4, 5] as const;
export const NOTE_LIMIT = 1000;
export const UNIT_LIMIT = 20;
export const VALUE_DECIMALS = 6;
/** Values are below this (a typo guard). */
export const VALUE_LIMIT = "1000000";
/** Days in "Last 14 days". */
export const HISTORY_DAYS = 14;

// ── Copy (the prototype's) ──────────────────────────────────────────────────

export const FEELING_REQUIRED = "Pick an overall feeling from 1 to 5.";
export const VALUE_INVALID = "Measurement must be a number, or leave it empty.";
export const UNIT_REQUIRED = "Add a unit for the measurement.";
export const CHECK_IN_SAVED = "Check-in saved.";
// Not in the prototype (it required a cycle; Marco, 2026-09-26: check-ins don't).
export const NO_CYCLE = "No cycle yet — your check-ins are shown on their own.";
export const NO_CYCLE_OPTION = "No cycle · check-ins only";
export const NO_CYCLE_SELECTED = "Check-ins only. Pick a cycle to see them beside its doses and phases.";
export const ONE_ENTRY = "One entry covers all active peptides";
export const NOT_EVIDENCE = "Shown together for your own comparison — not evidence that a peptide caused a change";
export const SPARSE = "Sparse history so far — that's fine. Gaps stay gaps.";
export const NO_CHECK_IN = "No check-in — not a zero";
export const NO_DOSES = "No doses recorded this day";
// Not in the prototype: limits, and the server's refusals.
export const VALUE_NEGATIVE = "Measurement can't be below 0.";
export const VALUE_TOO_LARGE = "Measurement must be less than 1,000,000.";
export const VALUE_TOO_PRECISE = `Measurement can have up to ${VALUE_DECIMALS} decimal places.`;
export const UNIT_TOO_LONG = `Units can be up to ${UNIT_LIMIT} characters.`;
export const NOTE_TOO_LONG = "Notes can be up to 1,000 characters.";
export const CHECK_IN_CHANGED = "This check-in was changed on another device. Reload the page to see the latest.";
export const NEW_DAY = "A new day has started. Reload the page to check in for today.";
export const CHECK_IN_INVALID = "This check-in could not be saved. Reload the page and try again.";

export const formTitle = (savedAt: string | null) => (savedAt ? `Today's check-in · saved ${savedAt}` : "Today's check-in");
export const saveLabel = (existing: boolean) => (existing ? "Update today's check-in" : "Save check-in");

// ── Effects ─────────────────────────────────────────────────────────────────

const isEffect = (value: unknown): value is Effect => typeof value === "string" && (EFFECTS as readonly string[]).includes(value);

/** Chips after tapping `effect`: "None noticed" clears the others, any other chip clears it. */
export function toggleEffect(current: readonly Effect[], effect: Effect): Effect[] {
  if (current.includes(effect)) return current.filter((e) => e !== effect);
  if (effect === NONE_NOTICED) return [NONE_NOTICED];
  return sortEffects([...current.filter((e) => e !== NONE_NOTICED), effect]);
}

/** In the chips' order. */
export const sortEffects = (effects: readonly Effect[]): Effect[] => [...effects].sort((a, b) => EFFECTS.indexOf(a) - EFFECTS.indexOf(b));

/** "Mild headache, Nausea", or "" when none or only "None noticed" (the history's yellow line). */
export const effectsLine = (effects: readonly string[]) =>
  effects.length && !(effects.length === 1 && effects[0] === NONE_NOTICED) ? effects.join(", ") : "";

// ── Validation ──────────────────────────────────────────────────────────────

export const unitFor = (name: string) => MEASUREMENTS.find((m) => m.name === name)?.unit ?? "";
const isMeasurementName = (value: unknown): value is MeasurementName => MEASUREMENTS.some((m) => m.name === value);

/** Characters as PostgreSQL's char_length counts them (code points, not UTF-16 units). */
export const characters = (text: string) => [...text].length;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What the form sends. */
export type CheckInForm = {
  /** The day the screen showed as today (YYYY-MM-DD). */
  day: string;
  /** The version shown, or null for the day's first check-in. */
  version: number | null;
  /** 0 when not picked. */
  feeling: number;
  effects: string[];
  note: string;
  measurementName: string;
  /** As typed: "82,4" or "82.4", or "" for none. */
  measurementValue: string;
  measurementUnit: string;
};

/** A check-in ready to save: the value exact and canonical ("82.4"), or no measurement. */
export type ValidCheckIn = {
  day: string;
  version: number | null;
  feeling: number;
  effects: Effect[];
  note: string;
  measurement: { name: MeasurementName; value: string; unit: string } | null;
};

export type CheckInValidation = { ok: true; value: ValidCheckIn } | { ok: false; error: string };

/**
 * The measurement value: a plain decimal (a comma works as the decimal point;
 * "1,000"-style grouping is refused, as everywhere in the app), 0 up to under
 * 1,000,000, at most 6 decimals. Returns the canonical text or the error.
 */
export function measurementValue(text: string): { ok: true; value: string } | { ok: false; error: string } {
  const normalized = normalizeDecimal(text);
  const parsed = normalized === null ? null : parseDecimal(normalized);
  if (parsed === null) return { ok: false, error: VALUE_INVALID };
  if (parsed.isNegative() && !parsed.isZero()) return { ok: false, error: VALUE_NEGATIVE };
  if (parsed.greaterThanOrEqualTo(VALUE_LIMIT)) return { ok: false, error: VALUE_TOO_LARGE };
  if (parsed.decimalPlaces() > VALUE_DECIMALS) return { ok: false, error: VALUE_TOO_PRECISE };
  // "-0" and "00.50" read as "0" and "0.5".
  return { ok: true, value: plain(parsed.abs()) };
}

/** The first problem in the prototype's order (feeling, measurement, unit), else the check-in to save. */
export function validateCheckIn(input: unknown): CheckInValidation {
  if (typeof input !== "object" || input === null) return { ok: false, error: CHECK_IN_INVALID };
  const raw = input as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const day = text(raw.day);
  const version = raw.version === null ? null : raw.version;
  const effects = Array.isArray(raw.effects) ? raw.effects : null;
  if (
    !DAY.test(day) ||
    !(version === null || (typeof version === "number" && Number.isInteger(version) && version >= 1)) ||
    effects === null ||
    !effects.every(isEffect) ||
    new Set(effects).size !== effects.length ||
    (effects.includes(NONE_NOTICED) && effects.length > 1)
  ) {
    return { ok: false, error: CHECK_IN_INVALID };
  }

  const feeling = raw.feeling;
  if (typeof feeling !== "number" || !FEELINGS.includes(feeling as never)) return { ok: false, error: FEELING_REQUIRED };

  let measurement: ValidCheckIn["measurement"] = null;
  const typed = text(raw.measurementValue).trim();
  if (typed) {
    const value = measurementValue(typed);
    if (!value.ok) return value;
    const unit = text(raw.measurementUnit).trim();
    if (!unit) return { ok: false, error: UNIT_REQUIRED };
    if (characters(unit) > UNIT_LIMIT) return { ok: false, error: UNIT_TOO_LONG };
    if (!isMeasurementName(raw.measurementName)) return { ok: false, error: CHECK_IN_INVALID };
    measurement = { name: raw.measurementName, value: value.value, unit };
  }

  const note = text(raw.note).trim();
  if (characters(note) > NOTE_LIMIT) return { ok: false, error: NOTE_TOO_LONG };

  return {
    ok: true,
    value: { day, version, feeling, effects: sortEffects(effects), note, measurement },
  };
}

// ── The day ─────────────────────────────────────────────────────────────────

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The local date (YYYY-MM-DD) of an instant in a zone; a check-in's day is this in PROGRESS_TIME_ZONE. */
export function checkInDay(at: Date | string, timeZone: string = PROGRESS_TIME_ZONE): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(typeof at === "string" ? new Date(at) : at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
