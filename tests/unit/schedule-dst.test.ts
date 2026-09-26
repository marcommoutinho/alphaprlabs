// Daylight-saving behavior of the schedule engine (plan D4 refinement): a
// nonexistent local time moves forward by the gap, a repeated local time uses
// the earlier instant, and wall-clock times hold across changes. Covers
// America/New_York and Europe/Lisbon (both change in 2026 on different dates),
// and America/Regina and Asia/Kolkata (no daylight saving).
import { describe, expect, it } from "vitest";
import { type ActivePhase, type Occurrence, scheduleOccurrences } from "@/lib/schedule/engine";
import { isValidTimeZone, resolveLocal } from "@/lib/schedule/zone";

const everyDay = (start: string, end: string, time: string, overrides: Partial<ActivePhase> = {}): ActivePhase => ({
  id: "p",
  kind: "active",
  start,
  end,
  doseMg: "0.25",
  time,
  schedule: { type: "weekdays", days: [0, 1, 2, 3, 4, 5, 6] },
  ...overrides,
});
const run = (timeZone: string, phase: ActivePhase, confirmations: { key: string; actualAt: string }[] = []) =>
  scheduleOccurrences({ timeZone, phases: [phase] }, confirmations);
const rows = (occurrences: Occurrence[]) =>
  occurrences.map((o) => `${o.localDate} ${o.localTime} ${o.scheduledAt} ${o.dstAdjustment ?? "-"}`);

describe("America/New_York", () => {
  it("moves a time in the spring-forward gap forward by the gap (Mar 8, 2026)", () => {
    expect(rows(run("America/New_York", everyDay("2026-03-07", "2026-03-09", "02:30")))).toEqual([
      "2026-03-07 02:30 2026-03-07T07:30:00Z -",
      "2026-03-08 03:30 2026-03-08T07:30:00Z gap",
      "2026-03-09 02:30 2026-03-09T06:30:00Z -",
    ]);
  });

  it("uses the earlier of a repeated fall-back time (Nov 1, 2026)", () => {
    expect(rows(run("America/New_York", everyDay("2026-10-31", "2026-11-02", "01:30")))).toEqual([
      "2026-10-31 01:30 2026-10-31T05:30:00Z -",
      "2026-11-01 01:30 2026-11-01T05:30:00Z repeat",
      "2026-11-02 01:30 2026-11-02T06:30:00Z -",
    ]);
  });

  it("leaves other times on a change day alone", () => {
    expect(rows(run("America/New_York", everyDay("2026-03-08", "2026-03-08", "08:00")))).toEqual([
      "2026-03-08 08:00 2026-03-08T12:00:00Z -",
    ]);
  });

  it("keeps an every-N-days wall-clock time across the change (a 23-hour day)", () => {
    const daily = everyDay("2026-03-06", "2026-03-09", "20:00", { schedule: { type: "interval", everyDays: 1 } });
    expect(rows(run("America/New_York", daily))).toEqual([
      "2026-03-06 20:00 2026-03-07T01:00:00Z -",
      "2026-03-07 20:00 2026-03-08T01:00:00Z -",
      "2026-03-08 20:00 2026-03-09T00:00:00Z -",
      "2026-03-09 20:00 2026-03-10T00:00:00Z -",
    ]);
  });

  it("resolves an actual time + N days that lands in the repeated hour to the earlier instant", () => {
    // Taken Fri Oct 30 at 01:30 EDT; every 2 days → Sun Nov 1 01:30, which occurs twice.
    const phase = everyDay("2026-10-29", "2026-11-04", "09:00", { schedule: { type: "interval", everyDays: 2 } });
    const occurrences = run("America/New_York", phase, [{ key: "p:0", actualAt: "2026-10-30T05:30:00Z" }]);
    expect(rows(occurrences).slice(1, 3)).toEqual([
      "2026-11-01 01:30 2026-11-01T05:30:00Z repeat",
      "2026-11-03 01:30 2026-11-03T06:30:00Z -",
    ]);
  });

  it("ends reminders at local midnight after the last day, on change days too", () => {
    expect(run("America/New_York", everyDay("2026-03-08", "2026-03-08", "08:00"))[0].remindersStopAt).toBe("2026-03-09T04:00:00Z");
    expect(run("America/New_York", everyDay("2026-11-01", "2026-11-01", "08:00"))[0].remindersStopAt).toBe("2026-11-02T05:00:00Z");
  });
});

describe("Europe/Lisbon", () => {
  it("moves a time in the spring-forward gap forward by the gap (Mar 29, 2026)", () => {
    expect(rows(run("Europe/Lisbon", everyDay("2026-03-28", "2026-03-30", "01:30")))).toEqual([
      "2026-03-28 01:30 2026-03-28T01:30:00Z -",
      "2026-03-29 02:30 2026-03-29T01:30:00Z gap",
      "2026-03-30 01:30 2026-03-30T00:30:00Z -",
    ]);
  });

  it("uses the earlier of a repeated fall-back time (Oct 25, 2026)", () => {
    expect(rows(run("Europe/Lisbon", everyDay("2026-10-24", "2026-10-26", "01:30")))).toEqual([
      "2026-10-24 01:30 2026-10-24T00:30:00Z -",
      "2026-10-25 01:30 2026-10-25T00:30:00Z repeat",
      "2026-10-26 01:30 2026-10-26T01:30:00Z -",
    ]);
  });

  it("returns to the intended time after a gap when doses go unconfirmed", () => {
    const phase = everyDay("2026-03-27", "2026-04-01", "01:30", { schedule: { type: "interval", everyDays: 2 } });
    expect(rows(run("Europe/Lisbon", phase))).toEqual([
      "2026-03-27 01:30 2026-03-27T01:30:00Z -",
      "2026-03-29 02:30 2026-03-29T01:30:00Z gap",
      "2026-03-31 01:30 2026-03-31T00:30:00Z -",
    ]);
  });

  it("shifts an actual time + N days that lands in the gap", () => {
    // Planned 09:00, taken Fri Mar 27 at 01:30 WET; +2 days is 01:30 on the gap day.
    const phase = everyDay("2026-03-26", "2026-04-02", "09:00", { schedule: { type: "interval", everyDays: 2 } });
    const occurrences = run("Europe/Lisbon", phase, [{ key: "p:0", actualAt: "2026-03-27T01:30:00Z" }]);
    expect(rows(occurrences).slice(1)).toEqual([
      "2026-03-29 02:30 2026-03-29T01:30:00Z gap",
      "2026-03-31 01:30 2026-03-31T00:30:00Z -",
      "2026-04-02 01:30 2026-04-02T00:30:00Z -",
    ]);
  });
});

describe("zones without daylight saving", () => {
  it("America/Regina keeps one offset all year", () => {
    const spring = rows(run("America/Regina", everyDay("2026-03-07", "2026-03-09", "02:30")));
    const fall = rows(run("America/Regina", everyDay("2026-10-31", "2026-11-02", "01:30")));
    expect(spring).toEqual([
      "2026-03-07 02:30 2026-03-07T08:30:00Z -",
      "2026-03-08 02:30 2026-03-08T08:30:00Z -",
      "2026-03-09 02:30 2026-03-09T08:30:00Z -",
    ]);
    expect(fall).toEqual([
      "2026-10-31 01:30 2026-10-31T07:30:00Z -",
      "2026-11-01 01:30 2026-11-01T07:30:00Z -",
      "2026-11-02 01:30 2026-11-02T07:30:00Z -",
    ]);
  });

  it("Asia/Kolkata handles a half-hour offset", () => {
    expect(rows(run("Asia/Kolkata", everyDay("2026-03-08", "2026-03-08", "08:00")))).toEqual(["2026-03-08 08:00 2026-03-08T02:30:00Z -"]);
  });
});

describe("zone helpers", () => {
  it("accepts only real IANA zone names", () => {
    for (const zone of ["America/Toronto", "Europe/Lisbon", "America/Regina", "UTC"]) expect(isValidTimeZone(zone), zone).toBe(true);
    for (const zone of ["", " America/Toronto", "Mars/Olympus_Mons", "EST5EDT/Nope", 42, null]) expect(isValidTimeZone(zone), String(zone)).toBe(false);
  });

  it("resolves the same local time differently per zone, independent of the runtime zone", () => {
    expect(resolveLocal("2026-03-08", "02:30", "America/New_York").instant.toString()).toBe("2026-03-08T07:30:00Z");
    expect(resolveLocal("2026-03-08", "02:30", "Europe/Lisbon").instant.toString()).toBe("2026-03-08T02:30:00Z");
  });
});
