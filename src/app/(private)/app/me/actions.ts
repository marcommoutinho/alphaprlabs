"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentResearcher } from "@/lib/auth/session";
import { shareWithTeam, stopSharing } from "@/lib/support/service";
import { ALREADY_STOPPED, SHARED_TOAST, STOPPED_TOAST } from "@/lib/support/view";
import { createClient } from "@/lib/supabase/server";

const ME = "/app/me";

export type SupportActionResult = {
  /** Shown under the confirm step. */
  error?: string;
  toast?: string;
  tone?: ToastTone;
  /** The share or stop went through (or was already so): the confirm step closes. */
  done?: boolean;
};

/** The caller, re-checked on every action. Sharing and stopping always act on the caller's own history. */
async function signedIn() {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: ME }));
  return person;
}

/**
 * R11 "Share with the Alpha PR Labs team", after the confirm step: every
 * admin may read the caller's full history until they stop sharing. Sharing
 * while already sharing changes nothing.
 */
export async function shareWithTeamAction(): Promise<SupportActionResult> {
  await signedIn();
  const result = await shareWithTeam(await createClient());
  if (result.kind !== "shared") return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  revalidatePath(ME);
  return { done: true, toast: SHARED_TOAST, tone: "info" };
}

/**
 * R11 "Stop sharing", after the confirm step: ends the caller's share at
 * once, for every admin (their next page or request is denied, in the
 * database as well as on the server). Already stopped elsewhere: nothing to do.
 */
export async function stopSharingAction(): Promise<SupportActionResult> {
  await signedIn();
  const result = await stopSharing(await createClient());
  switch (result.kind) {
    case "stopped":
      revalidatePath(ME);
      return { done: true, toast: STOPPED_TOAST, tone: "info" };
    case "not_sharing":
      revalidatePath(ME);
      return { done: true, toast: ALREADY_STOPPED, tone: "info" };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}
