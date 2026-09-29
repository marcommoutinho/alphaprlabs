// R9 Progress: copy, the check-in's fixed choices and its validation. Pure
// and client-safe (no Temporal): shared by the screen, the server action and
// the tests. The database re-checks everything (save_check_in in
// 20260926220000_progress.sql, whose effects rule is now
// 20260928110000_check_in_effects_v3.sql's).
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

/**
 * R6's unwanted-effect chips (design v3), in the sheet's order. "None" is
 * picked alone; "Other" comes with its own text (OTHER_LIMIT characters).
 */
export const EFFECTS = ["None", "Site redness", "Nausea", "Headache", "Fatigue", "Poor sleep", "Water retention", "Other"] as const;
export type Effect = (typeof EFFECTS)[number];
export const NONE: Effect = "None";
export const OTHER: Effect = "Other";
/** The most characters "Other"'s text may have. */
export const OTHER_LIMIT = 100;

/**
 * The earlier chips (S15: None noticed, Injection-site redness, Mild
 * headache, Nausea, Fatigue, Appetite change, Other) stay valid in stored
 * check-ins. Shown under their v3 name where one corresponds; the others
 * (Appetite change, and Other, which then had no text) as they were.
 */
const LEGACY_LABELS: Readonly<Record<string, Effect>> = {
  "None noticed": "None",
  "Injection-site redness": "Site redness",
  "Mild headache": "Headache",
};

/**
 * R9's measurement names, each with the unit the form suggests. Weight's is
 * the account's weight unit (R8); lb, the default, when none is given.
 */
export const MEASUREMENTS = [
  { name: "Sleep", unit: "h" },
  { name: "Weight", unit: "lb" },
  { name: "Waist", unit: "cm" },
  { name: "Other", unit: "" },
] as const;
export type MeasurementName = (typeof MEASUREMENTS)[number]["name"];

export const FEELINGS = [1, 2, 3, 4, 5] as const;
/** R1's check-in card, R5 and R6: the five feelings, 1 (rough) to 5 (great). */
export const FEELING_WORDS: Record<number, string> = { 1: "Rough", 2: "Low", 3: "OK", 4: "Good", 5: "Great" };
export const NOTE_LIMIT = 1000;
export const UNIT_LIMIT = 20;
export const VALUE_DECIMALS = 6;
/** Values are below this (a typo guard). */
export const VALUE_LIMIT = "1000000";

// ── Copy (the prototype's) ──────────────────────────────────────────────────

export const FEELING_REQUIRED = "Pick an overall feeling from 1 to 5.";
export const OTHER_REQUIRED = "Describe the other unwanted effect, or unselect Other.";
export const OTHER_TOO_LONG = `The other unwanted effect can be up to ${OTHER_LIMIT} characters.`;
export const VALUE_INVALID = "Measurement must be a number, or leave it empty.";
export const UNIT_REQUIRED = "Add a unit for the measurement.";
export const CHECK_IN_SAVED = "Check-in saved.";
// Not in the prototype (it required a cycle; Marco, 2026-09-26: check-ins don't).
export const NO_CYCLE_OPTION = "No cycle · check-ins only";
export const NOT_EVIDENCE = "Shown together for your own comparison — not evidence that a peptide caused a change";
export const SPARSE = "Sparse history so far — that's fine. Gaps stay gaps.";
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

// ── Effects ─────────────────────────────────────────────────────────────────

const isEffect = (value: unknown): value is Effect => typeof value === "string" && (EFFECTS as readonly string[]).includes(value);

/** Chips after tapping `effect`: "None" clears the others, any other chip clears it. */
export function toggleEffect(current: readonly Effect[], effect: Effect): Effect[] {
  if (current.includes(effect)) return current.filter((e) => e !== effect);
  if (effect === NONE) return [NONE];
  return sortEffects([...current.filter((e) => e !== NONE), effect]);
}

/** In the chips' order. */
export const sortEffects = (effects: readonly Effect[]): Effect[] => [...effects].sort((a, b) => EFFECTS.indexOf(a) - EFFECTS.indexOf(b));

/** A stored chip as shown: its v3 name ("Mild headache" → "Headache"), or as stored. */
export const effectLabel = (stored: string): string => LEGACY_LABELS[stored] ?? stored;

/**
 * A stored check-in's chips as an edit form starts from them: v3 names, and
 * the Other text. Earlier chips with no v3 chip (Appetite change, and Other
 * without text) are left for the researcher to pick again.
 */
export function formEffects(effects: readonly string[], other: string): { effects: Effect[]; other: string } {
  const picked = effects
    .map(effectLabel)
    .filter((label): label is Effect => isEffect(label) && (label !== OTHER || other !== ""));
  return { effects: sortEffects([...new Set(picked)]), other: picked.includes(OTHER) ? other : "" };
}

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
  /** "Other"'s text (ignored unless Other is picked). */
  effectsOther?: string;
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
  /** "Other"'s text, trimmed: "" unless Other is picked, then 1 to OTHER_LIMIT characters. */
  effectsOther: string;
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

/** The first problem in the prototype's order (feeling, Other's text, measurement, unit), else the check-in to save. */
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
    (effects.includes(NONE) && effects.length > 1)
  ) {
    return { ok: false, error: CHECK_IN_INVALID };
  }

  const feeling = raw.feeling;
  if (typeof feeling !== "number" || !FEELINGS.includes(feeling as never)) return { ok: false, error: FEELING_REQUIRED };

  // "Other" needs its text; without Other, any text is dropped.
  const effectsOther = effects.includes(OTHER) ? text(raw.effectsOther).trim() : "";
  if (effects.includes(OTHER) && !effectsOther) return { ok: false, error: OTHER_REQUIRED };
  if (characters(effectsOther) > OTHER_LIMIT) return { ok: false, error: OTHER_TOO_LONG };

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
    value: { day, version, feeling, effects: sortEffects(effects), effectsOther, note, measurement },
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
