// S16 R10 supplements, pure: the routine form (amount decimals with the comma
// rules, lengths in characters, the daily time), the Taken input, the
// routine's occurrences (its dates, America/Toronto's daylight-saving
// changes), Today's supplement lines merged with the dose rows, and R10's
// cards. Sep 27, 2026 is a Sunday; Toronto is on EDT (UTC-4) until Nov 1.
import { describe, expect, it } from "vitest";
import type { TodayRow } from "@/lib/doses/today";
import {
  AMOUNT_REQUIRED,
  AMOUNT_TOO_LARGE,
  AMOUNT_TOO_PRECISE,
  NAME_REQUIRED,
  END_BEFORE_START,
  END_PAST,
  NAME_TOO_LONG,
  readTakenForm,
  START_INVALID,
  ROUTINE_INVALID,
  routineAmount,
  takenTimeError,
  TIME_FUTURE,
  TIME_REQUIRED,
  UNIT_TOO_LONG,
  validateRoutine,
} from "@/lib/supplements/rules";
import { occurrenceOn, occurrencesBetween, parseSupplementKey, runsOn, supplementKey } from "@/lib/supplements/schedule";
import type { Routine, TakenRecord } from "@/lib/supplements/service";
import {
  mergeTodayRows,
  NO_CYCLES_BODY,
  NO_CYCLES_BODY_SUPPLEMENTS,
  routineEnded,
  supplementsToday,
  supplementsTodayList,
  supplementsView,
  todayNotes,
  weekGrid,
} from "@/lib/supplements/view";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TORONTO = "America/Toronto";

/** A routine; its definition dates from its start unless given. */
const routine = (overrides: Partial<Routine> = {}): Routine => {
  const base = {
    id: uuid(1),
    name: "Vitamin D3",
    amount: "2000",
    unit: "IU",
    time: "08:00",
    timeZone: TORONTO,
    startDate: "2026-09-20",
    endDate: null,
    version: 1,
    createdAt: "2026-09-20T12:00:00Z",
    ...overrides,
  };
  return { ...base, definitionFrom: overrides.definitionFrom ?? base.startDate };
};

const taken = (r: Routine, date: string, actualAt: string, overrides: Partial<TakenRecord> = {}): TakenRecord => ({
  id: uuid(Number(date.slice(8)) + 500),
  routineId: r.id,
  occurrenceKey: supplementKey(r.id, date),
  localDate: date,
  // A Taken from before an edit keeps its own time (no longer an occurrence): pass it in overrides.
  scheduledAt: overrides.scheduledAt ?? occurrenceOn(r, date)!.scheduledAt,
  name: r.name,
  amount: r.amount,
  unit: r.unit,
  actualAt,
  recordedAt: actualAt,
  ...overrides,
});

const form = (overrides: Record<string, unknown> = {}) => ({ id: null, version: null, name: "Vitamin D3", amount: "2000", unit: "IU", time: "08:00", ...overrides });

describe("the routine form", () => {
  it("accepts a decimal comma, refuses grouping and keeps amounts exact", () => {
    expect(routineAmount("1,5")).toEqual({ ok: true, value: "1.5" });
    expect(routineAmount(" 0,125 ")).toEqual({ ok: true, value: "0.125" });
    expect(routineAmount("2000.000")).toEqual({ ok: true, value: "2000" });
    expect(routineAmount("999999.999999")).toEqual({ ok: true, value: "999999.999999" });
    for (const refused of ["1,000", "12,500", "1.000,5", "1e3", "", "abc", "0", "-1", "0,0", 2000]) {
      expect(routineAmount(refused), String(refused)).toEqual({ ok: false, error: AMOUNT_REQUIRED });
    }
    expect(routineAmount("1000000")).toEqual({ ok: false, error: AMOUNT_TOO_LARGE });
    expect(routineAmount("0.0000001")).toEqual({ ok: false, error: AMOUNT_TOO_PRECISE });
  });

  it("checks in the prototype's order and trims text", () => {
    expect(validateRoutine(form({ name: "  ", amount: "", unit: "", time: "" }))).toEqual({ ok: false, error: NAME_REQUIRED });
    expect(validateRoutine(form({ amount: "" }))).toEqual({ ok: false, error: AMOUNT_REQUIRED });
    expect(validateRoutine(form({ unit: " \t" }))).toEqual({ ok: false, error: AMOUNT_REQUIRED });
    for (const time of ["", "8:00", "24:00", "07:60", "07:30:00"]) {
      expect(validateRoutine(form({ time })), time).toEqual({ ok: false, error: TIME_REQUIRED });
    }
    expect(validateRoutine(form({ name: "  Magnesium ", amount: "1,5", unit: " capsules ", time: "21:30" }))).toEqual({
      ok: true,
      value: { id: null, version: null, name: "Magnesium", amount: "1.5", unit: "capsules", time: "21:30", startDate: null, endDate: null },
    });
  });

  it("checks R13's start and optional end as the database does: start today to a year ahead, end never before the start or today", () => {
    const today = "2026-09-27";
    const ok = (overrides: Record<string, unknown>) => validateRoutine(form(overrides), today);
    expect(ok({ startDate: "2026-09-27", endDate: "" })).toMatchObject({ ok: true, value: { startDate: "2026-09-27", endDate: null } });
    expect(ok({ startDate: "2026-10-01", endDate: "2026-10-01" })).toMatchObject({ ok: true, value: { startDate: "2026-10-01", endDate: "2026-10-01" } });
    expect(ok({ startDate: "2027-09-28" })).toMatchObject({ ok: true });
    for (const start of ["2026-09-26", "2027-09-29", "2026-02-30", "Sep 30"]) {
      expect(ok({ startDate: start }), start).toEqual({ ok: false, error: START_INVALID });
    }
    expect(ok({ startDate: "2026-10-01", endDate: "2026-09-30" })).toEqual({ ok: false, error: END_BEFORE_START });
    // No start: a new routine starts today.
    expect(ok({ endDate: "2026-09-26" })).toEqual({ ok: false, error: END_BEFORE_START });
    expect(ok({ endDate: "2026-09-27" })).toMatchObject({ ok: true, value: { startDate: null, endDate: "2026-09-27" } });
    // Editing: the start stays (never sent), the end can move but not into the past.
    const edit = { id: uuid(1), version: 2 };
    expect(ok({ ...edit, startDate: "2026-12-01", endDate: "2026-10-10" })).toMatchObject({ ok: true, value: { startDate: null, endDate: "2026-10-10" } });
    expect(ok({ ...edit, endDate: "2026-09-20" })).toEqual({ ok: false, error: END_PAST });
    // Names first, then dates.
    expect(ok({ name: "", startDate: "2020-01-01" })).toEqual({ ok: false, error: NAME_REQUIRED });
  });

  it("counts lengths in characters (code points), as the database does", () => {
    const emoji = "\u{1F48A}"; // two UTF-16 units, one character
    expect(validateRoutine(form({ name: emoji.repeat(80) })).ok).toBe(true);
    expect(validateRoutine(form({ name: emoji.repeat(81) }))).toEqual({ ok: false, error: NAME_TOO_LONG });
    expect(validateRoutine(form({ unit: emoji.repeat(20) })).ok).toBe(true);
    expect(validateRoutine(form({ unit: emoji.repeat(21) }))).toEqual({ ok: false, error: UNIT_TOO_LONG });
  });

  it("needs a real id and version to edit", () => {
    expect(validateRoutine(form({ id: uuid(1).toUpperCase(), version: 3 }))).toMatchObject({ ok: true, value: { id: uuid(1), version: 3 } });
    for (const bad of [{ id: "nope", version: 1 }, { id: uuid(1), version: null }, { id: uuid(1), version: 0 }, { id: uuid(1), version: 1.5 }]) {
      expect(validateRoutine(form(bad)), JSON.stringify(bad)).toEqual({ ok: false, error: ROUTINE_INVALID });
    }
    expect(validateRoutine(null)).toEqual({ ok: false, error: ROUTINE_INVALID });
  });
});

describe("the Taken input", () => {
  const input = { requestKey: uuid(9), key: `${uuid(1)}:2026-09-27`, seenScheduledAt: "2026-09-27T12:00:00Z", seenName: "Vitamin D3", seenAmount: "2000", seenUnit: "IU", actual: null };

  it("reads a Taken, or nothing that isn't one", () => {
    expect(readTakenForm(input)).toEqual(input);
    expect(readTakenForm({ ...input, actual: "2026-09-27T07:45" })?.actual).toBe("2026-09-27T07:45");
    for (const bad of [{ key: `${uuid(1)}:0` }, { key: `${uuid(1)}:${uuid(2)}:2026-09-27` }, { requestKey: "x" }, { actual: 5 }, { seenAmount: "" }, { seenName: "" }, { seenName: undefined }]) {
      expect(readTakenForm({ ...input, ...bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it("refuses a future or malformed actual time (the server re-checks both limits)", () => {
    expect(takenTimeError(null, "2026-09-27T10:00")).toBeNull();
    expect(takenTimeError("2026-09-26T09:00", "2026-09-27T10:00")).toBeNull();
    expect(takenTimeError("2026-09-27T10:01", "2026-09-27T10:00")).toBe(TIME_FUTURE);
    expect(takenTimeError("yesterday", "2026-09-27T10:00")).not.toBeNull();
  });
});

describe("a routine's occurrences", () => {
  it("run daily from the start date to the end date, both included, keyed by date", () => {
    const r = routine({ startDate: "2026-09-25", endDate: "2026-09-28" });
    expect(runsOn(r, "2026-09-24")).toBe(false);
    expect(runsOn(r, "2026-09-25")).toBe(true);
    expect(runsOn(r, "2026-09-28")).toBe(true);
    expect(runsOn(r, "2026-09-29")).toBe(false);
    expect(occurrenceOn(r, "2026-09-24")).toBeNull();
    expect(occurrenceOn(r, "2026-09-25")).toEqual({
      key: `${uuid(1)}:2026-09-25`,
      routineId: uuid(1),
      localDate: "2026-09-25",
      localTime: "08:00",
      scheduledAt: "2026-09-25T12:00:00Z",
      dstAdjustment: null,
    });
    expect(occurrencesBetween(r, "2026-09-01", "2026-12-31").map((o) => o.localDate)).toEqual(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]);
    expect(occurrencesBetween(routine(), "2026-09-26", "2026-09-27").map((o) => o.key)).toEqual([`${uuid(1)}:2026-09-26`, `${uuid(1)}:2026-09-27`]);
    expect(occurrencesBetween(r, "2026-09-29", "2026-09-30")).toEqual([]);
    expect(parseSupplementKey(`${uuid(1)}:2026-09-27`)).toEqual({ routineId: uuid(1), date: "2026-09-27" });
    expect(parseSupplementKey(`${uuid(1)}:2026-02-30`)).toBeNull();
  });

  it("start again from the day an edit took effect: earlier untaken days are no longer occurrences", () => {
    // Created Sep 20, edited on Tuesday Sep 22 to 09:00: a missed Monday stays missed.
    const edited = routine({ time: "09:00", amount: "2", unit: "capsules", definitionFrom: "2026-09-22" });
    expect(runsOn(edited, "2026-09-21")).toBe(false);
    expect(occurrenceOn(edited, "2026-09-21")).toBeNull();
    expect(occurrenceOn(edited, "2026-09-22")).toMatchObject({ localTime: "09:00", scheduledAt: "2026-09-22T13:00:00Z" });
    expect(occurrencesBetween(edited, "2026-09-20", "2026-09-23").map((o) => o.localDate)).toEqual(["2026-09-22", "2026-09-23"]);
  });

  it("keep the wall-clock time across daylight-saving changes", () => {
    const r = routine({ startDate: "2026-10-30" });
    // 08:00 EDT, then 08:00 EST after Nov 1.
    expect(occurrencesBetween(r, "2026-10-31", "2026-11-02").map((o) => o.scheduledAt)).toEqual([
      "2026-10-31T12:00:00Z",
      "2026-11-01T13:00:00Z",
      "2026-11-02T13:00:00Z",
    ]);
    // 01:30 happens twice on Nov 1: the earlier (EDT) one.
    expect(occurrenceOn(routine({ time: "01:30" }), "2026-11-01")).toMatchObject({ scheduledAt: "2026-11-01T05:30:00Z", dstAdjustment: "repeat" });
    // 02:30 doesn't exist on Mar 14, 2027: moved forward by the gap, to 03:30 EDT.
    expect(occurrenceOn(routine({ time: "02:30" }), "2027-03-14")).toMatchObject({ scheduledAt: "2027-03-14T07:30:00Z", dstAdjustment: "gap" });
    expect(occurrenceOn(routine({ time: "02:30" }), "2027-03-15")).toMatchObject({ scheduledAt: "2027-03-15T06:30:00Z", dstAdjustment: null });
  });
});

describe("Today's supplement lines", () => {
  const NOW = "2026-09-27T14:00:00Z"; // 10:00 in Toronto
  const d3 = routine();
  const mag = routine({ id: uuid(2), name: "Magnesium", amount: "1.5", unit: "capsules", time: "21:30" });
  const zinc = routine({ id: uuid(3), name: "Zinc", time: "07:00" });

  it("lists each running routine's occurrence today, by time, with a one-tap Taken", () => {
    const view = supplementsToday({ tracking: true, routines: [mag, d3], taken: [], now: NOW });
    expect(view.rows.map((r) => [r.title, r.sub, r.status])).toEqual([
      ["Vitamin D3", "Supplement · 08:00 · 2000 IU", "Due"],
      ["Magnesium", "Supplement · 21:30 · 1.5 capsules", "Later today"],
    ]);
    expect(view.rows[0].detail).toEqual({
      key: `${uuid(1)}:2026-09-27`,
      routineId: uuid(1),
      name: "Vitamin D3",
      amount: "2000",
      unit: "IU",
      timeZone: TORONTO,
      scheduledAt: "2026-09-27T12:00:00Z",
      planned: "2026-09-27T08:00",
      plannedLabel: "08:00 · 2000 IU",
    });
  });

  it("shows what was taken (as recorded), and leaves out routines not running today", () => {
    // Taken at 08:05 when it was 1,000 IU at 07:30; the routine was edited since.
    const record = taken(d3, "2026-09-27", "2026-09-27T12:05:00Z", { amount: "1000", scheduledAt: "2026-09-27T11:30:00Z" });
    const view = supplementsToday({
      tracking: true,
      routines: [
        d3,
        routine({ id: uuid(4), name: "Starts tomorrow", startDate: "2026-09-28" }),
        routine({ id: uuid(5), name: "Ended yesterday", endDate: "2026-09-26" }),
      ],
      taken: [record, taken(d3, "2026-09-26", "2026-09-26T12:00:00Z")],
      now: NOW,
    });
    expect(view.rows.map((r) => [r.title, r.sub, r.status, r.detail])).toEqual([["Vitamin D3", "Supplement · 07:30 · 1000 IU", "Taken 08:05", null]]);
  });

  it("keeps today's line, with its Taken, for a routine ended today (today is its last day)", () => {
    const endedToday = { ...zinc, endDate: "2026-09-27" };
    const view = supplementsToday({ tracking: true, routines: [endedToday], taken: [], now: NOW });
    expect(view.rows.map((r) => [r.title, r.status, r.detail?.key])).toEqual([["Zinc", "Due", `${uuid(3)}:2026-09-27`]]);
    // Taken: it shows what was taken.
    const zincTaken = supplementsToday({ tracking: true, routines: [{ ...zinc, endDate: "2026-09-27" }], taken: [taken(zinc, "2026-09-27", "2026-09-27T11:10:00Z")], now: NOW });
    expect(zincTaken.rows.map((r) => r.status)).toEqual(["Taken 07:10"]);
    // On R10, too: its last day, with Taken today.
    const [card] = supplementsView({ tracking: true, routines: [endedToday], taken: [], guidance: [], now: NOW }).routines;
    expect(card).toMatchObject({ ended: true, state: "Due today · last day", tone: "active", today: { key: `${uuid(3)}:2026-09-27` } });
    expect(supplementsView({ tracking: true, routines: [endedToday], taken: [], guidance: [], now: NOW }).empty).toBe(false);
    const [done] = supplementsView({ tracking: true, routines: [endedToday], taken: [taken(zinc, "2026-09-27", "2026-09-27T11:10:00Z")], guidance: [], now: NOW }).routines;
    expect(done).toMatchObject({ state: "Taken today 07:10 · last day", tone: "quiet", today: null });
  });

  it("words the dose notes so they never contradict a supplement still to take", () => {
    const pending = supplementsToday({ tracking: true, routines: [d3], taken: [], now: NOW });
    const done = supplementsToday({ tracking: true, routines: [d3], taken: [taken(d3, "2026-09-27", "2026-09-27T12:05:00Z")], now: NOW });
    const none = { rows: [] };
    // No cycles: the prototype's sentence, unless a supplement is still to take.
    expect(todayNotes({ nothingDue: null }, none)).toEqual({ noCyclesBody: NO_CYCLES_BODY, nothingDue: null });
    expect(todayNotes({ nothingDue: null }, done).noCyclesBody).toBe(NO_CYCLES_BODY);
    expect(todayNotes({ nothingDue: null }, pending).noCyclesBody).toBe(NO_CYCLES_BODY_SUPPLEMENTS);
    expect(NO_CYCLES_BODY_SUPPLEMENTS).not.toContain("Nothing is due");
    // Cycles: "All done" and "Nothing due" name doses while a supplement is still to take.
    const quiet = (title: string) => ({ nothingDue: { title, body: "Next: Compound A, Mon Sep 28 · 08:00" } });
    expect(todayNotes(quiet("All done for today"), pending).nothingDue).toEqual({ title: "Doses done for today", body: "Next: Compound A, Mon Sep 28 · 08:00" });
    expect(todayNotes(quiet("Nothing due today"), pending).nothingDue?.title).toBe("No doses due today");
    expect(todayNotes(quiet("Planned break"), pending).nothingDue?.title).toBe("Planned break");
    expect(todayNotes(quiet("All done for today"), done).nothingDue?.title).toBe("All done for today");
    expect(todayNotes(quiet("All done for today"), none).nothingDue?.title).toBe("All done for today");
  });

  it("shows nothing while tracking is off", () => {
    expect(supplementsToday({ tracking: false, routines: [d3], taken: [], now: NOW })).toEqual({ rows: [] });
  });

  it("uses the Toronto day around midnight", () => {
    // 23:30 on Sep 27 in Toronto is 03:30Z on Sep 28.
    const late = supplementsToday({ tracking: true, routines: [d3], taken: [], now: "2026-09-28T03:30:00Z" });
    expect(late.rows[0].key).toBe(`${uuid(1)}:2026-09-27`);
    expect(late.rows[0].status).toBe("Due");
  });

  it("merges them after today's doses, before unconfirmed and next doses", () => {
    const dose = (key: string, kind: TodayRow["kind"]): TodayRow => ({ key, kind, title: key, sub: "", status: "", statusNote: "", action: null, stockNote: null });
    const supplements = supplementsToday({ tracking: true, routines: [d3], taken: [], now: NOW }).rows;
    const merged = mergeTodayRows([dose("t1", "today"), dose("o1", "open"), dose("t2", "today"), dose("n1", "next")], supplements);
    expect(merged.map((item) => `${item.type}:${item.row.key}`)).toEqual([
      "dose:t1",
      "dose:t2",
      `supplement:${uuid(1)}:2026-09-27`,
      "dose:o1",
      "dose:n1",
    ]);
    expect(mergeTodayRows([], []).length).toBe(0);
  });
});

describe("R10 routine cards", () => {
  const NOW = "2026-09-27T14:00:00Z";
  const d3 = routine({ startDate: "2026-09-01" });
  const late = routine({ id: uuid(2), name: "Magnesium", time: "21:30", startDate: "2026-09-27" });
  const ended = routine({ id: uuid(3), name: "Zinc", endDate: "2026-09-25", version: 3 });
  const guidance = [
    { name: "Compound B", text: "Take with food." },
    { name: "Compound A", text: "Vitamin D3 in the morning." },
    { name: "Compound C", text: "" },
  ];

  it("shows the guidance, active routines by time, then ended ones, each with today's state and history", () => {
    const records = [
      taken(d3, "2026-09-13", "2026-09-13T12:00:00Z"), // outside the last 2 weeks
      taken(d3, "2026-09-14", "2026-09-14T12:00:00Z"),
      taken(d3, "2026-09-26", "2026-09-26T12:10:00Z", { amount: "1000" }),
      taken(ended, "2026-09-24", "2026-09-24T12:00:00Z"),
    ];
    const view = supplementsView({ tracking: true, routines: [ended, late, d3], taken: records, guidance, now: NOW });
    expect(view.guidance).toEqual([guidance[1], guidance[0]]);
    expect(view.empty).toBe(false);
    expect(view.routines.map((r) => [r.name, r.state, r.tone, r.since, r.recent, r.today?.key ?? null])).toEqual([
      ["Vitamin D3", "Due today", "active", "Since Sep 1", "2 recorded in the last 2 weeks", `${uuid(1)}:2026-09-27`],
      ["Magnesium", "Later today", "active", "Since Sep 27", "0 recorded in the last 2 weeks", `${uuid(2)}:2026-09-27`],
      ["Zinc", "Ended Sep 25", "quiet", "Since Sep 20", "1 recorded in the last 2 weeks", null],
    ]);
    // Newest first, as recorded.
    expect(view.routines[0].history.map((h) => [h.when, h.amount, h.planned])).toEqual([
      ["Sat Sep 26 · 08:10", "1000 IU", "planned 08:00"],
      ["Mon Sep 14 · 08:00", "2000 IU", "planned 08:00"],
      ["Sun Sep 13 · 08:00", "2000 IU", "planned 08:00"],
    ]);
  });

  it("marks today's Taken and says when nothing is active or tracking is off", () => {
    const view = supplementsView({ tracking: true, routines: [d3, ended], taken: [taken(d3, "2026-09-27", "2026-09-27T12:05:00Z")], guidance: [], now: NOW });
    expect(view.routines[0]).toMatchObject({ state: "Taken today 08:05", tone: "quiet", today: null });
    expect(supplementsView({ tracking: true, routines: [ended], taken: [], guidance: [], now: NOW }).empty).toBe(true);
    const off = supplementsView({ tracking: false, routines: [d3], taken: [], guidance, now: NOW });
    expect(off.routines).toEqual([]);
    expect(off.guidance.length).toBe(2);
  });
});

describe("R13 Supplements (design v3)", () => {
  const NOW = "2026-09-27T14:00:00Z"; // Sunday, 10:00 in Toronto
  const d3 = routine({ startDate: "2026-09-01", definitionFrom: "2026-09-01" });
  const zinc = routine({ id: uuid(2), name: "Zinc", time: "07:00", startDate: "2026-09-20", endDate: "2026-09-22" });
  const mag = routine({ id: uuid(3), name: "Magnesium", amount: "1.5", unit: "capsules", time: "21:30", startDate: "2026-09-25" });
  const later = routine({ id: uuid(4), name: "Creatine", startDate: "2026-10-01", endDate: "2026-10-30" });
  const neverRan = routine({ id: uuid(5), name: "Iron", startDate: "2026-10-01", endDate: "2026-09-27" });

  it("says when a routine has ended: its last day is today or past, or it ended before it started", () => {
    expect(routineEnded(d3, "2026-09-27")).toBe(false);
    expect(routineEnded({ ...d3, endDate: "2026-09-28" }, "2026-09-27")).toBe(false);
    expect(routineEnded({ ...d3, endDate: "2026-09-27" }, "2026-09-27")).toBe(true);
    expect(routineEnded(zinc, "2026-09-27")).toBe(true);
    expect(routineEnded(later, "2026-09-27")).toBe(false);
    expect(routineEnded(neverRan, "2026-09-27")).toBe(true);
  });

  it("draws the last 7 days, today last: taken, missed, still to take today, or not a day it ran", () => {
    const records = [
      taken(d3, "2026-09-22", "2026-09-22T12:05:00Z"),
      taken(d3, "2026-09-24", "2026-09-24T12:05:00Z"),
      taken(d3, "2026-09-27", "2026-09-27T12:05:00Z"),
      taken(zinc, "2026-09-22", "2026-09-22T11:00:00Z"),
      taken(mag, "2026-09-26", "2026-09-26T01:40:00Z"),
      // Before the week: not drawn.
      taken(d3, "2026-09-20", "2026-09-20T12:00:00Z"),
    ];
    const grid = weekGrid([mag, later, d3, neverRan, zinc], records, NOW);
    expect(grid.days.map((d) => d.date)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(grid.days.map((d) => d.letter).join("")).toBe("MTWTFSS");
    expect(grid.days.map((d) => d.today)).toEqual([false, false, false, false, false, false, true]);
    // By time; a routine that hasn't started, or never ran, has no row.
    expect(grid.rows.map((r) => [r.name, r.cells.join(" ")])).toEqual([
      ["Zinc", "missed taken none none none none none"],
      ["Vitamin D3", "missed taken missed taken missed missed taken"],
      ["Magnesium", "none none none none missed taken later"],
    ]);
    // The Toronto day: at 23:30 on Sunday it's still Sunday's column.
    expect(weekGrid([d3], [], "2026-09-28T03:30:00Z").days.at(-1)?.date).toBe("2026-09-27");
    expect(weekGrid([], [], NOW).rows).toEqual([]);
  });

  it("draws an edited routine from its edit on: earlier untaken days blank, earlier Taken kept, then scheduled as usual", () => {
    // Started six days ago (Sep 21), taken Sep 22 and Sep 24, edited today (Sep 27) to 09:00.
    const edited = routine({ startDate: "2026-09-21", definitionFrom: "2026-09-27", time: "09:00", version: 2 });
    const before = (date: string, actualAt: string) => taken(edited, date, actualAt, { scheduledAt: `${date}T12:00:00Z`, amount: "1000" });
    const records = [before("2026-09-22", "2026-09-22T12:05:00Z"), before("2026-09-24", "2026-09-24T12:05:00Z")];
    expect(weekGrid([edited], records, NOW).rows.map((r) => r.cells.join(" "))).toEqual(["none taken none taken none none later"]);
    // Taken today too.
    const today = [...records, taken(edited, "2026-09-27", "2026-09-27T13:10:00Z")];
    expect(weekGrid([edited], today, NOW).rows[0].cells.join(" ")).toBe("none taken none taken none none taken");
    // Edited three days ago (Sep 24): missed from the edit on, blank before it.
    const earlier = { ...edited, definitionFrom: "2026-09-24" };
    expect(weekGrid([earlier], records, NOW).rows[0].cells.join(" ")).toBe("none taken none taken missed missed later");
    // Edited today with nothing taken this week: only today is drawn.
    expect(weekGrid([edited], [], NOW).rows[0].cells.join(" ")).toBe("none none none none none none later");
    // The schedule agrees: none of the earlier days is an occurrence any more.
    for (const date of ["2026-09-21", "2026-09-22", "2026-09-26"]) expect(occurrenceOn(edited, date)).toBeNull();
    expect(occurrenceOn(edited, "2026-09-27")).not.toBeNull();
  });

  it("draws an ended routine to its last day, and nothing for one that ended before its edit took effect", () => {
    // Ran Sep 20 to Sep 25 (edited Sep 23): taken Sep 22 before the edit, Sep 24 after it.
    const ended = routine({ startDate: "2026-09-20", definitionFrom: "2026-09-23", endDate: "2026-09-25", version: 3 });
    const records = [
      taken(ended, "2026-09-22", "2026-09-22T12:05:00Z", { scheduledAt: "2026-09-22T12:00:00Z" }),
      taken(ended, "2026-09-24", "2026-09-24T12:05:00Z"),
    ];
    expect(weekGrid([ended], records, NOW).rows[0].cells.join(" ")).toBe("none taken missed taken missed none none");
    // Ended today: today is its last day, still to take.
    const endsToday = routine({ startDate: "2026-09-25", endDate: "2026-09-27" });
    expect(weekGrid([endsToday], [], NOW).rows[0].cells.join(" ")).toBe("none none none none missed missed later");
    // Ended the day before its edit took effect (end = definitionFrom - 1): no occurrences, only its Taken.
    const stopped = routine({ startDate: "2026-09-20", definitionFrom: "2026-09-24", endDate: "2026-09-23", version: 2 });
    expect(weekGrid([stopped], [records[0]], NOW).rows.map((r) => r.cells.join(" "))).toEqual(["none taken none none none none none"]);
    expect(weekGrid([stopped], [], NOW).rows).toEqual([]);
  });

  it("lists today's supplements as N of M, the first still to take marked next", () => {
    const morning = routine({ id: uuid(6), name: "Omega-3", time: "07:00", startDate: "2026-09-01" });
    const list = supplementsTodayList(supplementsToday({ tracking: true, routines: [mag, d3, morning], taken: [taken(d3, "2026-09-27", "2026-09-27T12:05:00Z")], now: NOW }));
    expect([list.taken, list.total]).toEqual([1, 3]);
    expect(list.rows.map((r) => [r.title, r.state, r.next])).toEqual([
      ["Omega-3", "due", true],
      ["Vitamin D3", "taken", false],
      ["Magnesium", "later", false],
    ]);
    const done = supplementsTodayList(supplementsToday({ tracking: true, routines: [d3], taken: [taken(d3, "2026-09-27", "2026-09-27T12:05:00Z")], now: NOW }));
    expect([done.taken, done.total, done.rows[0].next]).toEqual([1, 1, false]);
    expect(supplementsTodayList({ rows: [] })).toEqual({ rows: [], taken: 0, total: 0 });
  });

  it("words each routine card: title, daily time, its dates and state, upcoming and ended ones", () => {
    const view = supplementsView({ tracking: true, routines: [neverRan, zinc, later, { ...d3, endDate: "2026-10-30" }], taken: [], guidance: [], now: NOW });
    expect(view.routines.map((r) => [r.title, r.schedule, r.dates, r.state, r.ended, r.upcoming])).toEqual([
      // Active ones by time (an upcoming one among them), then by name.
      ["Creatine · 2000 IU", "Daily · 8:00 AM", "Starts Oct 1 · ends Oct 30", "Starts Oct 1", false, true],
      ["Vitamin D3 · 2000 IU", "Daily · 8:00 AM", "Since Sep 1 · ends Oct 30", "Due today", false, false],
      // Ended ones, most recently ended first.
      ["Iron · 2000 IU", "Daily · 8:00 AM", "Planned for Oct 1 · never ran", "Ended before it started", true, false],
      ["Zinc · 2000 IU", "Daily · 7:00 AM", "Sep 20 – Sep 22", "Ended Sep 22", true, false],
    ]);
    expect(view.today.total).toBe(1);
    expect(view.grid.rows.map((r) => r.name)).toEqual(["Zinc", "Vitamin D3"]);
    // Tracking off: no list, no grid rows.
    const off = supplementsView({ tracking: false, routines: [d3], taken: [], guidance: [], now: NOW });
    expect([off.today.total, off.grid.rows.length, off.grid.days.length]).toEqual([0, 0, 7]);
  });
});
