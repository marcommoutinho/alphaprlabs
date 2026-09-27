"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentResearcher } from "@/lib/auth/session";
import { grantSupport, isUuid, listGrantHistory, revokeSupport } from "@/lib/support/service";
import { ALREADY_REVOKED, CHOOSE_ADMIN, GRANT_REFUSED, grantedToast, revokedToast } from "@/lib/support/view";
import { createClient } from "@/lib/supabase/server";

const ME = "/app/me";

export type SupportActionResult = {
  /** Shown under the confirm step. */
  error?: string;
  toast?: string;
  tone?: ToastTone;
  /** The grant or revoke went through (or was already so): the confirm step closes. */
  done?: boolean;
};

/** The caller, re-checked on every action. Grants and revokes always act on the caller's own history. */
async function signedIn() {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: ME }));
  return person;
}

const adminIdOf = (input: unknown): string | null => {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>).adminId : undefined;
  return isUuid(raw) ? raw.toLowerCase() : null;
};

/** The admin's name as the caller's own grant history has it (for the toast). */
async function adminName(db: Awaited<ReturnType<typeof createClient>>, adminId: string): Promise<string> {
  try {
    return (await listGrantHistory(db)).find((grant) => grant.adminId === adminId)?.adminName ?? "The admin";
  } catch {
    return "The admin";
  }
}

/**
 * R11 "Grant read-only access", after the confirm step: the named admin may
 * read the caller's full history until it is revoked. grant_support_access
 * refuses anyone who is not an admin, and the caller; granting an admin who
 * already has access changes nothing.
 */
export async function grantSupportAction(input: unknown): Promise<SupportActionResult> {
  await signedIn();
  const adminId = adminIdOf(input);
  if (!adminId) return { error: CHOOSE_ADMIN };
  const db = await createClient();
  const result = await grantSupport(db, adminId);
  switch (result.kind) {
    case "granted":
      revalidatePath(ME);
      return { done: true, toast: grantedToast(await adminName(db, adminId)), tone: "info" };
    case "refused":
      return { error: GRANT_REFUSED };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}

/**
 * R11 "Revoke access", after the confirm step: ends the caller's active grant
 * to that admin at once (the admin's next page or request is denied, in the
 * database as well as on the server). Already revoked elsewhere: nothing to do.
 */
export async function revokeSupportAction(input: unknown): Promise<SupportActionResult> {
  await signedIn();
  const adminId = adminIdOf(input);
  if (!adminId) return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  const db = await createClient();
  const result = await revokeSupport(db, adminId);
  switch (result.kind) {
    case "revoked":
      revalidatePath(ME);
      return { done: true, toast: revokedToast(await adminName(db, adminId)), tone: "info" };
    case "not_active":
      revalidatePath(ME);
      return { done: true, toast: ALREADY_REVOKED, tone: "info" };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}
