"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { parseDecimal, plain } from "@/lib/calculator/decimal";
import { currentResearcher } from "@/lib/auth/session";
import { listCycles } from "@/lib/cycles/service";
import {
  confirmFormError,
  DOSE_CHANGED,
  DOSE_GONE,
  DOSE_NOT_YET,
  readConfirmForm,
  TIME_FUTURE,
  TIME_TOO_EARLY,
  wallOf,
} from "@/lib/doses/rules";
import { confirmationsByCycle, confirmDose, listDoseRecords } from "@/lib/doses/service";
import { pendingDoses } from "@/lib/doses/today";
import { isValidTimeZone, resolveLocal } from "@/lib/schedule/zone";
import { createClient } from "@/lib/supabase/server";

export type ConfirmActionResult = {
  /** "recorded": the dose is recorded (or was already, for this same request). */
  outcome?: "recorded" | "changed" | "already" | "gone";
  /** The recorded actual time (ISO), for the "Taken · …" toast. */
  actualAt?: string;
  /** The tracked vial whose estimate went below zero with this dose. */
  discrepancyVial?: string;
  error?: string;
  toast?: string;
  tone?: ToastTone;
};

const INVALID = "This dose could not be confirmed. Reload the page and try again.";

/**
 * R1 "Taken" and R5 "Mark Taken" for the signed-in, acknowledged researcher
 * (or admin on the research side), for their own doses only. The sheet sends
 * the occurrence key, the scheduled time, planned dose and saved-mixture
 * version (for the actual time chosen) it showed, the
 * amount, the actual wall-clock time in the dose's zone (null: now), site and
 * notes, and a request key that stays the same for retries.
 * confirm_dose() re-derives the occurrence from the stored plan and recorded
 * doses, records at most one dose per request and per occurrence, and
 * refuses a changed occurrence, a future time and a time over a day early.
 */
export async function confirmDoseAction(input: unknown): Promise<ConfirmActionResult> {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: "/app/today" }));

  const form = readConfirmForm(input);
  const timeZone = (input as { timeZone?: unknown } | null)?.timeZone;
  if (!form || !isValidTimeZone(timeZone)) return { error: INVALID };
  const error = confirmFormError(form, wallOf(new Date(), timeZone));
  if (error) return { error };
  const actualAt = form.actual ? resolveLocal(form.actual.slice(0, 10), form.actual.slice(11, 16), timeZone).instant.toString() : null;

  const db = await createClient();
  let result;
  try {
    result = await confirmDose(db, {
      requestKey: form.requestKey,
      occurrenceKey: form.key,
      seenScheduledAt: form.seenScheduledAt,
      seenDoseMg: form.seenDoseMg,
      seenMixtureVersionId: form.seenMixtureVersion,
      amountMg: plain(parseDecimal(form.amount)!),
      actualAt,
      site: form.site,
      notes: form.notes.trim(),
    });
  } catch {
    return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }

  switch (result.kind) {
    case "recorded":
      revalidatePath("/app/cycles", "layout");
      // R8: a deduction changes a vial's estimate, and every dose moves the next planned one.
      revalidatePath("/app/supplies");
      refresh();
      return {
        outcome: "recorded",
        actualAt: result.dose.actualAt,
        ...(result.dose.deduction?.stockDiscrepancy ? { discrepancyVial: result.dose.deduction.vialLabel } : {}),
      };
    case "changed":
      refresh();
      return { outcome: "changed", error: DOSE_CHANGED };
    case "already":
      refresh();
      return { outcome: "already" };
    case "gone":
    case "not_found":
      refresh();
      return { outcome: "gone", toast: DOSE_GONE, tone: "error" };
    case "not_yet":
      return { error: DOSE_NOT_YET };
    case "future":
      return { error: TIME_FUTURE };
    case "too_early":
      return { error: TIME_TOO_EARLY };
    case "invalid":
      return { error: INVALID };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}

/**
 * The app icon badge: doses awaiting confirmation for the signed-in
 * researcher (see pendingDoses), or null when signed out. Read on app open
 * and on return to the foreground.
 */
export async function pendingDoseCount(): Promise<number | null> {
  const person = await currentResearcher();
  if (!person) return null;
  const db = await createClient();
  const [cycles, records] = await Promise.all([listCycles(db, person.id), listDoseRecords(db, person.id)]);
  return pendingDoses(cycles, confirmationsByCycle(records), new Date());
}
