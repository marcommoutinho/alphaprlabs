// Reminder timing the dispatcher (S13) uses ("Reminder delivery design";
// Marco, 2026-09-30: one follow-up an hour after the planned time): a
// reminder when due, the follow-up, stop rules, no bursts of historical
// reminders, keys that change when a
// not-yet-due dose's scheduled time moves and stay put once it is due, and
// keys scoped by peptide plan.
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { type ActivePhase, type Occurrence, scheduleOccurrences } from "@/lib/schedule/engine";
import { DEFAULT_REMINDER_GRACE_MINUTES, FOLLOW_UP_RELEVANCE_MINUTES, reminderSlots, reminderToSend } from "@/lib/schedule/reminders";

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
type Taken = { key: string; actualAt: string; recordedAt?: string };
// Confirmations are recorded when taken unless stated.
const schedule = (phase: ActivePhase, confirmations: Taken[] = [], planId = "p1") =>
  scheduleOccurrences(
    { planId, timeZone: TZ, phases: [phase] },
    confirmations.map((c) => ({ ...c, recordedAt: c.recordedAt ?? c.actualAt })),
  );
const first = schedule(interval)[0]; // Sep 2 20:00 local = 2026-09-03T00:00:00Z
const plus = (iso: string, minutes: number) => Temporal.Instant.from(iso).add({ minutes }).toString();

describe("reminderSlots", () => {
  it("offers the due reminder and one follow-up an hour later", () => {
    expect(reminderSlots(first)).toEqual([
      { key: "p1:i1:0@2026-09-03T00:00:00Z#due", occurrenceKey: "p1:i1:0", kind: "due", at: "2026-09-03T00:00:00Z" },
      { key: "p1:i1:0@2026-09-03T00:00:00Z#follow-up-1h", occurrenceKey: "p1:i1:0", kind: "follow-up-1h", at: "2026-09-03T01:00:00Z" },
    ]);
  });

  it("offers nothing once confirmed", () => {
    const [confirmed] = schedule(interval, [{ key: "p1:i1:0", actualAt: "2026-09-03T00:05:00Z" }]);
    expect(reminderSlots(confirmed)).toEqual([]);
    expect(reminderToSend(confirmed, "2026-09-03T01:00:00Z")).toBeNull();
  });

  it("stops follow-ups at the phase end", () => {
    // Last dose of the phase at 23:30; the phase ends at midnight.
    const late = schedule({ ...interval, start: "2026-09-30", time: "23:30" })[0];
    expect(late.remindersStopAt).toBe("2026-10-01T04:00:00Z");
    expect(reminderSlots(late).map((s) => s.kind)).toEqual(["due"]);
  });

  it("stops follow-ups when the next occurrence becomes due", () => {
    const occurrence: Occurrence = { ...first, remindersStopAt: "2026-09-03T00:45:00Z" };
    expect(reminderSlots(occurrence).map((s) => s.kind)).toEqual(["due"]);
    expect(reminderToSend(occurrence, "2026-09-03T00:45:00Z")).toBeNull();
  });

  it("changes keys when the dose's scheduled time moves, so a moved dose is reminded again", () => {
    const moved = schedule(interval, [{ key: "p1:i1:0", actualAt: "2026-09-03T13:15:00Z" }])[1];
    const original = schedule(interval)[1];
    expect(moved.key).toBe(original.key);
    expect(reminderSlots(moved)[0].key).toBe("p1:i1:1@2026-09-08T13:15:00Z#due");
    expect(reminderSlots(original)[0].key).toBe("p1:i1:1@2026-09-08T00:00:00Z#due");
  });
});

describe("reminderToSend", () => {
  it("returns the current reminder: the due one within 15 minutes, the follow-up while it is relevant", () => {
    expect(DEFAULT_REMINDER_GRACE_MINUTES).toBe(15);
    expect(FOLLOW_UP_RELEVANCE_MINUTES).toBe(120);
    const kindAt = (minutes: number) => reminderToSend(first, plus(first.scheduledAt, minutes))?.kind ?? null;
    expect(kindAt(-1)).toBeNull();
    expect(kindAt(0)).toBe("due");
    expect(kindAt(15)).toBe("due");
    expect(kindAt(16)).toBeNull();
    expect(kindAt(59)).toBeNull();
    expect(kindAt(60)).toBe("follow-up-1h");
    expect(kindAt(90)).toBe("follow-up-1h");
    expect(kindAt(180)).toBe("follow-up-1h");
    expect(kindAt(181)).toBeNull();
    expect(kindAt(60 * 24)).toBeNull();
  });

  it("sends each reminder once to a dispatcher ticking every minute, and skips a late due one", () => {
    const tick = (skip: (minute: number) => boolean) => {
      const sent = new Set<string>();
      for (let minute = -10; minute <= 60 * 5; minute++) {
        if (skip(minute)) continue;
        const slot = reminderToSend(first, plus(first.scheduledAt, minute));
        if (slot) sent.add(slot.key); // the dispatcher records sent keys
      }
      return [...sent].map((key) => key.split("#")[1]);
    };
    expect(tick(() => false)).toEqual(["due", "follow-up-1h"]);
    // Down from due −1 to due +20 minutes: the due reminder is skipped, not sent late.
    expect(tick((m) => m >= -1 && m <= 20)).toEqual(["follow-up-1h"]);
    // Down for 40 minutes after the follow-up's time: it still goes out.
    expect(tick((m) => m >= 60 && m <= 99)).toEqual(["due", "follow-up-1h"]);
  });

  it("sends no burst of historical reminders when a backdated confirmation moves a dose into the past", () => {
    // On Sep 6 at 12:00, before i1:1 (Sep 7 20:00) is due, i1:0 is recorded as taken Sep 1 08:00.
    // i1:1 moves to Sep 6 08:00 — already past — and its reminders are skipped, not sent late.
    const occurrences = schedule(interval, [{ key: "p1:i1:0", actualAt: "2026-09-01T12:00:00Z", recordedAt: "2026-09-06T16:00:00Z" }]);
    expect(occurrences[1]).toMatchObject({ key: "p1:i1:1", localDate: "2026-09-06", localTime: "08:00" });
    for (let minute = 0; minute <= 60 * 6; minute++) {
      expect(reminderToSend(occurrences[1], plus("2026-09-06T16:00:00Z", minute))).toBeNull();
    }
    // The next dose is reminded normally when it becomes due.
    expect(reminderToSend(occurrences[2], "2026-09-11T12:00:00Z")?.key).toBe("p1:i1:2@2026-09-11T12:00:00Z#due");
  });
});

describe("backdated confirmations and due doses", () => {
  // Toronto, every 5 days from Sep 2 20:00: i1:1 is due Mon Sep 7 20:00 (2026-09-08T00:00:00Z).
  const backdated = { key: "p1:i1:0", actualAt: "2026-09-04T12:00:00Z" }; // taken Fri Sep 4 08:00

  it("leave a dose that was already due open at its time, with the same reminder keys", () => {
    const before = schedule(interval);
    // Recorded Tue Sep 8 08:00, after i1:1 became due.
    const after = schedule(interval, [{ ...backdated, recordedAt: "2026-09-08T12:00:00Z" }]);
    expect(after[1]).toMatchObject({ key: "p1:i1:1", scheduledAt: "2026-09-08T00:00:00Z", localDate: "2026-09-07", actualAt: null });
    expect(reminderSlots(after[1])).toEqual(reminderSlots(before[1]));
    expect(reminderSlots(after[1])[0].key).toBe("p1:i1:1@2026-09-08T00:00:00Z#due");
    // The later doses count on from the open dose's planned time, as before.
    expect(after.map((o) => o.scheduledAt)).toEqual(before.map((o) => o.scheduledAt));
    expect(after[0].actualAt).toBe("2026-09-04T12:00:00Z");
  });

  it("move a dose that was still in the future when recorded", () => {
    // Recorded Sat Sep 5 08:00, before i1:1 was due: i1:1 moves to Sep 9 08:00, with new keys.
    const after = schedule(interval, [{ ...backdated, recordedAt: "2026-09-05T12:00:00Z" }]);
    expect(after.slice(1, 3).map((o) => `${o.key} ${o.localDate} ${o.localTime}`)).toEqual([
      "p1:i1:1 2026-09-09 08:00",
      "p1:i1:2 2026-09-14 08:00",
    ]);
    expect(reminderSlots(after[1])[0].key).toBe("p1:i1:1@2026-09-09T12:00:00Z#due");
  });

  it("then confirming the open dose moves the next one from its actual time", () => {
    const occurrences = schedule(interval, [
      { ...backdated, recordedAt: "2026-09-08T12:00:00Z" },
      { key: "p1:i1:1", actualAt: "2026-09-09T14:00:00Z" }, // the open Sep 7 dose, taken Wed Sep 9 10:00
    ]);
    expect(occurrences[1]).toMatchObject({ scheduledAt: "2026-09-08T00:00:00Z", actualAt: "2026-09-09T14:00:00Z" });
    expect(reminderSlots(occurrences[1])).toEqual([]);
    expect(occurrences[2]).toMatchObject({ key: "p1:i1:2", localDate: "2026-09-14", localTime: "10:00" });
  });

  it("never pull the next dose earlier than a newer confirmed dose", () => {
    // i1:1 taken on time Sep 7 20:00; then on Sep 9, i1:0 is backdated to Sep 4.
    const occurrences = schedule(interval, [
      { key: "p1:i1:1", actualAt: "2026-09-08T00:00:00Z" },
      { ...backdated, recordedAt: "2026-09-09T12:00:00Z" },
    ]);
    expect(occurrences[2]).toMatchObject({ key: "p1:i1:2", scheduledAt: "2026-09-13T00:00:00Z" });
  });
});

describe("keys across peptide plans", () => {
  it("never collide when two plans use the same phase id", () => {
    const a = schedule(interval, [{ key: "a:i1:0", actualAt: "2026-09-03T13:15:00Z" }], "a");
    const b = schedule(interval, [{ key: "a:i1:0", actualAt: "2026-09-03T13:15:00Z" }], "b");
    expect(a[0].key).toBe("a:i1:0");
    expect(b[0].key).toBe("b:i1:0");
    // Plan a's confirmation doesn't touch plan b.
    expect(a[0].actualAt).toBe("2026-09-03T13:15:00Z");
    expect(b[0].actualAt).toBeNull();
    expect(b[1].scheduledAt).toBe("2026-09-08T00:00:00Z");
    const aKeys = a.flatMap(reminderSlots).map((s) => s.key);
    const bKeys = b.flatMap(reminderSlots).map((s) => s.key);
    expect(bKeys[0]).toBe("b:i1:0@2026-09-03T00:00:00Z#due");
    expect(aKeys.filter((key) => bKeys.includes(key))).toEqual([]);
  });
});
