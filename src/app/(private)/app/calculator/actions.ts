"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentResearcher } from "@/lib/auth/session";
import { listCyclePeptides } from "@/lib/cycles/service";
import {
  INVALID_MIXTURE,
  MIXTURE_CHANGED,
  MIXTURE_DELETED,
  MIXTURE_GONE,
  MIXTURE_LINKED,
  PEPTIDE_UNAVAILABLE,
  PLANS_CHANGED,
  savedToast,
  validateMixture,
  VIAL_STRENGTH_TRACKED,
} from "@/lib/mixtures/rules";
import { deleteMixture, saveMixture } from "@/lib/mixtures/service";
import { createClient } from "@/lib/supabase/server";

const CALCULATOR = "/app/calculator";

export type MixtureActionResult = {
  /** Shown under the Save button, in order. */
  errors?: string[];
  toast?: string;
  tone?: ToastTone;
  /** The saved mixture: the form now shows it as loaded. */
  mixtureId?: string;
};

/**
 * R7 "Save mixture" / "Update saved mixture": stores the setup (a changed
 * setup becomes the mixture's next version; earlier doses keep theirs) and
 * which of the researcher's cycle peptide plans use it. Only for the
 * signed-in, acknowledged researcher's (or admin's) own records;
 * save_mixture() re-checks ownership, the plans and every value.
 */
export async function saveMixtureAction(input: unknown): Promise<MixtureActionResult> {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: CALCULATOR }));

  const valid = validateMixture(input);
  if (!valid.ok) return { errors: valid.errors };
  const mixture = valid.value;

  const db = await createClient();
  const result = await saveMixture(db, mixture);
  switch (result.kind) {
    case "saved": {
      revalidatePath(CALCULATOR);
      revalidatePath("/app/cycles", "layout");
      revalidatePath("/app/supplies");
      const name = await listCyclePeptides(db)
        .then((peptides) => peptides.find((peptide) => peptide.id === mixture.peptideId)?.name ?? "")
        .catch(() => "");
      return { mixtureId: result.id, toast: savedToast(mixture.mixtureId !== null, name, mixture.setup), tone: "info" };
    }
    case "stale":
      return { errors: [MIXTURE_CHANGED] };
    case "plans":
      return { errors: [PLANS_CHANGED] };
    case "unavailable":
      return { errors: [PEPTIDE_UNAVAILABLE] };
    case "vial_strength":
      return { errors: [VIAL_STRENGTH_TRACKED] };
    case "not_found":
      return { toast: MIXTURE_GONE, tone: "error" };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}

/** R7 "Delete": refused while a cycle plan uses the mixture. */
export async function deleteMixtureAction(input: unknown): Promise<MixtureActionResult> {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: CALCULATOR }));

  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const id = typeof raw.id === "string" && /^[0-9a-f-]{36}$/i.test(raw.id) ? raw.id.toLowerCase() : null;
  const version = Number.isInteger(raw.version) ? (raw.version as number) : null;
  if (!id || version === null) return { toast: INVALID_MIXTURE, tone: "error" };

  const db = await createClient();
  const result = await deleteMixture(db, id, version);
  switch (result.kind) {
    case "deleted":
      revalidatePath(CALCULATOR);
      revalidatePath("/app/supplies");
      return { toast: MIXTURE_DELETED, tone: "info" };
    case "linked":
      return { toast: MIXTURE_LINKED, tone: "warn" };
    case "stale":
      return { toast: MIXTURE_CHANGED, tone: "error" };
    case "not_found":
      return { toast: MIXTURE_GONE, tone: "error" };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}
