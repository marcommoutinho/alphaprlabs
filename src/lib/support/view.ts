// R11 Me's support access and A8 Researcher support / history: what the
// screens show (handoff docs/design/research-app README.md "A8 Researcher
// support", "A8 Researcher history (read-only)" and "R11 Me"; the
// prototype's `me`, `asup` and `ar` views). Pure: built from the grant rows
// and the records the admin read under RLS, and shared by the screens and the
// tests. Times are America/Toronto (the business is local) except a dose's,
// which is shown in its own occurrence's zone, as everywhere else.
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleOccurrences, cycleSpan, cycleStatus, type CycleStatus } from "@/lib/cycles/schedule";
import { planPeptides } from "@/lib/cycles/views";
import { formatDate, formatDateTime, formatDay, formatMonthDay } from "@/lib/format";
import { type Mixture, mixtureLabel } from "@/lib/mixtures/rules";
import { effectsLine } from "@/lib/progress/rules";
import type { Confirmation } from "@/lib/schedule/engine";
import type { InstantInput } from "@/lib/schedule/zone";
import { mgLabel, vialEstimate } from "@/lib/supplies/estimate";
import { todayIn } from "@/lib/supplements/schedule";

/** Grant times are shown in the business's zone. */
export const SUPPORT_TIME_ZONE = "America/Toronto";
const when = (at: string) => formatDateTime(at, { timeZone: SUPPORT_TIME_ZONE });

// ── Copy ────────────────────────────────────────────────────────────────────

export const SUPPORT_INTRO =
  "Your history is private by default. You can let a named admin read your full profile history — cycles, doses, check-ins, measurements, supplies and supplement records — to help with support. Read-only: they cannot edit anything. It lasts until you revoke it.";
export const GRANT_POINTS = [
  "Covers your full profile history, not a single cycle.",
  "Read-only — nothing can be edited, added or deleted.",
  "Lasts until you revoke it here. No automatic expiry.",
] as const;
export const REVOKE_POINTS = [
  "They lose access to your history from their next page or request.",
  "Nothing in your history changes.",
  "You can grant access again later; it starts a new grant.",
] as const;
export const NO_ADMINS = "There is no other admin to grant access to.";
export const CHOOSE_ADMIN = "Choose an admin.";
export const GRANT_REFUSED = "That admin can't be granted access. Reload the page and choose again.";
export const ALREADY_REVOKED = "That access had already ended. Your history is private.";
export const grantedToast = (name: string) => `${name} can now read your history. Revoke any time.`;
export const revokedToast = (name: string) => `Access revoked. ${name} can no longer open your history.`;
export const NOT_ADMIN_NOTE = "no longer an admin, so this grant reads nothing";

export const A8_INTRO =
  "You can only open a researcher's history after they grant you access from their profile. Access is read-only and ends the moment they revoke it. No editing, messaging or shared workspace.";
export const A8_NONE = "No researcher has granted you access. Ask them to grant it under Me → Support access.";

// ── R11 Me ──────────────────────────────────────────────────────────────────

export type GrantRow = { id: string; adminId: string; adminName: string; stillAdmin: boolean; grantedAt: string; revokedAt: string | null };

export type ActiveGrant = { adminId: string; adminName: string; since: string; note: string };

export type MeSupport = {
  /** One card per admin who can read the history now. */
  active: ActiveGrant[];
  /** Admins without an active grant, who may be granted one. */
  grantable: { id: string; name: string }[];
  /** "Previously: Marco Sep 1, 2026 – Sep 10, 2026; …", or "". */
  past: string;
};

/** R11's support section from the admins that may be chosen and the caller's grants. */
export function meSupport(admins: readonly { id: string; name: string }[], grants: readonly GrantRow[]): MeSupport {
  const active = grants.filter((g) => g.revokedAt === null).sort((a, b) => a.adminName.localeCompare(b.adminName));
  const holding = new Set(active.map((g) => g.adminId));
  const past = grants
    .filter((g) => g.revokedAt !== null)
    .sort((a, b) => Date.parse(b.grantedAt) - Date.parse(a.grantedAt) || b.id.localeCompare(a.id));
  const day = (at: string) => formatDate(at, { timeZone: SUPPORT_TIME_ZONE });
  return {
    active: active.map((g) => ({
      adminId: g.adminId,
      adminName: g.adminName,
      since: `Granted ${when(g.grantedAt)} · full profile history · until you revoke`,
      note: g.stillAdmin ? "" : NOT_ADMIN_NOTE,
    })),
    grantable: admins.filter((a) => !holding.has(a.id)).map((a) => ({ id: a.id, name: a.name })),
    past: past.length ? `Previously: ${past.map((g) => `${g.adminName} ${day(g.grantedAt)} – ${day(g.revokedAt!)}`).join("; ")}` : "",
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Me's "Personal supplies" line: the open vials while tracking is on, else "Off". */
export const suppliesSummary = (tracking: boolean, openVials: number) => (tracking ? plural(openVials, "vial") : "Off");

/** Me's "Supplement routines" line: routines still running (an end date today or later), else "Off". */
export function supplementsSummary(tracking: boolean, routines: readonly { endDate: string | null }[], now: InstantInput): string {
  if (!tracking) return "Off";
  const today = todayIn(now, SUPPORT_TIME_ZONE);
  return plural(routines.filter((r) => r.endDate === null || r.endDate >= today).length, "routine");
}

// ── A8 Researcher support ───────────────────────────────────────────────────

export type AccountState = { id: string; name: string; email: string; grantedAt: string | null; revokedAt: string | null };

export type Access = "granted" | "revoked" | "none";

export const accessOf = (account: Pick<AccountState, "grantedAt" | "revokedAt">): Access =>
  account.grantedAt ? "granted" : account.revokedAt ? "revoked" : "none";

export type SupportRow = { id: string; name: string; email: string; access: Access; state: string; sub: string };

const STATE: Record<Access, string> = { granted: "Access granted", revoked: "Revoked", none: "No access" };
const ORDER: Record<Access, number> = { granted: 0, revoked: 1, none: 2 };

/** A8's rows: granted first, then revoked, then the rest, each by name. */
export function supportRows(accounts: readonly AccountState[]): SupportRow[] {
  return accounts
    .map((a) => {
      const access = accessOf(a);
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        access,
        state: STATE[access],
        sub:
          access === "granted"
            ? `Read-only since ${when(a.grantedAt!)}`
            : access === "revoked"
              ? `Revoked ${when(a.revokedAt!)} — opening will be denied`
              : "They haven't granted access",
      };
    })
    .sort((a, b) => ORDER[a.access] - ORDER[b.access] || a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

/** The denied state's body for an account without an active grant. */
export const deniedText = (account: AccountState) =>
  account.revokedAt
    ? `${account.name} revoked your access on ${when(account.revokedAt)}. Their history is private again; you'd need a new grant from them.`
    : `${account.name} hasn't shared their history with you. Only they can grant access, from their own profile.`;

/** The granted header: "Read-only · granted Fri Sep 11 · 07:30". */
export const grantedLabel = (grantedAt: string) => `Read-only · granted ${when(grantedAt)}`;

// ── A8 Researcher history ───────────────────────────────────────────────────

/** How many of each list the history shows before "Show full history" (the prototype's). */
export const RECENT = { doses: 8, checkIns: 6, measurements: 6, taken: 8 } as const;

export type HistoryInput = {
  cycles: readonly CycleRecord[];
  /** Recorded doses (dose_records). */
  doses: readonly { id: string; cycleId: string; planId: string; occurrenceKey: string; actualAt: string; amountMg: string }[];
  confirmations: ReadonlyMap<string, readonly Confirmation[]>;
  checkIns: readonly {
    id: string;
    day: string;
    feeling: number;
    effects: readonly string[];
    note: string;
    measurement: { name: string; value: string; unit: string } | null;
  }[];
  supplyTracking: boolean;
  vials: readonly { id: string; peptideId: string; label: string; strengthMg: string; finishedAt: string | null }[];
  mixtures: readonly Mixture[];
  deductions: readonly { vialId: string; amountMg: string }[];
  supplementTracking: boolean;
  routines: readonly { id: string; name: string; amount: string; unit: string; time: string; endDate: string | null }[];
  taken: readonly { id: string; name: string; amount: string; unit: string; actualAt: string }[];
  /** Every library peptide's name, withdrawn ones included (the admin path). */
  peptides: ReadonlyMap<string, { name: string }>;
  now: InstantInput;
  /** Every record rather than the recent ones. */
  full: boolean;
};

export type HistoryCycle = { id: string; name: string; status: CycleStatus; dates: string; peptides: string; goal: string };
export type HistoryDose = { id: string; peptide: string; mg: string; time: string };
export type HistoryCheckIn = { id: string; date: string; feeling: number; effects: string; note: string };

export type HistoryView = {
  cycles: HistoryCycle[];
  doses: HistoryDose[];
  checkIns: HistoryCheckIn[];
  /** "Measurements: Weight 82.4 kg (Sep 26) · …", or "". */
  measures: string;
  supplies: string;
  mixtures: string;
  supplements: string;
  taken: { id: string; line: string; time: string }[];
  /** Some list shows only its most recent records. */
  cut: boolean;
  counts: { doses: number; checkIns: number; taken: number };
};

const newestFirst = <T>(rows: readonly T[], at: (row: T) => string, id: (row: T) => string) =>
  [...rows].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)) || id(b).localeCompare(id(a)));

/** Everything A8's four cards show (read-only; nothing here links to a write). */
export function historyView(input: HistoryInput): HistoryView {
  const nameOf = (peptideId: string | undefined) => (peptideId && input.peptides.get(peptideId)?.name) || "Unknown peptide";
  const take = <T>(rows: T[], n: number) => (input.full ? rows : rows.slice(0, n));

  const cycles = input.cycles.map((cycle): HistoryCycle => {
    const current = cycle.revisions[cycle.revisions.length - 1];
    const span = cycleSpan(current);
    return {
      id: cycle.id,
      name: cycle.name,
      status: cycleStatus(current, input.now),
      dates: `${formatMonthDay(span.start)} – ${formatDate(span.end)}`,
      peptides: current.plans.map((plan) => nameOf(plan.peptideId)).join(" + "),
      goal: cycle.goal || "—",
    };
  });

  // Each dose in its own occurrence's zone (a cycle that moved zones keeps earlier doses in theirs).
  const byId = new Map(input.cycles.map((c) => [c.id, c]));
  const zones = new Map<string, Map<string, string>>();
  const zoneOf = (cycleId: string, key: string): string => {
    const cycle = byId.get(cycleId);
    let byKey = zones.get(cycleId);
    if (!byKey) {
      byKey = new Map(cycle ? cycleOccurrences(cycle.revisions, input.confirmations.get(cycleId) ?? []).map((o) => [o.key, o.timeZone]) : []);
      zones.set(cycleId, byKey);
    }
    return byKey.get(key) ?? cycle?.revisions.at(-1)?.timeZone ?? SUPPORT_TIME_ZONE;
  };
  const planPeptide = new Map(input.cycles.flatMap((c) => [...planPeptides(c)]));
  const doses = newestFirst(input.doses, (d) => d.actualAt, (d) => d.id).map((d) => ({
    id: d.id,
    peptide: nameOf(planPeptide.get(d.planId)),
    mg: mgLabel(d.amountMg),
    time: formatDateTime(d.actualAt, { timeZone: zoneOf(d.cycleId, d.occurrenceKey) }),
  }));

  const checkIns = [...input.checkIns].sort((a, b) => b.day.localeCompare(a.day));
  const measured = checkIns.filter((c) => c.measurement);
  const measures = take(measured, RECENT.measurements)
    .map((c) => `${c.measurement!.name} ${c.measurement!.value} ${c.measurement!.unit} (${formatMonthDay(c.day)})`)
    .join(" · ");

  const byVial = new Map<string, { amountMg: string }[]>();
  for (const d of input.deductions) byVial.set(d.vialId, [...(byVial.get(d.vialId) ?? []), d]);
  const vialLine = (v: HistoryInput["vials"][number]) => {
    const head = `${v.label} · ${nameOf(v.peptideId)} ${mgLabel(v.strengthMg)}`;
    if (v.finishedAt) return `${head} · finished ${formatDate(v.finishedAt, { timeZone: SUPPORT_TIME_ZONE })}`;
    const estimate = vialEstimate(v.strengthMg, byVial.get(v.id) ?? []);
    return estimate.state === "over"
      ? `${head} · est. 0 mg left (${mgLabel(estimate.overMg!)} over)`
      : `${head} · est. ${mgLabel(estimate.remainingMg)} left`;
  };
  const vials = [...input.vials.filter((v) => !v.finishedAt), ...input.vials.filter((v) => v.finishedAt)];
  const supplies = vials.length
    ? `${input.supplyTracking ? "Supplies tracked" : "Supplies tracking is off. Vials kept"}: ${vials.map(vialLine).join("; ")}`
    : input.supplyTracking
      ? "Supplies tracking is on but no vials are recorded."
      : "Personal supplies: optional feature not used.";
  const mixtures = input.mixtures.length
    ? `Saved mixtures: ${input.mixtures.map((m) => mixtureLabel(nameOf(m.peptideId), m.setup)).join("; ")}`
    : "";

  const routine = (r: HistoryInput["routines"][number]) =>
    `${r.name} ${r.amount} ${r.unit} daily ${r.time}${r.endDate ? ` (ended ${formatDate(r.endDate)})` : ""}`;
  const supplements = input.routines.length
    ? `${input.supplementTracking ? "Supplement routines" : "Supplement tracking is off. Routines kept"}: ${input.routines.map(routine).join("; ")}`
    : input.supplementTracking
      ? "Supplement tracking is on but no routines exist."
      : "Supplement routines: optional feature not used.";
  const taken = newestFirst(input.taken, (t) => t.actualAt, (t) => t.id).map((t) => ({
    id: t.id,
    line: `${t.name} · ${t.amount} ${t.unit}`,
    time: when(t.actualAt),
  }));

  return {
    cycles,
    doses: take(doses, RECENT.doses),
    checkIns: take(checkIns, RECENT.checkIns).map((c) => ({
      id: c.id,
      date: formatDay(c.day),
      feeling: c.feeling,
      effects: effectsLine(c.effects),
      note: c.note,
    })),
    measures: measures ? `Measurements: ${measures}` : "",
    supplies,
    mixtures,
    supplements,
    taken: take(taken, RECENT.taken),
    cut:
      !input.full &&
      (doses.length > RECENT.doses || checkIns.length > RECENT.checkIns || measured.length > RECENT.measurements || taken.length > RECENT.taken),
    counts: { doses: doses.length, checkIns: checkIns.length, taken: taken.length },
  };
}
