"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { parseDecimal, plain } from "@/lib/calculator/decimal";
import { currentResearcher } from "@/lib/auth/session";
import { listCycles } from "@/lib/cycles/service";
import {
  ALREADY_SKIPPED,
  confirmFormError,
  DOSE_ALREADY_TAKEN,
  DOSE_CHANGED,
  DOSE_GONE,
  DOSE_NOT_YET,
  readConfirmForm,
  TIME_FUTURE,
  TIME_TOO_EARLY,
  UNDO_DEPENDS,
  UNDO_FAILED,
  UNDO_TOO_LATE,
  wallOf,
} from "@/lib/doses/rules";
import { confirmDose, ownerConfirmations, skipDose, undoDose } from "@/lib/doses/service";
import { pendingDoses } from "@/lib/doses/today";
import { isValidTimeZone, resolveLocal } from "@/lib/schedule/zone";
import { createClient } from "@/lib/supabase/server";

export type ConfirmActionResult = {
  /**
   * "recorded": the dose is recorded (or was already, for this same request).
   * "skipped": it was skipped (it can't be logged); "undone": this request's
   * entry was undone, so the screen sends a new request key.
   */
  outcome?: "recorded" | "changed" | "already" | "gone" | "skipped" | "undone";
  /** The recorded dose's id (Undo retracts it) and actual time (ISO), for the toast. */
  doseId?: string;
  actualAt?: string;
  /** The amount and site recorded. */
  amountMg?: string;
  site?: string;
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
        doseId: result.dose.id,
        actualAt: result.dose.actualAt,
        amountMg: result.dose.amountMg,
        site: result.dose.site,
        ...(result.dose.deduction?.stockDiscrepancy ? { discrepancyVial: result.dose.deduction.vialLabel } : {}),
      };
    case "changed":
      refresh();
      return { outcome: "changed", error: DOSE_CHANGED };
    case "already":
      refresh();
      return { outcome: "already" };
    case "skipped":
      refresh();
      return { outcome: "skipped", error: ALREADY_SKIPPED };
    case "undone":
      return { outcome: "undone" };
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

const SKIP_INVALID = "This dose could not be skipped. Reload the page and try again.";

export type SkipActionResult = {
  /** "skipped": recorded (or already, for this same request); the others: the page refreshed to show it as it is now. */
  outcome?: "skipped" | "changed" | "taken" | "already_skipped" | "gone" | "undone";
  skipId?: string;
  error?: string;
  toast?: string;
  tone?: ToastTone;
};

/**
 * "Skip" (R2) and "Mark skipped" (R2b, D1's overdue row): the dose is
 * resolved as skipped, not missed (see skip_dose,
 * 20260928100000_dose_skips_undo_sites.sql). The screen sends the
 * occurrence, its scheduled time and planned dose as shown, and a request key
 * that stays the same for retries.
 */
export async function skipDoseAction(input: unknown): Promise<SkipActionResult> {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: "/app/today" }));
  const form = readConfirmForm({ amount: "", site: "", notes: "", actual: null, seenMixtureVersion: null, ...(input as object) });
  if (!form) return { error: SKIP_INVALID };

  const db = await createClient();
  let result;
  try {
    result = await skipDose(db, {
      requestKey: form.requestKey,
      occurrenceKey: form.key,
      seenScheduledAt: form.seenScheduledAt,
      seenDoseMg: form.seenDoseMg,
    });
  } catch {
    return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
  switch (result.kind) {
    case "skipped":
      revalidatePath("/app/cycles", "layout");
      revalidatePath("/app/supplies");
      revalidatePath("/app/progress");
      refresh();
      return { outcome: "skipped", skipId: result.skip.id };
    case "changed":
      refresh();
      return { outcome: "changed", error: DOSE_CHANGED };
    case "already":
      refresh();
      return { outcome: "taken", error: DOSE_ALREADY_TAKEN };
    case "already_skipped":
      refresh();
      return { outcome: "already_skipped" };
    case "undone":
      return { outcome: "undone" };
    case "gone":
    case "not_found":
      refresh();
      return { outcome: "gone", toast: DOSE_GONE, tone: "error" };
    case "not_yet":
      return { error: DOSE_NOT_YET };
    case "invalid":
      return { error: SKIP_INVALID };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}

export type UndoActionResult = { outcome?: "undone"; error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The toast's Undo after a Taken or a Skip: undo_dose retracts the entry if
 * it is still recent (60 s) and nothing recorded since depends on it, keeping
 * an audit record (dose_voids). Idempotent by request key.
 */
export async function undoDoseAction(input: unknown): Promise<UndoActionResult> {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: "/app/today" }));
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const { requestKey, entryId } = value;
  if (typeof requestKey !== "string" || !UUID.test(requestKey) || typeof entryId !== "string" || !UUID.test(entryId)) return { error: UNDO_FAILED };

  const db = await createClient();
  let result;
  try {
    result = await undoDose(db, { requestKey: requestKey.toLowerCase(), entryId: entryId.toLowerCase() });
  } catch {
    return { error: UNDO_FAILED };
  }
  switch (result.kind) {
    case "undone":
      revalidatePath("/app/cycles", "layout");
      revalidatePath("/app/supplies");
      revalidatePath("/app/progress");
      refresh();
      return { outcome: "undone" };
    case "too_late":
      return { error: UNDO_TOO_LATE };
    case "depends":
      return { error: UNDO_DEPENDS };
    default:
      return { error: UNDO_FAILED };
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
  const [cycles, confirmations] = await Promise.all([listCycles(db, person.id), ownerConfirmations(db, person.id)]);
  return pendingDoses(cycles, confirmations, new Date());
}
