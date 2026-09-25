import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { AppIdentity, AppRole } from "@/lib/app/identity";
import { createClient } from "@/lib/supabase/server";
import { ACKNOWLEDGE_PATH, ROLE_HOME, signInUrl } from "./paths";

/** The verified signed-in person: Auth server user + their profile row. */
export type SessionPerson = AppIdentity & { id: string; acknowledged: boolean };

/**
 * Data access layer for "who is asking". Verifies the session with the Auth
 * server (getUser) and reads the role from `profiles` under RLS, never from
 * user-editable metadata. Memoized per request.
 */
export const getSessionPerson = cache(async (): Promise<SessionPerson | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name, email, role, acknowledged_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return null;

  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    acknowledged: profile.acknowledged_at !== null,
  };
});

/**
 * For layouts and pages: the signed-in person with `role`, or a redirect —
 * to sign-in without a session, to the acknowledgement for a researcher who
 * hasn't acknowledged, or to their own home for the other role.
 */
export async function requireRole(role: AppRole, returnTo?: string): Promise<SessionPerson> {
  const person = await getSessionPerson();
  if (!person) redirect(signInUrl({ next: returnTo }));
  if (person.role !== role) redirect(ROLE_HOME[person.role]);
  if (role === "researcher" && !person.acknowledged) redirect(ACKNOWLEDGE_PATH);
  return person;
}

/** For server actions: the signed-in admin, or null (the action must refuse). */
export async function currentAdmin(): Promise<SessionPerson | null> {
  const person = await getSessionPerson();
  return person?.role === "admin" ? person : null;
}
