"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentResearcher } from "@/lib/auth/session";
import { finishPersonalVial, listPersonalVials, savePersonalVial, setSupplyTracking } from "@/lib/mixtures/service";
import {
  addedToast,
  defaultVialLabel,
  finishedToast,
  LABEL_REQUIRED,
  MIXTURE_HAS_VIAL,
  PEPTIDE_UNAVAILABLE,
  reopenedToast,
  savedToast,
  STRENGTH_MISMATCH,
  TRACKING_REQUIRED,
  unlinkedToast,
  validateVialForm,
  VIAL_GONE,
  VIAL_INVALID,
  vialIdOf,
} from "@/lib/supplies/rules";
import { reopenPersonalVial } from "@/lib/supplies/service";
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
 * R8 "Add vial" (no id) or a vial's edit (its label and saved mixture). A
 * vial on a saved mixture takes the mixture's peptide and vial strength; a
 * blank label becomes "Vial N". save_personal_vial() re-checks ownership,
 * tracking, the mixture (the caller's, same peptide and strength) and that
 * the mixture has no other open vial.
 */
export async function saveVialAction(input: unknown): Promise<SuppliesActionResult> {
  const person = await signedIn();
  const valid = validateVialForm(input);
  if (!valid.ok) return { error: valid.error };
  const form = valid.value;

  const db = await createClient();
  let label = form.label;
  if (!label) {
    if (form.id) return { error: LABEL_REQUIRED };
    try {
      label = defaultVialLabel((await listPersonalVials(db, person.id)).map((vial) => vial.label));
    } catch {
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
    }
  }

  const result = await savePersonalVial(db, {
    ...(form.id ? { id: form.id } : {}),
    label,
    peptideId: form.peptideId,
    strengthMg: form.strengthMg,
    mixtureId: form.mixtureId,
  });
  switch (result.kind) {
    case "saved":
      revalidateSupplies();
      return { saved: true, toast: form.id ? savedToast(label) : addedToast(label), tone: "info" };
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
