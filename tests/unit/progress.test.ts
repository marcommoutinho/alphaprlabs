// S15 R9 Progress: the check-in's validation (feeling, chips, the
// measurement's decimals with the app's comma rules), the day in a zone
// (boundaries across zones and daylight-saving changes), and the history
// view built beside recorded doses and the cycle's phases. Pure, no database.
// Sep 21, 2026 is a Monday.
import { describe, expect, it } from "vitest";
import type { CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import type { RecordedConfirmation, ViewPeptides } from "@/lib/cycles/views";
import {
  CHECK_IN_INVALID,
  checkInDay,
  effectsLine,
  FEELING_REQUIRED,
  measurementValue,
  NO_CHECK_IN,
  NO_DOSES,
  NOTE_TOO_LONG,
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
import { progressView, progressWindow, selectedCycle } from "@/lib/progress/view";
import type { ActivePhase } from "@/lib/schedule/engine";
import { localDateOf } from "@/lib/schedule/zone";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TORONTO = "America/Toronto";

// ── Validation ──────────────────────────────────────────────────────────────

const form = (overrides: Record<string, unknown> = {}) => ({
  cycleId: uuid(1),
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

  it("refuses a malformed cycle, day or version", () => {
    for (const bad of [{ cycleId: "nope" }, { day: "Sep 21" }, { version: 0 }, { version: 1.5 }, { version: "2" }]) {
      expect(error(bad), JSON.stringify(bad)).toBe(CHECK_IN_INVALID);
    }
    expect(validateCheckIn("nope")).toEqual({ ok: false, error: CHECK_IN_INVALID });
    const ok = validateCheckIn(form({ version: 3, cycleId: uuid(1).toUpperCase() }));
    expect(ok.ok && [ok.value.version, ok.value.cycleId]).toEqual([3, uuid(1)]);
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

describe("a check-in's day is the local date in the cycle's zone", () => {
  it("turns at local midnight on both sides of Toronto's daylight-saving changes", () => {
    // Fall back on Sun Nov 1, 2026: midnight is 04:00Z before, 05:00Z after.
    expect(checkInDay("2026-11-01T03:59:59Z", TORONTO)).toBe("2026-10-31");
    expect(checkInDay("2026-11-01T04:00:00Z", TORONTO)).toBe("2026-11-01");
    // 01:30 happens twice that night; both are Nov 1.
    expect(checkInDay("2026-11-01T05:30:00Z", TORONTO)).toBe("2026-11-01");
    expect(checkInDay("2026-11-01T06:30:00Z", TORONTO)).toBe("2026-11-01");
    expect(checkInDay("2026-11-02T04:59:59Z", TORONTO)).toBe("2026-11-01");
    expect(checkInDay("2026-11-02T05:00:00Z", TORONTO)).toBe("2026-11-02");
    // Spring forward on Sun Mar 8, 2026: midnight is 05:00Z before, 04:00Z after (a 23-hour day).
    expect(checkInDay("2026-03-08T04:59:59Z", TORONTO)).toBe("2026-03-07");
    expect(checkInDay("2026-03-08T05:00:00Z", TORONTO)).toBe("2026-03-08");
    expect(checkInDay("2026-03-09T03:59:59Z", TORONTO)).toBe("2026-03-08");
    expect(checkInDay("2026-03-09T04:00:00Z", TORONTO)).toBe("2026-03-09");
  });

  it("differs between zones at the same instant, and agrees with the schedule engine's local date", () => {
    const at = "2026-09-21T16:00:00Z";
    expect(checkInDay(at, TORONTO)).toBe("2026-09-21");
    expect(checkInDay(at, "Asia/Tokyo")).toBe("2026-09-22");
    expect(checkInDay(at, "Pacific/Kiritimati")).toBe("2026-09-22");
    expect(checkInDay("2026-09-21T11:30:00Z", "Pacific/Pago_Pago")).toBe("2026-09-21");
    expect(checkInDay("2026-09-21T10:30:00Z", "Pacific/Pago_Pago")).toBe("2026-09-20");
    const zones = [TORONTO, "Europe/London", "Australia/Lord_Howe", "Asia/Kathmandu", "America/St_Johns", "UTC", "Etc/GMT+12", "Etc/GMT-14"];
    for (let t = Date.parse("2026-01-01T00:00:00Z"); t < Date.parse("2027-01-01T00:00:00Z"); t += 7 * 3_600_000 + 17 * 60_000) {
      const iso = new Date(t).toISOString();
      for (const zone of zones) expect(checkInDay(iso, zone), `${iso} ${zone}`).toBe(localDateOf(iso, zone));
    }
  });
});

// ── The history view ────────────────────────────────────────────────────────

const [PA, PB] = [uuid(901), uuid(902)];
const peptides: ViewPeptides = new Map([
  [PA, { name: "Compound A", available: true }],
  [PB, { name: "Compound B", available: true }],
]);
const [PLAN_A, PLAN_B, A1, BREAK, B1] = [uuid(1), uuid(2), uuid(10), uuid(11), uuid(20)];

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
    plans: [{ planId: uuid(3), peptideId: PA, effectiveFrom: null, phases: [{ ...(revision.plans[0].phases[0] as ActivePhase), id: uuid(12), start: "2026-08-01", end: "2026-08-20", doseChanges: [] }] }],
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
// A's 20:00 dose on Sun Sep 20 (index 5), taken at 23:30 in Toronto: Sep 21 in UTC, Sep 20 in the cycle's zone.
const lateA = record(`${PLAN_A}:${A1}:5`, "2026-09-21T03:30:00Z", "0.45");
// B's Monday dose, taken at 07:40.
const mondayB = record(`${PLAN_B}:${B1}:2026-09-21`, "2026-09-21T11:40:00Z", "1");

const checkIn = (day: string, overrides: Partial<CheckIn> = {}): CheckIn => ({
  id: uuid(Number(day.replace(/-/g, "")) % 100000),
  day,
  timeZone: TORONTO,
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

const ready = (v: ReturnType<typeof progressView>) => {
  if (v.kind !== "ready") throw new Error("expected a cycle");
  return v;
};

describe("R9 Progress view", () => {
  it("needs a cycle", () => {
    expect(view({ cycles: [] })).toEqual({ kind: "no-cycle" });
  });

  it("shows the cycle asked for, else the newest current one, else the newest", () => {
    expect(selectedCycle([ended, recomp], null, NOW)?.id).toBe(recomp.id);
    expect(selectedCycle([ended, recomp], ended.id, NOW)?.id).toBe(ended.id);
    expect(selectedCycle([ended, recomp], ended.id.toUpperCase(), NOW)?.id).toBe(ended.id);
    expect(selectedCycle([ended, recomp], uuid(999), NOW)?.id).toBe(recomp.id);
    expect(selectedCycle([ended], null, NOW)?.id).toBe(ended.id);
    const v = ready(view());
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
    const summer = ready(view({ selectedId: ended.id })).cycle;
    expect([summer.baseline, summer.hasBaseline, summer.status]).toEqual(["not set yet", false, "Ended"]);
  });

  it("lists the last 14 days in the cycle's zone, today first, each with its phases and the doses actually recorded", () => {
    const v = ready(view());
    expect(v.timeZone).toBe(TORONTO);
    expect(v.rows).toHaveLength(14);
    expect(v.rows.map((r) => r.day)[0]).toBe("2026-09-21");
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
    // Each dose on the day of its actual time in its own zone, with the amount recorded.
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
    const v = ready(view({ checkIns: [checkIn("2026-09-19", { effects: ["None noticed"], feeling: 2 }), today], total: 3 }));
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
      cycleId: recomp.id,
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
    const fresh = ready(view()).form;
    expect([fresh.title, fresh.saveLabel, fresh.start]).toEqual(["Today's check-in", "Save check-in", null]);
  });

  it("follows the selected cycle's zone for today and the window", () => {
    const tokyo = cycleOf(502, "Tokyo", [{ ...revision, id: uuid(120), timeZone: "Asia/Tokyo" }]);
    expect(progressWindow(tokyo, NOW)).toEqual({ from: "2026-09-09", to: "2026-09-22", timeZone: "Asia/Tokyo" });
    const v = ready(view({ cycles: [tokyo, recomp], selectedId: tokyo.id, checkIns: [checkIn("2026-09-22", { feeling: 5 })] }));
    expect([v.form.day, v.rows[0].day, v.rows[0].feelLabel]).toEqual(["2026-09-22", "2026-09-22", "5/5"]);
    // Recomp's doses keep their own zone's days (Toronto), whichever cycle is shown.
    expect(v.rows.find((r) => r.day === "2026-09-20")?.doses).toBe("Doses: Compound A 0.45 mg");
  });

  it("shows a break as a break", () => {
    const v = ready(view({ now: "2026-10-03T16:00:00Z" }));
    expect(v.rows[0].phase).toBe("Compound A: break · Compound B: 1 mg");
    expect(v.cycle.status).toBe("Active");
  });
});
