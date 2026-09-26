// Saved mixtures (R7): a saved calculation setup for one peptide, and how it
// feeds S7's calculator (src/lib/calculator). Pure: no database, no clock
// unless passed in. Stored in 20260926190000_mixtures.sql.
//
// Plan "Routine implementation rules": a setup records one peptide, the vial
// strength, the liquid added, the syringe capacity and its line spacing (or
// that the spacing is unknown). Incomplete setups stay explicit: no mixture
// means no syringe units, never a guessed value. Nothing is ever rounded.
import {
  type CalculatorInput,
  type CalculatorResult,
  calculate,
  DEFAULT_LINE_SPACING,
  isLineSpacing,
  isSyringeCapacity,
  LIQUID_POSITIVE,
  LIQUID_REQUIRED,
  type LineSpacing,
  SYRINGE_LABEL,
  SYRINGE_REQUIRED,
  type SyringeCapacity,
  VIAL_POSITIVE,
  VIAL_REQUIRED,
  LINE_SPACING_REQUIRED,
} from "@/lib/calculator/calculator";
import { formatRatio, parseDecimal, plain } from "@/lib/calculator/decimal";

/** A saved setup, amounts as canonical decimal strings ("8", "0.5"). */
export type MixtureSetup = {
  vialMg: string;
  liquidMl: string;
  syringe: SyringeCapacity;
  lineSpacing: LineSpacing;
};

/** A saved mixture with its setup in effect now. */
export type Mixture = {
  id: string;
  ownerId: string;
  peptideId: string;
  /** Concurrency token: advances on every successful save or delete. */
  version: number;
  /** The setup's number (1, 2, ...) and row id: S12 snapshots the id on a recorded dose. */
  setupNumber: number;
  setupId: string;
  setup: MixtureSetup;
  /** When the current setup took effect (ISO). */
  setupSince: string;
  createdAt: string;
  /** Cycle peptide plans using it now. */
  planIds: string[];
};

/** One setup in a mixture's history, oldest first. */
export type MixtureVersion = { id: string; number: number; setup: MixtureSetup; createdAt: string };

/** Mirrors the database's entry limits (typo guards). */
export const MIXTURE_LIMITS = { vialMg: "100000", liquidMl: "1000" } as const;

// ── Calculator mapping ──────────────────────────────────────────────────────

/** A saved setup and a dose as the calculator's input. */
export function calculatorInput(setup: MixtureSetup, doseMg: string): CalculatorInput {
  return { vialMg: setup.vialMg, liquidMl: setup.liquidMl, doseMg, syringe: setup.syringe, lineSpacing: setup.lineSpacing };
}

export type CalculatedDraw = Extract<CalculatorResult, { ok: true }>;

/**
 * Syringe units for a planned dose from a plan's saved mixture (S12 Today,
 * S13 reminders, S10 cycle detail). Every state is explicit:
 *   - "no-mixture": the plan has no saved mixture, so no units are shown;
 *   - "not-calculable": the dose can't be converted with this mixture (for
 *     example it is larger than the whole vial), with the calculator's errors;
 *   - "calculated": the exact result, with its flags (over capacity, between
 *     lines, or line spacing unknown). Units are never rounded.
 */
export type PlanDraw =
  | { state: "no-mixture" }
  | { state: "not-calculable"; mixture: Mixture; errors: string[] }
  | { state: "calculated"; mixture: Mixture; result: CalculatedDraw };

export function drawFor(mixture: Mixture | null, doseMg: string): PlanDraw {
  if (!mixture) return { state: "no-mixture" };
  const result = calculate(calculatorInput(mixture.setup, doseMg));
  if (!result.ok) return { state: "not-calculable", mixture, errors: result.errors };
  return { state: "calculated", mixture, result };
}

// ── The line-spacing control ────────────────────────────────────────────────

/**
 * The R7 line-spacing select: "" is "Lines as printed on this size" (the
 * preselected default for the syringe, handoff reconciliation 3), or an
 * explicit spacing, or "unknown".
 */
export type LineChoice = "" | LineSpacing;

export const LINE_CHOICES: readonly { value: LineChoice; label: string }[] = [
  { value: "", label: "Lines as printed on this size" },
  { value: "0.5", label: "Every 0.5 unit" },
  { value: "1", label: "Every 1 unit" },
  { value: "2", label: "Every 2 units" },
  { value: "unknown", label: "Unknown / not checked" },
];

/** The spacing a choice means for a syringe. */
export const spacingOf = (syringe: SyringeCapacity, choice: LineChoice): LineSpacing =>
  choice === "" ? DEFAULT_LINE_SPACING[syringe] : choice;

/** A stored spacing as the select shows it: the default reads as "Lines as printed". */
export const choiceOf = (setup: Pick<MixtureSetup, "syringe" | "lineSpacing">): LineChoice =>
  setup.lineSpacing === DEFAULT_LINE_SPACING[setup.syringe] ? "" : setup.lineSpacing;

// ── The calculator form ─────────────────────────────────────────────────────

/** R7's fields as typed. `mixtureId` "" is "New mixture". */
export type CalculatorForm = {
  mixtureId: string;
  peptideId: string;
  vialMg: string;
  liquidMl: string;
  doseMg: string;
  syringe: SyringeCapacity;
  lineChoice: LineChoice;
};

export const blankForm = (peptideId = ""): CalculatorForm => ({
  mixtureId: "",
  peptideId,
  vialMg: "",
  liquidMl: "",
  doseMg: "",
  syringe: 100,
  lineChoice: "",
});

/** "Load" a saved mixture into the form, keeping the dose typed. */
export const formFromMixture = (mixture: Mixture, doseMg: string): CalculatorForm => ({
  mixtureId: mixture.id,
  peptideId: mixture.peptideId,
  vialMg: mixture.setup.vialMg,
  liquidMl: mixture.setup.liquidMl,
  doseMg,
  syringe: mixture.setup.syringe,
  lineChoice: choiceOf(mixture.setup),
});

/** The form as the calculator's input. */
export const formInput = (form: CalculatorForm): CalculatorInput => ({
  vialMg: form.vialMg,
  liquidMl: form.liquidMl,
  doseMg: form.doseMg,
  syringe: form.syringe,
  lineSpacing: spacingOf(form.syringe, form.lineChoice),
});

// ── Saving ──────────────────────────────────────────────────────────────────

/** A mixture ready for save_mixture: canonical decimals, a resolved spacing. */
export type ValidMixture = {
  mixtureId: string | null;
  version: number | null;
  peptideId: string;
  setup: MixtureSetup;
  planIds: string[];
};

export const PEPTIDE_REQUIRED = "Choose the peptide in this vial.";
export const VIAL_TOO_LARGE = "Vial strength can be up to 100,000 mg.";
export const LIQUID_TOO_LARGE = "Liquid added can be up to 1,000 mL.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

function amount(value: unknown, required: string, positive: string, tooLarge: string, limit: string) {
  const parsed = parseDecimal(value);
  if (!parsed) return { error: required };
  if (!parsed.greaterThan(0)) return { error: positive };
  if (parsed.greaterThan(limit)) return { error: tooLarge };
  return { value: plain(parsed) };
}

/**
 * Validates a save request from the client (untrusted). Only the setup is
 * checked: a mixture is saved without a dose. Errors in the calculator's
 * order; amounts come back canonical ("1,50" → "1.5").
 */
export function validateMixture(input: unknown): { ok: true; value: ValidMixture } | { ok: false; errors: string[] } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (!isUuid(raw.peptideId)) errors.push(PEPTIDE_REQUIRED);
  const vial = amount(raw.vialMg, VIAL_REQUIRED, VIAL_POSITIVE, VIAL_TOO_LARGE, MIXTURE_LIMITS.vialMg);
  if (vial.error) errors.push(vial.error);
  const liquid = amount(raw.liquidMl, LIQUID_REQUIRED, LIQUID_POSITIVE, LIQUID_TOO_LARGE, MIXTURE_LIMITS.liquidMl);
  if (liquid.error) errors.push(liquid.error);
  if (!isSyringeCapacity(raw.syringe)) errors.push(SYRINGE_REQUIRED);
  if (!isLineSpacing(raw.lineSpacing)) errors.push(LINE_SPACING_REQUIRED);

  const mixtureId = raw.mixtureId === null || raw.mixtureId === "" || raw.mixtureId === undefined ? null : raw.mixtureId;
  const version = raw.version === null || raw.version === undefined ? null : raw.version;
  const planIds = Array.isArray(raw.planIds) ? raw.planIds : null;
  const shapeOk =
    (mixtureId === null || isUuid(mixtureId)) &&
    (mixtureId === null) === (version === null) &&
    (version === null || (Number.isInteger(version) && (version as number) >= 1)) &&
    planIds !== null &&
    planIds.length <= 100 &&
    planIds.every(isUuid);
  if (!shapeOk) errors.push(INVALID_MIXTURE);
  if (errors.length > 0 || !vial.value || !liquid.value) return { ok: false, errors };

  return {
    ok: true,
    value: {
      mixtureId: mixtureId === null ? null : (mixtureId as string).toLowerCase(),
      version: version as number | null,
      peptideId: (raw.peptideId as string).toLowerCase(),
      setup: {
        vialMg: vial.value,
        liquidMl: liquid.value,
        syringe: raw.syringe as SyringeCapacity,
        lineSpacing: raw.lineSpacing as LineSpacing,
      },
      planIds: [...new Set((planIds as string[]).map((id) => id.toLowerCase()))],
    },
  };
}

// ── Copy ────────────────────────────────────────────────────────────────────

export const CALCULATOR_NOTE =
  "The calculator converts the dose you enter; it never chooses one. Calculating doesn't record Taken or change supplies.";
export const SAVE_NOTE = "Stores the vial, liquid and syringe for reuse in reminders. Stock tracking stays optional.";
export const saveLabel = (updating: boolean) => (updating ? "Update saved mixture" : "Save mixture");
export const NO_MIXTURES = "None yet. Save one above to reuse it in reminders.";
export const MIXTURE_DELETED = "Mixture deleted.";
export const MIXTURE_LINKED = "This mixture is linked to a cycle plan. Load it and untick the plan first.";
export const MIXTURE_CHANGED = "This mixture was changed elsewhere. Reload the page to see the latest.";
export const MIXTURE_GONE = "This mixture no longer exists.";
export const PEPTIDE_UNAVAILABLE = "This peptide is no longer offered. Choose another.";
export const PLANS_CHANGED = "Your cycles changed. Reload the page and choose the plans again.";
export const INVALID_MIXTURE = "This mixture could not be saved. Reload the page and try again.";
export const LINK_HEADING = "Use for syringe units in";
export const NO_PLANS = "No cycle uses this peptide yet. You can link the mixture later.";
export const NO_MIXTURE_LINE = "No saved mixture — units can't be shown for this peptide.";

export const VIAL_STRENGTH_TRACKED =
  "A tracked vial uses this mixture at its current strength. Finish that vial in Personal supplies, or save a new mixture.";

export const savedToast = (updated: boolean, peptideName: string, setup: MixtureSetup) =>
  `${updated ? "Updated" : "Saved"} mixture · ${peptideName ? `${peptideName} ` : ""}${setup.vialMg} mg / ${setup.liquidMl} mL`;

/** "Compound A · 8 mg / 2 mL · 1 mL" (the saved-mixture select and list). */
export const mixtureLabel = (peptideName: string, setup: MixtureSetup) =>
  `${peptideName} · ${setup.vialMg} mg / ${setup.liquidMl} mL · ${SYRINGE_LABEL[setup.syringe]}`;

/** Concentration for display, exact or "≈" (mg/mL). */
export const concentrationOf = (setup: Pick<MixtureSetup, "vialMg" | "liquidMl">) => formatRatio(setup.vialMg, setup.liquidMl);

/** The list row's second line: "4 mg/mL · lines every 2 u · used by Spring · vial A-01 tracked". */
export function mixtureDetail(setup: MixtureSetup, usedBy: readonly string[], trackedVial?: string): string {
  const lines = setup.lineSpacing === "unknown" ? "line spacing unknown" : `lines every ${setup.lineSpacing} u`;
  const used = usedBy.length ? ` · used by ${[...new Set(usedBy)].join(", ")}` : " · not linked to a plan";
  return `${concentrationOf(setup)} mg/mL · ${lines}${used}${trackedVial ? ` · vial ${trackedVial} tracked` : ""}`;
}

/** R4's line for a plan's mixture: "Mixture 8 mg / 2 mL (4 mg/mL) · 1 mL syringe", or NO_MIXTURE_LINE. */
export function planMixtureLine(mixture: Mixture | null): string {
  if (!mixture) return NO_MIXTURE_LINE;
  const { setup } = mixture;
  return `Mixture ${setup.vialMg} mg / ${setup.liquidMl} mL (${concentrationOf(setup)} mg/mL) · ${SYRINGE_LABEL[setup.syringe]} syringe`;
}

/** "10 units", or the reason units can't be shown (Today, reminders). */
export function drawLabel(draw: PlanDraw): string {
  if (draw.state === "no-mixture") return "no saved mixture";
  if (draw.state === "not-calculable") return "units can't be calculated";
  return `${draw.result.display.units} units`;
}
