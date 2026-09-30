// S13 reminder rules (plan "Reminder delivery design"; Marco's decisions of
// 2026-09-26 and 2026-09-30): whether a queued reminder still goes out at
// send time, how long the push service may hold it, what it opens and which
// earlier notification it replaces, and which failures are retried. Pure
// (the clock is passed in), shared by the dispatcher and its tests.
//
// Reminder timing itself is the schedule's (src/lib/schedule/reminders.ts):
// a reminder when due (skipped when more than 15 minutes late), one
// follow-up an hour later (the last one for that dose; it still goes out
// while relevant), and none once the dose is logged or skipped, the phase has
// ended or the plan's next dose has become due (Occurrence.remindersStopAt).
//
// The heads-up (Marco, 2026-09-30): one per owner and planned instant, the
// owner's lead (Advance heads-up: 15 by default, 30 or 60 minutes; Off sends
// none) before it, grouping every dose planned at that time. Doses only:
// supplements get none. It is skipped once the time has come or it is more
// than 15 minutes late, when every dose in the group is logged or skipped,
// or when the setting has changed since it was planned.
import { createHash } from "node:crypto";
import type { HeadsUpMinutes } from "@/lib/preferences/rules";
import type { Occurrence } from "@/lib/schedule/engine";
import { DEFAULT_REMINDER_GRACE_MINUTES, type ReminderKind, REMINDER_OFFSETS, reminderToSend } from "@/lib/schedule/reminders";

export type ReminderSource = "dose" | "heads-up" | "supplement";

/** reminder_jobs.kind: a dose's reminders, or the heads-up before a planned time. */
export type JobKind = ReminderKind | "heads-up";

/**
 * The send on/off control. Off unless REMINDERS_ENABLED is exactly "true",
 * so an environment without it (production until Main turns it on) sends
 * nothing. The test notification (PUSH_TEST_ENABLED) is separate.
 */
export const remindersEnabled = (env: Readonly<Record<string, string | undefined>> = process.env) => env.REMINDERS_ENABLED === "true";

/** Where a dose reminder opens: Today with that dose's sheet (src/app/(private)/app/today/page.tsx). */
export const doseReminderUrl = (occurrenceKey: string) => `/app/today?dose=${encodeURIComponent(occurrenceKey)}`;

/** Supplements have no deep link of their own: Today lists today's routines, each with its Taken. */
export const SUPPLEMENT_REMINDER_URL = "/app/today";

/**
 * One notification per occurrence (public/sw.js replaces a notification with
 * the same tag): "dose:<occurrence key>" or "supplement:<occurrence key>". A
 * dose's due reminder, then its follow-up, replace each other.
 */
export const reminderTag = (source: "dose" | "supplement", occurrenceKey: string) => `${source}:${occurrenceKey}`;

/**
 * A heads-up's tag: the tag of the first dose it names, in Today's order
 * (headsUpDoses), so that dose's due reminder replaces the heads-up on the
 * phone, and its topic replaces a heads-up the push service still holds. The
 * group's other doses get their own due reminders under their own tags. A
 * heads-up has no tag of its own: one per planned instant, it always leads
 * into a due reminder.
 */
export const headsUpTag = (doses: readonly Pick<Occurrence, "key">[]) => reminderTag("dose", doses[0].key);

/** Where a heads-up opens: that dose's sheet when it names one dose, else Today. */
export const headsUpUrl = (doses: readonly Pick<Occurrence, "key">[]) => (doses.length === 1 ? doseReminderUrl(doses[0].key) : "/app/today");

/**
 * The Web Push topic for a tag (≤ 32 URL-safe characters): a newer reminder
 * with the same tag replaces an earlier one that the push service has not
 * delivered yet.
 */
export const reminderTopic = (tag: string) => createHash("sha256").update(tag).digest("base64url").slice(0, 32);

const MINUTE = 60_000;

/** Supplement reminders (and a dose's last follow-up) stay relevant this long after their time. */
export const LAST_REMINDER_RELEVANCE_MINUTES = 120;

/**
 * Seconds the push service may keep an undelivered reminder (a phone that is
 * off or offline): a heads-up until the planned time (the due reminder takes
 * over); a dose reminder until its next reminder takes over (its topic
 * replaces this one), or LAST_REMINDER_RELEVANCE_MINUTES after the last one;
 * never past the time its reminders stop. At least a minute.
 */
export function reminderTtlSeconds(
  reminder: { source: ReminderSource; kind: JobKind; sendAt: string; occurrenceAt?: string; stopAt?: string | null },
  now: Date | string,
): number {
  const sendMs = Date.parse(reminder.sendAt);
  let until: number;
  if (reminder.kind === "heads-up") {
    until = Date.parse(reminder.occurrenceAt ?? reminder.sendAt);
  } else {
    const offsets = REMINDER_OFFSETS.map((o) => o.minutes);
    const own = REMINDER_OFFSETS.find((o) => o.kind === reminder.kind)?.minutes ?? 0;
    const next = reminder.source === "dose" ? offsets.find((minutes) => minutes > own) : undefined;
    until = sendMs + (next !== undefined ? next - own : LAST_REMINDER_RELEVANCE_MINUTES) * MINUTE;
  }
  if (reminder.stopAt) until = Math.min(until, Date.parse(reminder.stopAt));
  return Math.max(60, Math.floor((until - new Date(now).getTime()) / 1000));
}

/** Why a queued reminder was not sent (reminder_jobs.result). */
export type Suppression =
  | "terms outdated"
  | "device off"
  | "occurrence gone"
  | "occurrence moved"
  | "logged"
  | "skipped"
  | "cycle ended"
  | "stopped"
  | "superseded"
  | "late"
  | "setting changed"
  /** The subscription is no longer the owner's, active, the same endpoint and keys it was claimed with, or its device's newest (another account took the device over). */
  | "device changed";

export type Verdict = { send: true } | { send: false; reason: Suppression };

export type DoseJob = { kind: ReminderKind; occurrenceKey: string; occurrenceAt: string };

/**
 * A dose reminder at send time, from the owner's current records: the
 * occurrence must still exist at the time it was queued for (an edit that
 * moved or removed it makes the job stale; a moved dose has its own jobs),
 * be neither logged nor skipped, belong to a plan still in its cycle that
 * has not ended, and this must be the reminder that is current now.
 */
export function doseVerdict(
  job: DoseJob,
  occurrence: Occurrence | undefined,
  plan: { inCurrentRevision: boolean; cycleEnded: boolean },
  now: Date | string,
): Verdict {
  if (!occurrence) return { send: false, reason: "occurrence gone" };
  if (Date.parse(occurrence.scheduledAt) !== Date.parse(job.occurrenceAt)) return { send: false, reason: "occurrence moved" };
  if (occurrence.actualAt) return { send: false, reason: "logged" };
  if (occurrence.skipped) return { send: false, reason: "skipped" };
  if (!plan.inCurrentRevision || plan.cycleEnded) return { send: false, reason: "cycle ended" };
  const at = new Date(now);
  if (at.getTime() >= Date.parse(occurrence.remindersStopAt)) return { send: false, reason: "stopped" };
  const current = reminderToSend(occurrence, at.toISOString());
  if (current?.kind === job.kind) return { send: true };
  return { send: false, reason: current ? "superseded" : "late" };
}

export type HeadsUpJob = { occurrenceAt: string; sendAt: string; leadMinutes: number };

/**
 * The doses a heads-up names, in Today's order (the same instant, so by
 * occurrence key): of `planned`, the occurrences still planned at the job's
 * instant in running plans (the caller passes only plans in their cycle's
 * current revision whose cycle has not ended), those neither logged nor
 * skipped.
 */
export function headsUpDoses<O extends Occurrence>(job: Pick<HeadsUpJob, "occurrenceAt">, planned: readonly O[]): O[] {
  const instant = Date.parse(job.occurrenceAt);
  return planned
    .filter((o) => Date.parse(o.scheduledAt) === instant && !o.actualAt && !o.skipped)
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * A heads-up at send time: the owner's setting must still be the lead it was
 * planned with (Off, or another lead, which plans its own), the planned time
 * must still be ahead and the heads-up no more than 15 minutes late, and at
 * least one dose planned at that time must still be open (`atInstant`: every
 * occurrence still planned at that instant in running plans, logged or not).
 */
export function headsUpVerdict(
  job: HeadsUpJob,
  setting: HeadsUpMinutes,
  atInstant: readonly Pick<Occurrence, "scheduledAt" | "actualAt" | "skipped">[],
  now: Date | string,
): Verdict {
  if (setting !== job.leadMinutes) return { send: false, reason: "setting changed" };
  const at = new Date(now).getTime();
  if (at >= Date.parse(job.occurrenceAt) || at > Date.parse(job.sendAt) + DEFAULT_REMINDER_GRACE_MINUTES * MINUTE) {
    return { send: false, reason: "late" };
  }
  const instant = Date.parse(job.occurrenceAt);
  const group = atInstant.filter((o) => Date.parse(o.scheduledAt) === instant);
  if (group.length === 0) return { send: false, reason: "occurrence gone" };
  if (group.every((o) => o.actualAt || o.skipped)) return { send: false, reason: group.some((o) => o.actualAt) ? "logged" : "skipped" };
  return { send: true };
}

export type SupplementJob = { occurrenceKey: string; occurrenceAt: string; sendAt: string };

/**
 * A supplement reminder at send time: the occurrence must still be due under
 * the routine's current definition (not taken, routine not edited to another
 * time or ended, tracking still on: `current` is its row in the due feed, or
 * null), and not more than 15 minutes late.
 */
export function supplementVerdict(
  job: SupplementJob,
  current: { scheduledAt: string } | null,
  taken: boolean,
  now: Date | string,
): Verdict {
  if (taken) return { send: false, reason: "logged" };
  if (!current) return { send: false, reason: "occurrence gone" };
  if (Date.parse(current.scheduledAt) !== Date.parse(job.occurrenceAt)) return { send: false, reason: "occurrence moved" };
  if (new Date(now).getTime() > Date.parse(job.sendAt) + DEFAULT_REMINDER_GRACE_MINUTES * MINUTE) return { send: false, reason: "late" };
  return { send: true };
}

// ── Retries ──────────────────────────────────────────────────────────────────

/** Sends per reminder, the first included. */
export const MAX_ATTEMPTS = 3;

/** Minutes before attempt n + 1 after attempt n failed (1, then 2). */
export const retryDelayMinutes = (attempts: number) => attempts;

/**
 * A failure worth another attempt: no answer (network, timeout), 429 or a
 * 5xx from the push service, or a gone subscription that could not be
 * disabled. Any other 4xx, or an endpoint that is not a push service, will
 * not get better.
 */
export function isTransientFailure(result: { status: string; statusCode?: number; error?: string }, unknownEndpoint: string): boolean {
  if (result.status !== "failed") return false;
  if (result.error === unknownEndpoint) return false;
  const code = result.statusCode;
  return code === undefined || code === 404 || code === 410 || code === 429 || code >= 500;
}

/**
 * When to try again after a transient failure of attempt `attempts`, or
 * null when it may not: out of attempts, or the retry would be past the
 * reminder's 15 minutes (it would be skipped then anyway).
 */
export function retryAt(attempts: number, sendAt: string, now: Date | string): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const at = new Date(new Date(now).getTime() + retryDelayMinutes(attempts) * MINUTE);
  return at.getTime() > Date.parse(sendAt) + DEFAULT_REMINDER_GRACE_MINUTES * MINUTE ? null : at;
}
