// R11 Me's support access and A8 Researcher support / history: what the
// screens show (handoff docs/design/research-app README.md "A8 Researcher
// support", "A8 Researcher history (read-only)" and "R11 Me"; the
// prototype's `me`, `asup` and `ar` views), with Marco's simplification
// (2026-09-27): a researcher shares with the whole Alpha PR Labs team, never
// with a chosen admin, and a researcher never sees which admin reads. Pure:
// built from the share rows and the records the admin read under RLS, and
// shared by the screens and the tests. Times are America/Toronto (the
// business is local) except a dose's, which is shown in its own occurrence's
// zone, as everywhere else.
import { SYRINGE_LABEL } from "@/lib/calculator/calculator";
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleOccurrences, cycleSpan, cycleStatus, type CycleStatus } from "@/lib/cycles/schedule";
import { planPeptides } from "@/lib/cycles/views";
import { formatDate, formatDateTime, formatDay, formatMonthDay } from "@/lib/format";
import { type MixtureSetup, mixtureLabel } from "@/lib/mixtures/rules";
import { effectsLine } from "@/lib/progress/rules";
import type { Confirmation } from "@/lib/schedule/engine";
import type { InstantInput } from "@/lib/schedule/zone";
import { mgLabel, vialEstimate } from "@/lib/supplies/estimate";
import { todayIn } from "@/lib/supplements/schedule";

/** Share times are shown in the business's zone. */
export const SUPPORT_TIME_ZONE = "America/Toronto";
const when = (at: string) => formatDateTime(at, { timeZone: SUPPORT_TIME_ZONE });
const dayOf = (at: string) => formatDate(at, { timeZone: SUPPORT_TIME_ZONE });

// ── Copy ────────────────────────────────────────────────────────────────────

export const TEAM = "the Alpha PR Labs team";

export const SUPPORT_INTRO =
  "Your history is private by default. You can share your full profile history — cycles, doses, check-ins, measurements, supplies and supplement records — with the Alpha PR Labs team to help with support. Read-only: they cannot edit anything. It lasts until you stop sharing.";
export const SHARE_BUTTON = "Share with the Alpha PR Labs team";
export const SHARE_QUESTION = "Share your history with the Alpha PR Labs team?";
export const SHARE_POINTS = [
  "Every Alpha PR Labs admin can read it, including admins added later.",
  "Covers your full profile history, not a single cycle.",
  "Read-only — nothing can be edited, added or deleted.",
  "Lasts until you stop sharing here. No automatic expiry.",
] as const;
export const STOP_QUESTION = "Stop sharing your history?";
export const STOP_POINTS = [
  "The team loses access to your history from their next page or request.",
  "Nothing in your history changes.",
  "You can share again later; it starts a new share.",
] as const;
export const SHARED_TOAST = "Your history is shared with the Alpha PR Labs team. Stop sharing any time.";
export const STOPPED_TOAST = "Sharing stopped. The team can no longer open your history.";
export const ALREADY_STOPPED = "Sharing had already stopped. Your history is private.";

export const A8_INTRO =
  "Researchers who share their history with the Alpha PR Labs team appear here. Access is read-only and ends the moment they stop sharing. No editing, messaging or shared workspace.";
export const A8_NONE = "No researcher has shared their history with the team. They can share it under Me → Support access.";

// ── R11 Me ──────────────────────────────────────────────────────────────────

export type ShareRow = { id: string; startedAt: string; stoppedAt: string | null };

export type MeSupport = {
  /** "Shared since Fri Sep 11 · 07:30 · full profile history · until you stop", or null when private. */
  sharedSince: string | null;
  /** "Previously: shared Sep 1, 2026 – Sep 10, 2026; …", or "". */
  past: string;
};

/** R11's support section from the caller's own shares. Names no admin: the team reads, not a person. */
export function meSupport(shares: readonly ShareRow[]): MeSupport {
  const active = shares.find((s) => s.stoppedAt === null) ?? null;
  const past = shares
    .filter((s) => s.stoppedAt !== null)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id));
  return {
    sharedSince: active ? `Shared since ${when(active.startedAt)} · full profile history · until you stop` : null,
    past: past.length ? `Previously: ${past.map((s) => `shared ${dayOf(s.startedAt)} – ${dayOf(s.stoppedAt!)}`).join("; ")}` : "",
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

export type AccountState = { id: string; name: string; email: string; sharedSince: string | null; stoppedAt: string | null };

export type SupportRow = { id: string; name: string; email: string; sub: string };

/** A8's rows: the accounts sharing now, by name. */
export function supportRows(accounts: readonly AccountState[]): SupportRow[] {
  return accounts
    .filter((a) => a.sharedSince !== null)
    .map((a) => ({ id: a.id, name: a.name, email: a.email, sub: `Read-only since ${when(a.sharedSince!)}` }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

/** The denied state's body for an account not sharing now (stopped, or never shared). */
export const deniedText = (account: AccountState) =>
  account.stoppedAt
    ? `${account.name} stopped sharing their history on ${when(account.stoppedAt)}. It's private again; only they can share it again, from their own profile.`
    : `${account.name} hasn't shared their history with the team. Only they can share it, from their own profile.`;

/** The shared header: "Read-only · shared Fri Sep 11 · 07:30". */
export const sharedLabel = (sharedSince: string) => `Read-only · shared ${when(sharedSince)}`;

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
    /** As stored (v3 chips or the earlier ones), with "Other"'s text ("" when none). */
    effects: readonly string[];
    effectsOther?: string;
    note: string;
    measurement: { name: string; value: string; unit: string } | null;
  }[];
  supplyTracking: boolean;
  vials: readonly { id: string; peptideId: string; label: string; strengthMg: string; finishedAt: string | null }[];
  /** Every mixture ever saved, deleted ones included, with every setup version. */
  mixtures: readonly {
    id: string;
    peptideId: string;
    createdAt: string;
    deletedAt: string | null;
    currentVersion: number;
    versions: readonly { id: string; number: number; setup: MixtureSetup; createdAt: string }[];
  }[];
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
/** A saved mixture: its setup now (or when deleted), its state, and every setup it had with its date. */
export type HistoryMixture = { id: string; title: string; state: string; deleted: boolean; versions: { id: string; line: string }[] };

export type HistoryView = {
  cycles: HistoryCycle[];
  doses: HistoryDose[];
  checkIns: HistoryCheckIn[];
  /** "Measurements: Weight 82.4 kg (Sep 26) · …", or "". */
  measures: string;
  supplies: string;
  /** Every mixture record, oldest first (never cut: a short list). */
  mixtures: HistoryMixture[];
  supplements: string;
  taken: { id: string; line: string; time: string }[];
  /** Some list shows only its most recent records. */
  cut: boolean;
  counts: { doses: number; checkIns: number; taken: number };
};

const newestFirst = <T>(rows: readonly T[], at: (row: T) => string, id: (row: T) => string) =>
  [...rows].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)) || id(b).localeCompare(id(a)));

/** A8's mixture records: the current (or last) setup, saved or deleted, and each version with the date it took effect. */
export function mixtureHistory(mixtures: HistoryInput["mixtures"], nameOf: (peptideId: string) => string): HistoryMixture[] {
  return mixtures.map((m) => {
    const versions = [...m.versions].sort((a, b) => a.number - b.number);
    const current = versions.find((v) => v.number === m.currentVersion) ?? versions.at(-1);
    const name = nameOf(m.peptideId);
    return {
      id: m.id,
      title: current ? mixtureLabel(name, current.setup) : name,
      deleted: m.deletedAt !== null,
      state: m.deletedAt ? `saved ${dayOf(m.createdAt)} · deleted ${dayOf(m.deletedAt)}` : `saved ${dayOf(m.createdAt)}`,
      versions: versions.map((v) => ({
        id: v.id,
        line: `Setup ${v.number} · ${v.setup.vialMg} mg / ${v.setup.liquidMl} mL · ${SYRINGE_LABEL[v.setup.syringe]} syringe · from ${when(v.createdAt)}`,
      })),
    };
  });
}

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
    if (v.finishedAt) return `${head} · finished ${dayOf(v.finishedAt)}`;
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

  // A planned end still ahead (R13) reads as one.
  const supportToday = todayIn(input.now, SUPPORT_TIME_ZONE);
  const routine = (r: HistoryInput["routines"][number]) =>
    `${r.name} ${r.amount} ${r.unit} daily ${r.time}${r.endDate ? ` (${r.endDate > supportToday ? "ends" : "ended"} ${formatDate(r.endDate)})` : ""}`;
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
      effects: effectsLine(c.effects, c.effectsOther),
      note: c.note,
    })),
    measures: measures ? `Measurements: ${measures}` : "",
    supplies,
    mixtures: mixtureHistory(input.mixtures, nameOf),
    supplements,
    taken: take(taken, RECENT.taken),
    cut:
      !input.full &&
      (doses.length > RECENT.doses || checkIns.length > RECENT.checkIns || measured.length > RECENT.measurements || taken.length > RECENT.taken),
    counts: { doses: doses.length, checkIns: checkIns.length, taken: taken.length },
  };
}
