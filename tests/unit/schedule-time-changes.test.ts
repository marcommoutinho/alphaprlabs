// Time changes within a phase (Marco, 2026-09-26): changing the dose time
// partway through keeps the every-N-days rhythm and only moves the clock time;
// fixed weekdays use the time in effect on each date.
import { describe, expect, it } from "vitest";
import { type ActivePhase, type Occurrence, scheduleOccurrences, timeOn, validatePlan } from "@/lib/schedule/engine";

const phase = (overrides: Partial<ActivePhase> = {}): ActivePhase => ({
  id: "p",
  kind: "active",
  start: "2026-09-01",
  end: "2026-09-15",
  doseMg: "0.25",
  time: "08:00",
  schedule: { type: "interval", everyDays: 3 },
  ...overrides,
});
const run = (p: ActivePhase, confirmations: { key: string; actualAt: string; recordedAt?: string }[] = [], timeZone = "America/Toronto") =>
  scheduleOccurrences(
    { planId: "plan", timeZone, phases: [p] },
    confirmations.map((c) => ({ recordedAt: c.actualAt, ...c })),
  );
const rows = (occurrences: Occurrence[]) => occurrences.map((o) => `${o.key.slice(7)} ${o.localDate} ${o.localTime}`);
const instants = (occurrences: Occurrence[]) => occurrences.map((o) => `${o.localDate} ${o.localTime} ${o.scheduledAt} ${o.dstAdjustment ?? "-"}`);

describe("every N days", () => {
  it("keeps the dates and moves only the clock time from the change date", () => {
    expect(rows(run(phase({ timeChanges: [{ from: "2026-09-05", time: "20:00" }] })))).toEqual([
      "0 2026-09-01 08:00",
      "1 2026-09-04 08:00",
      "2 2026-09-07 20:00",
      "3 2026-09-10 20:00",
      "4 2026-09-13 20:00",
    ]);
  });

  it("applies a change dated on a dose day to that dose", () => {
    expect(rows(run(phase({ timeChanges: [{ from: "2026-09-07", time: "06:15" }] }))).slice(1, 3)).toEqual([
      "1 2026-09-04 08:00",
      "2 2026-09-07 06:15",
    ]);
  });

  it("uses a change on the start date for the first dose, and the latest of several changes", () => {
    const p = phase({
      timeChanges: [
        { from: "2026-09-01", time: "09:00" },
        { from: "2026-09-05", time: "10:00" },
        { from: "2026-09-06", time: "11:00" },
      ],
    });
    expect(rows(run(p)).slice(0, 3)).toEqual(["0 2026-09-01 09:00", "1 2026-09-04 09:00", "2 2026-09-07 11:00"]);
    expect([timeOn(p, "2026-08-31"), timeOn(p, "2026-09-01"), timeOn(p, "2026-09-05"), timeOn(p, "2026-09-30")]).toEqual([
      "08:00",
      "09:00",
      "10:00",
      "11:00",
    ]);
  });

  it("moves the time after a late confirmation without moving the rhythm", () => {
    const p = phase({ timeChanges: [{ from: "2026-09-05", time: "20:00" }] });
    // Taken at 11:00 on the 4th: the next dose is still on the 7th, at the new time.
    expect(rows(run(p, [{ key: "plan:p:1", actualAt: "2026-09-04T15:00:00Z" }])).slice(1, 4)).toEqual([
      "1 2026-09-04 08:00",
      "2 2026-09-07 20:00",
      "3 2026-09-10 20:00",
    ]);
  });

  it("follows a late actual time again once the change is in effect", () => {
    const p = phase({ timeChanges: [{ from: "2026-09-05", time: "20:00" }] });
    // Dose 2 (the 7th, 20:00) taken at 22:00: the next follows the actual time, as before.
    expect(rows(run(p, [{ key: "plan:p:2", actualAt: "2026-09-08T02:00:00Z" }])).slice(2, 4)).toEqual([
      "2 2026-09-07 20:00",
      "3 2026-09-10 22:00",
    ]);
  });

  it("re-anchors on a backdated confirmation and still applies the change", () => {
    const p = phase({ timeChanges: [{ from: "2026-09-05", time: "20:00" }] });
    const late = [{ key: "plan:p:1", actualAt: "2026-09-04T13:00:00Z", recordedAt: "2026-09-06T12:00:00Z" }];
    expect(rows(run(p, late)).slice(1, 3)).toEqual(["1 2026-09-04 08:00", "2 2026-09-07 20:00"]);
  });

  it("carries the intended time across a spring-forward gap (America/New_York)", () => {
    const p = phase({
      start: "2026-03-04",
      end: "2026-03-11",
      schedule: { type: "interval", everyDays: 2 },
      timeChanges: [{ from: "2026-03-07", time: "02:30" }],
    });
    expect(instants(run(p, [], "America/New_York"))).toEqual([
      "2026-03-04 08:00 2026-03-04T13:00:00Z -",
      "2026-03-06 08:00 2026-03-06T13:00:00Z -",
      "2026-03-08 03:30 2026-03-08T07:30:00Z gap",
      "2026-03-10 02:30 2026-03-10T06:30:00Z -",
    ]);
  });

  it("uses the earlier instant of a repeated time after a change (fall back)", () => {
    const p = phase({
      start: "2026-10-30",
      end: "2026-11-02",
      schedule: { type: "interval", everyDays: 1 },
      timeChanges: [{ from: "2026-11-01", time: "01:30" }],
    });
    expect(instants(run(p, [], "America/New_York")).slice(2)).toEqual([
      "2026-11-01 01:30 2026-11-01T05:30:00Z repeat",
      "2026-11-02 01:30 2026-11-02T06:30:00Z -",
    ]);
  });

  it("computes the new time in the plan's zone (Asia/Tokyo)", () => {
    const p = phase({ timeChanges: [{ from: "2026-09-05", time: "23:30" }] });
    expect(instants(run(p, [], "Asia/Tokyo")).slice(1, 3)).toEqual([
      "2026-09-04 08:00 2026-09-03T23:00:00Z -",
      "2026-09-07 23:30 2026-09-07T14:30:00Z -",
    ]);
  });
});

describe("fixed weekdays", () => {
  it("uses the time in effect on each date", () => {
    const p = phase({
      start: "2026-09-07",
      end: "2026-09-13",
      schedule: { type: "weekdays", days: [1, 3, 5] },
      timeChanges: [{ from: "2026-09-09", time: "21:00" }],
    });
    expect(rows(run(p))).toEqual(["2026-09-07 2026-09-07 08:00", "2026-09-09 2026-09-09 21:00", "2026-09-11 2026-09-11 21:00"]);
  });
});

describe("validation", () => {
  const issues = (timeChanges: unknown) =>
    validatePlan({ planId: "plan", timeZone: "America/Toronto", phases: [phase({ timeChanges: timeChanges as ActivePhase["timeChanges"] })] });

  it("accepts dated, distinct, valid times within the phase", () => {
    expect(issues([{ from: "2026-09-05", time: "20:00" }])).toEqual([]);
  });

  it.each([
    ["an invalid time", [{ from: "2026-09-05", time: "25:00" }]],
    ["a date before the phase", [{ from: "2026-08-31", time: "20:00" }]],
    ["a date after the phase", [{ from: "2026-09-16", time: "20:00" }]],
    ["two changes on one date", [{ from: "2026-09-05", time: "20:00" }, { from: "2026-09-05", time: "21:00" }]],
    ["a missing date", [{ time: "20:00" }]],
    ["not a list", "20:00"],
  ])("refuses %s", (_, changes) => {
    expect(issues(changes)).toEqual([{ code: "time-change", phase: 1 }]);
  });
});
