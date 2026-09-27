import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CycleRecord } from "@/lib/cycles/rules";
import { listCycles } from "@/lib/cycles/service";
import { type DoseRecord, listDoseRecords } from "@/lib/doses/service";
import { keysetRows, type PageOptions } from "@/lib/keyset";
import { getSupplyTracking, listMixtureRecords, listPersonalVials, type MixtureRecord, type PersonalVial } from "@/lib/mixtures/service";
import { type CheckIn, listCheckIns } from "@/lib/progress/service";
import { getSupplementTracking, listRoutines, listTaken, type Routine, type TakenRecord } from "@/lib/supplements/service";
import { listDeductions, type VialDeduction } from "@/lib/supplies/service";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

// Support access (S17's team share; R11 Me and A8 screens). A researcher
// shares their history, read-only, with the Alpha PR Labs team: every
// current admin (20260927120000_support_history.sql). `db` is always the
// caller's own session client: the share functions act for the caller, the
// listing function checks the caller is an admin, and A8's history reads the
// researcher's records as the admin, under RLS (can_read_researcher), never
// with the secret key. Stopping therefore denies every admin's next read.
//
// The researcher's side never learns which admin reads: a share names no
// admin, and nothing here returns an admin's name or email to a researcher.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

// ── R11: the researcher's side ──────────────────────────────────────────────

/** One period the caller shared with the team: active (stoppedAt null) or past. */
export type SupportShare = { id: string; startedAt: string; stoppedAt: string | null };

/** The caller's shares, newest first (their own rows; RLS). `pageSize` is for tests. */
export async function listShareHistory(db: Db, ownerId: string, options: PageOptions = {}): Promise<SupportShare[]> {
  const rows = await keysetRows<{ id: string; started_at: string; stopped_at: string | null }>(
    (after, limit) => {
      const query = db.from("support_shares").select("id, started_at, stopped_at").eq("researcher_id", ownerId);
      return (after ? query.gt("id", after.id) : query).order("id").limit(limit);
    },
    "your sharing history",
    options,
  );
  return rows
    .map((row) => ({ id: row.id, startedAt: row.started_at, stoppedAt: row.stopped_at }))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id));
}

export type ShareResult = { kind: "shared" | "error" };

/** share_with_team: an active share for the caller (an existing one counts). Refused (error) until acknowledged. */
export async function shareWithTeam(db: Db): Promise<ShareResult> {
  const { data, error } = await db.rpc("share_with_team");
  return { kind: !error && data ? "shared" : "error" };
}

export type StopResult = { kind: "stopped" | "not_sharing" | "error" };

/** stop_sharing_with_team: ends the caller's active share at once, for every admin. */
export async function stopSharing(db: Db): Promise<StopResult> {
  const { data, error } = await db.rpc("stop_sharing_with_team");
  if (error) return { kind: "error" };
  return { kind: data ? "stopped" : "not_sharing" };
}

// ── A8: the admin's side ────────────────────────────────────────────────────

/** An account and its team share, as an admin sees it. */
export type SupportAccount = {
  id: string;
  name: string;
  email: string;
  /** When their active share started, or null when they are not sharing. */
  sharedSince: string | null;
  /** When their latest past share stopped, or null when none ever did. */
  stoppedAt: string | null;
};

type AccountRow = { profile_id: string; name: string; email: string; shared_since: string | null; stopped_at: string | null };

const ACCOUNT_COLUMNS = "profile_id, name, email, shared_since, stopped_at";

const accountOf = (row: AccountRow): SupportAccount => ({
  id: row.profile_id,
  name: row.name,
  email: row.email,
  sharedSince: row.shared_since,
  stoppedAt: row.stopped_at,
});

/** The accounts (other than the caller, an admin) sharing with the team now. `pageSize` is for tests. */
export async function listSupportAccounts(db: Db, options: PageOptions = {}): Promise<SupportAccount[]> {
  const rows = await keysetRows<AccountRow>(
    (after, limit) => {
      const query = db.rpc("admin_support_researchers").select(ACCOUNT_COLUMNS);
      return (after ? query.gt("profile_id", after.profile_id) : query).order("profile_id").limit(limit);
    },
    "researchers",
    options,
  );
  return rows.map(accountOf);
}

/** One account's name, email and share state (for the calling admin), or null when there is none. */
export async function getSupportAccount(db: Db, profileId: string): Promise<SupportAccount | null> {
  if (!isUuid(profileId)) return null;
  const { data, error } = await db
    .rpc("admin_support_researchers", { p_researcher_id: profileId.toLowerCase() })
    .select(ACCOUNT_COLUMNS)
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
  const rows = await keysetRows<{ id: string; name: string; available: boolean }>(
    (after, limit) => {
      const query = db.rpc("admin_library_peptides").select("id, name, available");
      return (after ? query.gt("id", after.id) : query).order("id").limit(limit);
    },
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
  /** Every mixture, deleted ones included, with every setup version. */
  mixtures: MixtureRecord[];
  deductions: VialDeduction[];
  supplementTracking: boolean;
  routines: Routine[];
  taken: TakenRecord[];
};

/**
 * A researcher's full history for A8, with owner-scoped reads run as the
 * calling admin: RLS returns rows only while the researcher shares, so a
 * read after they stop comes back empty (callers check before and after).
 * Every collection is read a page at a time by key (keyset), never cut at
 * the API's row cap. Business stock, sales and push subscriptions are never
 * read here. `options` is for tests that prove paging.
 */
export async function readResearcherRecords(db: Db, ownerId: string, options: PageOptions = {}): Promise<ResearcherRecords> {
  const [cycles, doses, checkIns, supplyTracking, vials, mixtures, deductions, supplementTracking, routines, taken] = await Promise.all([
    listCycles(db, ownerId, options),
    listDoseRecords(db, ownerId, { pageSize: options.pageSize, afterPage: (page) => options.afterPage?.("recorded doses", page) }),
    listCheckIns(db, ownerId, {}, options.pageSize),
    getSupplyTracking(db, ownerId),
    listPersonalVials(db, ownerId, options),
    listMixtureRecords(db, ownerId, options),
    listDeductions(db, ownerId, { pageSize: options.pageSize }),
    getSupplementTracking(db, ownerId),
    listRoutines(db, ownerId, options.pageSize),
    listTaken(db, ownerId, {}, options.pageSize),
  ]);
  return { cycles, doses, checkIns, supplyTracking, vials, mixtures, deductions, supplementTracking, routines, taken };
}
