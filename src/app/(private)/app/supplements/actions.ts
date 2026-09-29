"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/lib/app/save";
import { signInUrl } from "@/lib/auth/paths";
import { currentResearcher } from "@/lib/auth/session";
import { wallOf } from "@/lib/doses/rules";
import { resolveLocal } from "@/lib/schedule/zone";
import {
  createdToast,
  endedToast,
  readTakenForm,
  ROUTINE_CHANGED,
  ROUTINE_ENDED,
  ROUTINE_GONE,
  ROUTINE_INVALID,
  savedToast,
  SUPPLEMENT_TIME_ZONE,
  TAKEN_CHANGED,
  TAKEN_GONE,
  TAKEN_INVALID,
  TAKEN_NOT_YET,
  takenTimeError,
  TIME_FUTURE,
  TIME_TOO_EARLY,
  TRACKING_REQUIRED,
  uuidOf,
  validateRoutine,
} from "@/lib/supplements/rules";
import { endRoutine, saveRoutine, setSupplementTracking, takeSupplement } from "@/lib/supplements/service";
import { todayIn } from "@/lib/supplements/schedule";
import { saveRequestHash } from "@/lib/request-hash";
import { createClient } from "@/lib/supabase/server";

const SUPPLEMENTS = "/app/supplements";

export type SupplementActionResult = {
  /** Shown under the form. */
  error?: string;
  toast?: string;
  tone?: ToastTone;
  /** The write went through: the form closes or resets. */
  saved?: boolean;
};

export type TakenActionResult = {
  /** "taken": recorded (or already, for this same request). */
  outcome?: "taken" | "changed" | "already" | "gone";
  /** The recorded actual time (ISO), for the "Taken · …" toast. */
  actualAt?: string;
  error?: string;
  toast?: string;
  tone?: ToastTone;
};

/** The caller, re-checked on every action (a support share never writes; the database re-checks too). */
async function signedIn(next: string) {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next }));
  return person;
}

/** Everything that shows a routine or a Taken: R10 and Today. */
function revalidateSupplements() {
  revalidatePath(SUPPLEMENTS);
  revalidatePath("/app/today");
  // R8 Me: the Supplements row's switch and routine count.
  revalidatePath("/app/me");
}

/** R10 "Track supplements" on or off; turning it off keeps every routine and record. */
export async function setSupplementTrackingAction(input: unknown): Promise<SupplementActionResult> {
  await signedIn(SUPPLEMENTS);
  const enabled = typeof input === "object" && input !== null ? (input as Record<string, unknown>).enabled : undefined;
  if (typeof enabled !== "boolean") return { toast: ROUTINE_INVALID, tone: "error" };
  const db = await createClient();
  try {
    await setSupplementTracking(db, enabled);
  } catch {
    return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
  revalidateSupplements();
  return { saved: true };
}

/** The request key the screen made for this submission (sent again on a retry), or null. */
const requestKeyOf = (input: unknown): string | null =>
  uuidOf(typeof input === "object" && input !== null ? (input as Record<string, unknown>).requestKey : null);

/**
 * R13 "Add routine" (no id; from its start, today by default, with an
 * optional planned end) or a routine's edit (from the version shown). An
 * edit changes the routine from now on; Taken records keep what was taken.
 * Idempotent: the same request key and details return the first save.
 */
export async function saveRoutineAction(input: unknown): Promise<SupplementActionResult> {
  await signedIn(SUPPLEMENTS);
  const requestKey = requestKeyOf(input);
  if (!requestKey) return { error: ROUTINE_INVALID };
  const valid = validateRoutine(input, todayIn(new Date(), SUPPLEMENT_TIME_ZONE));
  if (!valid.ok) return { error: valid.error };
  const db = await createClient();
  const result = await saveRoutine(db, valid.value, { key: requestKey, hash: saveRequestHash(valid.value) });
  switch (result.kind) {
    case "saved":
      revalidateSupplements();
      return { saved: true, toast: valid.value.id ? savedToast(valid.value.name) : createdToast(valid.value.name), tone: "info" };
    case "changed":
      return { error: ROUTINE_CHANGED };
    case "ended":
      return { error: ROUTINE_ENDED };
    case "tracking_off":
      return { error: TRACKING_REQUIRED };
    case "not_found":
      return { error: ROUTINE_GONE };
    case "invalid":
      return { error: ROUTINE_INVALID };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}

/** R13 "End routine": it runs through today and stops (one not started yet never runs); its history is kept. */
export async function endRoutineAction(input: unknown): Promise<SupplementActionResult> {
  await signedIn(SUPPLEMENTS);
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const id = uuidOf(raw.id);
  const version = raw.version;
  const requestKey = requestKeyOf(input);
  if (!id || !requestKey || typeof version !== "number" || !Number.isInteger(version) || version < 1) return { error: ROUTINE_INVALID };
  const db = await createClient();
  const result = await endRoutine(db, id, version, { key: requestKey, hash: saveRequestHash({ id, version }) });
  switch (result.kind) {
    case "done":
      revalidateSupplements();
      return { saved: true, toast: endedToast, tone: "info" };
    case "changed":
      return { error: ROUTINE_CHANGED };
    case "ended":
      return { error: ROUTINE_ENDED };
    case "tracking_off":
      return { error: TRACKING_REQUIRED };
    case "not_found":
      return { error: ROUTINE_GONE };
    case "invalid":
      return { error: ROUTINE_INVALID };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}

/**
 * Today's and R10's "Taken" for a supplement: the occurrence key, the
 * scheduled time, name, amount and unit shown, the actual wall-clock time in the
 * routine's zone (null: now) and a request key that stays the same for
 * retries. take_supplement() re-derives the occurrence from the stored
 * routine, records at most one per request and per occurrence, and refuses a
 * changed routine, a later day, a future time and a time over a day early.
 */
export async function takeSupplementAction(input: unknown): Promise<TakenActionResult> {
  await signedIn("/app/today");
  const form = readTakenForm(input);
  if (!form) return { error: TAKEN_INVALID };
  const timeError = takenTimeError(form.actual, wallOf(new Date(), SUPPLEMENT_TIME_ZONE));
  if (timeError) return { error: timeError };
  const actualAt = form.actual ? resolveLocal(form.actual.slice(0, 10), form.actual.slice(11, 16), SUPPLEMENT_TIME_ZONE).instant.toString() : null;

  const db = await createClient();
  let result;
  try {
    result = await takeSupplement(db, {
      requestKey: form.requestKey,
      occurrenceKey: form.key,
      seenScheduledAt: form.seenScheduledAt,
      seenName: form.seenName,
      seenAmount: form.seenAmount,
      seenUnit: form.seenUnit,
      actualAt,
    });
  } catch {
    return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }

  switch (result.kind) {
    case "taken":
      revalidateSupplements();
      refresh();
      return { outcome: "taken", actualAt: result.actualAt };
    case "changed":
      refresh();
      return { outcome: "changed", error: TAKEN_CHANGED };
    case "already":
      refresh();
      return { outcome: "already" };
    case "gone":
    case "not_found":
      refresh();
      return { outcome: "gone", toast: TAKEN_GONE, tone: "error" };
    case "not_yet":
      return { error: TAKEN_NOT_YET };
    case "future":
      return { error: TIME_FUTURE };
    case "too_early":
      return { error: TIME_TOO_EARLY };
    case "tracking_off":
      refresh();
      return { error: TRACKING_REQUIRED };
    case "invalid":
      return { error: TAKEN_INVALID };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}
