import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveRequestHash } from "@/lib/request-hash";
import type { Database } from "@/lib/supabase/database.types";
import { type PreferencePatch, type Preferences, resolvePreferences } from "./rules";

type Db = SupabaseClient<Database>;

// R8 Me · Preferences, through the caller's own session client: the table is
// readable by its owner only, and saves go through save_account_preferences
// (supabase/migrations/20260928140000_me_preferences.sql).

/** The caller's preferences (the defaults when none were ever saved). */
export async function getPreferences(db: Db, ownerId: string): Promise<Preferences> {
  const { data, error } = await db
    .from("account_preferences")
    .select("default_syringe, weight_unit, appearance, heads_up_minutes")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(`Could not load your preferences: ${error.message}`);
  return resolvePreferences(data);
}

export type SavePreferencesResult = { kind: "saved"; preferences: Preferences; replayed: boolean } | { kind: "error" };

/** The hash a preference save sends with its request key: the patch as sent. */
export const preferencesRequestHash = (patch: PreferencePatch) => saveRequestHash({ kind: "preferences", ...patch });

/** Saves a patch, idempotently: the same key and patch again replay the first save. */
export async function savePreferences(db: Db, requestKey: string, patch: PreferencePatch): Promise<SavePreferencesResult> {
  const { data, error } = await db.rpc("save_account_preferences", {
    p_request_key: requestKey,
    p_request_hash: preferencesRequestHash(patch),
    ...(patch.defaultSyringe !== undefined ? { p_default_syringe: patch.defaultSyringe } : {}),
    ...(patch.weightUnit !== undefined ? { p_weight_unit: patch.weightUnit } : {}),
    ...(patch.appearance !== undefined ? { p_appearance: patch.appearance } : {}),
    ...(patch.headsUpMinutes !== undefined ? { p_heads_up_minutes: patch.headsUpMinutes } : {}),
  });
  if (error || !data || typeof data !== "object") return { kind: "error" };
  const row = data as { default_syringe: number; weight_unit: string; appearance: string | null; heads_up_minutes?: number; replayed?: boolean };
  return { kind: "saved", preferences: resolvePreferences(row), replayed: row.replayed === true };
}
