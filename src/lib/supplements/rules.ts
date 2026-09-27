// R10 Supplements: the routine form's rules, the Taken form's input, and the
// screens' wording (the prototype's R10 and Today copy). Pure and
// client-safe: shared by the screens, the server actions and the tests. The
// database re-checks everything (20260927100000_supplements.sql).
//
// Amounts are exact decimals with their own free-text unit ("2000 IU",
// "1,5 capsules"): a comma works as the decimal point and "1,000"-style
// grouping is refused, as everywhere in the app. Lengths are counted in
// characters (Unicode code points), as PostgreSQL's char_length counts them.
// Supplements never use the syringe calculator or peptide stock.
import { normalizeDecimal, parseDecimal, plain } from "@/lib/calculator/decimal";
import { isWall, TIME_FUTURE, TIME_REQUIRED as ACTUAL_REQUIRED, type Wall } from "@/lib/doses/rules";
import { characters } from "@/lib/progress/rules";

/** The app is strictly local: every routine follows this zone. */
export const SUPPLEMENT_TIME_ZONE = "America/Toronto";

/** Mirrors supplement_routines. Amounts are below AMOUNT_LIMIT. */
export const ROUTINE_LIMITS = { name: 80, unit: 20, decimals: 6, amount: "1000000" } as const;

/** "N recorded in the last 2 weeks" (the prototype's window). */
export const HISTORY_WINDOW_DAYS = 14;

// ── Copy ────────────────────────────────────────────────────────────────────

export const SUPPLEMENTS_INTRO = "Optional. Supplements use their own units and never touch peptide mixtures or vials.";
export const GUIDANCE_NOTE = "Reading guidance doesn't create a routine.";
export const NO_GUIDANCE = "No supplement guidance has been supplied yet.";
export const NO_ROUTINES = "No routines yet. Create one to get reminders and record Taken.";
// Not in the prototype (it showed nothing while off).
export const TRACKING_OFF = "Supplement tracking is off. Your routines and their history are kept; turn it on to see them and record Taken.";
export const REMINDERS_LATER = "Reminders for routines follow your notification setting once reminders are switched on for the app.";

export const NAME_REQUIRED = "Name the supplement.";
export const AMOUNT_REQUIRED = "Enter an amount and its unit (e.g. 2000 IU).";
export const TIME_REQUIRED = "Choose a daily time.";
// Not in the prototype: limits and the server's refusals.
export const NAME_TOO_LONG = `Supplement names can be up to ${ROUTINE_LIMITS.name} characters.`;
export const UNIT_TOO_LONG = `Units can be up to ${ROUTINE_LIMITS.unit} characters.`;
export const AMOUNT_TOO_LARGE = "The amount must be less than 1,000,000.";
export const AMOUNT_TOO_PRECISE = `The amount can have up to ${ROUTINE_LIMITS.decimals} decimal places.`;
export const ROUTINE_CHANGED = "This routine was changed on another device. Reload the page to see the latest.";
export const ROUTINE_ENDED = "This routine has ended. Its history is kept; create a new routine to start again.";
export const ROUTINE_GONE = "This routine no longer exists. Reload the page.";
export const ROUTINE_INVALID = "This routine could not be saved. Reload the page and try again.";
export const TRACKING_REQUIRED = "Turn on Track supplements first.";

export const TAKEN_CHANGED = "This routine changed since you opened it. The details are current now — check them and tap Taken again.";
export const TAKEN_GONE = "This day is not part of the routine any more. Nothing was recorded.";
export const TAKEN_NOT_YET = "This isn't due yet. You can record it on its day.";
export const TAKEN_INVALID = "This could not be recorded. Reload the page and try again.";
export { TIME_FUTURE, TIME_TOO_EARLY } from "@/lib/doses/rules";

export const createdToast = (name: string) => `Routine created · ${name}.`;
export const savedToast = (name: string) => `Routine saved · ${name}. Earlier Taken records keep what was taken.`;
export const endedToast = "Routine ended. Its history is kept.";
export const takenToast = (name: string, when: string) => `Taken · ${name} · ${when}`;

// ── The routine form ────────────────────────────────────────────────────────

/** What the add and edit forms send. */
export type RoutineForm = {
  /** The routine being edited; null to create one. */
  id: string | null;
  /** The version shown (edits only). */
  version: number | null;
  name: string;
  /** As typed: "2000", "1,5". */
  amount: string;
  unit: string;
  /** "HH:MM" */
  time: string;
};

/** A routine ready to save: trimmed text and a canonical exact amount ("1.5"). */
export type ValidRoutine = { id: string | null; version: number | null; name: string; amount: string; unit: string; time: string };

export type RoutineValidation = { ok: true; value: ValidRoutine } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const uuidOf = (value: unknown): string | null => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1;

/**
 * The amount: a plain decimal over 0 and under 1,000,000 with at most 6
 * decimals. Returns the canonical text ("0.5", "2000") or the error.
 */
export function routineAmount(text: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const normalized = normalizeDecimal(text);
  const parsed = normalized === null ? null : parseDecimal(normalized);
  if (parsed === null || !parsed.greaterThan(0)) return { ok: false, error: AMOUNT_REQUIRED };
  if (parsed.greaterThanOrEqualTo(ROUTINE_LIMITS.amount)) return { ok: false, error: AMOUNT_TOO_LARGE };
  if (parsed.decimalPlaces() > ROUTINE_LIMITS.decimals) return { ok: false, error: AMOUNT_TOO_PRECISE };
  return { ok: true, value: plain(parsed) };
}

/** The first problem in the prototype's order (name, amount and unit, time), else the routine to save. */
export function validateRoutine(input: unknown): RoutineValidation {
  if (typeof input !== "object" || input === null) return { ok: false, error: ROUTINE_INVALID };
  const raw = input as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const id = raw.id === null || raw.id === undefined || raw.id === "" ? null : uuidOf(raw.id);
  if (raw.id && !id) return { ok: false, error: ROUTINE_INVALID };
  const version = id === null ? null : raw.version;
  if (id !== null && !isVersion(version)) return { ok: false, error: ROUTINE_INVALID };

  const name = text(raw.name).trim();
  if (!name) return { ok: false, error: NAME_REQUIRED };
  if (characters(name) > ROUTINE_LIMITS.name) return { ok: false, error: NAME_TOO_LONG };
  const amount = routineAmount(raw.amount);
  if (!amount.ok) return amount;
  const unit = text(raw.unit).trim();
  if (!unit) return { ok: false, error: AMOUNT_REQUIRED };
  if (characters(unit) > ROUTINE_LIMITS.unit) return { ok: false, error: UNIT_TOO_LONG };
  const time = text(raw.time);
  if (!TIME.test(time)) return { ok: false, error: TIME_REQUIRED };
  return { ok: true, value: { id, version: version as number | null, name, amount: amount.value, unit, time } };
}

// ── The Taken form ──────────────────────────────────────────────────────────

/** What Today and R10 send for "Taken". */
export type TakenForm = {
  requestKey: string;
  key: string;
  /** What the screen showed, so a changed routine is never recorded blindly. */
  seenScheduledAt: string;
  seenName: string;
  seenAmount: string;
  seenUnit: string;
  /** A wall-clock time in the routine's zone; null: now. */
  actual: Wall | null;
};

/** "<routine id>:<YYYY-MM-DD>" */
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{4}-\d{2}-\d{2}$/;
export const isSupplementKey = (value: unknown): value is string => typeof value === "string" && KEY.test(value.toLowerCase());

/** Reads the untrusted input; null when it isn't a Taken at all. */
export function readTakenForm(input: unknown): TakenForm | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : null);
  const [requestKey, key, seenScheduledAt, seenName, seenAmount, seenUnit] = ["requestKey", "key", "seenScheduledAt", "seenName", "seenAmount", "seenUnit"].map(text);
  const actual = raw.actual === null ? null : typeof raw.actual === "string" ? raw.actual : undefined;
  if (!uuidOf(requestKey) || !isSupplementKey(key) || !seenScheduledAt || !seenName || !seenAmount || seenUnit === null || actual === undefined) return null;
  return { requestKey: requestKey!.toLowerCase(), key: key.toLowerCase(), seenScheduledAt, seenName, seenAmount, seenUnit, actual };
}

/** The actual time's check (the server re-checks the clock and the planned time): a wall time, never after now. */
export function takenTimeError(actual: Wall | null, now: Wall): string | null {
  if (actual === null) return null;
  if (!isWall(actual)) return ACTUAL_REQUIRED;
  if (actual > now) return TIME_FUTURE;
  return null;
}
