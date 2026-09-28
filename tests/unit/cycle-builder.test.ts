// V2 cycle builder (R4a–c and review): the model's conversion to and from
// the stored form (which validateCycle still checks), template copies, the
// dose and unit, the mix saved with each peptide, and the validation the
// builder shows as the first error plus "(+N more)". Pure.
import { describe, expect, it } from "vitest";
import {
  blankMix,
  type BuilderPlan,
  type BuilderState,
  builderFromForm,
  cycleDays,
  endBefore,
  endsBefore,
  endPlanNow,
  exactSyringes,
  firstIssue,
  formFromBuilder,
  mixEntry,
  mixFrom,
  mixIssues,
  newBuilderPlan,
  newPhase,
  nextFreeDay,
  phaseNames,
  planLink,
  previewPhases,
  reviewIssues,
  scheduleIssues,
  togglePlan,
  withDose,
  withSyringe,
  withUnit,
} from "@/lib/cycles/builder";
import { type CycleForm, type CyclePeptide, formFromTemplate, GOAL_REQUIRED, NAME_REQUIRED, TIME_ZONE_REQUIRED, validateCycle } from "@/lib/cycles/rules";
import type { Mixture } from "@/lib/mixtures/rules";
import type { TemplatePlan } from "@/lib/templates/rules";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PA, PB] = [uuid(901), uuid(902)];
const peptides: CyclePeptide[] = [
  { id: PA, name: "BPC-157", available: true },
  { id: PB, name: "TB-500", available: true },
];
const nameOf = (id: string) => peptides.find((p) => p.id === id)?.name ?? "Peptide";
const TORONTO = "America/Toronto";

const form: CycleForm = {
  cycleId: null,
  version: null,
  templateId: null,
  name: "Recovery",
  timeZone: TORONTO,
  goal: "Recover",
  baseline: "",
  plans: [
    {
      planId: null,
      peptideId: PA,
      phases: [
        { id: null, kind: "active", start: "2026-10-01", end: "2026-10-28", mg: "0.25", time: "20:00", schedule: "interval", every: "1", days: [1, 3, 5] },
        { id: null, kind: "break", start: "2026-10-29", end: "2026-11-04", mg: "", time: "08:00", schedule: "interval", every: "1", days: [1, 3, 5] },
        { id: null, kind: "active", start: "2026-11-05", end: "2026-11-18", mg: "0.5", time: "20:00", schedule: "interval", every: "3", days: [1, 3, 5] },
      ],
    },
    {
      planId: null,
      peptideId: PB,
      phases: [{ id: null, kind: "active", start: "2026-10-01", end: "2026-10-31", mg: "2.5", time: "07:30", schedule: "weekdays", every: "2", days: [1, 4] }],
    },
  ],
};

describe("conversion", () => {
  const state = builderFromForm(form, "2026-10-01");

  it("dates become cycle days, amounts the plan's unit, and every 1 day 'daily'", () => {
    const [a, b] = state.plans;
    expect(a).toMatchObject({ unit: "mcg", dose: "250", started: false });
    expect(a.phases.map((p) => [p.kind, p.day, p.length, p.dose, p.frequency, p.every])).toEqual([
      ["active", "1", "28", "250", "daily", "2"],
      ["break", "29", "7", "", "daily", "2"],
      ["active", "36", "14", "500", "every", "3"],
    ]);
    expect(b).toMatchObject({ unit: "mg", dose: "2.5" });
    expect(b.phases[0]).toMatchObject({ day: "1", length: "31", frequency: "weekdays", days: [1, 4], time: "07:30" });
    expect(cycleDays(state)).toBe(49);
  });

  it("round-trips to the same stored form, which validateCycle accepts", () => {
    const back = formFromBuilder(state);
    expect(back.plans[0].phases.map((p) => [p.kind, p.start, p.end, p.mg, p.schedule, p.every])).toEqual([
      ["active", "2026-10-01", "2026-10-28", "0.25", "interval", "1"],
      ["break", "2026-10-29", "2026-11-04", "", "interval", "1"],
      ["active", "2026-11-05", "2026-11-18", "0.5", "interval", "3"],
    ]);
    expect(back.plans[1].phases[0]).toMatchObject({ start: "2026-10-01", end: "2026-10-31", mg: "2.5", schedule: "weekdays", days: [1, 4] });
    expect(validateCycle(back, peptides).ok).toBe(true);
  });

  it("moving day 1 moves every phase with it", () => {
    const moved = formFromBuilder({ ...state, start: "2026-10-05" });
    expect(moved.plans[0].phases[2]).toMatchObject({ start: "2026-11-09", end: "2026-11-22" });
  });

  it("a template copy: day offsets from the chosen start, no ids, the template's name", () => {
    const plans: TemplatePlan[] = [
      {
        peptideId: PA,
        phases: [
          { kind: "active", offset: 0, len: 28, doseMg: "0.4", time: "20:00", schedule: { type: "interval", everyDays: 2 } },
          { kind: "break", offset: 28, len: 7 },
        ],
      },
    ];
    const copy = builderFromForm(formFromTemplate({ id: uuid(800), name: "Recovery stack", plans }, "2026-10-01", TORONTO), "2026-10-01");
    expect(copy).toMatchObject({ templateId: uuid(800), name: "Recovery stack", goal: "", cycleId: null });
    expect(copy.plans[0]).toMatchObject({ planId: null, unit: "mcg", dose: "400" });
    expect(copy.plans[0].phases.map((p) => [p.id, p.kind, p.day, p.length])).toEqual([
      [null, "active", "1", "28"],
      [null, "break", "29", "7"],
    ]);
    expect(copy.plans[0].phases[0]).toMatchObject({ frequency: "every", every: "2", time: "20:00", dose: "400" });
    expect(new Set(copy.plans[0].phases.map((p) => p.key)).size).toBe(2);
  });

  it("editing: locks and started plans carry over, and the reference dose is the first phase not ended", () => {
    const stored: CycleForm = {
      ...form,
      cycleId: uuid(500),
      version: 3,
      plans: [{ ...form.plans[0], planId: uuid(1), phases: form.plans[0].phases.map((p, i) => ({ ...p, id: uuid(10 + i) })) }],
    };
    const edit = builderFromForm(stored, "2026-10-01", { locks: { [uuid(10)]: "ended", [uuid(12)]: "started" }, started: [uuid(1)] });
    expect(edit).toMatchObject({ cycleId: uuid(500), version: 3 });
    expect(edit.plans[0]).toMatchObject({ started: true, dose: "500" });
    expect(edit.plans[0].phases.map((p) => [p.key, p.lock])).toEqual([
      [uuid(10), "ended"],
      [uuid(11), null],
      [uuid(12), "started"],
    ]);
  });
});

describe("editing the model", () => {
  it("new phases follow the last one: 28 days active or 7 break, with its time and rhythm", () => {
    const plan = builderFromForm(form, "2026-10-01").plans[0];
    expect(nextFreeDay(plan)).toBe(50);
    expect(newPhase(plan, "active")).toMatchObject({ id: null, day: "50", length: "28", dose: "250", time: "20:00", frequency: "every", every: "3" });
    expect(newPhase(plan, "break")).toMatchObject({ day: "50", length: "7", dose: "" });
    const fresh = newBuilderPlan(PB);
    expect(fresh).toMatchObject({ planId: null, unit: "mg", dose: "", started: false, mix: blankMix() });
    expect(fresh.phases).toHaveLength(1);
    expect(fresh.phases[0]).toMatchObject({ day: "1", length: "28", time: "08:00", frequency: "daily" });
  });

  it("the dose reaches phases still on the old dose or empty, not ones given their own or ended", () => {
    const plan = builderFromForm(form, "2026-10-01").plans[0];
    const ended = { ...plan, phases: [{ ...plan.phases[0], key: "e", lock: "ended" as const }, ...plan.phases] };
    const next = withDose(ended, "300");
    expect(next.dose).toBe("300");
    expect(next.phases.map((p) => p.dose)).toEqual(["250", "300", "", "500"]);
    // An empty dose takes the new one.
    const empty = withDose({ ...plan, phases: [{ ...plan.phases[0], dose: "" }] }, "150");
    expect(empty.phases[0].dose).toBe("150");
  });

  it("mcg ↔ mg shows the same mass", () => {
    const plan = builderFromForm(form, "2026-10-01").plans[0];
    const mg = withUnit(plan, "mg");
    expect(mg).toMatchObject({ unit: "mg", dose: "0.25" });
    expect(mg.phases.map((p) => p.dose)).toEqual(["0.25", "", "0.5"]);
    expect(withUnit(mg, "mcg").phases.map((p) => p.dose)).toEqual(["250", "", "500"]);
    expect(withUnit(plan, "mcg")).toBe(plan);
    // Text that isn't a number stays as typed.
    expect(withUnit({ ...plan, dose: "abc" }, "mg").dose).toBe("abc");
  });

  it("the preview draws only phases with a whole day and length", () => {
    const plan = builderFromForm(form, "2026-10-01").plans[0];
    const partial = { ...plan, phases: [...plan.phases, { ...plan.phases[0], key: "x", day: "", length: "3" }] };
    const phases = previewPhases(partial, "2026-10-01");
    expect(phases.map((p) => [p.kind, p.start, p.end])).toEqual([
      ["active", "2026-10-01", "2026-10-28"],
      ["break", "2026-10-29", "2026-11-04"],
      ["active", "2026-11-05", "2026-11-18"],
    ]);
    expect(phases[0]).toMatchObject({ doseMg: "0.25" });
    expect(previewPhases(plan, "")).toEqual([]);
  });
});

describe("the mix", () => {
  const mixture: Mixture = {
    id: uuid(700),
    ownerId: uuid(600),
    peptideId: PA,
    version: 2,
    setupNumber: 2,
    setupId: uuid(701),
    setup: { vialMg: "10", liquidMl: "2", syringe: 30, lineSpacing: "0.5" },
    setupSince: "2026-09-01T12:00:00Z",
    createdAt: "2026-09-01T12:00:00Z",
    planIds: [],
  };
  const plan = (mix = blankMix()): BuilderPlan => ({ ...newBuilderPlan(PA, mix), dose: "250", unit: "mcg" });

  const link = { mixtureId: uuid(700), version: 2 };

  it("unchanged and already the plan's: keep; blank with no mix before: nothing to send", () => {
    expect(mixEntry(plan())).toBeNull();
    expect(mixEntry(plan(mixFrom(mixture, true)), link)).toEqual({ kind: "keep", peptideId: PA, mixtureId: uuid(700), version: 2 });
    expect(mixEntry(plan({ ...mixFrom(mixture, true), vialMg: "10.0" }), link)).toMatchObject({ kind: "keep" });
    // The same mixture shown as a saved one to reuse.
    expect(mixEntry(plan(mixFrom(mixture, false)), link)).toMatchObject({ kind: "keep" });
  });

  it("a cleared mix the plan had is removed, never left as it was", () => {
    const remove = { kind: "remove", peptideId: PA, mixtureId: uuid(700), version: 2 };
    expect(mixEntry(plan({ ...mixFrom(mixture, true), vialMg: "", liquidMl: "" }), link)).toEqual(remove);
    expect(mixEntry(plan({ ...mixFrom(mixture, true), vialMg: "  ", liquidMl: "" }), link)).toEqual(remove);
  });

  // An edit whose plan for PA (stored id PLAN) uses the mixture.
  const PLAN = uuid(800);
  const stored: CycleForm = { ...form, cycleId: uuid(801), version: 1, plans: [{ ...form.plans[0], planId: PLAN }] };
  const opened = () => builderFromForm(stored, "2026-10-01", { mixes: new Map([[PA, mixFrom(mixture, true)]]) });

  it("builderFromForm records each stored plan's mixture when the builder opened, by plan id", () => {
    expect(opened().links).toEqual({ [PLAN]: link });
    expect(builderFromForm(stored, "2026-10-01", { mixes: new Map([[PA, mixFrom(mixture, false)]]) }).links).toEqual({});
    // A new cycle's plans aren't stored yet: nothing to keep or remove.
    expect(builderFromForm(form, "2026-10-01", { mixes: new Map([[PA, mixFrom(mixture, true)]]) }).links).toEqual({});
    expect(planLink(opened(), { planId: null })).toBeNull();
  });

  it("unchecking and checking a peptide again restores its plan, its stored id and its mixture link", () => {
    const fresh = () => newBuilderPlan(PA, mixFrom(mixture, false));
    const state = opened();
    const out = togglePlan(state, PA, fresh);
    expect(out.plans).toEqual([]);
    const back = togglePlan(out, PA, fresh);
    expect(back.plans).toEqual(state.plans);
    expect(back.removed).toEqual({});
    const entry = (s: typeof state) => mixEntry(s.plans[0], planLink(s, s.plans[0]));
    // Unchanged, cleared and changed after the round trip: keep, remove and set, on the same plan.
    expect(entry(back)).toMatchObject({ kind: "keep", mixtureId: uuid(700) });
    const cleared = { ...back, plans: [{ ...back.plans[0], mix: { ...back.plans[0].mix, vialMg: "", liquidMl: "" } }] };
    expect(entry(cleared)).toMatchObject({ kind: "remove", mixtureId: uuid(700) });
    const changed = { ...back, plans: [{ ...back.plans[0], mix: { ...back.plans[0].mix, liquidMl: "3" } }] };
    expect(entry(changed)).toMatchObject({ kind: "set", mixtureId: uuid(700), setup: { liquidMl: "3" } });
    expect(changed.plans[0].planId).toBe(PLAN);
    // A started plan can't be unchecked; a peptide never in the builder is added fresh.
    const started = { ...state, plans: [{ ...state.plans[0], started: true }] };
    expect(togglePlan(started, PA, fresh)).toBe(started);
    expect(togglePlan(state, PB, () => newBuilderPlan(PB)).plans.map((p) => [p.peptideId, p.planId])).toEqual([
      [PA, PLAN],
      [PB, null],
    ]);
  });

  it("End it now ends a phase under way the day before the edit applies", () => {
    // Day 3 of a cycle from Oct 1 is Oct 3; changes apply from Oct 10: it ends Oct 9, 7 days long.
    expect(endBefore({ day: "3" }, "2026-10-01", "2026-10-10")).toEqual({ length: "7" });
    expect(endsBefore({ day: "3", length: "7" }, "2026-10-01", "2026-10-10")).toBe(true);
    expect(endsBefore({ day: "3", length: "8" }, "2026-10-01", "2026-10-10")).toBe(false);
    expect(endBefore({ day: "10" }, "2026-10-01", "2026-10-10")).toBeNull();
    expect(endBefore({ day: "3" }, "2026-10-01", null)).toBeNull();
  });

  it("End it now ends the whole plan: the phase under way shortened, every later phase and break removed", () => {
    const base = newBuilderPlan(PA);
    const phase = (key: string, kind: "active" | "break", day: string, length: string, lock: "ended" | "started" | null) => ({
      ...base.phases[0],
      key,
      id: key,
      kind,
      day,
      length,
      lock,
    });
    const plan: BuilderPlan = {
      ...base,
      phases: [phase("p0", "active", "1", "5", "ended"), phase("p1", "active", "6", "20", "started"), phase("b", "break", "26", "7", null), phase("p2", "active", "33", "10", null)],
    };
    // From Oct 1, phase 1 runs from Oct 6; the edit applies from Oct 10: it ends Oct 9.
    const ended = endPlanNow(plan, "p1", "2026-10-01", "2026-10-10")!;
    expect(ended.phases.map((p) => [p.key, p.day, p.length])).toEqual([
      ["p0", "1", "5"],
      ["p1", "6", "4"],
    ]);
    expect(endPlanNow(plan, "b", "2026-10-01", "2026-10-10")).toBeNull();
    expect(endPlanNow(plan, "p1", "2026-10-01", null)).toBeNull();
  });

  it("a saved mix to reuse links it; a change makes the next setup of the same mixture", () => {
    expect(mixEntry(plan(mixFrom(mixture, false)))).toEqual({
      kind: "set",
      peptideId: PA,
      mixtureId: uuid(700),
      version: 2,
      setup: { vialMg: "10", liquidMl: "2", syringe: 30, lineSpacing: "0.5" },
    });
    expect(mixEntry(plan({ ...mixFrom(mixture, true), liquidMl: "3" }), link)).toMatchObject({
      kind: "set",
      mixtureId: uuid(700),
      version: 2,
      setup: { liquidMl: "3" },
    });
    expect(mixEntry(plan({ ...blankMix(), vialMg: "5", liquidMl: "2.50" }), link)).toEqual({
      kind: "set",
      peptideId: PA,
      mixtureId: null,
      version: null,
      setup: { vialMg: "5", liquidMl: "2.5", syringe: 100, lineSpacing: "2" },
    });
  });

  it("a syringe change keeps a custom spacing only for the syringe it was set on", () => {
    const custom = { ...mixFrom({ ...mixture, setup: { ...mixture.setup, syringe: 100, lineSpacing: "1" } }, true) };
    expect(withSyringe(custom, 30)).toMatchObject({ syringe: 30, lineSpacing: "0.5" });
    expect(withSyringe(withSyringe(custom, 30), 100)).toMatchObject({ syringe: 100, lineSpacing: "1" });
  });

  it("suggests the other syringes that read the dose exactly", () => {
    // 10 mg in 2 mL: 250 mcg is 5 units on any syringe; on 10 mg in 3 mL it is 7.5 units, a 30-unit line only.
    expect(exactSyringes({ vialMg: "10", liquidMl: "2", syringe: 100 }, "0.25")).toEqual([30, 50]);
    expect(exactSyringes({ vialMg: "10", liquidMl: "3", syringe: 100 }, "0.25")).toEqual([30]);
    expect(exactSyringes({ vialMg: "", liquidMl: "3", syringe: 100 }, "0.25")).toEqual([]);
  });

  it("a half-filled or impossible mix is an issue", () => {
    expect(mixIssues(plan(), "BPC-157")).toEqual([]);
    expect(mixIssues(plan({ ...blankMix(), vialMg: "10" }), "BPC-157")).toEqual(["BPC-157: enter the BAC water in mL, or leave the mix empty."]);
    expect(mixIssues(plan({ ...blankMix(), vialMg: "0", liquidMl: "5000" }), "BPC-157")).toEqual([
      "BPC-157: enter the vial strength in mg, or leave the mix empty.",
      "BPC-157: liquid added can be up to 1,000 mL.",
    ]);
  });
});

describe("validation", () => {
  const base = builderFromForm(form, "2026-10-01");

  it("names phases as the screen does", () => {
    expect(phaseNames([{ kind: "active" }, { kind: "break" }, { kind: "active" }])).toEqual(["Phase 1", "Break", "Phase 2"]);
    expect(phaseNames([{ kind: "active" }, { kind: "break" }, { kind: "break" }])).toEqual(["Phase 1", "Break 1", "Break 2"]);
  });

  it("a valid cycle has no issues", () => {
    expect(reviewIssues(base, nameOf, true)).toEqual([]);
    expect(firstIssue([])).toBeNull();
  });

  it("per phase in order (start, length, dose, rhythm, time), then overlaps, then an active phase", () => {
    const plan = base.plans[0];
    const broken: BuilderPlan = {
      ...plan,
      phases: [
        { ...plan.phases[0], day: "0", length: "", dose: "0", time: "" },
        { ...plan.phases[1], day: "20", length: "x" },
        { ...plan.phases[2], day: "10", frequency: "every", every: "400" },
        { ...plan.phases[2], key: "w", frequency: "weekdays", days: [], day: "60" },
      ],
    };
    expect(scheduleIssues(broken, "BPC-157")).toEqual([
      "BPC-157 · Phase 1: start on day 1 or later.",
      "BPC-157 · Phase 1: needs a length of at least 1 day.",
      "BPC-157 · Phase 1: needs a dose above 0.",
      "BPC-157 · Phase 1: choose a time.",
      "BPC-157 · Break: needs a length of at least 1 day.",
      "BPC-157 · Phase 2: repeat every 365 days or fewer.",
      "BPC-157 · Phase 3: choose at least one weekday.",
    ]);
    const overlap: BuilderPlan = { ...plan, phases: [plan.phases[0], { ...plan.phases[1], day: "28" }, { ...plan.phases[2], every: "0" }] };
    expect(scheduleIssues(overlap, "BPC-157")).toEqual(["BPC-157 · Phase 2: repeat every 1 day or more.", "BPC-157: Phase 1 and break overlap."]);
    expect(scheduleIssues({ ...plan, phases: [plan.phases[1]] }, "BPC-157")).toEqual(["BPC-157: add at least one active phase."]);
  });

  it("ended phases are read-only and not checked", () => {
    const plan = base.plans[0];
    const ended: BuilderPlan = { ...plan, phases: [{ ...plan.phases[0], lock: "ended", dose: "" }, ...plan.phases.slice(1)] };
    expect(scheduleIssues(ended, "BPC-157")).toEqual([]);
  });

  it("the review: name, zone, goal and start first, then each peptide's mix and schedule", () => {
    const state: BuilderState = {
      ...base,
      name: " ",
      goal: "",
      start: "",
      plans: [{ ...base.plans[0], mix: { ...blankMix(), liquidMl: "2" } }, { ...base.plans[1], phases: [{ ...base.plans[1].phases[0], dose: "" }] }],
    };
    const issues = reviewIssues(state, nameOf, false);
    expect(issues).toEqual([
      NAME_REQUIRED,
      TIME_ZONE_REQUIRED,
      GOAL_REQUIRED,
      "Choose the date the cycle starts.",
      "BPC-157: enter the vial strength in mg, or leave the mix empty.",
      "TB-500 · Phase 1: needs a dose above 0.",
    ]);
    expect(firstIssue(issues)).toEqual({ first: NAME_REQUIRED, more: "(+5 more)" });
    expect(firstIssue([NAME_REQUIRED])).toEqual({ first: NAME_REQUIRED, more: "" });
  });
});
