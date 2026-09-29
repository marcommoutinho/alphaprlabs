"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { appOrigin } from "@/lib/auth/origin";
import {
  ACKNOWLEDGE_PATH,
  ACKNOWLEDGEMENT_VERSION,
  AFTER_ACKNOWLEDGEMENT_PATH,
  RECOVER_PATH,
  RESET_PASSWORD_PATH,
  SIGN_IN_PATH,
  destinationFor,
} from "@/lib/auth/paths";
import { startRecovery } from "@/lib/auth/recovery";
import { canonicalEndpoint, deviceIdOf } from "@/lib/push/device";
import { getSessionPerson } from "@/lib/auth/session";
import { hasResearchAccess } from "@/lib/app/identity";
import { acceptInvitation, MIN_PASSWORD_LENGTH } from "@/lib/invitations/service";
import { createClient } from "@/lib/supabase/server";

/**
 * What a form shows after a failed submit (one inline error or one error
 * toast), or where it goes next.
 */
export type FormResult = { error?: string; toast?: string; redirectTo?: string } | undefined;

const SAVE_FAILED = "Could not save. Nothing was lost — your entry is still here. Try again.";
const PASSWORD_TOO_SHORT = "Password needs at least 8 characters.";
const str = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Where the sign-in, recovery and joining forms go next. Not `redirect()`:
 * Next.js renders an action's redirect target within the same request, with
 * the cookies the request came in with, so after a sign-in the new session
 * isn't on it yet and the person would land on a page rendered signed out
 * (the sign-in form under /app/today); after R15 an iPhone was taken past
 * R16 to Today. The form navigates instead, as a link would, with the
 * current cookies (useAuthSubmit). The e2e suite resolves the app host as
 * production does, so it takes this path (tests/support/resolve-localhost.mjs).
 */
const goTo = (path: string): FormResult => ({ redirectTo: path });

// ── Sign in / out ────────────────────────────────────────────────────────────

export async function signIn(input: { email: unknown; password: unknown; next?: unknown }): Promise<FormResult> {
  const email = str(input.email).trim().toLowerCase();
  const password = str(input.password);
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  // Same message whether the email is unknown or the password is wrong.
  if (error || !data.user) return { error: "Email or password is incorrect. Passwords are case-sensitive." };

  // Role comes from the profile (RLS: own row), read with the new session.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, acknowledged_at")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    return { error: "Email or password is incorrect. Passwords are case-sensitive." };
  }
  return goTo(destinationFor({ role: profile.role, acknowledged: profile.acknowledged_at !== null }, str(input.next)));
}

/**
 * `endpoint` is this device's push subscription, if it has one, and
 * `deviceId` this browser's device id: the rows for either are disabled for
 * the person signing out and the device is marked off, so a signed-out phone
 * gets no reminders and a pending re-registration can't switch it back on.
 * A researcher (or admin: every admin is also a researcher) is signed out
 * only once that is recorded: without a device id,
 * or if it fails, the session is kept and `{ ok: false }` returned
 * (src/lib/push/sign-out.ts retries once). No
 * redirect (it would reject the caller's promise): the account menu reloads
 * to the sign-in page, which also clears all client state.
 */
export async function signOut(input?: { endpoint?: unknown; deviceId?: unknown }): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const person = await getSessionPerson();
  if (person && hasResearchAccess(person.role)) {
    const deviceId = deviceIdOf(input?.deviceId);
    if (deviceId === null) return { ok: false };
    const { error } = await supabase.rpc("disable_push_subscription", {
      p_reason: "signed_out",
      p_endpoint: canonicalEndpoint(input?.endpoint) ?? undefined,
      p_device_id: deviceId,
    });
    if (error) return { ok: false };
  }
  await supabase.auth.signOut();
  return { ok: true };
}

// ── Recover access ───────────────────────────────────────────────────────────

/**
 * Always reports success for a valid address, immediately: the provider call
 * (which only emails existing accounts) runs after the response, so neither
 * the answer nor its timing reveals whether an account exists.
 */
export async function requestRecovery(input: { email: unknown }): Promise<FormResult & { sent?: boolean }> {
  return startRecovery(input, { origin: await appOrigin(), schedule: after });
}

/**
 * Second half of the recovery link. The emailed link (GET /auth/confirm) only
 * shows a button, so mail scanners that follow links can't use up the
 * single-use token; the person's click verifies it and signs them in.
 */
export async function confirmRecovery(input: { tokenHash: unknown }): Promise<FormResult> {
  const tokenHash = str(input.tokenHash);
  let verified = false;
  if (tokenHash) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    verified = !error;
  }
  return goTo(verified ? RESET_PASSWORD_PATH : `${RECOVER_PATH}?link=invalid`);
}

export async function setNewPassword(input: { password: unknown }): Promise<FormResult> {
  const password = str(input.password);
  if (password.length < MIN_PASSWORD_LENGTH) return { error: PASSWORD_TOO_SHORT };

  const person = await getSessionPerson();
  if (!person) redirect(`${SIGN_IN_PATH}?expired=1`);

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error?.code === "same_password") return { error: "Choose a password different from your old one." };
  if (error?.code === "weak_password") return { error: PASSWORD_TOO_SHORT };
  if (error) return { toast: SAVE_FAILED };
  return goTo(destinationFor(person));
}

// ── Invitation: account setup (step 1) and acknowledgement (step 2) ──────────

export async function createAccount(input: { token: unknown; name: unknown; password: unknown }): Promise<FormResult> {
  const token = str(input.token);
  const name = str(input.name).trim();
  const password = str(input.password);
  if (!name) return { error: "Enter your name." };
  if (password.length < MIN_PASSWORD_LENGTH) return { error: PASSWORD_TOO_SHORT };

  const result = await acceptInvitation({ token, name, password });
  if (!result.ok) {
    if (result.reason === "invalid_name") return { error: "Enter your name (up to 120 characters)." };
    if (result.reason === "weak_password") return { error: PASSWORD_TOO_SHORT };
    // Expired, already used or unknown: the invitation page explains which.
    if (result.reason === "invalid") redirect(`/auth/invite/${encodeURIComponent(token)}`);
    return { toast: SAVE_FAILED };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: result.email, password });
  if (error) redirect(SIGN_IN_PATH);
  return goTo(ACKNOWLEDGE_PATH);
}

export async function acknowledge(input: { accepted: unknown }): Promise<FormResult> {
  if (input.accepted !== true) {
    return { error: "Tick the acknowledgement to continue. It is required for researcher accounts." };
  }
  const person = await getSessionPerson();
  if (!person) redirect(`${SIGN_IN_PATH}?expired=1`);
  // Researchers and admins (every admin is also a researcher); own profile only.
  if (!hasResearchAccess(person.role)) redirect(destinationFor(person));

  const supabase = await createClient();
  const { data: recorded, error } = await supabase.rpc("record_acknowledgement", {
    p_version: ACKNOWLEDGEMENT_VERSION,
  });
  if (error || !recorded) return { toast: SAVE_FAILED };
  return goTo(AFTER_ACKNOWLEDGEMENT_PATH);
}
