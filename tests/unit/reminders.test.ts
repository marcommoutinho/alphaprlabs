// S13 reminder rules (src/lib/reminders/rules.ts) and the copy module: what
// a queued reminder does at send time, its TTL, topic, tag and link, which
// failures are retried, and the send on/off control. The dispatcher itself is
// proven against the real database in tests/integration/reminders.test.ts.
import { describe, expect, it } from "vitest";
import {
  DOSE_DUE_BODY_NO_UNITS,
  DOSE_DUE_BODY_UNITS,
  DOSE_DUE_TITLE,
  doseReminderText,
  fillCopy,
  FOLLOWUP_2H_BODY,
  FOLLOWUP_2H_TITLE,
  FOLLOWUP_30_BODY,
  FOLLOWUP_30_TITLE,
  SUPPLEMENT_DUE_BODY,
  SUPPLEMENT_DUE_TITLE,
  SUPPLEMENT_DUE_TITLE_AMOUNT,
  supplementReminderText,
} from "@/lib/reminders/copy";
import {
  doseReminderUrl,
  doseVerdict,
  isTransientFailure,
  MAX_ATTEMPTS,
  reminderTag,
  reminderTopic,
  reminderTtlSeconds,
  remindersEnabled,
  retryAt,
  supplementVerdict,
} from "@/lib/reminders/rules";
import { appNotificationPath, UNKNOWN_ENDPOINT } from "@/lib/push/send";
import type { Occurrence } from "@/lib/schedule/engine";

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
const job = (kind: "due" | "follow-up-30m" | "follow-up-2h") => ({ kind, occurrenceKey: "p1:f1:2026-09-30", occurrenceAt: T });

describe("the send on/off control", () => {
  it("is off unless REMINDERS_ENABLED is exactly true", () => {
    expect(remindersEnabled({})).toBe(false);
    for (const value of ["", "1", "TRUE", "yes", " true"]) expect(remindersEnabled({ REMINDERS_ENABLED: value })).toBe(false);
    expect(remindersEnabled({ REMINDERS_ENABLED: "true" })).toBe(true);
  });
});

describe("dose reminders at send time", () => {
  it("send each reminder at its time and within 15 minutes of it, and nothing later", () => {
    expect(doseVerdict(job("due"), occurrence(), running, T)).toEqual({ send: true });
    expect(doseVerdict(job("due"), occurrence(), running, plus(15))).toEqual({ send: true });
    expect(doseVerdict(job("due"), occurrence(), running, plus(16))).toEqual({ send: false, reason: "late" });
    expect(doseVerdict(job("follow-up-30m"), occurrence(), running, plus(30))).toEqual({ send: true });
    expect(doseVerdict(job("follow-up-30m"), occurrence(), running, plus(46))).toEqual({ send: false, reason: "late" });
    expect(doseVerdict(job("follow-up-2h"), occurrence(), running, plus(120))).toEqual({ send: true });
    // A due reminder picked up after the 30-minute follow-up's time is superseded by it.
    expect(doseVerdict(job("due"), occurrence(), running, plus(31))).toEqual({ send: false, reason: "superseded" });
  });

  it("stop once the dose is logged or skipped, and when the plan changed or ended", () => {
    expect(doseVerdict(job("follow-up-30m"), occurrence({ actualAt: plus(10) }), running, plus(30))).toEqual({ send: false, reason: "logged" });
    expect(doseVerdict(job("follow-up-30m"), occurrence({ skipped: true }), running, plus(30))).toEqual({ send: false, reason: "skipped" });
    expect(doseVerdict(job("due"), undefined, running, T)).toEqual({ send: false, reason: "occurrence gone" });
    expect(doseVerdict(job("due"), occurrence({ scheduledAt: plus(60) }), running, T)).toEqual({ send: false, reason: "occurrence moved" });
    expect(doseVerdict(job("due"), occurrence(), { inCurrentRevision: false, cycleEnded: false }, T)).toEqual({ send: false, reason: "cycle ended" });
    expect(doseVerdict(job("due"), occurrence(), { inCurrentRevision: true, cycleEnded: true }, T)).toEqual({ send: false, reason: "cycle ended" });
    // At the phase's end, or once the plan's next dose is due (remindersStopAt).
    expect(doseVerdict(job("follow-up-2h"), occurrence({ remindersStopAt: plus(60) }), running, plus(120))).toEqual({ send: false, reason: "stopped" });
  });

  it("compare the queued time as an instant, whatever its spelling", () => {
    const queued = { ...job("due"), occurrenceAt: "2026-09-30T12:00:00+00:00" };
    expect(doseVerdict(queued, occurrence(), running, T)).toEqual({ send: true });
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
    const dose = (kind: "due" | "follow-up-30m" | "follow-up-2h", sendAt: string, stopAt: string | null = null) => ({ source: "dose" as const, kind, sendAt, stopAt });
    expect(reminderTtlSeconds(dose("due", T), T)).toBe(30 * 60);
    expect(reminderTtlSeconds(dose("due", T), plus(10))).toBe(20 * 60);
    expect(reminderTtlSeconds(dose("follow-up-30m", plus(30)), plus(30))).toBe(90 * 60);
    expect(reminderTtlSeconds(dose("follow-up-2h", plus(120)), plus(120))).toBe(120 * 60);
    expect(reminderTtlSeconds(dose("follow-up-2h", plus(120), plus(150)), plus(120))).toBe(30 * 60);
    expect(reminderTtlSeconds({ source: "supplement", kind: "due", sendAt: T }, T)).toBe(120 * 60);
    expect(reminderTtlSeconds(dose("due", T, T), T)).toBe(60);
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

describe("copy", () => {
  it("fills each template's fields, with a due body for a dose without syringe units", () => {
    expect(fillCopy("{a} and {b}, {c}", { a: "1", b: "2" })).toBe("1 and 2, {c}");
    const facts = { peptide: "BPC-157", amount: "250 mcg", time: "8:05 PM", units: "10", syringe: "100-unit" };
    expect(doseReminderText("due", facts)).toEqual({ title: fillCopy(DOSE_DUE_TITLE, facts), body: fillCopy(DOSE_DUE_BODY_UNITS, facts) });
    expect(doseReminderText("due", { ...facts, units: null, syringe: null })).toEqual({
      title: fillCopy(DOSE_DUE_TITLE, facts),
      body: fillCopy(DOSE_DUE_BODY_NO_UNITS, facts),
    });
    expect(doseReminderText("follow-up-30m", facts)).toEqual({ title: fillCopy(FOLLOWUP_30_TITLE, facts), body: fillCopy(FOLLOWUP_30_BODY, facts) });
    expect(doseReminderText("follow-up-2h", { ...facts, units: null, syringe: null })).toEqual({
      title: fillCopy(FOLLOWUP_2H_TITLE, facts),
      body: fillCopy(FOLLOWUP_2H_BODY, facts),
    });
    const supplement = { supplement: "Vitamin D3", amount: "2000 IU" };
    expect(supplementReminderText(supplement)).toEqual({ title: fillCopy(SUPPLEMENT_DUE_TITLE_AMOUNT, supplement), body: SUPPLEMENT_DUE_BODY });
    expect(supplementReminderText({ ...supplement, amount: "" }).title).toBe(fillCopy(SUPPLEMENT_DUE_TITLE, supplement));
    // Nothing is left unfilled.
    for (const text of [doseReminderText("due", facts), doseReminderText("follow-up-30m", facts), doseReminderText("follow-up-2h", facts), supplementReminderText(supplement)]) {
      expect(`${text.title} ${text.body}`).not.toMatch(/[{}]/);
    }
  });
});
