import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { hasResearchAccess, type AppIdentity } from "@/lib/app/identity";
import { type Preferences, resolvePreferences } from "@/lib/preferences/rules";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { ACKNOWLEDGE_PATH, RESEARCH_HOME, signInUrl, termsAgreement } from "./paths";

/** The verified signed-in person: Auth server user + their profile row and preferences. */
export type SessionPerson = AppIdentity & {
  id: string;
  /** Agreed to the CURRENT research terms (ACKNOWLEDGEMENT_VERSION); an earlier version doesn't count. */
  acknowledged: boolean;
  /** The terms version last agreed to, or null (never: still joining). */
  agreedVersion: string | null;
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
  return readSessionPerson(supabase, user.id);
});

/** The profile and its preferences in one read, through the caller's own client (RLS: own row). */
export async function readSessionPerson(supabase: SupabaseClient<Database>, userId: string): Promise<SessionPerson | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name, email, role, acknowledgement_version, created_at, account_preferences(default_syringe, weight_unit, appearance, heads_up_minutes)")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return null;

  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    // The version and its time are stored together (profiles_acknowledgement_pair).
    acknowledged: termsAgreement(profile.acknowledgement_version) === "current",
    agreedVersion: profile.acknowledgement_version,
    createdAt: profile.created_at,
    preferences: resolvePreferences(profile.account_preferences),
  };
}

/**
 * For research-side layouts and pages (/app): the signed-in researcher or
 * admin (every admin is also a researcher) who has agreed to the current
 * research terms, or a redirect — to sign-in without a session, else to the
 * terms (an earlier version's agreement doesn't count). Only ever grants
 * access to the person's own records.
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
 * does not need the research terms (current or not): an admin who hasn't
 * agreed to the current version is sent to them only on the research side.
 */
export async function requireAdmin(returnTo?: string): Promise<SessionPerson> {
  const person = await getSessionPerson();
  if (!person) redirect(signInUrl({ next: returnTo }));
  if (person.role !== "admin") redirect(RESEARCH_HOME);
  return person;
}

/**
 * For research-side server actions: the signed-in researcher or admin who
 * has agreed to the current terms, or null (the action must refuse). Actions act only on this person's
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
