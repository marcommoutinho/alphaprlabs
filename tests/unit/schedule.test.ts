// Schedule engine (handoff Business Rules 1–2, plan D4, "Routine
// implementation rules" and handoff reconciliation 2): fixed weekdays,
// every-N-days after late and missed doses, older backdated confirmations,
// breaks, dose changes, validation and dose states. Daylight-saving cases are
// in schedule-dst.test.ts. Synthetic values only; not protocol guidance.
import { describe, expect, it } from "vitest";
import {
  type ActivePhase,
  type Confirmation,
  isAwaitingConfirmation,
  nextDue,
  type Occurrence,
  occurrenceState,
  type Phase,
  type PeptidePlan,
  ScheduleInputError,
  scheduleOccurrences,
  validatePlan,
} from "@/lib/schedule/engine";

// Toronto is UTC−4 throughout September 2026. Sep 2, 2026 is a Wednesday.
const TZ = "America/Toronto";
const interval = (overrides: Partial<ActivePhase> = {}): ActivePhase => ({
  id: "i1",
  kind: "active",
  start: "2026-09-02",
  end: "2026-09-30",
  doseMg: "0.4",
  time: "20:00",
  schedule: { type: "interval", everyDays: 5 },
  ...overrides,
});
const weekdays = (overrides: Partial<ActivePhase> = {}): ActivePhase => ({
  id: "w1",
  kind: "active",
  start: "2026-09-07",
  end: "2026-09-20",
  doseMg: "0.3",
  time: "07:30",
  schedule: { type: "weekdays", days: [1, 3, 5] },
  ...overrides,
});
const plan = (...phases: Phase[]): PeptidePlan => ({ planId: "p1", timeZone: TZ, phases });
const when = (occurrences: Occurrence[]) => occurrences.map((o) => `${o.key} ${o.localDate} ${o.localTime}`);
// Recorded when taken unless stated.
const taken = (key: string, actualAt: string, more: { recordedAt?: string; scheduledAt?: string } = {}): Confirmation => ({
  key,
  actualAt,
  recordedAt: more.recordedAt ?? actualAt,
  scheduledAt: more.scheduledAt,
});

describe("fixed weekdays", () => {
  it("creates each selected weekday within the phase at the local time", () => {
    const occurrences = scheduleOccurrences(plan(weekdays()));
    expect(when(occurrences)).toEqual([
      "p1:w1:2026-09-07 2026-09-07 07:30",
      "p1:w1:2026-09-09 2026-09-09 07:30",
      "p1:w1:2026-09-11 2026-09-11 07:30",
      "p1:w1:2026-09-14 2026-09-14 07:30",
      "p1:w1:2026-09-16 2026-09-16 07:30",
      "p1:w1:2026-09-18 2026-09-18 07:30",
    ]);
    expect(occurrences[0]).toEqual({
      key: "p1:w1:2026-09-07",
      planId: "p1",
      phaseId: "w1",
      scheduledAt: "2026-09-07T11:30:00Z",
      localDate: "2026-09-07",
      localTime: "07:30",
      timeZone: TZ,
      dstAdjustment: null,
      doseMg: "0.3",
      actualAt: null,
      // Follow-ups stop when the next fixed-day occurrence becomes due.
      remindersStopAt: "2026-09-09T11:30:00Z",
    });
  });

  it("numbers weekdays 0 = Sunday … 6 = Saturday", () => {
    const sundays = scheduleOccurrences(plan(weekdays({ start: "2026-09-02", end: "2026-09-30", schedule: { type: "weekdays", days: [0] } })));
    expect(sundays.map((o) => o.localDate)).toEqual(["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"]);
  });

  it("keeps its days and time however late or early a dose was taken", () => {
    const before = scheduleOccurrences(plan(weekdays()));
    const after = scheduleOccurrences(plan(weekdays()), [
      taken("p1:w1:2026-09-09", "2026-09-10T19:00:00Z"), // a day late
      taken("p1:w1:2026-09-11", "2026-09-10T20:00:00Z"), // the evening before
    ]);
    expect(when(after)).toEqual(when(before));
    expect(after.map((o) => o.actualAt)).toEqual([null, "2026-09-10T19:00:00Z", "2026-09-10T20:00:00Z", null, null, null]);
  });

  it("ignores confirmations that match no occurrence", () => {
    const occurrences = scheduleOccurrences(plan(weekdays()), [
      taken("p1:w1:2026-09-08", "2026-09-08T11:30:00Z"),
      taken("x:1", "2026-09-08T11:30:00Z"),
      taken("w1:2026-09-09", "2026-09-09T11:30:00Z"), // no plan id
      taken("p2:w1:2026-09-11", "2026-09-11T11:30:00Z"), // another plan
    ]);
    expect(occurrences.every((o) => o.actualAt === null)).toBe(true);
  });
});

describe("every N days", () => {
  it("starts on the phase start at the local time and repeats from planned times", () => {
    expect(when(scheduleOccurrences(plan(interval())))).toEqual([
      "p1:i1:0 2026-09-02 20:00",
      "p1:i1:1 2026-09-07 20:00",
      "p1:i1:2 2026-09-12 20:00",
      "p1:i1:3 2026-09-17 20:00",
      "p1:i1:4 2026-09-22 20:00",
      "p1:i1:5 2026-09-27 20:00",
    ]);
  });

  it("follows the actual time of a late dose", () => {
    // Due Wed Sep 2 20:00, taken Thu Sep 3 09:15.
    const occurrences = scheduleOccurrences(plan(interval()), [taken("p1:i1:0", "2026-09-03T13:15:00Z")]);
    expect(when(occurrences)).toEqual([
      "p1:i1:0 2026-09-02 20:00",
      "p1:i1:1 2026-09-08 09:15",
      "p1:i1:2 2026-09-13 09:15",
      "p1:i1:3 2026-09-18 09:15",
      "p1:i1:4 2026-09-23 09:15",
      "p1:i1:5 2026-09-28 09:15",
    ]);
    expect(occurrences[0].actualAt).toBe("2026-09-03T13:15:00Z");
    expect(occurrences[1].scheduledAt).toBe("2026-09-08T13:15:00Z");
  });

  it("follows the planned time of a missed dose, which stays open", () => {
    const occurrences = scheduleOccurrences(plan(interval()), [taken("p1:i1:1", "2026-09-08T00:02:00Z")]);
    expect(when(occurrences).slice(0, 3)).toEqual(["p1:i1:0 2026-09-02 20:00", "p1:i1:1 2026-09-07 20:00", "p1:i1:2 2026-09-12 20:02"]);
    expect(occurrences[0].actualAt).toBeNull();
    expect(occurrenceState(occurrences[0], "2026-09-12T12:00:00Z")).toBe("open");
  });

  it("moves the next dose when the due dose is confirmed with an earlier actual time", () => {
    // i1:1 is due Mon Sep 7 20:00; at 21:00 it is recorded as taken Sun Sep 6 18:00.
    const occurrences = scheduleOccurrences(plan(interval()), [
      taken("p1:i1:0", "2026-09-03T00:00:00Z"),
      taken("p1:i1:1", "2026-09-06T22:00:00Z", { recordedAt: "2026-09-08T01:00:00Z" }),
    ]);
    expect(when(occurrences).slice(1, 3)).toEqual(["p1:i1:1 2026-09-07 20:00", "p1:i1:2 2026-09-11 18:00"]);
  });

  it("never extends a phase after late or missed doses", () => {
    // Four missed doses, then i1:4 (due Sep 22) taken late on Sep 26 10:00.
    const occurrences = scheduleOccurrences(plan(interval()), [taken("p1:i1:4", "2026-09-26T14:00:00Z")]);
    expect(occurrences.map((o) => o.key)).toEqual(["p1:i1:0", "p1:i1:1", "p1:i1:2", "p1:i1:3", "p1:i1:4"]);
    // Reminders for the last dose stop when the phase ends (midnight after Sep 30).
    expect(occurrences[4].remindersStopAt).toBe("2026-10-01T04:00:00Z");
  });

  it("anchors on calendar days in the plan's zone, keeping the wall-clock time", () => {
    const daily = scheduleOccurrences(plan(interval({ end: "2026-09-04", schedule: { type: "interval", everyDays: 1 } })));
    expect(when(daily)).toEqual(["p1:i1:0 2026-09-02 20:00", "p1:i1:1 2026-09-03 20:00", "p1:i1:2 2026-09-04 20:00"]);
  });
});

describe("older backdated confirmations", () => {
  it("do not move the next dose earlier than a newer confirmed dose", () => {
    // i1:0 taken Sep 2 20:00; i1:1 then recorded (Sep 7 21:00) with an older actual time (Sep 1 12:00).
    const occurrences = scheduleOccurrences(plan(interval()), [
      taken("p1:i1:0", "2026-09-03T00:00:00Z"),
      taken("p1:i1:1", "2026-09-01T16:00:00Z", { recordedAt: "2026-09-08T01:00:00Z" }),
    ]);
    // Sep 2 20:00 + 5 days, not Sep 1 12:00 + 5 days.
    expect(when(occurrences)[2]).toBe("p1:i1:2 2026-09-07 20:00");
  });

  it("confirming an old open dose leaves later confirmed doses and the next due time alone", () => {
    const later = taken("p1:i1:1", "2026-09-08T00:10:00Z", { scheduledAt: "2026-09-08T00:00:00Z" });
    const before = scheduleOccurrences(plan(interval()), [later]);
    const after = scheduleOccurrences(plan(interval()), [later, taken("p1:i1:0", "2026-09-04T12:00:00Z", { recordedAt: "2026-09-09T12:00:00Z" })]);
    expect(when(after)).toEqual(when(before));
    expect(when(after)[2]).toBe("p1:i1:2 2026-09-12 20:10");
    expect(after[0].actualAt).toBe("2026-09-04T12:00:00Z");
    expect(after[1]).toMatchObject({ scheduledAt: "2026-09-08T00:00:00Z", actualAt: "2026-09-08T00:10:00Z" });
  });

  it("never drop or move a confirmed dose, even without a recorded scheduled time", () => {
    const phase = interval({ end: "2026-09-20" });
    // i1:0–i1:2 were missed; i1:3 (Sep 17 20:00) was taken on time, with no scheduled time stored.
    const confirmed = taken("p1:i1:3", "2026-09-18T00:00:00Z");
    expect(when(scheduleOccurrences(plan(phase), [confirmed]))).toEqual([
      "p1:i1:0 2026-09-02 20:00",
      "p1:i1:1 2026-09-07 20:00",
      "p1:i1:2 2026-09-12 20:00",
      "p1:i1:3 2026-09-17 20:00",
    ]);
    // On Sep 19, i1:0 is backdated to Sep 9: every dose was already due or taken, so nothing moves.
    const occurrences = scheduleOccurrences(plan(phase), [confirmed, taken("p1:i1:0", "2026-09-10T00:00:00Z", { recordedAt: "2026-09-19T12:00:00Z" })]);
    expect(when(occurrences)).toEqual(when(scheduleOccurrences(plan(phase), [confirmed])));
    expect(occurrences.map((o) => o.actualAt)).toEqual(["2026-09-10T00:00:00Z", null, null, "2026-09-18T00:00:00Z"]);
  });

  it("ignore a confirmation for a dose past the phase end", () => {
    const occurrences = scheduleOccurrences(plan(interval()), [taken("p1:i1:6", "2026-09-30T12:00:00Z")]);
    expect(occurrences.map((o) => o.key)).toEqual(["p1:i1:0", "p1:i1:1", "p1:i1:2", "p1:i1:3", "p1:i1:4", "p1:i1:5"]);
    expect(occurrences.every((o) => o.actualAt === null)).toBe(true);
  });

  it("refuse duplicate or unreadable confirmations", () => {
    expect(() => scheduleOccurrences(plan(interval()), [taken("p1:i1:0", "2026-09-03T00:00:00Z"), taken("p1:i1:0", "2026-09-04T00:00:00Z")])).toThrow(
      ScheduleInputError,
    );
    // An actual time must carry its offset: a bare local time is ambiguous.
    expect(() => scheduleOccurrences(plan(interval()), [taken("p1:i1:0", "2026-09-03T00:00:00")])).toThrow(ScheduleInputError);
    expect(() =>
      scheduleOccurrences(plan(interval()), [{ key: "p1:i1:0", actualAt: new Date(Number.NaN), recordedAt: "2026-09-03T00:00:00Z" }]),
    ).toThrow(ScheduleInputError);
    // The recording time is required and can't be before the dose was taken.
    const unrecorded = { key: "p1:i1:0", actualAt: "2026-09-03T00:00:00Z" } as unknown as Confirmation;
    expect(() => scheduleOccurrences(plan(interval()), [unrecorded])).toThrow(ScheduleInputError);
    expect(() => scheduleOccurrences(plan(interval()), [taken("p1:i1:0", "2026-09-03T00:00:00Z", { recordedAt: "2026-09-02T23:59:00Z" })])).toThrow(
      ScheduleInputError,
    );
  });
});

describe("breaks, phases and dose changes", () => {
  const first = interval({ end: "2026-09-11" });
  const pause: Phase = { id: "b1", kind: "break", start: "2026-09-12", end: "2026-09-18" };
  const second = interval({ id: "i2", start: "2026-09-19", doseMg: "0.6", time: "08:00" });

  it("schedules nothing during a break and starts the next phase on its own start date", () => {
    const occurrences = scheduleOccurrences(plan(second, pause, first));
    expect(when(occurrences)).toEqual([
      "p1:i1:0 2026-09-02 20:00",
      "p1:i1:1 2026-09-07 20:00",
      "p1:i2:0 2026-09-19 08:00",
      "p1:i2:1 2026-09-24 08:00",
      "p1:i2:2 2026-09-29 08:00",
    ]);
    expect(occurrences.map((o) => o.doseMg)).toEqual(["0.4", "0.4", "0.6", "0.6", "0.6"]);
    // The last dose before the break stops reminding when its phase ends.
    expect(occurrences[1].remindersStopAt).toBe("2026-09-12T04:00:00Z");
  });

  it("a late dose before a break adds nothing to the break and doesn't move the next phase", () => {
    const occurrences = scheduleOccurrences(plan(first, pause, second), [taken("p1:i1:1", "2026-09-10T14:00:00Z")]);
    expect(occurrences.map((o) => o.key)).toEqual(["p1:i1:0", "p1:i1:1", "p1:i2:0", "p1:i2:1", "p1:i2:2"]);
  });

  it("applies dose changes from their date without restarting the rhythm", () => {
    const changed = interval({ doseChanges: [{ from: "2026-09-15", doseMg: "0.6" }, { from: "2026-09-25", doseMg: " 0.5 " }] });
    const occurrences = scheduleOccurrences(plan(changed));
    expect(when(occurrences)).toEqual(when(scheduleOccurrences(plan(interval()))));
    expect(occurrences.map((o) => o.doseMg)).toEqual(["0.4", "0.4", "0.4", "0.6", "0.6", "0.5"]);
    const fixed = scheduleOccurrences(plan(weekdays({ doseChanges: [{ from: "2026-09-14", doseMg: "0.35" }] })));
    expect(fixed.map((o) => o.doseMg)).toEqual(["0.3", "0.3", "0.3", "0.35", "0.35", "0.35"]);
  });

  it("keeps each peptide plan independent", () => {
    const a = scheduleOccurrences(plan(interval()), [taken("p1:i1:0", "2026-09-03T13:15:00Z")]);
    const b = scheduleOccurrences(plan(weekdays()));
    expect(a[1].localTime).toBe("09:15");
    expect(b.every((o) => o.localTime === "07:30")).toBe(true);
  });
});

describe("validation", () => {
  it("reports every issue in the builder's order, numbering phases by start date", () => {
    const bad: PeptidePlan = {
      planId: "p1",
      timeZone: "Mars/Olympus_Mons",
      phases: [
        {
          id: "late",
          kind: "active",
          start: "2026-09-20",
          end: "2026-09-30",
          doseMg: "1",
          time: "08:00",
          schedule: { type: "weekdays", days: [] },
          doseChanges: [{ from: "2026-10-01", doseMg: "1" }],
        },
        { id: "a", kind: "break", start: "2026-09-01", end: "2026-09-10" },
        { id: "b", kind: "active", start: "2026-09-10", end: "2026-09-05", doseMg: "0", time: "24:00", schedule: { type: "interval", everyDays: 1.5 } },
      ],
    };
    expect(validatePlan(bad)).toEqual([
      { code: "time-zone" },
      { code: "ends-before-start", phase: 2 },
      { code: "overlap", phases: [1, 2] },
      { code: "dose", phase: 2 },
      { code: "interval", phase: 2 },
      { code: "time", phase: 2 },
      { code: "weekdays", phase: 3 },
      { code: "dose-change", phase: 3 },
    ]);
  });

  it("requires an active phase, real dates, unique ids and a schedule", () => {
    expect(validatePlan(plan({ id: "b", kind: "break", start: "2026-09-01", end: "2026-09-02" }))).toEqual([{ code: "no-active-phase" }]);
    expect(validatePlan(plan(interval({ end: "2026-02-30" })))).toEqual([{ code: "dates-missing", phase: 1 }]);
    expect(validatePlan(plan(interval({ end: "2026-09-05" }), interval({ start: "2026-09-06" })))).toEqual([{ code: "duplicate-phase-id", phase: 2 }]);
    const noSchedule = { ...interval(), schedule: undefined } as unknown as ActivePhase;
    expect(validatePlan(plan(noSchedule))).toEqual([{ code: "schedule", phase: 1 }]);
    expect(validatePlan(plan(weekdays({ schedule: { type: "weekdays", days: [1, 1] } })))).toEqual([{ code: "weekdays", phase: 1 }]);
    expect(validatePlan(plan(interval({ doseMg: "abc" })))).toEqual([{ code: "dose", phase: 1 }]);
    expect(validatePlan(plan(interval(), weekdays({ start: "2026-10-01", end: "2026-10-31" })))).toEqual([]);
    expect(validatePlan(plan(interval({ id: "" })))).toEqual([{ code: "phase-id", phase: 1 }]);
    expect(validatePlan(plan(interval({ id: "i:1" })))).toEqual([{ code: "phase-id", phase: 1 }]);
    for (const planId of ["", "a:b", undefined]) {
      expect(validatePlan({ ...plan(interval()), planId } as PeptidePlan), String(planId)).toEqual([{ code: "plan-id" }]);
    }
  });

  it("refuses to schedule an invalid plan", () => {
    try {
      scheduleOccurrences(plan(interval({ time: "8:00" })));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ScheduleInputError);
      expect((error as ScheduleInputError).issues).toEqual([{ code: "time", phase: 1 }]);
    }
  });
});

describe("dose states, next due and ranges", () => {
  const occurrences = scheduleOccurrences(plan(interval()), [taken("p1:i1:0", "2026-09-03T00:00:00Z")]);
  const [first, second, third] = occurrences;

  it("classifies by local date in the plan's zone", () => {
    // 22:00 on Mon Sep 7 in Toronto is already Sep 8 in UTC.
    const lateEvening = "2026-09-08T02:00:00Z";
    expect([first, second, third].map((o) => occurrenceState(o, lateEvening))).toEqual(["taken", "due", "planned"]);
    // Due later today is still "due".
    expect(occurrenceState(second, "2026-09-07T12:00:00Z")).toBe("due");
    expect(occurrenceState(second, "2026-09-08T12:00:00Z")).toBe("open");
    expect(occurrenceState(second, new Date("2026-09-08T12:00:00Z"))).toBe("open");
  });

  it("counts unconfirmed doses whose time has arrived", () => {
    expect(isAwaitingConfirmation(second, "2026-09-07T23:59:00Z")).toBe(false);
    expect(isAwaitingConfirmation(second, "2026-09-08T00:00:00Z")).toBe(true);
    expect(isAwaitingConfirmation(first, "2026-09-20T00:00:00Z")).toBe(false);
  });

  it("finds the next unconfirmed dose at or after now", () => {
    expect(nextDue(occurrences, "2026-09-07T12:00:00Z")?.key).toBe("p1:i1:1");
    expect(nextDue(occurrences, "2026-09-08T00:00:00Z")?.key).toBe("p1:i1:1");
    expect(nextDue(occurrences, "2026-09-08T00:00:01Z")?.key).toBe("p1:i1:2");
    expect(nextDue(occurrences, "2026-10-01T00:00:00Z")).toBeNull();
  });

  it("limits results to a local date range without changing the schedule", () => {
    const range = scheduleOccurrences(plan(interval()), [taken("p1:i1:0", "2026-09-03T00:00:00Z")], { from: "2026-09-07", to: "2026-09-17" });
    expect(range).toEqual(occurrences.slice(1, 4));
    expect(scheduleOccurrences(plan(interval()), [], { from: "2026-09-27" }).map((o) => o.key)).toEqual(["p1:i1:5"]);
  });
});

describe("limits and long phases", () => {
  it("rejects intervals outside 1–365 days and dates outside 2000–2100 with issue codes", () => {
    for (const everyDays of [0, 366, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY, 2.5]) {
      expect(validatePlan(plan(interval({ schedule: { type: "interval", everyDays } }))), String(everyDays)).toEqual([{ code: "interval", phase: 1 }]);
    }
    expect(validatePlan(plan(interval({ schedule: { type: "interval", everyDays: 365 } })))).toEqual([]);
    try {
      scheduleOccurrences(plan(interval({ schedule: { type: "interval", everyDays: Number.MAX_SAFE_INTEGER } })));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ScheduleInputError);
      expect((error as ScheduleInputError).issues).toEqual([{ code: "interval", phase: 1 }]);
    }
    expect(validatePlan(plan(weekdays({ start: "0001-01-01", end: "9999-12-31" })))).toEqual([{ code: "dates-out-of-range", phase: 1 }]);
    expect(validatePlan(plan(weekdays({ start: "1999-12-31", end: "2000-01-31" })))).toEqual([{ code: "dates-out-of-range", phase: 1 }]);
    expect(validatePlan(plan(weekdays({ start: "2100-12-01", end: "2101-01-01" })))).toEqual([{ code: "dates-out-of-range", phase: 1 }]);
    // At most 3660 days (about ten years) per phase.
    expect(validatePlan(plan(weekdays({ start: "2026-01-01", end: "2036-01-08" })))).toEqual([]);
    expect(validatePlan(plan(weekdays({ start: "2026-01-01", end: "2036-01-09" })))).toEqual([{ code: "phase-too-long", phase: 1 }]);
  });

  it("refuses an unreadable range", () => {
    expect(() => scheduleOccurrences(plan(interval()), [], { from: "2026-9-1" })).toThrow(ScheduleInputError);
  });

  it("computes a whole ten-year daily phase quickly, even with every dose confirmed", () => {
    const long = { start: "2026-01-01", end: "2036-01-08" }; // MAX_PHASE_DAYS
    const daily = plan(interval({ ...long, schedule: { type: "interval", everyDays: 1 } }));
    const everyDay = plan(weekdays({ ...long, schedule: { type: "weekdays", days: [0, 1, 2, 3, 4, 5, 6] } }));
    // Every dose taken and recorded an hour after it was due.
    const all: Confirmation[] = scheduleOccurrences(daily).map((o) => {
      const at = new Date(Date.parse(o.scheduledAt) + 3_600_000).toISOString();
      return taken(o.key, at);
    });
    const week = { from: "2035-06-01", to: "2035-06-07" };
    const time = (run: () => unknown) => {
      const started = performance.now();
      run();
      return performance.now() - started;
    };
    const weekdayMs = time(() => scheduleOccurrences(everyDay, [], week));
    const intervalMs = time(() => scheduleOccurrences(daily, [taken("p1:i1:0", "2026-01-02T12:00:00Z")], week));
    const allConfirmedMs = time(() => scheduleOccurrences(daily, all, week));
    expect(weekdayMs).toBeLessThan(1000);
    expect(intervalMs).toBeLessThan(1000);
    expect(allConfirmedMs).toBeLessThan(2000);

    expect(scheduleOccurrences(everyDay, [], week).map((o) => o.localDate)).toEqual([
      "2035-06-01",
      "2035-06-02",
      "2035-06-03",
      "2035-06-04",
      "2035-06-05",
      "2035-06-06",
      "2035-06-07",
    ]);
    // Taken Jan 2 at 07:00 EST: the daily rhythm keeps 07:00 on the wall clock, into summer time.
    expect(when(scheduleOccurrences(daily, [taken("p1:i1:0", "2026-01-02T12:00:00Z")], week))).toEqual([
      "p1:i1:3437 2035-06-01 07:00",
      "p1:i1:3438 2035-06-02 07:00",
      "p1:i1:3439 2035-06-03 07:00",
      "p1:i1:3440 2035-06-04 07:00",
      "p1:i1:3441 2035-06-05 07:00",
      "p1:i1:3442 2035-06-06 07:00",
      "p1:i1:3443 2035-06-07 07:00",
    ]);
    expect(scheduleOccurrences(daily, all, week).every((o) => o.actualAt !== null)).toBe(true);
  });

  it("returns exactly the matching part of the full schedule for any range", () => {
    // interval(): Toronto, every 5 days at 20:00 — i1:0 Sep 2, i1:1 Sep 7, i1:2 Sep 12, i1:3 Sep 17, i1:4 Sep 22, i1:5 Sep 27.
    const toOctober = interval({ end: "2026-10-31" });
    const cases: [string, Phase, Confirmation[]][] = [
      ["no confirmations", interval(), []],
      ["late dose", interval(), [taken("p1:i1:0", "2026-09-03T13:15:00Z")]],
      [
        "backdated after the next was due, then the next confirmed",
        interval(),
        [taken("p1:i1:0", "2026-09-04T12:00:00Z", { recordedAt: "2026-09-08T12:00:00Z" }), taken("p1:i1:2", "2026-09-13T01:00:00Z")],
      ],
      [
        "backdated before the next was due",
        toOctober,
        [taken("p1:i1:0", "2026-09-04T12:00:00Z", { recordedAt: "2026-09-05T12:00:00Z" })],
      ],
      [
        "older backdate after a newer confirmed dose",
        toOctober,
        [taken("p1:i1:1", "2026-09-08T00:00:00Z"), taken("p1:i1:0", "2026-09-01T12:00:00Z", { recordedAt: "2026-09-09T12:00:00Z" })],
      ],
      [
        "confirmations separated from later ranges by unconfirmed doses",
        toOctober,
        [taken("p1:i1:1", "2026-09-08T00:00:00Z"), taken("p1:i1:4", "2026-09-24T02:00:00Z", { scheduledAt: "2026-09-23T00:00:00Z" })],
      ],
      [
        "a future dose confirmed early (its actual time anchors the next)",
        toOctober,
        [taken("p1:i1:3", "2026-09-05T12:00:00Z", { recordedAt: "2026-09-07T13:00:00Z" })],
      ],
      [
        "early, late and backdated confirmations together",
        toOctober,
        [
          taken("p1:i1:2", "2026-09-10T12:00:00Z"),
          taken("p1:i1:0", "2026-08-30T12:00:00Z", { recordedAt: "2026-09-20T12:00:00Z" }),
          taken("p1:i1:5", "2026-09-21T12:00:00Z", { recordedAt: "2026-09-21T12:00:00Z" }),
          taken("p1:i1:7", "2026-10-09T00:00:00Z", { recordedAt: "2026-10-12T00:00:00Z" }),
        ],
      ],
      [
        "every 3 days with a recorded scheduled time",
        interval({ end: "2026-12-31", schedule: { type: "interval", everyDays: 3 } }),
        [taken("p1:i1:4", "2026-09-15T02:00:00Z", { scheduledAt: "2026-09-15T00:00:00Z" })],
      ],
      [
        "daily at 01:30 across the Nov 1 repeated hour",
        interval({ start: "2026-10-28", end: "2026-11-05", time: "01:30", schedule: { type: "interval", everyDays: 1 } }),
        [taken("p1:i1:2", "2026-10-30T09:00:00Z")],
      ],
      [
        "backdated to before the phase start",
        interval({ start: "2026-09-10" }),
        [taken("p1:i1:0", "2026-09-01T12:00:00Z", { recordedAt: "2026-09-11T00:30:00Z", scheduledAt: "2026-09-11T00:00:00Z" })],
      ],
      [
        "fixed weekdays with late, early and off-day recorded times",
        weekdays({ end: "2026-11-30" }),
        [
          taken("p1:w1:2026-09-09", "2026-09-10T19:00:00Z"),
          taken("p1:w1:2026-09-11", "2026-09-10T20:00:00Z", { scheduledAt: "2026-09-13T11:30:00Z" }),
          taken("p1:w1:2026-10-02", "2026-10-02T11:30:00Z", { scheduledAt: "2026-09-25T11:30:00Z" }),
        ],
      ],
    ];
    const day = (offset: number) => new Date(Date.UTC(2026, 7, 25 + offset)).toISOString().slice(0, 10); // from Aug 25
    for (const [name, phase, confirmations] of cases) {
      const full = scheduleOccurrences(plan(phase), confirmations);
      const check = (range: { from?: string; to?: string }) => {
        const expected = full.filter((o) => (!range.from || o.localDate >= range.from) && (!range.to || o.localDate <= range.to));
        expect(scheduleOccurrences(plan(phase), confirmations, range), `${name}: ${range.from ?? "…"}–${range.to ?? "…"}`).toEqual(expected);
      };
      // Every single day from Aug 25 to Dec 3, plus longer and open-ended windows.
      for (let offset = 0; offset <= 100; offset++) {
        check({ from: day(offset), to: day(offset) });
        if (offset % 2 === 0) check({ from: day(offset), to: day(offset + 4) });
        if (offset % 4 === 1) check({ from: day(offset), to: day(offset + 17) });
        if (offset % 5 === 0) check({ from: day(offset) });
        if (offset % 5 === 2) check({ to: day(offset) });
      }
    }
  });

  it("finds a dose anchored on an early confirmation outside the range", () => {
    // UTC, every 5 days at 08:00 from Sep 1. Occurrence 3 (due Sep 16) is recorded
    // on Sep 7 as taken Sep 5 08:00, so occurrence 4 falls due Sep 10 08:00.
    const utc: PeptidePlan = {
      planId: "p",
      timeZone: "UTC",
      phases: [interval({ id: "i", start: "2026-09-01", end: "2026-10-31", time: "08:00" })],
    };
    const confirmations = [taken("p:i:3", "2026-09-05T08:00:00Z", { recordedAt: "2026-09-07T09:00:00Z" })];
    const full = scheduleOccurrences(utc, confirmations);
    expect(full.find((o) => o.key === "p:i:4")?.scheduledAt).toBe("2026-09-10T08:00:00Z");
    const range = { from: "2026-09-10", to: "2026-09-10" };
    const ranged = scheduleOccurrences(utc, confirmations, range);
    expect(ranged).toEqual(full.filter((o) => o.localDate >= range.from && o.localDate <= range.to));
    expect(ranged.map((o) => `${o.key} ${o.scheduledAt}`)).toEqual(["p:i:4 2026-09-10T08:00:00Z"]);
  });

  it("reports malformed plans as validation issues, not crashes", () => {
    const malformed = [
      { planId: "p1", timeZone: TZ, phases: [null] },
      { planId: "p1", timeZone: TZ, phases: [interval(), 42] },
      { planId: "p1", timeZone: TZ, phases: "i1" },
      { planId: "p1", timeZone: TZ, phases: [{ ...interval(), start: 20260902 }] },
      { planId: "p1", timeZone: TZ, phases: [{ ...interval(), doseChanges: [null] }] },
      { planId: "p1", timeZone: TZ },
      null,
    ];
    for (const bad of malformed) {
      expect(() => scheduleOccurrences(bad as unknown as PeptidePlan), JSON.stringify(bad)).toThrow(ScheduleInputError);
    }
    expect(validatePlan({ planId: "p1", timeZone: TZ, phases: [null] } as unknown as PeptidePlan)).toEqual([{ code: "phases" }, { code: "no-active-phase" }]);
    expect(validatePlan({ planId: "p1", timeZone: TZ, phases: [interval(), null] } as unknown as PeptidePlan)).toEqual([{ code: "phases" }]);
  });

  it("replays a phase whose confirmations move doses before its start, even when the range ends before it", () => {
    // UTC, every 5 days from Sep 10 08:00. Occurrence 0 is recorded at 09:00 as taken Sep 1 08:00.
    const utc: PeptidePlan = {
      planId: "p1",
      timeZone: "UTC",
      phases: [interval({ start: "2026-09-10", time: "08:00" })],
    };
    const confirmations = [taken("p1:i1:0", "2026-09-01T08:00:00Z", { recordedAt: "2026-09-10T09:00:00Z", scheduledAt: "2026-09-10T08:00:00Z" })];
    const full = scheduleOccurrences(utc, confirmations);
    expect(full[0]).toMatchObject({ key: "p1:i1:1", scheduledAt: "2026-09-06T08:00:00Z" });
    const range = { from: "2026-09-06", to: "2026-09-06" };
    const ranged = scheduleOccurrences(utc, confirmations, range);
    expect(ranged).toEqual(full.filter((o) => o.localDate >= range.from && o.localDate <= range.to));
    expect(ranged.map((o) => o.key)).toEqual(["p1:i1:1"]);
  });
});

describe("confirmations recorded at the same instant", () => {
  it("are applied together, whatever their order in the input", () => {
    // Both recorded Mon Sep 7 21:00: i1:0 (taken Sep 2 20:00) and i1:1 (taken Sep 7 20:30).
    const recordedAt = "2026-09-08T01:00:00Z";
    const first = taken("p1:i1:0", "2026-09-03T00:00:00Z", { recordedAt });
    const second = taken("p1:i1:1", "2026-09-08T00:30:00Z", { recordedAt });
    const forward = scheduleOccurrences(plan(interval()), [first, second]);
    expect(scheduleOccurrences(plan(interval()), [second, first])).toEqual(forward);
    expect(when(forward).slice(0, 3)).toEqual(["p1:i1:0 2026-09-02 20:00", "p1:i1:1 2026-09-07 20:00", "p1:i1:2 2026-09-12 20:30"]);
  });
});
