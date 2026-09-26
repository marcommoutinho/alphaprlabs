// Reminder timing the dispatcher (S13) uses (plan D3 and "Reminder delivery
// design"): a reminder when due, follow-ups at 30 minutes and 2 hours, stop
// rules, no bursts of historical reminders, and keys that change when a
// dose's scheduled time moves.
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { type ActivePhase, type Occurrence, scheduleOccurrences } from "@/lib/schedule/engine";
import { DEFAULT_REMINDER_GRACE_MINUTES, reminderSlots, reminderToSend } from "@/lib/schedule/reminders";

const TZ = "America/Toronto"; // UTC−4 in September 2026
const interval: ActivePhase = {
  id: "i1",
  kind: "active",
  start: "2026-09-02",
  end: "2026-09-30",
  doseMg: "0.4",
  time: "20:00",
  schedule: { type: "interval", everyDays: 5 },
};
const schedule = (phase: ActivePhase, confirmations: { key: string; actualAt: string }[] = []) =>
  scheduleOccurrences({ timeZone: TZ, phases: [phase] }, confirmations);
const first = schedule(interval)[0]; // Sep 2 20:00 local = 2026-09-03T00:00:00Z
const plus = (iso: string, minutes: number) => Temporal.Instant.from(iso).add({ minutes }).toString();

describe("reminderSlots", () => {
  it("offers the due reminder and follow-ups at 30 minutes and 2 hours", () => {
    expect(reminderSlots(first)).toEqual([
      { key: "i1:0@2026-09-03T00:00:00Z#due", occurrenceKey: "i1:0", kind: "due", at: "2026-09-03T00:00:00Z" },
      { key: "i1:0@2026-09-03T00:00:00Z#follow-up-30m", occurrenceKey: "i1:0", kind: "follow-up-30m", at: "2026-09-03T00:30:00Z" },
      { key: "i1:0@2026-09-03T00:00:00Z#follow-up-2h", occurrenceKey: "i1:0", kind: "follow-up-2h", at: "2026-09-03T02:00:00Z" },
    ]);
  });

  it("offers nothing once confirmed", () => {
    const [confirmed] = schedule(interval, [{ key: "i1:0", actualAt: "2026-09-03T00:05:00Z" }]);
    expect(reminderSlots(confirmed)).toEqual([]);
    expect(reminderToSend(confirmed, "2026-09-03T00:30:00Z")).toBeNull();
  });

  it("stops follow-ups at the phase end", () => {
    // Last dose of the phase at 23:00; the phase ends at midnight.
    const late = schedule({ ...interval, start: "2026-09-30", time: "23:00" })[0];
    expect(late.remindersStopAt).toBe("2026-10-01T04:00:00Z");
    expect(reminderSlots(late).map((s) => s.kind)).toEqual(["due", "follow-up-30m"]);
  });

  it("stops follow-ups when the next occurrence becomes due", () => {
    const occurrence: Occurrence = { ...first, remindersStopAt: "2026-09-03T01:00:00Z" };
    expect(reminderSlots(occurrence).map((s) => s.kind)).toEqual(["due", "follow-up-30m"]);
    expect(reminderToSend(occurrence, "2026-09-03T01:00:00Z")).toBeNull();
  });

  it("changes keys when the dose's scheduled time moves, so a moved dose is reminded again", () => {
    const moved = schedule(interval, [{ key: "i1:0", actualAt: "2026-09-03T13:15:00Z" }])[1];
    const original = schedule(interval)[1];
    expect(moved.key).toBe(original.key);
    expect(reminderSlots(moved)[0].key).toBe("i1:1@2026-09-08T13:15:00Z#due");
    expect(reminderSlots(original)[0].key).toBe("i1:1@2026-09-08T00:00:00Z#due");
  });
});

describe("reminderToSend", () => {
  it("returns the current reminder within the grace period", () => {
    expect(DEFAULT_REMINDER_GRACE_MINUTES).toBe(15);
    const kindAt = (minutes: number) => reminderToSend(first, plus(first.scheduledAt, minutes))?.kind ?? null;
    expect(kindAt(-1)).toBeNull();
    expect(kindAt(0)).toBe("due");
    expect(kindAt(15)).toBe("due");
    expect(kindAt(16)).toBeNull();
    expect(kindAt(30)).toBe("follow-up-30m");
    expect(kindAt(119)).toBeNull();
    expect(kindAt(120)).toBe("follow-up-2h");
    expect(kindAt(135)).toBe("follow-up-2h");
    expect(kindAt(136)).toBeNull();
    expect(kindAt(60 * 24)).toBeNull();
  });

  it("accepts a custom grace period", () => {
    expect(reminderToSend(first, plus(first.scheduledAt, 25), { graceMinutes: 30 })?.kind).toBe("due");
    expect(reminderToSend(first, plus(first.scheduledAt, 1), { graceMinutes: 0 })).toBeNull();
  });

  it("sends each reminder once to a dispatcher ticking every minute, and skips ones missed by downtime", () => {
    const tick = (skip: (minute: number) => boolean) => {
      const sent = new Set<string>();
      for (let minute = -10; minute <= 60 * 5; minute++) {
        if (skip(minute)) continue;
        const slot = reminderToSend(first, plus(first.scheduledAt, minute));
        if (slot) sent.add(slot.key); // the dispatcher records sent keys
      }
      return [...sent].map((key) => key.split("#")[1]);
    };
    expect(tick(() => false)).toEqual(["due", "follow-up-30m", "follow-up-2h"]);
    // Down from due −1 to due +20 minutes: the due reminder is skipped, not sent late.
    expect(tick((m) => m >= -1 && m <= 20)).toEqual(["follow-up-30m", "follow-up-2h"]);
    // Down for 10 minutes after the 30-minute follow-up: it's still sent within the grace period.
    expect(tick((m) => m >= 30 && m <= 39)).toEqual(["due", "follow-up-30m", "follow-up-2h"]);
  });

  it("sends no burst of historical reminders after a backdated confirmation", () => {
    // i1:0 was left open until Sep 20, then recorded as taken Sep 4 08:00.
    // The open doses are recalculated to Sep 9, 14 and 19, all in the past.
    const occurrences = schedule(interval, [{ key: "i1:0", actualAt: "2026-09-04T12:00:00Z" }]);
    expect(occurrences.map((o) => o.localDate)).toEqual(["2026-09-02", "2026-09-09", "2026-09-14", "2026-09-19", "2026-09-24", "2026-09-29"]);
    const now = "2026-09-20T16:00:00Z";
    expect(occurrences.map((o) => reminderToSend(o, now))).toEqual([null, null, null, null, null, null]);
    // The next dose is reminded normally when it becomes due.
    expect(reminderToSend(occurrences[4], "2026-09-24T12:00:00Z")?.key).toBe("i1:4@2026-09-24T12:00:00Z#due");
  });
});
