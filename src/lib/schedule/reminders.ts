// Reminder timing for one occurrence ("Reminder delivery design"; Marco,
// 2026-09-30: one follow-up, an hour after the planned time, replacing D3's
// 30-minute and 2-hour ones). The dispatcher (S13) owns the queue, leases,
// retries, devices and the heads-up before a dose; this module only decides
// which reminder, if any, is current for an occurrence.
//
// - A reminder when the dose becomes due, then one follow-up an hour later
//   while it is unconfirmed: the last reminder for that dose.
// - They stop on confirmation, at the phase's end, or when the next
//   occurrence in the phase becomes due (Occurrence.remindersStopAt).
// - No bursts: at any moment only the latest reminder whose time has passed
//   is current, and only within its grace period. A due reminder more than
//   15 minutes late is skipped (Marco, 2026-09-26; for example after
//   dispatcher downtime, or when a backdated confirmation moves a
//   not-yet-due dose into the past). The follow-up has no 15-minute cut: it
//   still goes out while it is relevant, up to FOLLOW_UP_RELEVANCE_MINUTES
//   after its time (as long as the push service holds it).
// - A dose that has become due keeps its scheduled time (engine.ts), so its
//   reminder keys never change after its due reminder could have been sent.
import { Temporal } from "@js-temporal/polyfill";
import type { Occurrence } from "./engine";
import { type InstantInput, isoInstant, toInstant } from "./zone";

export type ReminderKind = "due" | "follow-up-1h";

export type ReminderSlot = {
  /**
   * `${planId}:${phaseId}:${index|date}@${scheduledAt}#${kind}`: stable per
   * peptide plan, occurrence, scheduled time and kind. A not-yet-due dose
   * whose scheduled time moves gets new keys; the dispatcher adds the device.
   */
  key: string;
  occurrenceKey: string;
  kind: ReminderKind;
  /** When it should be sent, ISO UTC. */
  at: string;
};

/** A due reminder more than this late is skipped rather than sent. */
export const DEFAULT_REMINDER_GRACE_MINUTES = 15;

/** The follow-up stays relevant (is still sent) this long after its time. */
export const FOLLOW_UP_RELEVANCE_MINUTES = 120;

/** Minutes after the due time for each reminder, and how late each may still go out. */
export const REMINDER_OFFSETS: readonly { kind: ReminderKind; minutes: number; graceMinutes: number }[] = [
  { kind: "due", minutes: 0, graceMinutes: DEFAULT_REMINDER_GRACE_MINUTES },
  { kind: "follow-up-1h", minutes: 60, graceMinutes: FOLLOW_UP_RELEVANCE_MINUTES },
];

/** The reminders an unconfirmed occurrence can receive (before its stop time); none once confirmed. */
export function reminderSlots(occurrence: Occurrence): ReminderSlot[] {
  if (occurrence.actualAt) return [];
  const due = Temporal.Instant.from(occurrence.scheduledAt);
  const stop = Temporal.Instant.from(occurrence.remindersStopAt);
  return REMINDER_OFFSETS.map(({ kind, minutes }) => ({ kind, at: due.add({ minutes }) }))
    .filter(({ at }) => Temporal.Instant.compare(at, stop) < 0)
    .map(({ kind, at }) => ({
      key: `${occurrence.key}@${occurrence.scheduledAt}#${kind}`,
      occurrenceKey: occurrence.key,
      kind,
      at: isoInstant(at),
    }));
}

/**
 * The reminder to send for this occurrence at `now`, or null: the latest slot
 * whose time has passed, if `now` is within its grace period and before the
 * stop time. The dispatcher sends each slot key at most once.
 */
export function reminderToSend(occurrence: Occurrence, now: InstantInput): ReminderSlot | null {
  const at = toInstant(now);
  if (Temporal.Instant.compare(at, Temporal.Instant.from(occurrence.remindersStopAt)) >= 0) return null;
  const passed = reminderSlots(occurrence).filter((slot) => Temporal.Instant.compare(Temporal.Instant.from(slot.at), at) <= 0);
  const current = passed.at(-1);
  if (!current) return null;
  const grace = REMINDER_OFFSETS.find((o) => o.kind === current.kind)!.graceMinutes;
  const deadline = Temporal.Instant.from(current.at).add({ minutes: grace });
  return Temporal.Instant.compare(at, deadline) <= 0 ? current : null;
}
