// Reminder timing for one occurrence (plan D3 and "Reminder delivery design").
// The dispatcher (S13) owns the queue, leases, retries and devices; this
// module only decides which reminder, if any, is current for an occurrence.
//
// - A reminder when the dose becomes due, then follow-ups 30 minutes and
//   2 hours later while it is unconfirmed.
// - They stop on confirmation, at the phase's end, or when the next
//   occurrence in the phase becomes due (Occurrence.remindersStopAt).
// - No bursts: at any moment only the latest reminder whose time has passed
//   is current, and only within a grace period after its time. Anything older
//   was missed and is skipped (for example after dispatcher downtime, or when
//   a backdated confirmation moves a not-yet-due dose into the past).
// - A dose that has become due keeps its scheduled time (engine.ts), so its
//   reminder keys never change after its due reminder could have been sent.
import { Temporal } from "@js-temporal/polyfill";
import type { Occurrence } from "./engine";
import { type InstantInput, isoInstant, toInstant } from "./zone";

export type ReminderKind = "due" | "follow-up-30m" | "follow-up-2h";

export type ReminderSlot = {
  /**
   * `${planId}:${phaseId}:${index|date}@${scheduledAt}#${kind}`: stable per
   * peptide plan, occurrence, scheduled time and kind. A not-yet-due dose
   * whose scheduled time moves gets new keys; the dispatcher adds device and
   * plan version.
   */
  key: string;
  occurrenceKey: string;
  kind: ReminderKind;
  /** When it should be sent, ISO UTC. */
  at: string;
};

/** Minutes after the due time for each reminder (D3: 30 minutes and 2 hours). */
export const REMINDER_OFFSETS: readonly { kind: ReminderKind; minutes: number }[] = [
  { kind: "due", minutes: 0 },
  { kind: "follow-up-30m", minutes: 30 },
  { kind: "follow-up-2h", minutes: 120 },
];

/** A reminder more than this late is skipped rather than sent. */
export const DEFAULT_REMINDER_GRACE_MINUTES = 15;

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
 * whose time has passed, if `now` is within the grace period after it and
 * before the stop time. The dispatcher sends each slot key at most once.
 */
export function reminderToSend(
  occurrence: Occurrence,
  now: InstantInput,
  options: { graceMinutes?: number } = {},
): ReminderSlot | null {
  const at = toInstant(now);
  if (Temporal.Instant.compare(at, Temporal.Instant.from(occurrence.remindersStopAt)) >= 0) return null;
  const passed = reminderSlots(occurrence).filter((slot) => Temporal.Instant.compare(Temporal.Instant.from(slot.at), at) <= 0);
  const current = passed.at(-1);
  if (!current) return null;
  const grace = options.graceMinutes ?? DEFAULT_REMINDER_GRACE_MINUTES;
  const deadline = Temporal.Instant.from(current.at).add({ minutes: grace });
  return Temporal.Instant.compare(at, deadline) <= 0 ? current : null;
}
