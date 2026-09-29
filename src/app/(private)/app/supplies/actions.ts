"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/lib/app/save";
import { signInUrl } from "@/lib/auth/paths";
import { currentResearcher } from "@/lib/auth/session";
import { massLabel } from "@/lib/alpha/format";
import { finishPersonalVial, savePersonalVial, setSupplyTracking } from "@/lib/mixtures/service";
import { saveRequestHash } from "@/lib/request-hash";
import {
  addedToast,
  CORRECTION_CHANGED,
  CORRECTION_INVALID,
  correctedToast,
  finishedToast,
  LABEL_REQUIRED,
  MIXTURE_HAS_VIAL,
  PEPTIDE_UNAVAILABLE,
  readCorrection,
  reopenedToast,
  requestKeyOf,
  savedToast,
  STRENGTH_MISMATCH,
  TRACKING_REQUIRED,
  unchangedToast,
  unlinkedToast,
  validateVialForm,
  VIAL_GONE,
  VIAL_INVALID,
  vialIdOf,
} from "@/lib/supplies/rules";
import { addPersonalVial, correctPersonalVial, reopenPersonalVial } from "@/lib/supplies/service";
import { createClient } from "@/lib/supabase/server";

const SUPPLIES = "/app/supplies";

export type SuppliesActionResult = {
  /** Shown under the form. */
  error?: string;
  toast?: string;
  tone?: ToastTone;
  /** The write went through: the form closes or resets. */
  saved?: boolean;
};

async function signedIn() {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: SUPPLIES }));
  return person;
}

/** Everything that shows a tracked vial: this screen, Today's low-stock notes, the calculator's "vial … tracked". */
function revalidateSupplies() {
  revalidatePath(SUPPLIES);
  revalidatePath("/app/today");
  revalidatePath("/app/calculator");
  // R8 Me: the Vials and supplies row's switch.
  revalidatePath("/app/me");
}

/**
 * R8 "Track supplies" on or off, for the signed-in, acknowledged researcher
 * (or admin on the research side) only; set_supply_tracking() re-checks.
 * Turning it off keeps every vial; nothing is deducted while it is off.
 */
export async function setTrackingAction(input: unknown): Promise<SuppliesActionResult> {
  await signedIn();
  const enabled = (typeof input === "object" && input !== null ? (input as Record<string, unknown>).enabled : undefined) as unknown;
  if (typeof enabled !== "boolean") return { toast: VIAL_INVALID, tone: "error" };
  const db = await createClient();
  try {
    await setSupplyTracking(db, enabled);
  } catch {
    return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
  revalidateSupplies();
  return { saved: true };
}

/**
 * R7's round + "Add vial" (no id) or a vial's edit (its label and saved
 * mixture). A vial on a saved mixture takes the mixture's peptide and vial
 * strength; a blank label becomes "Vial N". Adding is idempotent: the
 * request key the sheet made returns the same vial on a retry
 * (add_personal_vial). save_personal_vial() re-checks ownership, tracking,
 * the mixture (the caller's, same peptide and strength) and that the
 * mixture has no other open vial.
 */
export async function saveVialAction(input: unknown): Promise<SuppliesActionResult> {
  await signedIn();
  const valid = validateVialForm(input);
  if (!valid.ok) return { error: valid.error };
  const form = valid.value;
  const requestKey = requestKeyOf(input);
  if (!form.id && !requestKey) return { error: VIAL_INVALID };

  if (!form.label && form.id) return { error: LABEL_REQUIRED };

  const db = await createClient();
  const vial = { label: form.label, peptideId: form.peptideId, strengthMg: form.strengthMg, mixtureId: form.mixtureId };
  // A blank label is named by add_personal_vial; the toast names what was stored (a retry's too).
  const result = form.id
    ? await savePersonalVial(db, { id: form.id, ...vial }).then((saved) => (saved.kind === "saved" ? { ...saved, label: form.label } : saved))
    : await addPersonalVial(db, { requestKey: requestKey!, requestHash: saveRequestHash(vial), ...vial });
  switch (result.kind) {
    case "saved":
    case "added":
      revalidateSupplies();
      return { saved: true, toast: form.id ? savedToast(result.label) : addedToast(result.label), tone: "info" };
    case "mixture_has_vial":
      return { error: MIXTURE_HAS_VIAL };
    case "strength":
      return { error: STRENGTH_MISMATCH };
    case "tracking_off":
      return { error: TRACKING_REQUIRED };
    case "unavailable":
      return { error: PEPTIDE_UNAVAILABLE };
    case "not_found":
      return { toast: VIAL_GONE, tone: "error" };
    case "invalid":
      return { error: form.id ? VIAL_GONE : VIAL_INVALID };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}

/**
 * R7 "Correct remaining": the vial's estimate set to what the researcher
 * found, from the estimate they were shown (a dose recorded meanwhile makes
 * them look again: AP035). Recorded as a correction in the vial's history;
 * the same request key returns it again.
 */
export async function correctVialAction(input: unknown): Promise<SuppliesActionResult> {
  await signedIn();
  const read = readCorrection(input);
  if (!read) return { toast: VIAL_INVALID, tone: "error" };
  if (!read.ok) return { error: read.error };
  const label = labelOf(input);
  const db = await createClient();
  const result = await correctPersonalVial(db, read.value);
  switch (result.kind) {
    case "corrected":
      revalidateSupplies();
      return { saved: true, toast: correctedToast(label, massLabel(result.remainingMg)), tone: "info" };
    case "unchanged":
      return { saved: true, toast: unchangedToast(label), tone: "info" };
    case "changed":
      revalidateSupplies();
      return { error: CORRECTION_CHANGED };
    case "invalid":
      return { error: CORRECTION_INVALID };
    case "tracking_off":
      return { error: TRACKING_REQUIRED };
    case "not_found":
      return { toast: VIAL_GONE, tone: "error" };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}

/** R8 "Finish": the vial stays with its history; its mixture may get a new vial. */
export async function finishVialAction(input: unknown): Promise<SuppliesActionResult> {
  await signedIn();
  const id = vialIdOf(input);
  const label = labelOf(input);
  if (!id) return { toast: VIAL_INVALID, tone: "error" };
  const db = await createClient();
  let finished: boolean;
  try {
    finished = await finishPersonalVial(db, id);
  } catch {
    return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
  if (!finished) return { toast: VIAL_GONE, tone: "error" };
  revalidateSupplies();
  return { saved: true, toast: finishedToast(label), tone: "info" };
}

/** R8 "Reopen" a vial finished by mistake (see reopen_personal_vial for when it keeps its mixture). */
export async function reopenVialAction(input: unknown): Promise<SuppliesActionResult> {
  await signedIn();
  const id = vialIdOf(input);
  const label = labelOf(input);
  if (!id) return { toast: VIAL_INVALID, tone: "error" };
  const db = await createClient();
  const result = await reopenPersonalVial(db, id);
  switch (result.kind) {
    case "reopened":
    case "unlinked":
      revalidateSupplies();
      return { saved: true, toast: result.kind === "reopened" ? reopenedToast(label) : unlinkedToast(label), tone: result.kind === "reopened" ? "info" : "warn" };
    case "tracking_off":
      return { toast: TRACKING_REQUIRED, tone: "error" };
    case "not_found":
      return { toast: VIAL_GONE, tone: "error" };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}

/** The label the screen showed, for the toast only (never trusted for anything else). */
function labelOf(input: unknown): string {
  const label = typeof input === "object" && input !== null ? (input as Record<string, unknown>).label : undefined;
  return typeof label === "string" ? label.trim().slice(0, 40) : "";
}
