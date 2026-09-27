// S15 R9 Progress: the check-in's validation (feeling, chips, the
// measurement's decimals with the app's comma rules, lengths in characters
// as PostgreSQL counts them), the check-in's day (always America/Toronto,
// across midnight and daylight-saving changes), phases across revisions, and
// the history view with and without a cycle. Pure, no database.
// Sep 21, 2026 is a Monday.
import { describe, expect, it } from "vitest";
import type { CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import { phasesOn } from "@/lib/cycles/schedule";
import type { RecordedConfirmation, ViewPeptides } from "@/lib/cycles/views";
import {
  CHECK_IN_INVALID,
  characters,
  checkInDay,
  effectsLine,
  FEELING_REQUIRED,
  measurementValue,
  NO_CHECK_IN,
  NO_DOSES,
  NOTE_TOO_LONG,
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
import type { CheckIn } from "@/lib/progress/service";
import { NO_CYCLE_PARAM, phaseLine, progressView, progressWindow, selectedCycle } from "@/lib/progress/view";
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

  it("accepts R9's chips only: distinct, and None noticed alone; stores them in the chips' order", () => {
    const ok = validateCheckIn(form({ effects: ["Nausea", "Mild headache"] }));
    expect(ok.ok && ok.value.effects).toEqual(["Mild headache", "Nausea"]);
    expect(validateCheckIn(form({ effects: ["None noticed"] })).ok).toBe(true);
    for (const effects of [["Dizzy"], ["Nausea", "Nausea"], ["None noticed", "Nausea"], "Nausea", null]) {
      expect(error({ effects }), JSON.stringify(effects)).toBe(CHECK_IN_INVALID);
    }
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

  it("toggles chips as the prototype does: None noticed clears the others and is cleared by them", () => {
    expect(toggleEffect([], "Nausea")).toEqual(["Nausea"]);
    expect(toggleEffect(["Nausea"], "Mild headache")).toEqual(["Mild headache", "Nausea"]);
    expect(toggleEffect(["Nausea", "Fatigue"], "None noticed")).toEqual(["None noticed"]);
    expect(toggleEffect(["None noticed"], "Fatigue")).toEqual(["Fatigue"]);
    expect(toggleEffect(["Fatigue"], "Fatigue")).toEqual([]);
    expect(effectsLine(["None noticed"])).toBe("");
    expect(effectsLine(["Mild headache", "Nausea"])).toBe("Mild headache, Nausea");
  });
});

// ── The day ─────────────────────────────────────────────────────────────────

describe("a check-in's day is the America/Toronto calendar day", () => {
  it("defaults to Toronto, whatever zone the device or a cycle uses", () => {
    expect(PROGRESS_TIME_ZONE).toBe(TORONTO);
    // 23:30 in Toronto is already the next day in Tokyo and in UTC; the check-in is Toronto's day.
    expect(checkInDay("2026-09-22T03:30:00Z")).toBe("2026-09-21");
    expect(progressWindow("2026-09-22T03:30:00Z")).toEqual({ from: "2026-09-08", to: "2026-09-21" });
    expect(progressWindow("2026-09-22T04:00:00Z")).toEqual({ from: "2026-09-09", to: "2026-09-22" });
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
  note: "",
  measurement: null,
  version: 1,
  createdAt: `${day}T13:00:00Z`,
  updatedAt: `${day}T13:00:00Z`,
  ...overrides,
});

const view = (overrides: Partial<Parameters<typeof progressView>[0]> = {}) =>
  progressView({
    cycles: [ended, recomp],
    selectedId: null,
    checkIns: [],
    total: 0,
    confirmations: new Map([[recomp.id, [lateA, mondayB]]]),
    peptides,
    now: NOW,
    ...overrides,
  });

describe("R9 Progress view", () => {
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
    expect(v.cycle).toEqual({
      id: recomp.id,
      name: "Recomp",
      goal: "Body composition",
      baseline: "82.4 kg",
      hasBaseline: true,
      status: "Active",
      dates: "Sep 10 – Oct 9, 2026",
      editHref: `/app/cycles/${recomp.id}/edit`,
    });
    const summer = view({ selectedId: ended.id }).cycle!;
    expect([summer.baseline, summer.hasBaseline, summer.status]).toEqual(["not set yet", false, "Ended"]);
  });

  it("lists the last 14 Toronto days, today first, each with the cycle's phases and the doses actually recorded", () => {
    const v = view();
    expect(v.rows).toHaveLength(14);
    expect(v.rows[0].day).toBe("2026-09-21");
    expect(v.rows.at(-1)?.day).toBe("2026-09-08");
    expect(v.rows.slice(0, 3).map((r) => [r.label, r.today])).toEqual([
      ["Today", true],
      ["Sun Sep 20", false],
      ["Sat Sep 19", false],
    ]);
    const on = (day: string) => v.rows.find((r) => r.day === day)!;
    // A's dose change from Sep 21; B starts Sep 14; nothing before Sep 10.
    expect(on("2026-09-21").phase).toBe("Compound A: 0.5 mg · Compound B: 1 mg");
    expect(on("2026-09-20").phase).toBe("Compound A: 0.4 mg · Compound B: 1 mg");
    expect(on("2026-09-12").phase).toBe("Compound A: 0.4 mg");
    expect(on("2026-09-09").phase).toBe("");
    // Each dose on the Toronto day of its actual time, with the amount recorded.
    expect(on("2026-09-21").doses).toBe("Doses: Compound B 1 mg");
    expect(on("2026-09-20").doses).toBe("Doses: Compound A 0.45 mg");
    expect(on("2026-09-18").doses).toBe(NO_DOSES);
    // No check-ins yet: gaps, not zeros.
    expect(v.rows.every((r) => r.feeling === null && r.feelLabel === NO_CHECK_IN && !r.effects && !r.note && !r.measure)).toBe(true);
    expect(v.sparse).toBe(SPARSE);
  });

  it("shows each check-in on its day, and today's as the form's starting point", () => {
    const today = checkIn("2026-09-21", {
      feeling: 4,
      effects: ["Mild headache", "Nausea"],
      note: "Slept better.",
      measurement: { name: "Weight", value: "82.4", unit: "kg", measuredAt: "2026-09-21T12:00:00Z" },
      version: 2,
      updatedAt: "2026-09-21T13:05:00Z",
    });
    const v = view({ checkIns: [checkIn("2026-09-19", { effects: ["None noticed"], feeling: 2 }), today], total: 3 });
    expect(v.rows[0]).toMatchObject({
      feeling: 4,
      feelLabel: "4/5",
      effects: "Mild headache, Nausea",
      note: "Slept better.",
      measure: "Weight 82.4 kg",
      doses: "Doses: Compound B 1 mg",
    });
    // "None noticed" alone is no line of its own.
    expect(v.rows[2]).toMatchObject({ day: "2026-09-19", feeling: 2, feelLabel: "2/5", effects: "", measure: "" });
    expect(v.sparse).toBe("");
    expect(v.form).toEqual({
      day: "2026-09-21",
      title: "Today's check-in · saved 09:05",
      saveLabel: "Update today's check-in",
      start: {
        version: 2,
        feeling: 4,
        effects: ["Mild headache", "Nausea"],
        note: "Slept better.",
        measurement: { name: "Weight", value: "82.4", unit: "kg" },
      },
    });
    const fresh = view().form;
    expect([fresh.title, fresh.saveLabel, fresh.start]).toEqual(["Today's check-in", "Save check-in", null]);
  });

  it("shows check-ins only, without a cycle: none exists, none is current, or none is picked", () => {
    const checkIns = [checkIn("2026-09-21", { feeling: 5, note: "Between cycles." }), checkIn("2026-09-15", { feeling: 2 })];
    for (const [label, overrides] of [
      ["no cycles", { cycles: [] }],
      ["between cycles", { cycles: [ended] }],
      ["picked none", { selectedId: NO_CYCLE_PARAM }],
    ] as const) {
      const v = view({ ...overrides, checkIns, total: 2 });
      expect(v.cycle, label).toBeNull();
      expect(v.rows.map((r) => r.day), label).toEqual(Array.from({ length: 14 }, (_, i) => `2026-09-${String(21 - i).padStart(2, "0")}`));
      expect(v.rows[0], label).toMatchObject({ feelLabel: "5/5", note: "Between cycles.", phase: "", doses: null });
      expect(v.rows.find((r) => r.day === "2026-09-15"), label).toMatchObject({ feelLabel: "2/5", doses: null });
      expect(v.form.day, label).toBe("2026-09-21");
    }
    expect(view({ cycles: [] }).cycles).toEqual([]);
  });

  it("keeps one Toronto axis for a cycle in another zone: its doses fall on their Toronto day", () => {
    const tokyo = cycleOf(502, "Tokyo", [{ ...revision, id: uuid(120), timeZone: "Asia/Tokyo" }]);
    // Tokyo's Tue Sep 22 07:40 is Mon Sep 21 18:40 in Toronto.
    const tuesdayB = record(`${PLAN_B}:${B1}:2026-09-22`, "2026-09-21T22:40:00Z", "1");
    const v = view({ cycles: [tokyo], selectedId: tokyo.id, confirmations: new Map([[tokyo.id, [tuesdayB]]]), checkIns: [checkIn("2026-09-21", { feeling: 5 })] });
    expect([v.form.day, v.rows[0].day, v.rows[0].feelLabel, v.rows[0].doses]).toEqual(["2026-09-21", "2026-09-21", "5/5", "Doses: Compound B 1 mg"]);
  });

  it("shows a break as a break", () => {
    const v = view({ now: "2026-10-03T16:00:00Z" });
    expect(v.rows[0].phase).toBe("Compound A: break · Compound B: 1 mg");
    expect(v.cycle?.status).toBe("Active");
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
    expect(phaseLine(cycle, "2026-09-12", peptides)).toBe("Compound A: 0.4 mg · Compound C: break");
    expect(phaseLine(cycle, "2026-09-16", peptides)).toBe("Compound A: 0.4 mg · Compound B: 1 mg · Compound C: break");
    expect(phaseLine(cycle, "2026-09-17", peptides)).toBe("Compound A: 0.4 mg · Compound B: 1 mg");
    // C's active phase never came: it was removed first.
    expect(phaseLine(cycle, "2026-09-20", peptides)).toBe("Compound A: 0.6 mg · Compound B: 1 mg");
    expect(phasesOn(cycle.revisions, "2026-09-19").map((p) => p.planId)).toEqual([PLAN_A, PLAN_B]);
    // Only the current revision would have lost C's earlier days.
    expect(phaseLine(cycleOf(504, "Current only", [{ ...edited, number: 1, plans: edited.plans.map((p) => ({ ...p, effectiveFrom: null })) }]), "2026-09-12", peptides)).toBe(
      "Compound A: 0.4 mg",
    );
    const v = view({ cycles: [cycle], now: NOW });
    expect(v.rows.find((r) => r.day === "2026-09-14")?.phase).toBe("Compound A: 0.4 mg · Compound B: 1 mg · Compound C: break");
  });

  it("uses each revision from its effective date: earlier days keep the plan as it was", () => {
    expect(phaseLine(cycle, "2026-09-17", peptides)).toBe("Compound A: 0.4 mg · Compound B: 1 mg");
    expect(phaseLine(cycle, "2026-09-18", peptides)).toBe("Compound A: 0.6 mg · Compound B: 1 mg");
    expect(phaseLine(cycle, "2026-10-02", peptides)).toBe("Compound A: break · Compound B: 1 mg");
  });
});
