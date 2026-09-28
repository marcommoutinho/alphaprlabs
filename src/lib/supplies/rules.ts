// R8 personal supplies: the vial form's rules and the screen's wording. Pure.
// The database re-checks everything (save_personal_vial, reopen_personal_vial).
import { parseDecimal, plain } from "@/lib/calculator/decimal";

/** Mirrors personal_vials: a label of 1–40 characters, strength up to 100,000 mg. */
export const VIAL_LIMITS = { label: 40, strengthMg: "100000" } as const;

export const SUPPLIES_INTRO = "Optional. Your own vials, separate from any business inventory. Nothing is added here automatically.";
export const TRACKING_OFF =
  "Tracking is off. Saved mixtures still work for syringe units; no estimates are kept and nothing is deducted when you confirm a dose.";
export const NO_VIALS = "No vials yet. Tap + to add one, and link it to a saved mixture so confirmed doses reduce the estimate.";
/** R7's footnote. */
export const VIALS_FOOTNOTE = "Remaining is estimated from the doses you log. Tap a vial to correct it or mark it finished.";
export const ESTIMATE_NOTE = "An estimate from confirmed doses, not a measurement of the vial.";
export const NOT_MIXED_LINE = "Not mixed yet · link it to a saved mixture so confirmed doses reduce the estimate.";
export const MIXTURE_DELETED_LINE = "Its saved mixture was deleted · link it to another so confirmed doses reduce the estimate.";
export const NEVER_ADDS = "Calculating never deducts, and business sales never add here.";

export const LABEL_TOO_LONG = "Keep the label to 40 characters.";
export const LABEL_REQUIRED = "Give the vial a label you'll recognise.";
export const PEPTIDE_REQUIRED = "Choose the peptide in this vial.";
export const STRENGTH_REQUIRED = "Enter the vial strength in mg.";
export const STRENGTH_TOO_LARGE = "Vial strength can be up to 100,000 mg.";
export const MIXTURE_HAS_VIAL = "That mixture already has an open vial. Finish it first, or choose another mixture.";
export const STRENGTH_MISMATCH = "That mixture's vial strength changed. Reload the page and choose it again.";
export const TRACKING_REQUIRED = "Turn on Track supplies first.";
export const VIAL_GONE = "This vial no longer exists, or it was finished elsewhere. Reload the page.";
export const VIAL_INVALID = "This vial could not be saved. Reload the page and try again.";
export const PEPTIDE_UNAVAILABLE = "This peptide is no longer offered. Choose a saved mixture instead.";

// Design v3 R7 "Correct remaining" (correct_personal_vial).
export const CORRECTION_INVALID = "Enter what's left: from 0 up to the vial's strength, at most 6 decimal places.";
export const CORRECTION_CHANGED = "A dose changed this vial's estimate since you opened it. Check the new estimate and correct it again.";
export const correctedToast = (label: string, left: string) => `Vial ${label} set to ${left} left.`;
export const unchangedToast = (label: string) => `Vial ${label} already shows that amount.`;

export const addedToast = (label: string) => `Vial ${label} added.`;
export const savedToast = (label: string) => `Vial ${label} saved.`;
export const finishedToast = (label: string) => `Vial ${label} finished. Its history stays here.`;
export const reopenedToast = (label: string) => `Vial ${label} reopened.`;
export const unlinkedToast = (label: string) =>
  `Vial ${label} reopened as not mixed yet: its mixture changed, was deleted or has another open vial. Link it again.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (value: unknown): string | null => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);

/** Trims surrounding whitespace, as the database's trim_whitespace. */
export const cleanLabel = (value: string) => value.trim();

/**
 * The label for a vial added without one: "Vial N", the first N from the
 * count of vials already listed that no existing label uses.
 */
export function defaultVialLabel(existing: readonly string[]): string {
  const taken = new Set(existing.map((label) => label.toLowerCase()));
  for (let n = existing.length + 1; ; n += 1) if (!taken.has(`vial ${n}`)) return `Vial ${n}`;
}

/** What the add and edit forms send. */
export type VialForm = {
  /** The vial being edited; null to add one. */
  id: string | null;
  label: string;
  /** The saved mixture; null for "Not mixed yet". */
  mixtureId: string | null;
  peptideId: string;
  strengthMg: string;
};

/** A checked form: the label may still be blank (the action names it); the strength is canonical ("8", "0.5"). */
export type ValidVialForm = VialForm;

/** Checks the add/edit form: a label up to 40 characters, a peptide, and a strength over 0 and up to 100,000 mg. */
export function validateVialForm(input: unknown): { ok: true; value: ValidVialForm } | { ok: false; error: string } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const id = raw.id === null || raw.id === undefined || raw.id === "" ? null : uuidOf(raw.id);
  if (raw.id && !id) return { ok: false, error: VIAL_INVALID };
  const label = cleanLabel(typeof raw.label === "string" ? raw.label : "");
  if (label.length > VIAL_LIMITS.label) return { ok: false, error: LABEL_TOO_LONG };
  const mixtureId = raw.mixtureId === null || raw.mixtureId === undefined || raw.mixtureId === "" ? null : uuidOf(raw.mixtureId);
  if (raw.mixtureId && !mixtureId) return { ok: false, error: VIAL_INVALID };
  const peptideId = uuidOf(raw.peptideId);
  if (!peptideId) return { ok: false, error: PEPTIDE_REQUIRED };
  const strength = parseDecimal(raw.strengthMg);
  if (!strength || !strength.greaterThan(0)) return { ok: false, error: STRENGTH_REQUIRED };
  if (strength.greaterThan(VIAL_LIMITS.strengthMg)) return { ok: false, error: STRENGTH_TOO_LARGE };
  return { ok: true, value: { id, label, mixtureId, peptideId, strengthMg: plain(strength) } };
}

/** A request key (a UUID) from an action's input, or null. */
export const requestKeyOf = (input: unknown): string | null =>
  uuidOf((typeof input === "object" && input !== null ? (input as Record<string, unknown>).requestKey : null) ?? null);

/**
 * "Correct remaining": what the researcher says is left (mg, exact) and the
 * estimate they were shown. Null when the input isn't one; the error when
 * the amount can't be.
 */
export function readCorrection(
  input: unknown,
): { ok: true; value: { requestKey: string; vialId: string; seenRemainingMg: string; remainingMg: string } } | { ok: false; error: string } | null {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const id = uuidOf(raw.id);
  const requestKey = requestKeyOf(input);
  const seen = parseDecimal(raw.seenRemainingMg);
  if (!id || !requestKey || !seen) return null;
  const remaining = parseDecimal(raw.remainingMg);
  if (!remaining || remaining.isNegative() || remaining.decimalPlaces() > 6 || remaining.greaterThan(VIAL_LIMITS.strengthMg)) return { ok: false, error: CORRECTION_INVALID };
  return { ok: true, value: { requestKey, vialId: id, seenRemainingMg: plain(seen), remainingMg: plain(remaining) } };
}

/** A vial id from an action's input, or null. */
export const vialIdOf = (input: unknown): string | null =>
  uuidOf((typeof input === "object" && input !== null ? (input as Record<string, unknown>).id : null) ?? null);
