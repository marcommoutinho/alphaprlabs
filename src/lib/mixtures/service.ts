import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineSpacing, SyringeCapacity } from "@/lib/calculator/calculator";
import { allRows } from "@/lib/library/service";
import type { Database } from "@/lib/supabase/database.types";
import { drawFor, type Mixture, type MixtureSetup, type MixtureVersion, type PlanDraw, type ValidMixture } from "./rules";

type Db = SupabaseClient<Database>;

// Saved mixtures (R7) and personal vials (R8 data), read and written with the
// caller's own session client, so RLS decides what is readable: a person's
// own records, or those of a researcher whose active support grant they hold
// (can_read_researcher). Callers that mean "mine" pass their own id as owner.
// Amounts are read as text so no decimal passes through a float.
//
// For other slices:
//   S10 cycle detail  planMixtures(db, ownerId) → the mixture each plan uses
//                     now; rules.planMixtureLine / drawFor for its lines.
//   S12 Today         planDraws(db, ownerId, [{ planId, doseMg }]) → units for
//                     each due dose; the confirmation function snapshots
//                     public.plan_mixture_version_at(plan, instant).
//   S14 supplies      listPersonalVials, getSupplyTracking, setSupplyTracking,
//                     savePersonalVial, finishPersonalVial; listMixtures for
//                     the "Saved mixture" select.

const VERSION_COLUMNS = "id, mixture_id, number, vial_mg::text, liquid_ml::text, syringe_units, line_spacing::text, created_at";

type VersionRow = {
  id: string;
  mixture_id: string;
  number: number;
  vial_mg: string;
  liquid_ml: string;
  syringe_units: number;
  line_spacing: string | null;
  created_at: string;
};

const setupOf = (row: VersionRow): MixtureSetup => ({
  vialMg: row.vial_mg,
  liquidMl: row.liquid_ml,
  syringe: row.syringe_units as SyringeCapacity,
  lineSpacing: (row.line_spacing ?? "unknown") as LineSpacing,
});

type MixtureRow = {
  id: string;
  owner_id: string;
  peptide_id: string;
  current_version: number;
  version: number;
  created_at: string;
};

/** Mixtures with their current setup and current plan links. */
async function withSetups(db: Db, rows: MixtureRow[]): Promise<Mixture[]> {
  if (rows.length === 0) return [];
  // One mixture, or a list of one owner's: filter by the mixture or the owner.
  const one = rows.length === 1;
  const column = one ? "mixture_id" : "owner_id";
  const value = one ? rows[0].id : rows[0].owner_id;
  const [versions, links] = await Promise.all([
    allRows<VersionRow>(
      (from, to) =>
        db
          .from("mixture_versions")
          .select(VERSION_COLUMNS)
          .eq(column, value)
          .order("mixture_id")
          .order("number")
          .range(from, to) as unknown as PromiseLike<{ data: VersionRow[] | null; error: { message: string } | null }>,
      "mixture setups",
    ),
    allRows(
      (from, to) =>
        db
          .from("cycle_plan_mixtures")
          .select("plan_id, mixture_id")
          .eq(column, value)
          .is("unlinked_at", null)
          .order("plan_id")
          .range(from, to),
      "mixture links",
    ),
  ]);
  const current = new Map<string, VersionRow>();
  for (const version of versions) {
    const mixture = rows.find((row) => row.id === version.mixture_id);
    if (mixture && version.number === mixture.current_version) current.set(version.mixture_id, version);
  }
  return rows.flatMap((row) => {
    const version = current.get(row.id);
    if (!version) return [];
    return [
      {
        id: row.id,
        ownerId: row.owner_id,
        peptideId: row.peptide_id,
        version: row.version,
        setupNumber: version.number,
        setupId: version.id,
        setup: setupOf(version),
        setupSince: version.created_at,
        createdAt: row.created_at,
        planIds: links.filter((link) => link.mixture_id === row.id).map((link) => link.plan_id),
      },
    ];
  });
}

const MIXTURE_COLUMNS = "id, owner_id, peptide_id, current_version, version, created_at";

/** The saved mixtures `ownerId` has (not deleted), newest first. */
export async function listMixtures(db: Db, ownerId: string): Promise<Mixture[]> {
  const rows = await allRows(
    (from, to) =>
      db
        .from("mixtures")
        .select(MIXTURE_COLUMNS)
        .eq("owner_id", ownerId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    "saved mixtures",
  );
  return withSetups(db, rows);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One saved mixture (deleted ones included, for history), or null. */
export async function getMixture(db: Db, mixtureId: string): Promise<(Mixture & { deleted: boolean }) | null> {
  if (!UUID.test(mixtureId)) return null;
  const { data, error } = await db
    .from("mixtures")
    .select(`${MIXTURE_COLUMNS}, deleted_at`)
    .eq("id", mixtureId.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(`Could not load the mixture: ${error.message}`);
  if (!data) return null;
  const [mixture] = await withSetups(db, [data]);
  return mixture ? { ...mixture, deleted: data.deleted_at !== null } : null;
}

/** A mixture's setups, oldest first: every version ever saved. */
export async function mixtureHistory(db: Db, mixtureId: string): Promise<MixtureVersion[]> {
  if (!UUID.test(mixtureId)) return [];
  const rows = await allRows<VersionRow>(
    (from, to) =>
      db
        .from("mixture_versions")
        .select(VERSION_COLUMNS)
        .eq("mixture_id", mixtureId.toLowerCase())
        .order("number")
        .range(from, to) as unknown as PromiseLike<{ data: VersionRow[] | null; error: { message: string } | null }>,
    "mixture history",
  );
  return rows.map((row) => ({ id: row.id, number: row.number, setup: setupOf(row), createdAt: row.created_at }));
}

/**
 * The mixture each of `ownerId`'s cycle plans uses now, by plan id. A plan
 * without one is absent (S10: "No saved mixture — units can't be shown").
 */
export async function planMixtures(db: Db, ownerId: string): Promise<Map<string, Mixture>> {
  const mixtures = await listMixtures(db, ownerId);
  const byPlan = new Map<string, Mixture>();
  for (const mixture of mixtures) for (const planId of mixture.planIds) byPlan.set(planId, mixture);
  return byPlan;
}

/**
 * Syringe units for planned doses (S12 Today): each { planId, doseMg } with
 * its plan's current mixture, as an explicit draw (see rules.drawFor).
 */
export async function planDraws(
  db: Db,
  ownerId: string,
  doses: readonly { planId: string; doseMg: string }[],
): Promise<PlanDraw[]> {
  const byPlan = await planMixtures(db, ownerId);
  return doses.map(({ planId, doseMg }) => drawFor(byPlan.get(planId) ?? null, doseMg));
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type SaveMixtureResult =
  | { kind: "saved"; id: string }
  | { kind: "not_found" | "stale" | "plans" | "unavailable" | "vial_strength" | "error" };

const SAVE_REFUSALS: Record<string, Exclude<SaveMixtureResult["kind"], "saved">> = {
  AP003: "unavailable",
  AP007: "unavailable",
  AP011: "stale",
  AP012: "plans",
  AP014: "vial_strength",
};

/** save_mixture (20260926190100_mixture_writes.sql): create, or a new setup version, and the plan links. */
export async function saveMixture(db: Db, mixture: ValidMixture): Promise<SaveMixtureResult> {
  const { data, error } = await db.rpc("save_mixture", {
    p_peptide_id: mixture.peptideId,
    p_vial_mg: mixture.setup.vialMg,
    p_liquid_ml: mixture.setup.liquidMl,
    p_syringe_units: mixture.setup.syringe,
    p_line_spacing: mixture.setup.lineSpacing,
    p_plan_ids: mixture.planIds,
    ...(mixture.mixtureId ? { p_mixture_id: mixture.mixtureId, p_version: mixture.version ?? undefined } : {}),
  });
  if (error) return { kind: SAVE_REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  return { kind: "saved", id: data };
}

export type DeleteMixtureResult = { kind: "deleted" | "not_found" | "stale" | "linked" | "error" };

export async function deleteMixture(db: Db, mixtureId: string, version: number): Promise<DeleteMixtureResult> {
  const { data, error } = await db.rpc("delete_mixture", { p_mixture_id: mixtureId, p_version: version });
  if (error) return { kind: error.code === "AP013" ? "linked" : error.code === "AP011" ? "stale" : "error" };
  return { kind: data ? "deleted" : "not_found" };
}

// ── Personal supplies (R8 data; screens in S14) ─────────────────────────────

export type PersonalVial = {
  id: string;
  peptideId: string;
  label: string;
  strengthMg: string;
  /** The saved mixture it was mixed to; null while "Not mixed yet". */
  mixtureId: string | null;
  createdAt: string;
  /** Set once finished; finished vials stay for history. */
  finishedAt: string | null;
};

/** "Track supplies" for `ownerId` (off when never set). */
export async function getSupplyTracking(db: Db, ownerId: string): Promise<boolean> {
  const { data, error } = await db.from("personal_supply_settings").select("tracking_enabled").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Could not load the supplies setting: ${error.message}`);
  return data?.tracking_enabled ?? false;
}

export async function setSupplyTracking(db: Db, enabled: boolean): Promise<boolean> {
  const { data, error } = await db.rpc("set_supply_tracking", { p_enabled: enabled });
  if (error) throw new Error(`Could not save the supplies setting: ${error.message}`);
  return data;
}

type VialRow = {
  id: string;
  peptide_id: string;
  label: string;
  strength_mg: string;
  mixture_id: string | null;
  created_at: string;
  finished_at: string | null;
};

/** `ownerId`'s vials, open and finished, oldest first. */
export async function listPersonalVials(db: Db, ownerId: string): Promise<PersonalVial[]> {
  const rows = await allRows<VialRow>(
    (from, to) =>
      db
        .from("personal_vials")
        .select("id, peptide_id, label, strength_mg::text, mixture_id, created_at, finished_at")
        .eq("owner_id", ownerId)
        .order("created_at")
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: VialRow[] | null; error: { message: string } | null }>,
    "personal vials",
  );
  return rows.map((row) => ({
    id: row.id,
    peptideId: row.peptide_id,
    label: row.label,
    strengthMg: row.strength_mg,
    mixtureId: row.mixture_id,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }));
}

export type SaveVialResult =
  | { kind: "saved"; id: string }
  | { kind: "not_found" | "tracking_off" | "strength" | "mixture_has_vial" | "unavailable" | "invalid" | "error" };

const VIAL_REFUSALS: Record<string, Exclude<SaveVialResult["kind"], "saved">> = {
  AP003: "unavailable",
  AP007: "unavailable",
  AP014: "strength",
  AP015: "mixture_has_vial",
  AP016: "tracking_off",
  "22023": "invalid",
};

/** Adds a vial (no `id`) or changes one's label and mixture (save_personal_vial). */
export async function savePersonalVial(
  db: Db,
  vial: { id?: string; label: string; peptideId: string; strengthMg: string; mixtureId: string | null },
): Promise<SaveVialResult> {
  const { data, error } = await db.rpc("save_personal_vial", {
    p_label: vial.label,
    p_peptide_id: vial.peptideId,
    p_strength_mg: vial.strengthMg,
    ...(vial.mixtureId ? { p_mixture_id: vial.mixtureId } : {}),
    ...(vial.id ? { p_vial_id: vial.id } : {}),
  });
  if (error) return { kind: VIAL_REFUSALS[error.code] ?? "error" };
  if (!data) return { kind: "not_found" };
  return { kind: "saved", id: data };
}

/** Marks a vial finished; false when it is not the caller's or already finished. */
export async function finishPersonalVial(db: Db, vialId: string): Promise<boolean> {
  const { data, error } = await db.rpc("finish_personal_vial", { p_vial_id: vialId });
  if (error) throw new Error(`Could not finish the vial: ${error.message}`);
  return data === true;
}
