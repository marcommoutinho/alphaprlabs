// A11 / D8 People and A12 Researcher history (design v3, V7). Pure: shared
// by the pages and the tests (tests/unit/people.test.ts).
//
// People shows every account's name, email and whether they share their
// history with the team, and the invitations still open, and nothing else:
// a researcher who does not share has no count, cycle or record here.
import { clock12, massLabel, weekdayOf } from "@/lib/alpha/format";
import { adherence, adherenceCount, type Adherence } from "@/lib/cycles/adherence";
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleOccurrences, cycleSpan, cycleStatus } from "@/lib/cycles/schedule";
import type { RecordedConfirmation, ViewPeptides } from "@/lib/cycles/views";
import { formatMonthDay } from "@/lib/format";
import { INVITATION_VALID_DAYS, type InvitationDisplayState, type InvitationRole } from "@/lib/invitations/state";
import { shownMeasurement, type WeightUnit } from "@/lib/preferences/rules";
import { reportedEffects } from "@/lib/progress/screen";
import { FEELING_WORDS } from "@/lib/progress/rules";
import { occurrenceState } from "@/lib/schedule/engine";
import { localDateOf, toInstant, type InstantInput, wallClock, formatLocalTime } from "@/lib/schedule/zone";

export const PEOPLE_TIME_ZONE = "America/Toronto";
const md = (at: string) => formatMonthDay(at, { timeZone: PEOPLE_TIME_ZONE });

export const PEOPLE_PATH = "/admin/people";
export const personPath = (id: string) => `${PEOPLE_PATH}/${id}`;

/** D8's invite card note. */
export const INVITE_NOTE = `Valid for ${INVITATION_VALID_DAYS} days. An invitation gives no access to the person's history; only they can share it.`;

// ── A11 / D8 ────────────────────────────────────────────────────────────────

export type PeopleAccount = {
  id: string;
  name: string;
  email: string;
  role: InvitationRole;
  sharedSince: string | null;
  stoppedAt: string | null;
};

export type PeopleInvite = {
  id: string;
  name: string;
  email: string;
  role: InvitationRole;
  state: InvitationDisplayState;
  sentAt: string;
  expiresAt: string;
};

export type PersonStatus = {
  /** shared: done + eye, opens A12; private: lock; invited: signal-ink; expired: low; failed: missed; admin: ink-2. */
  tone: "shared" | "private" | "invited" | "expired" | "failed" | "admin";
  text: string;
};

export type PeopleRow = {
  key: string;
  kind: "account" | "invite";
  id: string;
  /** The name, or null for an invitation sent without one. */
  name: string | null;
  email: string;
  initials: string;
  status: PersonStatus;
  /** A12, for an account sharing now. */
  historyHref: string | null;
  canResend: boolean;
  you: boolean;
};

export type PeopleView = {
  /** "5 researchers · 3 admins" */
  meta: string;
  researchers: PeopleRow[];
  admins: PeopleRow[];
};

/** "JR" from "Jordan Reyes", "J" from "Jordan", "?" from nothing. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function accountStatus(account: Pick<PeopleAccount, "sharedSince" | "stoppedAt" | "role">): PersonStatus {
  if (account.sharedSince) return { tone: "shared", text: `Shared since ${md(account.sharedSince)}` };
  if (account.role === "admin") return { tone: "admin", text: "Admin" };
  if (account.stoppedAt) return { tone: "private", text: `Private · revoked ${md(account.stoppedAt)}` };
  return { tone: "private", text: "Private" };
}

export function inviteStatus(invite: Pick<PeopleInvite, "state" | "expiresAt">): PersonStatus {
  if (invite.state === "expired") return { tone: "expired", text: `Invite expired ${md(invite.expiresAt)}` };
  if (invite.state === "failed") return { tone: "failed", text: "Invite not sent" };
  return { tone: "invited", text: `Invited · expires ${md(invite.expiresAt)}` };
}

const byName = (a: PeopleRow, b: PeopleRow) =>
  (a.name ?? "").localeCompare(b.name ?? "", "en", { sensitivity: "base" }) || a.email.localeCompare(b.email) || a.id.localeCompare(b.id);

/**
 * A11 / D8: accounts by name, then the invitations still open (pending,
 * expired or failed; an accepted one is its account), newest first, each in
 * its role's group. `selfId` marks the viewing admin.
 */
export function peopleView(accounts: readonly PeopleAccount[], invites: readonly PeopleInvite[], selfId: string): PeopleView {
  const accountRow = (a: PeopleAccount): PeopleRow => ({
    key: `account:${a.id}`,
    kind: "account",
    id: a.id,
    name: a.name,
    email: a.email,
    initials: initials(a.name || a.email),
    status: accountStatus(a),
    historyHref: a.sharedSince && a.id !== selfId ? personPath(a.id) : null,
    canResend: false,
    you: a.id === selfId,
  });
  const open = invites.filter((i) => i.state !== "accepted").sort((a, b) => b.sentAt.localeCompare(a.sentAt) || a.id.localeCompare(b.id));
  const inviteRow = (i: PeopleInvite): PeopleRow => ({
    key: `invite:${i.id}`,
    kind: "invite",
    id: i.id,
    name: i.name.trim() || null,
    email: i.email,
    initials: "",
    status: inviteStatus(i),
    historyHref: null,
    canResend: i.state === "expired" || i.state === "failed",
    you: false,
  });
  const group = (role: InvitationRole) => [
    ...accounts.filter((a) => a.role === role).map(accountRow).sort(byName),
    ...open.filter((i) => i.role === role).map(inviteRow),
  ];
  const researchers = group("researcher");
  const admins = group("admin");
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return { meta: `${count(researchers.length, "researcher")} · ${count(admins.length, "admin")}`, researchers, admins };
}

// ── A12 ─────────────────────────────────────────────────────────────────────

/** The denied state (A12 without a share now), naming only the person. */
export const deniedHistory = (name: string) => `${firstName(name)} hasn't shared their history. Only they can turn it on, from Me.`;

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim() || "This researcher";

/** The pinned band: "Read-only · shared by Jordan on Sep 10". */
export const sharedBanner = (name: string, sharedSince: string) => `Read-only · shared by ${firstName(name)} on ${md(sharedSince)}`;

export type RecentRow = {
  key: string;
  /** done: taken; skipped; missed: not logged; check-in: the feeling's number. */
  kind: "done" | "skipped" | "missed" | "check-in";
  title: string;
  /** The title's trailing words in the row's tone ("· Not logged"), or "". */
  flag: string;
  sub: string;
  feeling?: number;
  /** For ordering: when it happened or was planned (ISO). */
  at: string;
};

export type HistoryNow = {
  /** "Adherence this cycle", or "Last 30 days" between cycles. */
  label: string;
  /** "51 of 53", or "" with no cycle. */
  count: string;
  /** "96", or "—". */
  percent: string;
  feeling: string | null;
  weight: { value: string; unit: string } | null;
  effectDays: number;
};

export type ResearcherHistory = {
  banner: string;
  name: string;
  /** "Recovery protocol · day 24 of 84", "… · starts Oct 1", "… · ended Sep 24", or "No cycle running". */
  sub: string;
  now: HistoryNow;
  recent: RecentRow[];
};

export type HistoryInput = {
  name: string;
  sharedSince: string;
  cycles: readonly CycleRecord[];
  confirmations: ReadonlyMap<string, readonly RecordedConfirmation[]>;
  checkIns: readonly {
    id: string;
    day: string;
    feeling: number;
    effects: string[];
    effectsOther: string;
    note: string;
    measurement: { name: string; value: string; unit: string } | null;
    createdAt: string;
  }[];
  peptides: ViewPeptides;
  /** The viewing admin's weight unit: weights are shown in it, converted exactly. */
  weightUnit: WeightUnit;
  now: InstantInput;
  /** How many recent rows to show. */
  limit?: number;
};

const current = (cycle: CycleRecord) => cycle.revisions[cycle.revisions.length - 1];

/** The cycle A12 reads from: the newest running one, else the newest that has started, else the next. */
function focusCycle(cycles: readonly CycleRecord[], now: InstantInput): CycleRecord | null {
  const withPlans = cycles.filter((c) => current(c).plans.length > 0);
  const running = withPlans.find((c) => ["Active", "In break"].includes(cycleStatus(current(c), now)));
  return running ?? withPlans.find((c) => cycleStatus(current(c), now) === "Ended") ?? withPlans[0] ?? null;
}

function cycleSub(cycle: CycleRecord | null, now: InstantInput): string {
  if (!cycle) return "No cycle running";
  const revision = current(cycle);
  const { start, end } = cycleSpan(revision);
  const today = localDateOf(now, revision.timeZone);
  const status = cycleStatus(revision, now);
  if (status === "Upcoming") return `${cycle.name} · starts ${formatMonthDay(start)}`;
  if (status === "Ended") return `${cycle.name} · ended ${formatMonthDay(end)}`;
  const day = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  return `${cycle.name} · day ${day(start, today) + 1} of ${day(start, end) + 1}`;
}

const planPeptides = (cycle: CycleRecord) => new Map(cycle.revisions.flatMap((r) => r.plans.map((p) => [p.planId, p.peptideId] as const)));

const wallOf = (at: string, timeZone: string) => {
  const wall = wallClock(toInstant(at), timeZone);
  return { date: `${String(wall.year).padStart(4, "0")}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`, time: formatLocalTime(wall) };
};

const dayText = (date: string) => `${weekdayOf(date)} ${formatMonthDay(date)}`;

/** A12, read-only, as of `now`: the band, the Now block and the recent doses and check-ins, newest first. */
export function researcherHistory(input: HistoryInput): ResearcherHistory {
  const cycle = focusCycle(input.cycles, input.now);
  const nowMs = toInstant(input.now).epochMilliseconds;
  const today = localDateOf(input.now, PEOPLE_TIME_ZONE);
  const recent: RecentRow[] = [];

  // Adherence this cycle (V2's computation), and the doses of every cycle for Recent.
  let stats: Adherence | null = null;
  for (const c of input.cycles) {
    const revision = current(c);
    const confirmations = input.confirmations.get(c.id) ?? [];
    const occurrences = cycleOccurrences(c.revisions, confirmations);
    if (cycle && c.id === cycle.id) {
      const { start } = cycleSpan(revision);
      stats = adherence(occurrences.filter((o) => o.localDate >= start), input.now);
    }
    const peptideOf = planPeptides(c);
    const recorded = new Map(confirmations.map((conf) => [conf.key, conf]));
    for (const o of occurrences) {
      if (Date.parse(o.scheduledAt) > nowMs) continue;
      const state = occurrenceState(o, input.now);
      if (state !== "taken" && state !== "skipped" && state !== "open") continue;
      const peptide = input.peptides.get(peptideOf.get(o.planId) ?? "")?.name ?? "Unknown peptide";
      const planned = `${dayText(o.localDate)} · planned ${clock12(o.localTime)}`;
      if (state === "taken") {
        const conf = recorded.get(o.key);
        const at = o.actualAt ?? o.scheduledAt;
        const wall = wallOf(at, o.timeZone);
        const amount = conf?.amountMg ?? o.doseMg;
        recent.push({
          key: `dose:${o.key}`,
          kind: "done",
          title: `${peptide} · ${massLabel(amount)}`,
          flag: "",
          sub: [`${dayText(wall.date)} · ${clock12(wall.time)}`, conf?.site ?? ""].filter(Boolean).join(" · "),
          at,
        });
      } else {
        recent.push({
          key: `dose:${o.key}`,
          kind: state === "skipped" ? "skipped" : "missed",
          title: `${peptide} · ${massLabel(o.doseMg)}`,
          flag: state === "skipped" ? "· Skipped" : "· Not logged",
          sub: planned,
          at: o.scheduledAt,
        });
      }
    }
  }

  // Check-ins: feeling, effects and weight (in the viewing admin's unit).
  const shown = input.checkIns.map((c) => ({ ...c, measurement: c.measurement ? shownMeasurement(c.measurement, input.weightUnit) : null }));
  for (const c of shown) {
    const effects = reportedEffects(c);
    const parts = [dayText(c.day), effects.length ? effects.join(", ").toLowerCase() : "", c.measurement ? `${c.measurement.value} ${c.measurement.unit}` : ""];
    recent.push({
      key: `check-in:${c.id}`,
      kind: "check-in",
      title: `Check-in · ${FEELING_WORDS[c.feeling] ?? c.feeling}`,
      flag: "",
      sub: parts.filter(Boolean).join(" · "),
      feeling: c.feeling,
      // A check-in covers its whole day: order it at the day's end (or when saved, if earlier).
      at: c.day < today ? `${c.day}T23:59:59Z` : c.createdAt,
    });
  }
  recent.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));

  // The Now block's readings over the cycle so far (between cycles, the last 30 days).
  const from = cycle ? cycleSpan(current(cycle)).start : addDays(today, -29);
  const window = shown.filter((c) => c.day >= from && c.day <= today);
  const feelings = window.map((c) => c.feeling);
  const feeling = feelings.length ? (Math.round((feelings.reduce((a, b) => a + b, 0) / feelings.length) * 10) / 10).toFixed(1) : null;
  const weights = window.filter((c) => c.measurement?.name === "Weight").sort((a, b) => a.day.localeCompare(b.day));
  const latest = weights.at(-1)?.measurement ?? null;

  return {
    banner: sharedBanner(input.name, input.sharedSince),
    name: input.name,
    sub: cycleSub(cycle, input.now),
    now: {
      label: cycle ? "Adherence this cycle" : "Last 30 days",
      count: stats ? adherenceCount(stats, false) : "",
      percent: stats?.percent === null || !stats ? "—" : String(stats.percent),
      feeling,
      weight: latest ? { value: latest.value, unit: latest.unit } : null,
      effectDays: window.filter((c) => reportedEffects(c).length > 0).length,
    },
    recent: recent.slice(0, input.limit ?? 12),
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
