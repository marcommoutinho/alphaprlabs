"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE } from "@/lib/app/save";
import { signInUrl } from "@/lib/auth/paths";
import { currentResearcher } from "@/lib/auth/session";
import { parsePatch, type Preferences } from "@/lib/preferences/rules";
import { savePreferences } from "@/lib/preferences/service";
import { isUuid, shareWithTeam, stopSharing } from "@/lib/support/service";
import { ALREADY_STOPPED, SHARED_TOAST, STOPPED_TOAST } from "@/lib/support/view";
import { createClient } from "@/lib/supabase/server";

const ME = "/app/me";

export type MeActionResult = {
  /** The write went through (or already had): the sheet closes. */
  saved?: boolean;
  toast?: string;
  tone?: "error" | "info";
  /** The preferences as saved (a preference change). */
  preferences?: Preferences;
};

/** The caller, re-checked on every action. Sharing, stopping and preferences always act on the caller's own account. */
async function signedIn() {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: ME }));
  return person;
}

/** The request key the screen made for this submission (sent again on a retry), or null. */
const requestKeyOf = (input: unknown): string | null => {
  const key = typeof input === "object" && input !== null ? (input as Record<string, unknown>).requestKey : null;
  return isUuid(key) ? key.toLowerCase() : null;
};

/**
 * R17 "Allow read-only access": every Alpha PR Labs admin may read the
 * caller's full history until they stop sharing. Sharing while already
 * sharing changes nothing; the same request key again replays (a retry never
 * shares again after a stop).
 */
export async function shareWithTeamAction(input: unknown): Promise<MeActionResult> {
  await signedIn();
  const key = requestKeyOf(input);
  if (!key) return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  const result = await shareWithTeam(await createClient(), key);
  if (result.kind !== "shared") return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  revalidatePath(ME);
  return { saved: true, toast: SHARED_TOAST, tone: "info" };
}

/**
 * R8's switch turned off, after its confirmation (Marco, 2026-09-27: stopping
 * asks first): ends the caller's share at once, for every admin (their next
 * page or request is denied, in the database as well as on the server).
 * Already stopped elsewhere: nothing to do. Keyed like the share.
 */
export async function stopSharingAction(input: unknown): Promise<MeActionResult> {
  await signedIn();
  const key = requestKeyOf(input);
  if (!key) return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  const result = await stopSharing(await createClient(), key);
  switch (result.kind) {
    case "stopped":
      revalidatePath(ME);
      return { saved: true, toast: STOPPED_TOAST, tone: "info" };
    case "not_sharing":
      revalidatePath(ME);
      return { saved: true, toast: ALREADY_STOPPED, tone: "info" };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}

/**
 * R8 Preferences: Default syringe, Weight unit or Appearance, stored with the
 * account (save_account_preferences). Idempotent by request key. Every
 * screen that honours them is refreshed.
 */
export async function savePreferencesAction(input: unknown): Promise<MeActionResult> {
  await signedIn();
  const key = requestKeyOf(input);
  const patch = parsePatch(typeof input === "object" && input !== null ? (input as Record<string, unknown>).patch : null);
  if (!key || !patch) return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  const result = await savePreferences(await createClient(), key, patch);
  if (result.kind !== "saved") return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  // The appearance is rendered by the root layout; the syringe and weight unit by these screens.
  revalidatePath("/", "layout");
  return { saved: true, preferences: result.preferences };
}
