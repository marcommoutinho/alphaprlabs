import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { hasResearchAccess, type AppIdentity } from "@/lib/app/identity";
import { type Preferences, resolvePreferences } from "@/lib/preferences/rules";
import { createClient } from "@/lib/supabase/server";
import { ACKNOWLEDGE_PATH, RESEARCH_HOME, signInUrl } from "./paths";

/** The verified signed-in person: Auth server user + their profile row and preferences. */
export type SessionPerson = AppIdentity & {
  id: string;
  acknowledged: boolean;
  /** When the account was created (R8 "Researcher since Aug 2026"). */
  createdAt: string;
  /** R8 Preferences (the defaults when none were saved). */
  preferences: Preferences;
};

/**
 * Data access layer for "who is asking". Verifies the session with the Auth
 * server (getUser) and reads the role from `profiles` under RLS, never from
 * user-editable metadata. The profile and the account's preferences come in
 * one read (the private root layout needs the appearance before first
 * paint). Memoized per request.
 */
export const getSessionPerson = cache(async (): Promise<SessionPerson | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name, email, role, acknowledged_at, created_at, account_preferences(default_syringe, weight_unit, appearance)")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return null;

  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    acknowledged: profile.acknowledged_at !== null,
    createdAt: profile.created_at,
    preferences: resolvePreferences(profile.account_preferences),
  };
});

/**
 * For research-side layouts and pages (/app): the signed-in researcher or
 * admin (every admin is also a researcher) who has acknowledged the
 * disclaimer, or a redirect — to sign-in without a session, else to the
 * acknowledgement. Only ever grants access to the person's own records.
 */
export async function requireResearcher(returnTo?: string): Promise<SessionPerson> {
  const person = await getSessionPerson();
  if (!person) redirect(signInUrl({ next: returnTo }));
  if (!hasResearchAccess(person.role)) notFound();
  if (!person.acknowledged) redirect(ACKNOWLEDGE_PATH);
  return person;
}

/**
 * For admin layouts and pages (/admin): the signed-in admin, or a redirect —
 * to sign-in without a session, else (a researcher) to Today. The back office
 * does not need the researcher acknowledgement.
 */
export async function requireAdmin(returnTo?: string): Promise<SessionPerson> {
  const person = await getSessionPerson();
  if (!person) redirect(signInUrl({ next: returnTo }));
  if (person.role !== "admin") redirect(RESEARCH_HOME);
  return person;
}

/**
 * For research-side server actions: the signed-in, acknowledged researcher or
 * admin, or null (the action must refuse). Actions act only on this person's
 * own records.
 */
export async function currentResearcher(): Promise<SessionPerson | null> {
  const person = await getSessionPerson();
  return person && hasResearchAccess(person.role) && person.acknowledged ? person : null;
}

/** For server actions: the signed-in admin, or null (the action must refuse). */
export async function currentAdmin(): Promise<SessionPerson | null> {
  const person = await getSessionPerson();
  return person?.role === "admin" ? person : null;
}
