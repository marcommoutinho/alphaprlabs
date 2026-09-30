// S13 reminder rules (src/lib/reminders/rules.ts) and the copy module: what
// a queued reminder does at send time (a dose's due reminder and its one
// follow-up an hour later, the heads-up before a planned time, a
// supplement's), its TTL, topic, tag and link, which failures are retried,
// and the send on/off control. The dispatcher itself is proven against the
// real database in tests/integration/reminders.test.ts.
import { describe, expect, it } from "vitest";
import {
  DOSE_DUE_BODY_NO_UNITS,
  DOSE_DUE_BODY_UNITS,
  DOSE_DUE_TITLE,
  doseReminderText,
  fillCopy,
  FOLLOWUP_BODY,
  FOLLOWUP_TITLE,
  HEADS_UP_BODY_MANY,
  HEADS_UP_BODY_ONE,
  HEADS_UP_BODY_ONE_NO_UNITS,
  HEADS_UP_LEAD_LABEL,
  HEADS_UP_OPTION_LABEL,
  HEADS_UP_TITLE_MANY,
  HEADS_UP_TITLE_ONE,
  headsUpText,
  OPTION_15,
  OPTION_30,
  OPTION_60,
  OPTION_OFF,
  SUPPLEMENT_DUE_BODY,
  SUPPLEMENT_DUE_TITLE,
  SUPPLEMENT_DUE_TITLE_AMOUNT,
  supplementReminderText,
} from "@/lib/reminders/copy";
import {
  doseReminderUrl,
  doseVerdict,
  headsUpDoses,
  headsUpTag,
  headsUpUrl,
  headsUpVerdict,
  isTransientFailure,
  MAX_ATTEMPTS,
  reminderTag,
  reminderTopic,
  reminderTtlSeconds,
  remindersEnabled,
  retryAt,
  supplementVerdict,
} from "@/lib/reminders/rules";
import { DEFAULT_PREFERENCES, HEADS_UP_CHOICES, parsePatch, resolvePreferences } from "@/lib/preferences/rules";
import { appNotificationPath, UNKNOWN_ENDPOINT } from "@/lib/push/send";
import type { Occurrence } from "@/lib/schedule/engine";
import type { ReminderKind } from "@/lib/schedule/reminders";

const T = "2026-09-30T12:00:00.000Z";
const plus = (minutes: number, from = T) => new Date(Date.parse(from) + minutes * 60_000).toISOString();

const occurrence = (overrides: Partial<Occurrence> = {}): Occurrence => ({
  key: "p1:f1:2026-09-30",
  planId: "p1",
  phaseId: "f1",
  scheduledAt: "2026-09-30T12:00:00Z",
  localDate: "2026-09-30",
  localTime: "08:00",
  timeZone: "America/Toronto",
  dstAdjustment: null,
  doseMg: "0.4",
  actualAt: null,
  remindersStopAt: plus(24 * 60),
  ...overrides,
});
const running = { inCurrentRevision: true, cycleEnded: false };
const job = (kind: ReminderKind) => ({ kind, occurrenceKey: "p1:f1:2026-09-30", occurrenceAt: T });

describe("the send on/off control", () => {
  it("is off unless REMINDERS_ENABLED is exactly true", () => {
    expect(remindersEnabled({})).toBe(false);
    for (const value of ["", "1", "TRUE", "yes", " true"]) expect(remindersEnabled({ REMINDERS_ENABLED: value })).toBe(false);
    expect(remindersEnabled({ REMINDERS_ENABLED: "true" })).toBe(true);
  });
});

describe("dose reminders at send time", () => {
  it("send the due reminder within 15 minutes, and the one follow-up an hour later while it is relevant", () => {
    expect(doseVerdict(job("due"), occurrence(), running, T)).toEqual({ send: true });
    expect(doseVerdict(job("due"), occurrence(), running, plus(15))).toEqual({ send: true });
    expect(doseVerdict(job("due"), occurrence(), running, plus(16))).toEqual({ send: false, reason: "late" });
    expect(doseVerdict(job("follow-up-1h"), occurrence(), running, plus(59))).toEqual({ send: false, reason: "late" });
    expect(doseVerdict(job("follow-up-1h"), occurrence(), running, plus(60))).toEqual({ send: true });
    // The follow-up has no 15-minute cut: it still goes out up to 2 hours after its time.
    expect(doseVerdict(job("follow-up-1h"), occurrence(), running, plus(180))).toEqual({ send: true });
    expect(doseVerdict(job("follow-up-1h"), occurrence(), running, plus(181))).toEqual({ send: false, reason: "late" });
    // A due reminder picked up after the follow-up's time is superseded by it.
    expect(doseVerdict(job("due"), occurrence(), running, plus(61))).toEqual({ send: false, reason: "superseded" });
  });

  it("stop once the dose is logged or skipped, and when the plan changed or ended", () => {
    expect(doseVerdict(job("follow-up-1h"), occurrence({ actualAt: plus(10) }), running, plus(60))).toEqual({ send: false, reason: "logged" });
    expect(doseVerdict(job("follow-up-1h"), occurrence({ skipped: true }), running, plus(60))).toEqual({ send: false, reason: "skipped" });
    expect(doseVerdict(job("due"), undefined, running, T)).toEqual({ send: false, reason: "occurrence gone" });
    expect(doseVerdict(job("due"), occurrence({ scheduledAt: plus(60) }), running, T)).toEqual({ send: false, reason: "occurrence moved" });
    expect(doseVerdict(job("due"), occurrence(), { inCurrentRevision: false, cycleEnded: false }, T)).toEqual({ send: false, reason: "cycle ended" });
    expect(doseVerdict(job("due"), occurrence(), { inCurrentRevision: true, cycleEnded: true }, T)).toEqual({ send: false, reason: "cycle ended" });
    // At the phase's end, or once the plan's next dose is due (remindersStopAt).
    expect(doseVerdict(job("follow-up-1h"), occurrence({ remindersStopAt: plus(45) }), running, plus(60))).toEqual({ send: false, reason: "stopped" });
  });

  it("compare the queued time as an instant, whatever its spelling", () => {
    const queued = { ...job("due"), occurrenceAt: "2026-09-30T12:00:00+00:00" };
    expect(doseVerdict(queued, occurrence(), running, T)).toEqual({ send: true });
  });
});

describe("the heads-up at send time", () => {
  const headsUp = (lead: number) => ({ occurrenceAt: T, sendAt: plus(-lead), leadMinutes: lead });
  const a = occurrence({ key: "p2:f1:2026-09-30", planId: "p2" });
  const b = occurrence({ key: "p1:f1:2026-09-30" });
  const other = occurrence({ key: "p3:f1:2026-09-30", planId: "p3", scheduledAt: plus(30) });

  it("goes out at its lead while the setting is unchanged, until 15 minutes late or the planned time", () => {
    for (const lead of [15, 30, 60] as const) {
      expect(headsUpVerdict(headsUp(lead), lead, [a], plus(-lead))).toEqual({ send: true });
    }
    expect(headsUpVerdict(headsUp(60), 60, [a], plus(-45))).toEqual({ send: true });
    expect(headsUpVerdict(headsUp(60), 60, [a], plus(-44))).toEqual({ send: false, reason: "late" });
    // Planned late (a plan change): never at or after the planned time.
    expect(headsUpVerdict(headsUp(15), 15, [a], T)).toEqual({ send: false, reason: "late" });
    expect(headsUpVerdict({ occurrenceAt: T, sendAt: plus(-15), leadMinutes: 15 }, 15, [a], plus(-1))).toEqual({ send: true });
  });

  it("is skipped when the setting changed, every dose is logged or skipped, or none is planned then", () => {
    expect(headsUpVerdict(headsUp(15), 0, [a], plus(-15))).toEqual({ send: false, reason: "setting changed" });
    expect(headsUpVerdict(headsUp(15), 30, [a], plus(-15))).toEqual({ send: false, reason: "setting changed" });
    expect(headsUpVerdict(headsUp(15), 15, [{ ...a, actualAt: plus(-20) }, { ...b, skipped: true }], plus(-15))).toEqual({ send: false, reason: "logged" });
    expect(headsUpVerdict(headsUp(15), 15, [{ ...a, skipped: true }], plus(-15))).toEqual({ send: false, reason: "skipped" });
    expect(headsUpVerdict(headsUp(15), 15, [other], plus(-15))).toEqual({ send: false, reason: "occurrence gone" });
    expect(headsUpVerdict(headsUp(15), 15, [{ ...a, actualAt: plus(-20) }, b], plus(-15))).toEqual({ send: true });
  });

  it("names the open doses at that time in Today's order; the first one's tag, so its due reminder replaces it", () => {
    const doses = headsUpDoses(headsUp(15), [a, other, b, { ...a, key: "p0:f1:2026-09-30", actualAt: plus(-20) }]);
    expect(doses.map((o) => o.key)).toEqual(["p1:f1:2026-09-30", "p2:f1:2026-09-30"]);
    expect(headsUpTag(doses)).toBe(reminderTag("dose", "p1:f1:2026-09-30"));
    expect(reminderTopic(headsUpTag(doses))).toBe(reminderTopic(reminderTag("dose", "p1:f1:2026-09-30")));
    expect(headsUpUrl(doses)).toBe("/app/today");
    expect(headsUpUrl([b])).toBe(doseReminderUrl(b.key));
  });
});

describe("supplement reminders at send time", () => {
  const supplement = { occurrenceKey: "r1:2026-09-30", occurrenceAt: T, sendAt: T };
  it("go out while due and not taken, within 15 minutes", () => {
    expect(supplementVerdict(supplement, { scheduledAt: T }, false, plus(15))).toEqual({ send: true });
    expect(supplementVerdict(supplement, { scheduledAt: T }, false, plus(16))).toEqual({ send: false, reason: "late" });
    expect(supplementVerdict(supplement, { scheduledAt: T }, true, T)).toEqual({ send: false, reason: "logged" });
    expect(supplementVerdict(supplement, null, false, T)).toEqual({ send: false, reason: "occurrence gone" });
    expect(supplementVerdict(supplement, { scheduledAt: plus(30) }, false, T)).toEqual({ send: false, reason: "occurrence moved" });
  });
});

describe("what a reminder opens and replaces", () => {
  it("opens the dose's sheet on Today (a path inside /app), and Today for a supplement", () => {
    const key = "7d1c1a9e-0000-4000-8000-000000000001:5a1c1a9e-0000-4000-8000-000000000002:2026-09-30";
    expect(doseReminderUrl(key)).toBe(`/app/today?dose=${encodeURIComponent(key)}`);
    expect(appNotificationPath(doseReminderUrl(key))).toBe(doseReminderUrl(key));
  });

  it("uses one tag and one topic per occurrence, so a follow-up replaces the earlier reminder", () => {
    const tag = reminderTag("dose", "p1:f1:2026-09-30");
    expect(tag).toBe("dose:p1:f1:2026-09-30");
    expect(reminderTag("supplement", "r1:2026-09-30")).not.toBe(reminderTag("dose", "r1:2026-09-30"));
    expect(reminderTopic(tag)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(reminderTopic(tag)).toBe(reminderTopic(tag));
    expect(reminderTopic(tag)).not.toBe(reminderTopic("dose:p1:f1:2026-10-01"));
  });

  it("lets the push service hold a reminder until the next one takes over, or 2 hours after the last", () => {
    const dose = (kind: ReminderKind, sendAt: string, stopAt: string | null = null) => ({ source: "dose" as const, kind, sendAt, stopAt });
    expect(reminderTtlSeconds(dose("due", T), T)).toBe(60 * 60);
    expect(reminderTtlSeconds(dose("due", T), plus(10))).toBe(50 * 60);
    expect(reminderTtlSeconds(dose("follow-up-1h", plus(60)), plus(60))).toBe(120 * 60);
    expect(reminderTtlSeconds(dose("follow-up-1h", plus(60), plus(90)), plus(60))).toBe(30 * 60);
    expect(reminderTtlSeconds({ source: "supplement", kind: "due", sendAt: T }, T)).toBe(120 * 60);
    expect(reminderTtlSeconds(dose("due", T, T), T)).toBe(60);
    // A heads-up until the planned time, when the due reminder takes over.
    expect(reminderTtlSeconds({ source: "heads-up", kind: "heads-up", sendAt: plus(-30), occurrenceAt: T }, plus(-30))).toBe(30 * 60);
    expect(reminderTtlSeconds({ source: "heads-up", kind: "heads-up", sendAt: plus(-15), occurrenceAt: T }, plus(-5))).toBe(5 * 60);
  });
});

describe("retries", () => {
  it("retry no answer, 429, 5xx and an undisabled gone subscription; nothing else", () => {
    expect(isTransientFailure({ status: "failed", error: "ECONNRESET" }, UNKNOWN_ENDPOINT)).toBe(true);
    for (const statusCode of [429, 500, 503]) expect(isTransientFailure({ status: "failed", statusCode, error: "x" }, UNKNOWN_ENDPOINT)).toBe(true);
    expect(isTransientFailure({ status: "failed", statusCode: 410, error: "gone; disabling failed: x" }, UNKNOWN_ENDPOINT)).toBe(true);
    for (const statusCode of [400, 401, 403, 413]) expect(isTransientFailure({ status: "failed", statusCode, error: "x" }, UNKNOWN_ENDPOINT)).toBe(false);
    expect(isTransientFailure({ status: "failed", error: UNKNOWN_ENDPOINT }, UNKNOWN_ENDPOINT)).toBe(false);
    expect(isTransientFailure({ status: "sent", statusCode: 201 }, UNKNOWN_ENDPOINT)).toBe(false);
  });

  it("back off 1 then 2 minutes, at most MAX_ATTEMPTS sends, never past the reminder's 15 minutes", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(retryAt(1, T, T)?.toISOString()).toBe(plus(1));
    expect(retryAt(2, T, plus(1))?.toISOString()).toBe(plus(3));
    expect(retryAt(3, T, plus(3))).toBeNull();
    expect(retryAt(1, T, plus(14.5))).toBeNull();
  });
});

describe("the Advance heads-up setting", () => {
  it("is 15 minutes by default, Off or 15, 30 or 60 minutes when chosen", () => {
    expect(DEFAULT_PREFERENCES.headsUpMinutes).toBe(15);
    expect(resolvePreferences(null).headsUpMinutes).toBe(15);
    expect(resolvePreferences({ default_syringe: 100, weight_unit: "lb", appearance: null }).headsUpMinutes).toBe(15);
    expect(resolvePreferences({ default_syringe: 100, weight_unit: "lb", appearance: null, heads_up_minutes: 0 }).headsUpMinutes).toBe(0);
    expect(resolvePreferences({ default_syringe: 100, weight_unit: "lb", appearance: null, heads_up_minutes: 45 }).headsUpMinutes).toBe(15);
    expect(parsePatch({ headsUpMinutes: 60 })).toEqual({ headsUpMinutes: 60 });
    expect(parsePatch({ headsUpMinutes: 0 })).toEqual({ headsUpMinutes: 0 });
    expect(parsePatch({ headsUpMinutes: 45 })).toBeNull();
    expect(parsePatch({ headsUpMinutes: "15" })).toBeNull();
  });

  it("lists its choices in order with the approved labels", () => {
    expect(HEADS_UP_CHOICES.map((minutes) => HEADS_UP_OPTION_LABEL[minutes])).toEqual([OPTION_OFF, OPTION_15, OPTION_30, OPTION_60]);
  });
});

describe("copy", () => {
  const facts = { peptide: "BPC-157", amount: "250 mcg", time: "8:05 PM", units: "10" };

  it("fills a dose's due reminder and follow-up; units only, never the syringe's size", () => {
    expect(fillCopy("{a} and {b}, {c}", { a: "1", b: "2" })).toBe("1 and 2, {c}");
    expect(doseReminderText("due", facts)).toEqual({ title: fillCopy(DOSE_DUE_TITLE, facts), body: fillCopy(DOSE_DUE_BODY_UNITS, facts) });
    expect(doseReminderText("due", { ...facts, units: null })).toEqual({
      title: fillCopy(DOSE_DUE_TITLE, facts),
      body: fillCopy(DOSE_DUE_BODY_NO_UNITS, facts),
    });
    expect(doseReminderText("follow-up-1h", facts)).toEqual({ title: fillCopy(FOLLOWUP_TITLE, facts), body: fillCopy(FOLLOWUP_BODY, facts) });
    expect(doseReminderText("follow-up-1h", { ...facts, units: null })).toEqual(doseReminderText("follow-up-1h", facts));
  });

  it("fills a heads-up for one dose, with its lead as 15 minutes, 30 minutes or 1 hour", () => {
    expect(HEADS_UP_LEAD_LABEL).toEqual({ 15: "15 minutes", 30: "30 minutes", 60: "1 hour" });
    for (const lead of [15, 30, 60] as const) {
      const values = { ...facts, minutes: HEADS_UP_LEAD_LABEL[lead] };
      expect(headsUpText({ doses: [facts], time: facts.time, lead })).toEqual({
        title: fillCopy(HEADS_UP_TITLE_ONE, values),
        body: fillCopy(HEADS_UP_BODY_ONE, values),
      });
    }
    expect(headsUpText({ doses: [{ ...facts, units: null }], time: facts.time, lead: 60 }).body).toBe(
      fillCopy(HEADS_UP_BODY_ONE_NO_UNITS, { minutes: HEADS_UP_LEAD_LABEL[60] }),
    );
  });

  it("fills one heads-up for several doses: their count and a list in the given (Today's) order", () => {
    const doses = [facts, { peptide: "TB-500", amount: "2 mg", units: null }];
    const text = headsUpText({ doses, time: "8:00 AM", lead: 30 });
    expect(text.title).toBe(fillCopy(HEADS_UP_TITLE_MANY, { count: "2", time: "8:00 AM" }));
    expect(text.body).toBe(fillCopy(HEADS_UP_BODY_MANY, { list: "BPC-157 250 mcg, TB-500 2 mg", minutes: HEADS_UP_LEAD_LABEL[30] }));
  });

  it("fills a supplement's reminder, and leaves nothing unfilled", () => {
    const supplement = { supplement: "Vitamin D3", amount: "2000 IU" };
    expect(supplementReminderText(supplement)).toEqual({ title: fillCopy(SUPPLEMENT_DUE_TITLE_AMOUNT, supplement), body: SUPPLEMENT_DUE_BODY });
    expect(supplementReminderText({ ...supplement, amount: "" }).title).toBe(fillCopy(SUPPLEMENT_DUE_TITLE, supplement));
    const texts = [
      doseReminderText("due", facts),
      doseReminderText("follow-up-1h", facts),
      headsUpText({ doses: [facts], time: facts.time, lead: 15 }),
      headsUpText({ doses: [facts, facts], time: facts.time, lead: 15 }),
      supplementReminderText(supplement),
    ];
    for (const text of texts) expect(`${text.title} ${text.body}`).not.toMatch(/[{}]/);
  });
});
