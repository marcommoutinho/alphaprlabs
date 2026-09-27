import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CycleRecord } from "@/lib/cycles/rules";
import { listCycles } from "@/lib/cycles/service";
import { type DoseRecord, listDoseRecords } from "@/lib/doses/service";
import type { Mixture } from "@/lib/mixtures/rules";
import { getSupplyTracking, listMixtures, listPersonalVials, type PersonalVial } from "@/lib/mixtures/service";
import { type CheckIn, listCheckIns } from "@/lib/progress/service";
import { getSupplementTracking, listRoutines, listTaken, type Routine, type TakenRecord } from "@/lib/supplements/service";
import { listDeductions, type VialDeduction } from "@/lib/supplies/service";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

// Support access (S4's grants; S17's R11 Me and A8 screens). `db` is always
// the caller's own session client: the grant functions act for the caller,
// the listing functions check the caller themselves
// (20260927120000_support_history.sql), and A8's history reads the
// researcher's records as the admin, under RLS (can_read_researcher), never
// with the secret key. Revoking therefore denies the admin's next read.

/** Rows per request; the API caps a response at 1,000 rows. */
const PAGE = 1000;

type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/** Every row of a function ordered by `id`, a page at a time by keyset (never cut at the row cap). */
async function keyset<Row>(page: (after: string | null, limit: number) => Page<Row>, idOf: (row: Row) => string, what: string, requested = PAGE): Promise<Row[]> {
  // Never more than the API returns: a short page must mean the last one.
  const pageSize = Math.min(requested, PAGE);
  const rows: Row[] = [];
  for (let after: string | null = null; ; ) {
    const { data, error } = await page(after, pageSize);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return rows;
    after = idOf(got[got.length - 1]);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

// ── R11: the researcher's side ──────────────────────────────────────────────

/** An admin a researcher may grant read-only access to (names only). */
export type SupportAdmin = { id: string; name: string };

/** One grant the caller made, active (revokedAt null) or past. */
export type SupportGrant = {
  id: string;
  adminId: string;
  adminName: string;
  /** False once the grantee is no longer an admin (the grant then reads nothing). */
  stillAdmin: boolean;
  grantedAt: string;
  revokedAt: string | null;
};

/** Every admin other than the caller, by name. `pageSize` is for tests that prove paging. */
export async function listSupportAdmins(db: Db, pageSize = PAGE): Promise<SupportAdmin[]> {
  const rows = await keyset(
    (after, limit) => {
      const query = db.rpc("support_admins").select("admin_id, name");
      return (after ? query.gt("admin_id", after) : query).order("admin_id").limit(limit);
    },
    (row) => row.admin_id,
    "the admins",
    pageSize,
  );
  return rows.map((row) => ({ id: row.admin_id, name: row.name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The caller's grants, newest first. */
export async function listGrantHistory(db: Db, pageSize = PAGE): Promise<SupportGrant[]> {
  const rows = await keyset(
    (after, limit) => {
      const query = db.rpc("support_grant_history").select("grant_id, admin_id, admin_name, still_admin, granted_at, revoked_at");
      return (after ? query.gt("grant_id", after) : query).order("grant_id").limit(limit);
    },
    (row) => row.grant_id,
    "your support access",
    pageSize,
  );
  return rows
    .map((row) => ({
      id: row.grant_id,
      adminId: row.admin_id,
      adminName: row.admin_name,
      stillAdmin: row.still_admin,
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at,
    }))
    .sort((a, b) => Date.parse(b.grantedAt) - Date.parse(a.grantedAt) || b.id.localeCompare(a.id));
}

export type GrantResult = { kind: "granted" | "refused" | "error" };

/** grant_support_access: an active grant to `adminId` (an existing one counts); refused when not an admin, or the caller. */
export async function grantSupport(db: Db, adminId: string): Promise<GrantResult> {
  const { data, error } = await db.rpc("grant_support_access", { p_admin_id: adminId });
  if (error) return { kind: "error" };
  return { kind: data ? "granted" : "refused" };
}

export type RevokeResult = { kind: "revoked" | "not_active" | "error" };

/** revoke_support_access: ends the caller's active grant to `adminId` at once. */
export async function revokeSupport(db: Db, adminId: string): Promise<RevokeResult> {
  const { data, error } = await db.rpc("revoke_support_access", { p_admin_id: adminId });
  if (error) return { kind: "error" };
  return { kind: data ? "revoked" : "not_active" };
}

// ── A8: the admin's side ────────────────────────────────────────────────────

/** An account and its grant state towards the calling admin. */
export type SupportAccount = {
  id: string;
  name: string;
  email: string;
  /** Their active grant to the caller, or null. */
  grantedAt: string | null;
  /** Their latest revoked grant to the caller, or null. */
  revokedAt: string | null;
};

type AccountRow = { profile_id: string; name: string; email: string; granted_at: string | null; revoked_at: string | null };

const accountOf = (row: AccountRow): SupportAccount => ({
  id: row.profile_id,
  name: row.name,
  email: row.email,
  grantedAt: row.granted_at,
  revokedAt: row.revoked_at,
});

/** Every other account with its grant state towards the caller (an admin). `pageSize` is for tests. */
export async function listSupportAccounts(db: Db, pageSize = PAGE): Promise<SupportAccount[]> {
  const rows = await keyset<AccountRow>(
    (after, limit) => {
      const query = db.rpc("admin_support_researchers").select("profile_id, name, email, granted_at, revoked_at");
      return (after ? query.gt("profile_id", after) : query).order("profile_id").limit(limit);
    },
    (row) => row.profile_id,
    "researchers",
    pageSize,
  );
  return rows.map(accountOf);
}

/** One account's name, email and grant state towards the caller (an admin), or null when there is none. */
export async function getSupportAccount(db: Db, profileId: string): Promise<SupportAccount | null> {
  if (!isUuid(profileId)) return null;
  const { data, error } = await db
    .rpc("admin_support_researchers", { p_researcher_id: profileId.toLowerCase() })
    .select("profile_id, name, email, granted_at, revoked_at")
    .maybeSingle();
  if (error) throw new Error(`Could not load the researcher: ${error.message}`);
  return data ? accountOf(data) : null;
}

/**
 * Every library peptide's name, withdrawn ones included, through the
 * admin-only admin_library_peptides(). A8 needs the names of peptides a
 * researcher's history uses even after they stopped being offered; the
 * research-side library read hides those from everyone but the researcher
 * whose own records use them.
 */
export async function adminPeptideNames(db: Db): Promise<Map<string, { name: string; available: boolean }>> {
  const rows = await keyset(
    (after, limit) => {
      const query = db.rpc("admin_library_peptides").select("id, name, available");
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    },
    (row) => row.id,
    "the library",
  );
  return new Map(rows.map((row) => [row.id, { name: row.name, available: row.available }]));
}

/** Everything A8's history shows, read as the admin under RLS (peptide names come from adminPeptideNames). */
export type ResearcherRecords = {
  cycles: CycleRecord[];
  doses: DoseRecord[];
  checkIns: CheckIn[];
  supplyTracking: boolean;
  vials: PersonalVial[];
  mixtures: Mixture[];
  deductions: VialDeduction[];
  supplementTracking: boolean;
  routines: Routine[];
  taken: TakenRecord[];
};

/**
 * A researcher's full history for A8, with the existing owner-scoped reads
 * run as the calling admin: RLS returns rows only while the researcher's
 * grant is active, so a read after a revoke comes back empty (callers check
 * the grant before and after). Business stock, sales and push subscriptions
 * are never read here.
 */
export async function readResearcherRecords(db: Db, ownerId: string): Promise<ResearcherRecords> {
  const [cycles, doses, checkIns, supplyTracking, vials, mixtures, deductions, supplementTracking, routines, taken] = await Promise.all([
    listCycles(db, ownerId),
    listDoseRecords(db, ownerId),
    listCheckIns(db, ownerId),
    getSupplyTracking(db, ownerId),
    listPersonalVials(db, ownerId),
    listMixtures(db, ownerId),
    listDeductions(db, ownerId),
    getSupplementTracking(db, ownerId),
    listRoutines(db, ownerId),
    listTaken(db, ownerId),
  ]);
  return { cycles, doses, checkIns, supplyTracking, vials, mixtures, deductions, supplementTracking, routines, taken };
}
