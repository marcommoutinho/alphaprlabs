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
const plan = (...phases: Phase[]): PeptidePlan => ({ timeZone: TZ, phases });
const when = (occurrences: Occurrence[]) => occurrences.map((o) => `${o.key} ${o.localDate} ${o.localTime}`);
const taken = (key: string, actualAt: string, scheduledAt?: string): Confirmation => ({ key, actualAt, scheduledAt });

describe("fixed weekdays", () => {
  it("creates each selected weekday within the phase at the local time", () => {
    const occurrences = scheduleOccurrences(plan(weekdays()));
    expect(when(occurrences)).toEqual([
      "w1:2026-09-07 2026-09-07 07:30",
      "w1:2026-09-09 2026-09-09 07:30",
      "w1:2026-09-11 2026-09-11 07:30",
      "w1:2026-09-14 2026-09-14 07:30",
      "w1:2026-09-16 2026-09-16 07:30",
      "w1:2026-09-18 2026-09-18 07:30",
    ]);
    expect(occurrences[0]).toEqual({
      key: "w1:2026-09-07",
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
      taken("w1:2026-09-09", "2026-09-10T19:00:00Z"), // a day late
      taken("w1:2026-09-11", "2026-09-10T20:00:00Z"), // the evening before
    ]);
    expect(when(after)).toEqual(when(before));
    expect(after.map((o) => o.actualAt)).toEqual([null, "2026-09-10T19:00:00Z", "2026-09-10T20:00:00Z", null, null, null]);
  });

  it("ignores confirmations that match no occurrence", () => {
    const occurrences = scheduleOccurrences(plan(weekdays()), [taken("w1:2026-09-08", "2026-09-08T11:30:00Z"), taken("x:1", "2026-09-08T11:30:00Z")]);
    expect(occurrences.every((o) => o.actualAt === null)).toBe(true);
  });
});

describe("every N days", () => {
  it("starts on the phase start at the local time and repeats from planned times", () => {
    expect(when(scheduleOccurrences(plan(interval())))).toEqual([
      "i1:0 2026-09-02 20:00",
      "i1:1 2026-09-07 20:00",
      "i1:2 2026-09-12 20:00",
      "i1:3 2026-09-17 20:00",
      "i1:4 2026-09-22 20:00",
      "i1:5 2026-09-27 20:00",
    ]);
  });

  it("follows the actual time of a late dose", () => {
    // Due Wed Sep 2 20:00, taken Thu Sep 3 09:15.
    const occurrences = scheduleOccurrences(plan(interval()), [taken("i1:0", "2026-09-03T13:15:00Z")]);
    expect(when(occurrences)).toEqual([
      "i1:0 2026-09-02 20:00",
      "i1:1 2026-09-08 09:15",
      "i1:2 2026-09-13 09:15",
      "i1:3 2026-09-18 09:15",
      "i1:4 2026-09-23 09:15",
      "i1:5 2026-09-28 09:15",
    ]);
    expect(occurrences[0].actualAt).toBe("2026-09-03T13:15:00Z");
    expect(occurrences[1].scheduledAt).toBe("2026-09-08T13:15:00Z");
  });

  it("follows the planned time of a missed dose, which stays open", () => {
    const occurrences = scheduleOccurrences(plan(interval()), [taken("i1:1", "2026-09-08T00:02:00Z")]);
    expect(when(occurrences).slice(0, 3)).toEqual(["i1:0 2026-09-02 20:00", "i1:1 2026-09-07 20:00", "i1:2 2026-09-12 20:02"]);
    expect(occurrences[0].actualAt).toBeNull();
    expect(occurrenceState(occurrences[0], "2026-09-12T12:00:00Z")).toBe("open");
  });

  it("moves the next dose when the due dose is confirmed with an earlier actual time", () => {
    // i1:1 is due Mon Sep 7 20:00; recorded as taken Sun Sep 6 18:00.
    const occurrences = scheduleOccurrences(plan(interval()), [
      taken("i1:0", "2026-09-03T00:00:00Z"),
      taken("i1:1", "2026-09-06T22:00:00Z"),
    ]);
    expect(when(occurrences).slice(1, 3)).toEqual(["i1:1 2026-09-07 20:00", "i1:2 2026-09-11 18:00"]);
  });

  it("never extends a phase after late or missed doses", () => {
    // Four missed doses, then i1:4 (due Sep 22) taken late on Sep 26 10:00.
    const occurrences = scheduleOccurrences(plan(interval()), [taken("i1:4", "2026-09-26T14:00:00Z")]);
    expect(occurrences.map((o) => o.key)).toEqual(["i1:0", "i1:1", "i1:2", "i1:3", "i1:4"]);
    // Reminders for the last dose stop when the phase ends (midnight after Sep 30).
    expect(occurrences[4].remindersStopAt).toBe("2026-10-01T04:00:00Z");
  });

  it("anchors on calendar days in the plan's zone, keeping the wall-clock time", () => {
    const daily = scheduleOccurrences(plan(interval({ end: "2026-09-04", schedule: { type: "interval", everyDays: 1 } })));
    expect(when(daily)).toEqual(["i1:0 2026-09-02 20:00", "i1:1 2026-09-03 20:00", "i1:2 2026-09-04 20:00"]);
  });
});

describe("older backdated confirmations", () => {
  it("do not move the next dose earlier than a newer confirmed dose", () => {
    // i1:0 taken Sep 2 20:00; i1:1 then recorded with an older actual time (Sep 1 12:00).
    const occurrences = scheduleOccurrences(plan(interval()), [
      taken("i1:0", "2026-09-03T00:00:00Z"),
      taken("i1:1", "2026-09-01T16:00:00Z"),
    ]);
    // Sep 2 20:00 + 5 days, not Sep 1 12:00 + 5 days.
    expect(when(occurrences)[2]).toBe("i1:2 2026-09-07 20:00");
  });

  it("confirming an old open dose leaves later confirmed doses and the next due time alone", () => {
    const later = taken("i1:1", "2026-09-08T00:10:00Z", "2026-09-08T00:00:00Z");
    const before = scheduleOccurrences(plan(interval()), [later]);
    const after = scheduleOccurrences(plan(interval()), [later, taken("i1:0", "2026-09-04T12:00:00Z")]);
    expect(when(after)).toEqual(when(before));
    expect(when(after)[2]).toBe("i1:2 2026-09-12 20:10");
    expect(after[0].actualAt).toBe("2026-09-04T12:00:00Z");
    expect(after[1]).toMatchObject({ scheduledAt: "2026-09-08T00:00:00Z", actualAt: "2026-09-08T00:10:00Z" });
  });

  it("never drop a confirmed dose, even when a backdated entry reshapes the open ones", () => {
    const phase = interval({ end: "2026-09-20" });
    const confirmed = taken("i1:3", "2026-09-18T00:00:00Z", "2026-09-18T00:00:00Z");
    expect(when(scheduleOccurrences(plan(phase), [confirmed])).map((w) => w.split(" ")[0])).toEqual(["i1:0", "i1:1", "i1:2", "i1:3"]);
    // i1:0 later recorded as taken Sep 9: i1:3 would now be planned for Sep 24,
    // after the phase, but it was taken and stays, at its recorded time.
    const occurrences = scheduleOccurrences(plan(phase), [confirmed, taken("i1:0", "2026-09-10T00:00:00Z")]);
    expect(when(occurrences)).toEqual([
      "i1:0 2026-09-02 20:00",
      "i1:1 2026-09-14 20:00",
      "i1:3 2026-09-17 20:00",
      "i1:2 2026-09-19 20:00",
    ]);
    expect(occurrences.find((o) => o.key === "i1:3")?.actualAt).toBe("2026-09-18T00:00:00Z");
  });

  it("refuse duplicate or unreadable confirmations", () => {
    expect(() => scheduleOccurrences(plan(interval()), [taken("i1:0", "2026-09-03T00:00:00Z"), taken("i1:0", "2026-09-04T00:00:00Z")])).toThrow(
      ScheduleInputError,
    );
    // An actual time must carry its offset: a bare local time is ambiguous.
    expect(() => scheduleOccurrences(plan(interval()), [taken("i1:0", "2026-09-03T00:00:00")])).toThrow(ScheduleInputError);
    expect(() => scheduleOccurrences(plan(interval()), [{ key: "i1:0", actualAt: new Date(Number.NaN) }])).toThrow(ScheduleInputError);
  });
});

describe("breaks, phases and dose changes", () => {
  const first = interval({ end: "2026-09-11" });
  const pause: Phase = { id: "b1", kind: "break", start: "2026-09-12", end: "2026-09-18" };
  const second = interval({ id: "i2", start: "2026-09-19", doseMg: "0.6", time: "08:00" });

  it("schedules nothing during a break and starts the next phase on its own start date", () => {
    const occurrences = scheduleOccurrences(plan(second, pause, first));
    expect(when(occurrences)).toEqual([
      "i1:0 2026-09-02 20:00",
      "i1:1 2026-09-07 20:00",
      "i2:0 2026-09-19 08:00",
      "i2:1 2026-09-24 08:00",
      "i2:2 2026-09-29 08:00",
    ]);
    expect(occurrences.map((o) => o.doseMg)).toEqual(["0.4", "0.4", "0.6", "0.6", "0.6"]);
    // The last dose before the break stops reminding when its phase ends.
    expect(occurrences[1].remindersStopAt).toBe("2026-09-12T04:00:00Z");
  });

  it("a late dose before a break adds nothing to the break and doesn't move the next phase", () => {
    const occurrences = scheduleOccurrences(plan(first, pause, second), [taken("i1:1", "2026-09-10T14:00:00Z")]);
    expect(occurrences.map((o) => o.key)).toEqual(["i1:0", "i1:1", "i2:0", "i2:1", "i2:2"]);
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
    const a = scheduleOccurrences(plan(interval()), [taken("i1:0", "2026-09-03T13:15:00Z")]);
    const b = scheduleOccurrences(plan(weekdays()));
    expect(a[1].localTime).toBe("09:15");
    expect(b.every((o) => o.localTime === "07:30")).toBe(true);
  });
});

describe("validation", () => {
  it("reports every issue in the builder's order, numbering phases by start date", () => {
    const bad: PeptidePlan = {
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
  const occurrences = scheduleOccurrences(plan(interval()), [taken("i1:0", "2026-09-03T00:00:00Z")]);
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
    expect(nextDue(occurrences, "2026-09-07T12:00:00Z")?.key).toBe("i1:1");
    expect(nextDue(occurrences, "2026-09-08T00:00:00Z")?.key).toBe("i1:1");
    expect(nextDue(occurrences, "2026-09-08T00:00:01Z")?.key).toBe("i1:2");
    expect(nextDue(occurrences, "2026-10-01T00:00:00Z")).toBeNull();
  });

  it("limits results to a local date range without changing the schedule", () => {
    const range = scheduleOccurrences(plan(interval()), [taken("i1:0", "2026-09-03T00:00:00Z")], { from: "2026-09-07", to: "2026-09-17" });
    expect(range).toEqual(occurrences.slice(1, 4));
    expect(scheduleOccurrences(plan(interval()), [], { from: "2026-09-27" }).map((o) => o.key)).toEqual(["i1:5"]);
  });
});
