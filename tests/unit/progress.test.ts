// S15 R9 Progress: the check-in's validation (feeling, chips, the
// measurement's decimals with the app's comma rules, lengths in characters
// as PostgreSQL counts them), the check-in's day (always America/Toronto,
// across midnight and daylight-saving changes), phases across revisions, and
// design v3 R5 / D3 (the range, the feeling with its gaps, the dose tracks,
// adherence, the measurement, the check-in rows) with and without a cycle.
// Pure, no database.
// Sep 21, 2026 is a Monday.
import { describe, expect, it } from "vitest";
import { massLabel } from "@/lib/alpha/format";
import type { CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import { adherence } from "@/lib/cycles/adherence";
import { cycleOccurrences, phasesDuring, planOccurrences } from "@/lib/cycles/schedule";
import type { RecordedConfirmation, ViewPeptides } from "@/lib/cycles/views";
import {
  CHECK_IN_INVALID,
  characters,
  checkInDay,
  effectLabel,
  effectsLine,
  FEELING_REQUIRED,
  formEffects,
  measurementValue,
  NO_DOSES,
  NOTE_TOO_LONG,
  OTHER_REQUIRED,
  OTHER_TOO_LONG,
  PROGRESS_TIME_ZONE,
  SPARSE,
  toggleEffect,
  UNIT_REQUIRED,
  UNIT_TOO_LONG,
  validateCheckIn,
  VALUE_INVALID,
  VALUE_NEGATIVE,
  VALUE_TOO_LARGE,
  VALUE_TOO_PRECISE,
} from "@/lib/progress/rules";
import { exportRange } from "@/lib/progress/csv";
import type { CheckIn } from "@/lib/progress/service";
import {
  daysOf,
  effectRows,
  feelingAverage,
  feelingChange,
  feelingPoints,
  measureCard,
  preCycleFraction,
  progressScreen,
  type ProgressScreenInput,
  rangeWindow,
  readRange,
  reportedEffects,
} from "@/lib/progress/screen";
import { NO_CYCLE_PARAM, phaseLine, selectedCycle } from "@/lib/progress/view";
import type { ActivePhase } from "@/lib/schedule/engine";
import { localDateOf } from "@/lib/schedule/zone";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TORONTO = "America/Toronto";

// ── Validation ──────────────────────────────────────────────────────────────

const form = (overrides: Record<string, unknown> = {}) => ({
  day: "2026-09-21",
  version: null,
  feeling: 4,
  effects: [],
  note: "",
  measurementName: "Weight",
  measurementValue: "",
  measurementUnit: "kg",
  ...overrides,
});

const error = (overrides: Record<string, unknown>) => {
  const result = validateCheckIn(form(overrides));
  return result.ok ? null : result.error;
};

describe("check-in validation", () => {
  it("requires a whole feeling from 1 to 5", () => {
    for (const feeling of [0, 6, -1, 2.5, "3", null, undefined]) expect(error({ feeling }), String(feeling)).toBe(FEELING_REQUIRED);
    for (const feeling of [1, 2, 3, 4, 5]) expect(validateCheckIn(form({ feeling })).ok).toBe(true);
  });

  it("accepts R6's v3 chips only: distinct, and None alone; stores them in the chips' order", () => {
    const ok = validateCheckIn(form({ effects: ["Water retention", "Nausea", "Site redness"] }));
    expect(ok.ok && ok.value.effects).toEqual(["Site redness", "Nausea", "Water retention"]);
    expect(ok.ok && ok.value.effectsOther).toBe("");
    expect(validateCheckIn(form({ effects: ["None"] })).ok).toBe(true);
    expect(validateCheckIn(form({ effects: ["Poor sleep", "Headache", "Fatigue"] })).ok).toBe(true);
    // The earlier chips are not written any more (stored ones stay readable: effectLabel).
    for (const effects of [["Dizzy"], ["Nausea", "Nausea"], ["None", "Nausea"], ["None noticed"], ["Mild headache"], ["Appetite change"], "Nausea", null]) {
      expect(error({ effects }), JSON.stringify(effects)).toBe(CHECK_IN_INVALID);
    }
  });

  it("needs Other's text: trimmed, up to 100 characters, dropped when Other isn't picked", () => {
    const other = validateCheckIn(form({ effects: ["Other", "Nausea"], effectsOther: "  dizzy after the dose  " }));
    expect(other.ok && other.value).toMatchObject({ effects: ["Nausea", "Other"], effectsOther: "dizzy after the dose" });
    expect(error({ effects: ["Other"] })).toBe(OTHER_REQUIRED);
    expect(error({ effects: ["Other"], effectsOther: " \t " })).toBe(OTHER_REQUIRED);
    expect(validateCheckIn(form({ effects: ["Other"], effectsOther: "\u{1F600}".repeat(100) })).ok).toBe(true);
    expect(error({ effects: ["Other"], effectsOther: "x".repeat(101) })).toBe(OTHER_TOO_LONG);
    const dropped = validateCheckIn(form({ effects: ["Fatigue"], effectsOther: "left over" }));
    expect(dropped.ok && dropped.value.effectsOther).toBe("");
    // Feeling first, then Other's text.
    expect(error({ feeling: 0, effects: ["Other"] })).toBe(FEELING_REQUIRED);
  });

  it("refuses a malformed day or version", () => {
    for (const bad of [{ day: "Sep 21" }, { day: 20260921 }, { version: 0 }, { version: 1.5 }, { version: "2" }]) {
      expect(error(bad), JSON.stringify(bad)).toBe(CHECK_IN_INVALID);
    }
    expect(validateCheckIn("nope")).toEqual({ ok: false, error: CHECK_IN_INVALID });
    const ok = validateCheckIn(form({ version: 3 }));
    expect(ok.ok && [ok.value.day, ok.value.version]).toEqual(["2026-09-21", 3]);
  });

  it("reads the measurement exactly, with a decimal comma, and refuses thousands-style input", () => {
    expect(measurementValue("82,4")).toEqual({ ok: true, value: "82.4" });
    expect(measurementValue(" 82.40 ")).toEqual({ ok: true, value: "82.4" });
    expect(measurementValue("0,125")).toEqual({ ok: true, value: "0.125" });
    expect(measurementValue("00.50")).toEqual({ ok: true, value: "0.5" });
    expect(measurementValue("0")).toEqual({ ok: true, value: "0" });
    expect(measurementValue("-0")).toEqual({ ok: true, value: "0" });
    expect(measurementValue(",5")).toEqual({ ok: true, value: "0.5" });
    expect(measurementValue("999999.999999")).toEqual({ ok: true, value: "999999.999999" });
    // 0.1 + 0.2 in binary floating point is not 0.3; here it is text throughout.
    expect(measurementValue("0.30000000000000004")).toEqual({ ok: false, error: VALUE_TOO_PRECISE });
    for (const bad of ["1,000", "12,500", "1,000.5", "1.000,5", "1,2,3", "8 h", "1e3", "Infinity", "NaN", "abc", "."]) {
      expect(measurementValue(bad), bad).toEqual({ ok: false, error: VALUE_INVALID });
    }
    expect(measurementValue("-1")).toEqual({ ok: false, error: VALUE_NEGATIVE });
    expect(measurementValue("1000000")).toEqual({ ok: false, error: VALUE_TOO_LARGE });
    expect(measurementValue("0.1234567")).toEqual({ ok: false, error: VALUE_TOO_PRECISE });
  });

  it("keeps a measurement only with a value, which then needs a unit; checks in the prototype's order", () => {
    const none = validateCheckIn(form({ measurementValue: "  ", measurementUnit: "" }));
    expect(none.ok && none.value.measurement).toBeNull();
    const weight = validateCheckIn(form({ measurementValue: "82,4", measurementUnit: " kg " }));
    expect(weight.ok && weight.value.measurement).toEqual({ name: "Weight", value: "82.4", unit: "kg" });
    expect(error({ measurementValue: "7", measurementUnit: " " })).toBe(UNIT_REQUIRED);
    expect(error({ measurementValue: "7", measurementUnit: "x".repeat(21) })).toBe(UNIT_TOO_LONG);
    expect(error({ measurementValue: "7", measurementName: "Mood" })).toBe(CHECK_IN_INVALID);
    expect(error({ measurementValue: "lots" })).toBe(VALUE_INVALID);
    // Feeling first, then the measurement.
    expect(error({ feeling: 0, measurementValue: "lots" })).toBe(FEELING_REQUIRED);
  });

  it("trims the note and caps it at 1,000 characters", () => {
    const ok = validateCheckIn(form({ note: "  Slept better.  " }));
    expect(ok.ok && ok.value.note).toBe("Slept better.");
    expect(validateCheckIn(form({ note: "x".repeat(1000) })).ok).toBe(true);
    expect(error({ note: "x".repeat(1001) })).toBe(NOTE_TOO_LONG);
  });

  it("counts characters as PostgreSQL does: an emoji or other astral character is one, not two", () => {
    const grin = "\u{1F600}"; // one character, two UTF-16 units
    const clef = "\u{1D11E}"; // MUSICAL SYMBOL G CLEF
    expect([grin.length, characters(grin)]).toEqual([2, 1]);
    // 1,000 emoji: 2,000 UTF-16 units, but 1,000 characters, which the database takes.
    expect(validateCheckIn(form({ note: grin.repeat(1000) })).ok).toBe(true);
    expect(error({ note: grin.repeat(1001) })).toBe(NOTE_TOO_LONG);
    expect(validateCheckIn(form({ note: `${"a".repeat(999)}${clef}` })).ok).toBe(true);
    expect(error({ note: `${"a".repeat(1000)}${clef}` })).toBe(NOTE_TOO_LONG);
    // A unit of 20 astral characters fits; 21 does not.
    const unit = validateCheckIn(form({ measurementValue: "1", measurementUnit: clef.repeat(20) }));
    expect(unit.ok && unit.value.measurement?.unit).toBe(clef.repeat(20));
    expect(error({ measurementValue: "1", measurementUnit: clef.repeat(21) })).toBe(UNIT_TOO_LONG);
    // A combining sequence is two characters in both (e + U+0301).
    expect(characters("é")).toBe(2);
    // Surrounding whitespace is trimmed before counting, as trim_whitespace does.
    expect(validateCheckIn(form({ note: `　${grin.repeat(1000)} ` })).ok).toBe(true);
  });

  it("toggles chips as R6 does: None clears the others and is cleared by them, Other included", () => {
    expect(toggleEffect([], "Nausea")).toEqual(["Nausea"]);
    expect(toggleEffect(["Nausea"], "Headache")).toEqual(["Nausea", "Headache"]);
    expect(toggleEffect(["Nausea", "Other"], "None")).toEqual(["None"]);
    expect(toggleEffect(["None"], "Other")).toEqual(["Other"]);
    expect(toggleEffect(["None"], "Fatigue")).toEqual(["Fatigue"]);
    expect(toggleEffect(["Fatigue"], "Fatigue")).toEqual([]);
  });

  it("shows stored effects under their v3 names, from either chip list, with Other's text", () => {
    expect(effectsLine(["None"])).toBe("");
    expect(effectsLine(["Nausea", "Headache", "Other"], "dizzy")).toBe("Nausea, Headache, Other: dizzy");
    // Stored with the earlier chips: the same names where one corresponds.
    expect(effectsLine(["None noticed"])).toBe("");
    expect(effectsLine(["Injection-site redness", "Mild headache", "Appetite change", "Other"])).toBe("Site redness, Headache, Appetite change, Other");
    expect(["None noticed", "Injection-site redness", "Mild headache", "Nausea", "Fatigue", "Appetite change", "Other"].map(effectLabel)).toEqual([
      "None",
      "Site redness",
      "Headache",
      "Nausea",
      "Fatigue",
      "Appetite change",
      "Other",
    ]);
    // An edit starts from the v3 chips; earlier ones with none to match are picked again.
    expect(formEffects(["Mild headache", "Appetite change", "Other"], "")).toEqual({ effects: ["Headache"], other: "" });
    expect(formEffects(["None noticed"], "")).toEqual({ effects: ["None"], other: "" });
    expect(formEffects(["Site redness", "Other"], "dizzy")).toEqual({ effects: ["Site redness", "Other"], other: "dizzy" });
  });
});

// ── The day ─────────────────────────────────────────────────────────────────

describe("a check-in's day is the America/Toronto calendar day", () => {
  it("defaults to Toronto, whatever zone the device or a cycle uses", () => {
    expect(PROGRESS_TIME_ZONE).toBe(TORONTO);
    // 23:30 in Toronto is already the next day in Tokyo and in UTC; the check-in is Toronto's day.
    expect(checkInDay("2026-09-22T03:30:00Z")).toBe("2026-09-21");
    expect(rangeWindow(null, "30d", "2026-09-22T03:30:00Z")).toMatchObject({ from: "2026-08-23", to: "2026-09-21" });
    expect(rangeWindow(null, "30d", "2026-09-22T04:00:00Z")).toMatchObject({ from: "2026-08-24", to: "2026-09-22" });
  });

  it("turns at Toronto midnight on both sides of its daylight-saving changes", () => {
    // Fall back on Sun Nov 1, 2026: midnight is 04:00Z before, 05:00Z after (a 25-hour day).
    expect(checkInDay("2026-11-01T03:59:59Z")).toBe("2026-10-31");
    expect(checkInDay("2026-11-01T04:00:00Z")).toBe("2026-11-01");
    // 01:30 happens twice that night; both are Nov 1.
    expect(checkInDay("2026-11-01T05:30:00Z")).toBe("2026-11-01");
    expect(checkInDay("2026-11-01T06:30:00Z")).toBe("2026-11-01");
    expect(checkInDay("2026-11-02T04:59:59Z")).toBe("2026-11-01");
    expect(checkInDay("2026-11-02T05:00:00Z")).toBe("2026-11-02");
    // Spring forward on Sun Mar 8, 2026: midnight is 05:00Z before, 04:00Z after (a 23-hour day).
    expect(checkInDay("2026-03-08T04:59:59Z")).toBe("2026-03-07");
    expect(checkInDay("2026-03-08T05:00:00Z")).toBe("2026-03-08");
    expect(checkInDay("2026-03-09T03:59:59Z")).toBe("2026-03-08");
    expect(checkInDay("2026-03-09T04:00:00Z")).toBe("2026-03-09");
  });

  it("agrees with the schedule engine's local date in any zone", () => {
    const zones = [TORONTO, "Europe/London", "Australia/Lord_Howe", "Asia/Kathmandu", "America/St_Johns", "UTC", "Etc/GMT+12", "Etc/GMT-14"];
    for (let t = Date.parse("2026-01-01T00:00:00Z"); t < Date.parse("2027-01-01T00:00:00Z"); t += 7 * 3_600_000 + 17 * 60_000) {
      const iso = new Date(t).toISOString();
      for (const zone of zones) expect(checkInDay(iso, zone), `${iso} ${zone}`).toBe(localDateOf(iso, zone));
    }
  });
});

// ── The history view ────────────────────────────────────────────────────────

const [PA, PB, PC] = [uuid(901), uuid(902), uuid(903)];
const peptides: ViewPeptides = new Map([
  [PA, { name: "Compound A", available: true }],
  [PB, { name: "Compound B", available: true }],
  [PC, { name: "Compound C", available: true }],
]);
const [PLAN_A, PLAN_B, PLAN_C, A1, BREAK, B1, C0, C1] = [uuid(1), uuid(2), uuid(3), uuid(10), uuid(11), uuid(20), uuid(30), uuid(31)];

/** A: every 2 days at 20:00 Sep 10–30 (0.5 mg from Sep 21), then a break to Oct 7; B: Mon/Wed/Fri 07:30 Sep 14 – Oct 9. */
const revision: CycleRevision = {
  id: uuid(100),
  number: 1,
  timeZone: TORONTO,
  createdAt: "2026-09-01T12:00:00Z",
  plans: [
    {
      planId: PLAN_A,
      peptideId: PA,
      effectiveFrom: null,
      phases: [
        {
          id: A1,
          kind: "active",
          start: "2026-09-10",
          end: "2026-09-30",
          doseMg: "0.4",
          time: "20:00",
          schedule: { type: "interval", everyDays: 2 },
          doseChanges: [{ from: "2026-09-21", doseMg: "0.5" }],
        },
        { id: BREAK, kind: "break", start: "2026-10-01", end: "2026-10-07" },
      ],
    },
    {
      planId: PLAN_B,
      peptideId: PB,
      effectiveFrom: null,
      phases: [{ id: B1, kind: "active", start: "2026-09-14", end: "2026-10-09", doseMg: "1", time: "07:30", schedule: { type: "weekdays", days: [1, 3, 5] } }],
    },
  ],
};

const cycleOf = (id: number, name: string, revisions: CycleRevision[], overrides: Partial<CycleRecord> = {}): CycleRecord => ({
  id: uuid(id),
  ownerId: uuid(600),
  name,
  goal: "Body composition",
  baseline: "",
  templateId: null,
  templateName: "",
  templateGuidance: "",
  templateUpdatedAt: null,
  currentRevision: revisions.length,
  version: 1,
  createdAt: revisions[0].createdAt,
  updatedAt: revisions[0].createdAt,
  revisions,
  ...overrides,
});

const recomp = cycleOf(500, "Recomp", [revision], { baseline: "82.4 kg" });
/** Ended in August, created after Recomp (listCycles is newest first). */
const ended = cycleOf(501, "Summer", [
  {
    ...revision,
    id: uuid(110),
    createdAt: "2026-09-02T12:00:00Z",
    plans: [{ planId: uuid(4), peptideId: PA, effectiveFrom: null, phases: [{ ...(revision.plans[0].phases[0] as ActivePhase), id: uuid(12), start: "2026-08-01", end: "2026-08-20", doseChanges: [] }] }],
  },
]);

/** Noon in Toronto on Mon Sep 21 (EDT, UTC-4). */
const NOW = "2026-09-21T16:00:00Z";

const record = (key: string, actualAt: string, amountMg: string): RecordedConfirmation => ({
  key,
  actualAt,
  recordedAt: actualAt,
  amountMg,
  site: "",
  notes: "",
});
// A's 20:00 dose on Sun Sep 20 (index 5), taken at 23:30 in Toronto: Sep 21 in UTC, Sep 20 in Toronto.
const lateA = record(`${PLAN_A}:${A1}:5`, "2026-09-21T03:30:00Z", "0.45");
// B's Monday dose, taken at 07:40.
const mondayB = record(`${PLAN_B}:${B1}:2026-09-21`, "2026-09-21T11:40:00Z", "1");

const checkIn = (day: string, overrides: Partial<CheckIn> = {}): CheckIn => ({
  id: uuid(Number(day.replace(/-/g, "")) % 100000),
  day,
  feeling: 3,
  effects: [],
  effectsOther: "",
  note: "",
  measurement: null,
  version: 1,
  createdAt: `${day}T13:00:00Z`,
  updatedAt: `${day}T13:00:00Z`,
  ...overrides,
});

const view = (overrides: Partial<ProgressScreenInput> = {}) =>
  progressScreen({
    cycles: [ended, recomp],
    selectedId: null,
    range: null,
    checkIns: [],
    total: 0,
    confirmations: new Map([[recomp.id, [lateA, mondayB]]]),
    peptides,
    now: NOW,
    ...overrides,
  });

describe("R5 Progress: the cycle and the range", () => {
  it("shows the cycle asked for, none for ?cycle=none, else the newest current one, else none", () => {
    expect(selectedCycle([ended, recomp], null, NOW)?.id).toBe(recomp.id);
    expect(selectedCycle([ended, recomp], ended.id, NOW)?.id).toBe(ended.id);
    expect(selectedCycle([ended, recomp], ended.id.toUpperCase(), NOW)?.id).toBe(ended.id);
    expect(selectedCycle([ended, recomp], uuid(999), NOW)?.id).toBe(recomp.id);
    expect(selectedCycle([ended, recomp], NO_CYCLE_PARAM, NOW)).toBeNull();
    // Between cycles: none by default, and any can be picked.
    expect(selectedCycle([ended], null, NOW)).toBeNull();
    expect(selectedCycle([], null, NOW)).toBeNull();
    const v = view();
    expect(v.cycles).toEqual([
      { id: ended.id, name: "Summer" },
      { id: recomp.id, name: "Recomp" },
    ]);
    // Recomp started Sep 10: Mon Sep 21 is its day 12.
    expect([v.cycleId, v.header, v.ranges]).toEqual([recomp.id, "Recomp · day 12", ["7d", "30d", "cycle"]]);
    expect(view({ selectedId: ended.id }).header).toBe("Summer · ended Aug 20");
    const none = view({ selectedId: NO_CYCLE_PARAM });
    expect([none.cycleId, none.header, none.ranges, none.tracks, none.tiles.adherence]).toEqual([null, "Check-ins only", ["7d", "30d"], [], null]);
  });

  it("covers the last 30 Toronto days by default, 7 on asking, or the cycle with the week before it", () => {
    expect(rangeWindow(recomp, null, NOW)).toEqual({ range: "30d", from: "2026-08-23", to: "2026-09-21", countFrom: "2026-08-23", today: "2026-09-21" });
    expect(rangeWindow(recomp, "7d", NOW)).toMatchObject({ from: "2026-09-15", to: "2026-09-21" });
    expect(rangeWindow(recomp, "cycle", NOW)).toEqual({ range: "cycle", from: "2026-09-03", to: "2026-09-21", countFrom: "2026-09-10", today: "2026-09-21" });
    // An ended cycle: up to its last day. No cycle (or one not started): 30 days.
    expect(rangeWindow(ended, "cycle", NOW)).toMatchObject({ from: "2026-07-25", to: "2026-08-20", countFrom: "2026-08-01" });
    expect(rangeWindow(null, "cycle", NOW)).toMatchObject({ range: "30d", from: "2026-08-23" });
    expect(readRange("cycle")).toBe("cycle");
    expect(readRange("90d")).toBeNull();
    // Toronto's day: 23:30 on Sep 21 is already Sep 22 in UTC.
    expect(rangeWindow(null, "7d", "2026-09-22T03:30:00Z")).toMatchObject({ from: "2026-09-15", to: "2026-09-21" });
    expect(rangeWindow(null, "7d", "2026-09-22T04:00:00Z")).toMatchObject({ from: "2026-09-16", to: "2026-09-22" });

    const cycle = view({ range: "cycle" });
    expect(cycle.feeling.label).toBe("Feeling · cycle average");
    expect(cycle.feeling.rangeLabel).toBe("Sep 10 – Sep 21");
    // 19 days (Sep 3–21); the cycle starts on the 8th: hatched up to 7/18 of the chart.
    expect(cycle.feeling.points).toHaveLength(19);
    expect(cycle.feeling.preCycle).toBeCloseTo(7 / 18);
    expect(cycle.feeling.axis.map((a) => [a.text, a.wide])).toEqual([
      ["Sep 3", "Sep 3 · before cycle"],
      ["Sep 10", "Sep 10 start"],
      ["Today", "Today"],
    ]);
    expect(cycle.exportHref).toBe("/app/progress/export?from=2026-09-03&to=2026-09-21");
    // 30 days start before the cycle too; 7 days are all inside it.
    expect(view().feeling.preCycle).toBeCloseTo(18 / 29);
    expect(view({ range: "7d" }).feeling.preCycle).toBeNull();
  });

  it("offers an export of any range it shows: a ten-year cycle's range is one the export accepts", () => {
    const [b] = revision.plans[1].phases;
    const decade = cycleOf(503, "Decade", [{ ...revision, id: uuid(130), plans: [{ ...revision.plans[1], phases: [{ ...b, start: "2016-10-01", end: "2026-10-06" }] }] }]);
    const long = view({ cycles: [decade], selectedId: decade.id, range: "cycle" });
    expect([long.from, long.to]).toEqual(["2016-09-24", "2026-09-21"]);
    const href = new URL(long.exportHref, "http://app.localhost");
    expect(exportRange(href.searchParams.get("from"), href.searchParams.get("to"))).toEqual({ from: "2016-09-24", to: "2026-09-21" });
    for (const range of ["7d", "30d", "cycle"] as const) {
      const shown = new URL(view({ range }).exportHref, "http://app.localhost");
      expect(exportRange(shown.searchParams.get("from"), shown.searchParams.get("to")), range).not.toBeNull();
    }
  });
});

describe("R5 Progress: feeling, gaps and the check-in rows", () => {
  const checkIns = [
    checkIn("2026-08-24", { feeling: 2 }),
    checkIn("2026-08-25", { feeling: 3 }),
    checkIn("2026-09-19", { effects: ["None noticed"], feeling: 2 }),
    checkIn("2026-09-20", { effects: ["Site redness", "Other"], effectsOther: "dizzy", feeling: 4 }),
    checkIn("2026-09-21", {
      feeling: 5,
      effects: ["Mild headache", "Nausea"],
      note: "Slept better.",
      measurement: { name: "Weight", value: "82.4", unit: "kg", measuredAt: "2026-09-21T12:00:00Z" },
      version: 2,
      updatedAt: "2026-09-21T13:05:00Z",
    }),
  ];

  it("keeps gaps as gaps: a day without a check-in has no point and no zero", () => {
    const v = view({ checkIns, total: 5 });
    const points = v.feeling.points;
    expect(points).toHaveLength(30);
    expect(points[0]).toEqual({ day: "2026-08-23", x: 0, feeling: null });
    expect(points[1]).toMatchObject({ day: "2026-08-24", feeling: 2 });
    expect(points.at(-1)).toEqual({ day: "2026-09-21", x: 1, feeling: 5 });
    expect(points.filter((p) => p.feeling !== null)).toHaveLength(5);
    // (2 + 3 + 2 + 4 + 5) / 5, from the check-ins only.
    expect(v.feeling.average).toBe("3.2");
    // First week (Aug 23–29): 2.5; last week (Sep 15–21): 11 / 3.
    expect(v.feeling.change).toEqual({ direction: "up", text: "Up 1.2", caption: "first week to last" });
    expect(v.tiles.checkIns).toEqual({ value: "5", context: "of 30 days" });
    expect(v.tiles.effects).toEqual({ value: "2", context: "days reported" });
    expect(v.sparse).toBe("");
  });

  it("compares the first days to the last in a short range, and says nothing when either side has no check-in", () => {
    const byDay = new Map([
      ["2026-09-15", 3],
      ["2026-09-21", 4],
    ]);
    const week = ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21"];
    expect(feelingChange(byDay, week)).toEqual({ direction: "up", text: "Up 1.0", caption: "first 3 days to last" });
    expect(feelingChange(new Map([["2026-09-21", 4]]), week)).toBeNull();
    expect(feelingChange(new Map([["2026-09-15", 4], ["2026-09-21", 4]]), week)).toMatchObject({ direction: "flat", text: "No change" });
    expect(feelingChange(new Map([["2026-09-15", 5], ["2026-09-21", 1]]), week)).toMatchObject({ direction: "down", text: "Down 4.0" });
    expect(feelingAverage(new Map(), week)).toBeNull();
    expect(feelingAverage(byDay, week)).toBe("3.5");
    expect(feelingPoints(byDay, ["2026-09-21"])).toEqual([{ day: "2026-09-21", x: 0.5, feeling: 4 }]);
    expect(preCycleFraction(week, null)).toBeNull();
    expect(preCycleFraction(week, "2026-09-15")).toBeNull();
    expect(preCycleFraction(week, "2026-09-18")).toBe(0.5);
    // A cycle that starts after the range: all of it is before.
    expect(preCycleFraction(week, "2026-10-01")).toBe(1);
  });

  it("lists each check-in newest first beside the cycle's phases and doses, and today's as the sheet's start", () => {
    const v = view({ checkIns, total: 5 });
    expect(v.rows.map((r) => r.day)).toEqual(["2026-09-21", "2026-09-20", "2026-09-19", "2026-08-25", "2026-08-24"]);
    expect(v.rows[0]).toMatchObject({
      date: "Mon Sep 21",
      today: true,
      feeling: 5,
      feelingText: "5 · Great",
      // Stored with the earlier chips (they stay valid): shown under the v3 names.
      effects: "Headache, Nausea",
      note: "Slept better.",
      measure: "Weight 82.4 kg",
      measureName: "Weight",
      measureValue: "82.4 kg",
      phase: "Compound A: 500 mcg · Compound B: 1 mg",
      doses: "Compound B 1 mg",
    });
    // A's 20:00 Sunday dose taken at 23:30 Toronto (Monday in UTC) is Sunday's.
    expect(v.rows[1]).toMatchObject({ feelingText: "4 · Good", effects: "Site redness, Other: dizzy", phase: "Compound A: 400 mcg · Compound B: 1 mg", doses: "Compound A 450 mcg" });
    // "None noticed" alone is no effect; a day without a dose says so.
    expect(v.rows[2]).toMatchObject({ feelingText: "2 · Low", effects: "", measure: "", doses: NO_DOSES });
    expect(v.rows[4]).toMatchObject({ phase: "", doses: NO_DOSES });
    expect(v.todayCheckIn).toEqual({
      version: 2,
      feeling: 5,
      effects: ["Nausea", "Headache"],
      effectsOther: "",
      note: "Slept better.",
      measurement: { name: "Weight", value: "82.4", unit: "kg" },
    });
    const fresh = view();
    expect([fresh.todayCheckIn, fresh.rows, fresh.sparse, fresh.feeling.average, fresh.feeling.change]).toEqual([null, [], SPARSE, null, null]);
  });

  it("groups the unwanted effects reported, with how many days and when", () => {
    const many = ["2026-09-01", "2026-09-05", "2026-09-10", "2026-09-15"].map((day) => checkIn(day, { effects: ["Headache"] }));
    const v = view({ checkIns: [...checkIns, ...many], total: 9 });
    expect(v.effects).toEqual([
      { label: "Headache", days: 5, count: "5 days", dates: "Sep 1 – Sep 21" },
      { label: "Nausea", days: 1, count: "1 day", dates: "Sep 21" },
      { label: "Other: dizzy", days: 1, count: "1 day", dates: "Sep 20" },
      { label: "Site redness", days: 1, count: "1 day", dates: "Sep 20" },
    ]);
    expect(effectRows([checkIn("2026-09-15", { effects: ["Nausea"] }), checkIn("2026-09-18", { effects: ["Nausea"] })])[0].dates).toBe("Sep 15 · Sep 18");
    expect(reportedEffects(checkIn("2026-09-15", { effects: ["None"] }))).toEqual([]);
  });

  it("shows check-ins only without a cycle: none exists, none is current, or none is picked", () => {
    const only = [checkIn("2026-09-21", { feeling: 5, note: "Between cycles." }), checkIn("2026-09-15", { feeling: 2 })];
    for (const [label, overrides] of [
      ["no cycles", { cycles: [] }],
      ["between cycles", { cycles: [ended] }],
      ["picked none", { selectedId: NO_CYCLE_PARAM }],
    ] as const) {
      const v = view({ ...overrides, checkIns: only, total: 2 });
      expect(v.cycleId, label).toBeNull();
      expect(v.rows.map((r) => [r.day, r.feelingText, r.note, r.phase, r.doses]), label).toEqual([
        ["2026-09-21", "5 · Great", "Between cycles.", "", null],
        ["2026-09-15", "2 · Low", "", "", null],
      ]);
      expect([v.tracks, v.tiles.adherence, v.feeling.preCycle, v.sparse], label).toEqual([[], null, null, SPARSE]);
      expect(v.feeling.axis.map((a) => a.wide), label).toEqual(["Aug 23", "Today"]);
    }
  });

  it("keeps one Toronto axis for a cycle in another zone: its doses fall on their Toronto day", () => {
    const tokyo = cycleOf(502, "Tokyo", [{ ...revision, id: uuid(120), timeZone: "Asia/Tokyo" }]);
    // B is Mon, Wed, Fri: Tokyo's Wed Sep 23 07:40 is Tue Sep 22 18:40 in Toronto.
    const wednesdayB = record(`${PLAN_B}:${B1}:2026-09-23`, "2026-09-22T22:40:00Z", "1");
    // Tokyo's Mon Sep 21 07:40 is Sun Sep 20 18:40 in Toronto.
    const mondayB = record(`${PLAN_B}:${B1}:2026-09-21`, "2026-09-20T22:40:00Z", "1");
    // Seen at 10 PM Toronto on Tuesday, after that dose was taken.
    const v = view({ now: "2026-09-23T02:00:00Z", cycles: [tokyo], selectedId: tokyo.id, confirmations: new Map([[tokyo.id, [mondayB, wednesdayB]]]), checkIns: [checkIn("2026-09-22", { feeling: 5 })], range: "7d" });
    expect([v.today, v.rows[0].day, v.rows[0].feelingText, v.rows[0].doses]).toEqual(["2026-09-22", "2026-09-22", "5 · Great", "Compound B 1 mg"]);
    const [b] = v.tracks.filter((t) => t.name === "Compound B");
    // Sunday 18:40 on the 5th of 7 days (Sep 16–22); Tuesday's, past the last day's centre, sits at the right edge.
    expect(b.dots.map((d) => [d.pending, d.label])).toEqual([
      [false, "Compound B · 1 mg · Sep 20 6:40 PM"],
      [false, "Compound B · 1 mg · Sep 22 6:40 PM"],
    ]);
    expect(b.dots[0].x).toBeCloseTo((4 + (18 * 60 + 40) / 1440 - 0.5) / 6);
    expect(b.dots[1].x).toBe(1);
  });

  it("shows a break as a break", () => {
    const v = view({ now: "2026-10-03T16:00:00Z", checkIns: [checkIn("2026-10-03")] });
    expect(v.rows[0].phase).toBe("Compound A: break · Compound B: 1 mg");
    expect(v.header).toBe("Recomp · day 24");
  });
});

describe("R5 Progress: dose tracks, adherence and the measurement", () => {
  it("draws each dose at its Toronto time, and today's still to take hollow", () => {
    const v = view({ range: "7d" });
    const [a, b] = v.tracks;
    expect([a.name, b.name]).toEqual(["Compound A", "Compound B"]);
    // A: Sunday 23:30 (day 6 of 7); B: Monday 07:40 (day 7).
    expect(a.dots).toEqual([{ x: expect.closeTo((5 + 1410 / 1440 - 0.5) / 6, 5), pending: false, label: "Compound A · 450 mcg · Sep 20 11:30 PM" }]);
    expect(b.dots).toEqual([{ x: expect.closeTo((6 + 460 / 1440 - 0.5) / 6, 5), pending: false, label: "Compound B · 1 mg · Sep 21 7:40 AM" }]);
    // Tuesday: A is due at 20:00 and not taken yet; B has no dose that day.
    const tuesday = view({ range: "7d", now: "2026-09-22T16:00:00Z" });
    // (The engine re-anchors every-2-days doses on the last one taken: Sunday's 23:30 makes Tuesday's 23:30.)
    expect(tuesday.tracks[0].dots.at(-1)).toMatchObject({ pending: true, x: 1, label: "Compound A · 500 mcg · due 11:30 PM" });
    // A skipped dose is not drawn at all.
    const skipped = view({ range: "7d", now: "2026-09-22T16:00:00Z", confirmations: new Map([[recomp.id, [lateA, mondayB, { key: `${PLAN_A}:${A1}:6`, actualAt: null, recordedAt: "2026-09-22T13:00:00Z", skipped: true } as unknown as RecordedConfirmation]]]) });
    expect(skipped.tracks[0].dots.some((d) => d.pending)).toBe(false);
  });

  it("counts adherence as V2 does, over the cycle's doses in the range", () => {
    // Sep 10–21: A's six doses (Sep 20 taken), B's four (Sep 21 taken).
    const v = view();
    const all = [...planOccurrences(recomp.revisions, [lateA, mondayB]).values()].flat();
    expect(adherence(all, NOW)).toMatchObject({ taken: 2, missed: 8, percent: 20 });
    expect(v.tiles.adherence).toEqual({ value: "20", unit: "%", context: "2 of 10 doses" });
    // The last 7 days only: Sep 15–21.
    expect(view({ range: "7d" }).tiles.adherence).toEqual({ value: "33", unit: "%", context: "2 of 6 doses" });
  });

  it("charts the measurement from its baseline, in its own unit, and is absent without one", () => {
    const weight = (day: string, value: string, unit = "kg") => checkIn(day, { measurement: { name: "Weight", value, unit, measuredAt: `${day}T12:00:00Z` } });
    const checkIns = [weight("2026-09-01", "84"), weight("2026-09-09", "83.2"), weight("2026-09-15", "82.1"), weight("2026-09-18", "180", "lb"), weight("2026-09-21", "81.7")];
    const card = view({ checkIns })!.measure!;
    // The last entry on or before the cycle's start (Sep 10) is the baseline; the lb entry is shown in
    // R8's weight unit (kg by default), converted exactly (V4; V3 left it out).
    expect(card).toMatchObject({ name: "Weight", unit: "kg", latest: "81.7", latestDay: "2026-09-21", entries: "5 entries", max: "84 kg", min: "81.6 kg" });
    expect(card.change).toEqual({ direction: "down", text: "Down 1.5 kg", since: "since Sep 9" });
    expect(card.points.map((p) => [p.day, p.value])).toEqual([
      ["2026-09-01", 84],
      ["2026-09-09", 83.2],
      ["2026-09-15", 82.1],
      ["2026-09-18", 81.6],
      ["2026-09-21", 81.7],
    ]);
    expect(card.points[0].x).toBeCloseTo(9 / 29);
    // Without a cycle, from the first entry in the range.
    expect(measureCard(checkIns, daysOf("2026-08-23", "2026-09-21"), null)?.change).toMatchObject({ text: "Down 2.3 kg", since: "since Sep 1" });
    // One entry: no change. Weight wins over another kind; with none, the latest kind.
    expect(measureCard([weight("2026-09-21", "81.7")], daysOf("2026-09-15", "2026-09-21"), null)).toMatchObject({ entries: "1 entry", change: null });
    const waist = checkIn("2026-09-20", { measurement: { name: "Waist", value: "80", unit: "cm", measuredAt: "2026-09-20T12:00:00Z" } });
    expect(measureCard([waist, weight("2026-09-16", "82")], daysOf("2026-09-15", "2026-09-21"), null)?.name).toBe("Weight");
    expect(measureCard([waist], daysOf("2026-09-15", "2026-09-21"), null)?.name).toBe("Waist");
    expect(view().measure).toBeNull();
  });

  it("finds the baseline before the range shown: the last entry on or before the cycle's start, in every check-in given", () => {
    const weight = (day: string, value: string, unit = "kg") => checkIn(day, { measurement: { name: "Weight", value, unit, measuredAt: `${day}T12:00:00Z` } });
    const week = daysOf("2026-09-04", "2026-09-10");
    // The cycle starts Sep 3; the range is Sep 4–10. Sep 1 is the baseline, though not shown.
    const early = measureCard([weight("2026-09-01", "84"), weight("2026-09-10", "82.5")], week, "2026-09-03")!;
    expect(early).toMatchObject({ latest: "82.5", entries: "1 entry", max: "82.5 kg", min: "82.5 kg" });
    expect(early.change).toEqual({ direction: "down", text: "Down 1.5 kg", since: "since Sep 1" });
    expect(early.points.map((p) => p.day)).toEqual(["2026-09-10"]);
    // Sep 3 (the start day) is later than Sep 1: it is the baseline.
    expect(measureCard([weight("2026-09-01", "84"), weight("2026-09-03", "83.4"), weight("2026-09-10", "82.5")], week, "2026-09-03")!.change).toEqual({
      direction: "down",
      text: "Down 0.9 kg",
      since: "since Sep 3",
    });
    // Only the same kind and unit: another unit or kind before the start is no baseline.
    const waist = checkIn("2026-09-02", { measurement: { name: "Waist", value: "80", unit: "cm", measuredAt: "2026-09-02T12:00:00Z" } });
    expect(measureCard([weight("2026-09-01", "185", "lb"), waist, weight("2026-09-05", "83"), weight("2026-09-10", "82.5")], week, "2026-09-03")!.change).toMatchObject({
      text: "Down 0.5 kg",
      since: "since Sep 5",
    });
    // Nothing measured in the range: no card, whatever came before.
    expect(measureCard([weight("2026-09-01", "84")], week, "2026-09-03")).toBeNull();
    // Through the screen: the check-ins the page fetched reach the card.
    const v = view({ range: "7d", checkIns: [weight("2026-09-09", "84"), weight("2026-09-20", "82.9")] });
    expect(v.measure?.change).toMatchObject({ text: "Down 1.1 kg", since: "since Sep 9" });
  });
});

describe("phases across revisions", () => {
  // C starts with a break (Sep 12–18), then 2 mg daily from Sep 19. No dose was ever due, so an edit on Sep 16 removed it.
  const withC: CycleRevision = {
    ...revision,
    plans: [
      ...revision.plans,
      {
        planId: PLAN_C,
        peptideId: PC,
        effectiveFrom: null,
        phases: [
          { id: C0, kind: "break", start: "2026-09-12", end: "2026-09-18" },
          { id: C1, kind: "active", start: "2026-09-19", end: "2026-09-30", doseMg: "2", time: "09:00", schedule: { type: "interval", everyDays: 1 } },
        ],
      },
    ],
  };
  /** Edited at noon on Wed Sep 16: C removed; A's dose becomes 0.6 mg from Sep 18. */
  const edited: CycleRevision = {
    id: uuid(101),
    number: 2,
    timeZone: TORONTO,
    createdAt: "2026-09-16T16:00:00Z",
    plans: [
      {
        ...revision.plans[0],
        effectiveFrom: "2026-09-18",
        phases: [{ ...(revision.plans[0].phases[0] as ActivePhase), doseChanges: [{ from: "2026-09-18", doseMg: "0.6" }] }, revision.plans[0].phases[1]],
      },
      { ...revision.plans[1], effectiveFrom: "2026-09-18" },
    ],
  };
  const cycle = cycleOf(503, "Edited", [withC, edited]);

  it("keeps a removed plan on its earlier days, through the day it was removed", () => {
    expect(phaseLine(cycle, "2026-09-12", peptides)).toBe("Compound A: 400 mcg · Compound C: break");
    expect(phaseLine(cycle, "2026-09-16", peptides)).toBe("Compound A: 400 mcg · Compound B: 1 mg · Compound C: break");
    expect(phaseLine(cycle, "2026-09-17", peptides)).toBe("Compound A: 400 mcg · Compound B: 1 mg");
    // C's active phase never came: it was removed first.
    expect(phaseLine(cycle, "2026-09-20", peptides)).toBe("Compound A: 600 mcg · Compound B: 1 mg");
    expect(phasesDuring(cycle.revisions, "2026-09-19", TORONTO).map((p) => p.planId)).toEqual([PLAN_A, PLAN_B]);
    // Only the current revision would have lost C's earlier days.
    expect(phaseLine(cycleOf(504, "Current only", [{ ...edited, number: 1, plans: edited.plans.map((p) => ({ ...p, effectiveFrom: null })) }]), "2026-09-12", peptides)).toBe(
      "Compound A: 400 mcg",
    );
    const v = view({ cycles: [cycle], now: NOW, checkIns: [checkIn("2026-09-14")] });
    expect(v.rows.find((r) => r.day === "2026-09-14")?.phase).toBe("Compound A: 400 mcg · Compound B: 1 mg · Compound C: break");
  });

  it("uses each revision from its effective date: earlier days keep the plan as it was (a same-zone seam, the control)", () => {
    // The seam is Toronto's midnight: no Toronto day straddles it.
    expect(phaseLine(cycle, "2026-09-17", peptides)).toBe("Compound A: 400 mcg · Compound B: 1 mg");
    expect(phaseLine(cycle, "2026-09-18", peptides)).toBe("Compound A: 600 mcg · Compound B: 1 mg");
    expect(phaseLine(cycle, "2026-10-02", peptides)).toBe("Compound A: break · Compound B: 1 mg");
    expect(phasesDuring(cycle.revisions, "2026-09-17", TORONTO)[0].parts.map((p) => p.date)).toEqual(["2026-09-17"]);
    everyDoseBesideItsPhase(cycle);
  });

  it("lets a later seam cut a span that began after it", () => {
    // Revision 2 (Sep 16) changes A from Sep 25; revision 3 (Sep 17) changes it again from Sep 20.
    const third: CycleRevision = {
      ...edited,
      id: uuid(102),
      number: 3,
      createdAt: "2026-09-17T16:00:00Z",
      plans: [
        {
          ...edited.plans[0],
          effectiveFrom: "2026-09-20",
          phases: [{ ...(revision.plans[0].phases[0] as ActivePhase), doseChanges: [{ from: "2026-09-20", doseMg: "0.7" }] }, revision.plans[0].phases[1]],
        },
        { ...edited.plans[1], effectiveFrom: "2026-09-20" },
      ],
    };
    const later = { ...edited, plans: edited.plans.map((p) => ({ ...p, effectiveFrom: "2026-09-25" })) };
    const cut = cycleOf(505, "Cut", [revision, later, third]);
    expect(phaseLine(cut, "2026-09-19", peptides)).toBe("Compound A: 400 mcg · Compound B: 1 mg");
    expect(phaseLine(cut, "2026-09-26", peptides)).toBe("Compound A: 700 mcg · Compound B: 1 mg");
    everyDoseBesideItsPhase(cut);
  });
});

/** Every scheduled dose's amount appears in the phase line of its Toronto day: doses and phases agree across zones. */
function everyDoseBesideItsPhase(cycle: CycleRecord) {
  const occurrences = cycleOccurrences(cycle.revisions);
  expect(occurrences.length).toBeGreaterThan(0);
  for (const o of occurrences) {
    const day = localDateOf(o.scheduledAt, TORONTO);
    const name = peptides.get(cycle.revisions[0].plans.find((p) => p.planId === o.planId)?.peptideId ?? "")?.name;
    const line = phaseLine(cycle, day, peptides).split(" · ").find((part) => part.startsWith(`${name}: `)) ?? "";
    expect(line.slice(`${name}: `.length).split(" → "), `${o.key} at ${o.scheduledAt} (${day})`).toContain(massLabel(o.doseMg));
  }
}

describe("phases across a change of time zone", () => {
  /** A: every day at 08:00, 0.4 mg, Sep 10–30, in Toronto. */
  const toronto: CycleRevision = {
    id: uuid(200),
    number: 1,
    timeZone: TORONTO,
    createdAt: "2026-09-01T12:00:00Z",
    plans: [
      {
        planId: PLAN_A,
        peptideId: PA,
        effectiveFrom: null,
        phases: [{ id: A1, kind: "active", start: "2026-09-10", end: "2026-09-30", doseMg: "0.4", time: "08:00", schedule: { type: "interval", everyDays: 1 } }],
      },
    ],
  };
  /** Edited on Sep 16: from Sep 18 (in `timeZone`), 0.6 mg. */
  const moved = (timeZone: string): CycleRevision => ({
    id: uuid(201),
    number: 2,
    timeZone,
    createdAt: "2026-09-16T16:00:00Z",
    plans: [
      {
        ...toronto.plans[0],
        effectiveFrom: "2026-09-18",
        phases: [{ ...(toronto.plans[0].phases[0] as ActivePhase), doseChanges: [{ from: "2026-09-18", doseMg: "0.6" }] }],
      },
    ],
  });

  it("Toronto to Tokyo: the seam (Sep 18 00:00 Tokyo) is Sep 17 11:00 in Toronto, so Sep 17 shows both", () => {
    const cycle = cycleOf(510, "To Tokyo", [toronto, moved("Asia/Tokyo")]);
    // The new 0.6 mg dose at Sep 18 08:00 Tokyo is Sep 17 19:00 in Toronto.
    const first = cycleOccurrences(cycle.revisions).find((o) => o.doseMg === "0.6")!;
    expect([first.scheduledAt, first.timeZone, localDateOf(first.scheduledAt, TORONTO)]).toEqual(["2026-09-17T23:00:00Z", "Asia/Tokyo", "2026-09-17"]);
    expect(phaseLine(cycle, "2026-09-16", peptides)).toBe("Compound A: 400 mcg");
    expect(phaseLine(cycle, "2026-09-17", peptides)).toBe("Compound A: 400 mcg → 600 mcg");
    expect(phasesDuring(cycle.revisions, "2026-09-17", TORONTO)[0].parts.map((p) => p.date)).toEqual(["2026-09-17", "2026-09-18"]);
    expect(phaseLine(cycle, "2026-09-18", peptides)).toBe("Compound A: 600 mcg");
    // Tokyo's last day (Sep 30) ends at Sep 30 11:00 in Toronto.
    expect(phaseLine(cycle, "2026-09-30", peptides)).toBe("Compound A: 600 mcg");
    expect(phaseLine(cycle, "2026-10-01", peptides)).toBe("");
    everyDoseBesideItsPhase(cycle);
  });

  it("Toronto to Vancouver: the seam (Sep 18 00:00 Vancouver) is Sep 18 03:00 in Toronto, so Sep 18 shows both", () => {
    const cycle = cycleOf(511, "To Vancouver", [toronto, moved("America/Vancouver")]);
    expect(phaseLine(cycle, "2026-09-17", peptides)).toBe("Compound A: 400 mcg");
    expect(phaseLine(cycle, "2026-09-18", peptides)).toBe("Compound A: 400 mcg → 600 mcg");
    expect(phaseLine(cycle, "2026-09-19", peptides)).toBe("Compound A: 600 mcg");
    // Vancouver's Sep 30 runs to Oct 1 03:00 in Toronto.
    expect(phaseLine(cycle, "2026-10-01", peptides)).toBe("Compound A: 600 mcg");
    expect(phaseLine(cycle, "2026-10-02", peptides)).toBe("");
    everyDoseBesideItsPhase(cycle);
  });
});

describe("R5 Progress in R8's weight unit", () => {
  const weights = [
    checkIn("2026-09-19", { measurement: { name: "Weight", value: "82", unit: "kg", measuredAt: "2026-09-19T12:00:00Z" } }),
    checkIn("2026-09-20", { measurement: { name: "Weight", value: "180", unit: "lb", measuredAt: "2026-09-20T12:00:00Z" } }),
    checkIn("2026-09-21", { measurement: { name: "Weight", value: "81.4", unit: "kg", measuredAt: "2026-09-21T12:00:00Z" } }),
  ];

  it("shows every weight in pounds, converted exactly from kg and as stored when entered in lb", () => {
    const v = view({ checkIns: weights, total: 3, weightUnit: "lb" });
    expect(v.measure).toMatchObject({ name: "Weight", unit: "lb", latest: "179.5", entries: "3 entries", max: "180.8 lb", min: "179.5 lb" });
    expect(v.measure?.points.map((p) => p.value)).toEqual([180.8, 180, 179.5]);
  });

  it("keeps kg by default, converting a weight entered in lb", () => {
    const v = view({ checkIns: weights, total: 3 });
    expect(v.measure).toMatchObject({ unit: "kg", latest: "81.4", entries: "3 entries", max: "82 kg", min: "81.4 kg" });
    expect(v.measure?.points.map((p) => p.value)).toEqual([82, 81.6, 81.4]);
  });
});
