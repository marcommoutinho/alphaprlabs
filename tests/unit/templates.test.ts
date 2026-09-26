// A3 Cycle templates: relative days mapped onto the S7 engine, every
// validation message in the design's order with "(+N more)", and the list's
// and editor's display text (handoff "A3 Cycle templates" and the prototype).
import { describe, expect, it } from "vitest";
import { scheduleOccurrences, validatePlan } from "@/lib/schedule/engine";
import {
  IDLE,
  phaseTitle,
  scopeNote,
  templateDays,
  templateEditorTitle,
  templateMeta,
  TEMPLATES_SUBTITLE,
  templateSummary,
  templateUsage,
  templateWarning,
  RECEIVE_HELPER,
  WEEKDAY_TOGGLES,
} from "@/lib/templates/display";
import {
  formOf,
  GUIDANCE_TOO_LONG,
  INVALID_TEMPLATE,
  NAME_REQUIRED,
  NAME_TOO_LONG,
  newActivePhase,
  newBreak,
  newPlan,
  nextPhaseDay,
  PEPTIDE_REQUIRED,
  REMOVE_UNAVAILABLE,
  templatePlanToEngine,
  type PhaseForm,
  type TemplateForm,
  type TemplatePlan,
  type TemplateRecord,
  validateTemplate,
} from "@/lib/templates/rules";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const LIBRARY = [
  { id: A, name: "Compound A", available: true },
  { id: B, name: "Compound B", available: true },
  { id: C, name: "Compound C", available: false },
];
const byId = new Map(LIBRARY.map((p) => [p.id, p]));

const active = (patch: Partial<PhaseForm> = {}): PhaseForm => ({ ...newActivePhase(1), mg: "0.4", ...patch });
const pause = (day: number, len = 7): PhaseForm => ({ ...newBreak(day), len: String(len) });
const form = (plans: TemplateForm["plans"], patch: Partial<TemplateForm> = {}): TemplateForm => ({
  id: null,
  name: "Recomp starter",
  guidance: "",
  plans,
  ...patch,
});
const errorOf = (input: unknown) => {
  const result = validateTemplate(input, LIBRARY);
  if (result.ok) throw new Error("expected a validation error");
  return result;
};

// The handoff's "Recomp starter": A 0.4 mg every 5 days day 2–30, break
// day 31–37, 0.6 mg day 38–84; B weekdays Mon/Wed/Fri day 1–40.
const recomp: TemplatePlan[] = [
  {
    peptideId: A,
    phases: [
      { kind: "active", offset: 1, len: 29, doseMg: "0.4", time: "20:00", schedule: { type: "interval", everyDays: 5 } },
      { kind: "break", offset: 30, len: 7 },
      { kind: "active", offset: 37, len: 47, doseMg: "0.6", time: "20:00", schedule: { type: "interval", everyDays: 5 } },
    ],
  },
  { peptideId: B, phases: [{ kind: "active", offset: 0, len: 40, doseMg: "0.3", time: "07:30", schedule: { type: "weekdays", days: [1, 3, 5] } }] },
];

describe("relative days on the schedule engine", () => {
  it("lays each phase onto real dates from the start date (day 1 = offset 0)", () => {
    const plan = templatePlanToEngine(recomp[0], { planId: "c1a", start: "2026-09-01", timeZone: "America/Toronto" });
    expect(plan.phases.map((p) => [p.id, p.kind, p.start, p.end])).toEqual([
      ["p1", "active", "2026-09-02", "2026-09-30"],
      ["p2", "break", "2026-10-01", "2026-10-07"],
      ["p3", "active", "2026-10-08", "2026-11-23"],
    ]);
    expect(validatePlan(plan)).toEqual([]);
    // The handoff's "Recomp Spring 26" cycle: first doses Sep 2, 7, 12 at 20:00 Toronto.
    const first = scheduleOccurrences(plan, []).slice(0, 3);
    expect(first.map((o) => `${o.localDate} ${o.localTime}`)).toEqual(["2026-09-02 20:00", "2026-09-07 20:00", "2026-09-12 20:00"]);
    // Across a month end and a leap day.
    const leap = templatePlanToEngine({ peptideId: A, phases: [{ kind: "break", offset: 58, len: 2 }] }, { planId: "x", start: "2028-01-01", timeZone: "UTC" });
    expect([leap.phases[0].start, leap.phases[0].end]).toEqual(["2028-02-28", "2028-02-29"]);
  });

  it("a template that validates here converts to a plan the engine accepts", () => {
    const result = validateTemplate(formOf({ id: null, name: "Recomp starter", guidance: "", plans: recomp }), LIBRARY);
    expect(result).toEqual({ ok: true, value: { id: null, name: "Recomp starter", guidance: "", plans: recomp } });
    for (const plan of recomp) {
      expect(validatePlan(templatePlanToEngine(plan, { planId: "p", start: "2099-12-01", timeZone: "Europe/Paris" }))).toEqual([]);
    }
  });
});

describe("validateTemplate: the designed messages, in order", () => {
  it("first failure wins for the name, an empty template and a peptide no longer offered", () => {
    expect(NAME_REQUIRED).toBe("Name is required.");
    expect(PEPTIDE_REQUIRED).toBe("Add at least one peptide — an empty template can't be saved.");
    expect(REMOVE_UNAVAILABLE).toBe("Remove peptides that are no longer offered before saving.");
    // Name first, even with an empty template and bad phases.
    expect(errorOf(form([], { name: " \t" })).errors).toEqual([NAME_REQUIRED]);
    expect(errorOf(form([{ peptideId: A, phases: [] }], { name: "" })).error).toBe(NAME_REQUIRED);
    expect(errorOf(form([])).error).toBe(PEPTIDE_REQUIRED);
    // An unavailable peptide blocks saving before any phase message.
    expect(errorOf(form([newPlan(A), { peptideId: C, phases: [active()] }])).errors).toEqual([REMOVE_UNAVAILABLE]);
    // A peptide not in the library at all counts the same.
    expect(errorOf(form([{ peptideId: "00000000-0000-4000-8000-0000000000ff", phases: [active()] }])).error).toBe(REMOVE_UNAVAILABLE);
    expect(errorOf(form([newPlan(A)], { name: "x".repeat(121) })).error).toBe(NAME_TOO_LONG);
    expect(errorOf(form([newPlan(A)], { guidance: "x".repeat(4001) })).error).toBe(GUIDANCE_TOO_LONG);
  });

  it("per phase: start day, length, dose, then interval or weekdays; then overlaps; then a missing active phase", () => {
    const result = errorOf(
      form([
        {
          peptideId: A,
          phases: [
            active({ day: "0", len: "", mg: "", every: "0" }),
            active({ day: "10", len: "5", mg: "0", schedule: "weekdays", days: [] }),
            pause(12, 3),
          ],
        },
        { peptideId: B, phases: [pause(1)] },
      ]),
    );
    expect(result.errors).toEqual([
      "Compound A, phase 1: start day must be 1 or later.",
      "Compound A, phase 1: length must be at least 1 day.",
      "Compound A, phase 1: enter a dose above 0 mg.",
      "Compound A, phase 1: interval must be at least 1 day.",
      "Compound A, phase 2: enter a dose above 0 mg.",
      "Compound A, phase 2: pick at least one weekday.",
      "Compound A: phases overlap at day 12.",
      "Compound B: add at least one active phase.",
    ]);
    expect(result.error).toBe("Compound A, phase 1: start day must be 1 or later. (+7 more)");
  });

  it("shows the first message alone when it is the only one", () => {
    expect(errorOf(form([{ peptideId: A, phases: [active({ mg: "" })] }])).error).toBe("Compound A, phase 1: enter a dose above 0 mg.");
    expect(errorOf(form([{ peptideId: A, phases: [] }])).error).toBe("Compound A: add at least one active phase.");
  });

  it("numbers phases in the editor's order, and names the overlap by the later phase's start day", () => {
    const result = errorOf(form([{ peptideId: A, phases: [active({ day: "40", len: "10" }), active({ day: "1", len: "28", mg: "" }), pause(20, 5), pause(45, 2)] }]));
    expect(result.errors).toEqual([
      "Compound A, phase 2: enter a dose above 0 mg.",
      "Compound A: phases overlap at day 20.",
      "Compound A: phases overlap at day 45.",
    ]);
    expect(result.error).toBe("Compound A, phase 2: enter a dose above 0 mg. (+2 more)");
    // Touching phases (one ends on day 28, the next starts on day 29) don't overlap.
    expect(validateTemplate(form([{ peptideId: A, phases: [active({ len: "28" }), pause(29), active({ day: "36" })] }]), LIBRARY).ok).toBe(true);
  });

  it("applies the engine's limits: interval 1–365 days, phases ending by day 3660, a valid time", () => {
    const one = (phase: PhaseForm) => errorOf(form([{ peptideId: A, phases: [phase] }])).errors;
    expect(one(active({ every: "366" }))).toEqual(["Compound A, phase 1: interval must be 365 days or fewer."]);
    expect(one(active({ every: "2.5" }))).toEqual(["Compound A, phase 1: interval must be at least 1 day."]);
    expect(one(active({ every: "" }))).toEqual(["Compound A, phase 1: interval must be at least 1 day."]);
    expect(one(active({ day: "3601", len: "61" }))).toEqual(["Compound A, phase 1: must end by day 3660."]);
    expect(one(active({ day: "1.5" }))).toEqual(["Compound A, phase 1: start day must be 1 or later."]);
    expect(one(active({ time: "25:00" }))).toEqual(["Compound A, phase 1: enter a local time."]);
    expect(one(active({ mg: "1,000" }))).toEqual(["Compound A, phase 1: enter a dose above 0 mg."]);
    // Limits that pass.
    const ok = (phase: PhaseForm) => validateTemplate(form([{ peptideId: A, phases: [phase] }]), LIBRARY).ok;
    expect(ok(active({ every: "365" }))).toBe(true);
    expect(ok(active({ day: "3601", len: "60" }))).toBe(true);
  });

  it("stores relative offsets: 0-based, sorted by start, doses exact without trailing zeros, blank time 08:00", () => {
    const result = validateTemplate(
      form(
        [
          {
            peptideId: A,
            phases: [
              active({ day: "36", len: "10", mg: "0,60", time: "" }),
              pause(29),
              active({ day: "1", len: "28", mg: "0.40", schedule: "weekdays", days: [5, 1, 3, 1], time: "20:00:00" }),
            ],
          },
        ],
        { name: "  Recomp  ", guidance: " Guidance. " },
      ),
      LIBRARY,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        id: null,
        name: "Recomp",
        guidance: "Guidance.",
        plans: [
          {
            peptideId: A,
            phases: [
              { kind: "active", offset: 0, len: 28, doseMg: "0.4", time: "20:00", schedule: { type: "weekdays", days: [1, 3, 5] } },
              { kind: "break", offset: 28, len: 7 },
              { kind: "active", offset: 35, len: 10, doseMg: "0.6", time: "08:00", schedule: { type: "interval", everyDays: 5 } },
            ],
          },
        ],
      },
    });
  });

  it("refuses malformed input the editor never sends", () => {
    for (const bad of [
      null,
      { ...form([newPlan(A)]), id: "not-a-uuid" },
      { ...form([]), plans: "nope" },
      form([newPlan(A), newPlan(A)]),
      form([{ peptideId: A, phases: [{ ...active(), kind: "rest" } as unknown as PhaseForm] }]),
      form([{ peptideId: A, phases: [active({ days: [7 as never] })] }]),
    ]) {
      expect(errorOf(bad).error).toBe(INVALID_TEMPLATE);
    }
  });
});

describe("the editor's defaults", () => {
  it("adds phases the day after the last one ends, as designed", () => {
    expect(newPlan(A)).toEqual({ peptideId: A, phases: [{ kind: "active", day: "1", len: "28", mg: "", time: "08:00", schedule: "interval", every: "5", days: [1, 3, 5] }] });
    expect(nextPhaseDay({ peptideId: A, phases: [] })).toBe(1);
    expect(nextPhaseDay({ peptideId: A, phases: [active({ day: "1", len: "29" })] })).toBe(30);
    expect(nextPhaseDay({ peptideId: A, phases: [active({ day: "30", len: "7" }), active({ day: "1", len: "28" })] })).toBe(37);
    expect(newBreak(30)).toMatchObject({ kind: "break", day: "30", len: "7" });
    // A stored template opens with its values as typed.
    const opened = formOf({ id: "t", name: "Recomp starter", guidance: "", plans: recomp });
    expect(opened.plans[0].phases.map((p) => [p.kind, p.day, p.len, p.mg, p.every])).toEqual([
      ["active", "2", "29", "0.4", "5"],
      ["break", "31", "7", "", "5"],
      ["active", "38", "47", "0.6", "5"],
    ]);
    expect(opened.plans[1].phases[0]).toMatchObject({ schedule: "weekdays", days: [1, 3, 5], time: "07:30" });
  });
});

describe("display text", () => {
  const template: TemplateRecord = { id: "t", name: "Recomp starter", guidance: "", updatedAt: "2026-08-28T16:00:00Z", plans: recomp, cycleCount: 0 };

  it("uses the design's copy", () => {
    expect(TEMPLATES_SUBTITLE).toBe(
      "Starting points researchers copy. Editing a template changes future copies only — existing researcher cycles are untouched.",
    );
    expect(RECEIVE_HELPER).toBe("Days count from the researcher's start date (day 1). They can adjust everything after copying.");
    expect(IDLE).toBe("Select a template to inspect or update it.");
    expect(scopeNote(false)).toBe("Saving updates future copies only. Cycles already created from this template are not changed.");
    expect(scopeNote(true)).toBe("Researchers will see this as a starting point.");
    expect(templateEditorTitle(true, "x")).toBe("New template");
    expect(templateEditorTitle(false, " Recomp starter ")).toBe("Edit Recomp starter");
    expect(templateEditorTitle(false, " ")).toBe("Edit template");
    expect(WEEKDAY_TOGGLES.map((d) => d.label).join(" ")).toBe("Mon Tue Wed Thu Fri Sat Sun");
  });

  it("list rows: days · updated, summary of active phases, the warning and cycle usage", () => {
    expect(templateDays(template)).toBe(84);
    expect(templateMeta(template)).toBe("84 days · updated Aug 28");
    // The date is Toronto's: late evening Toronto time is still that day there.
    expect(templateMeta({ ...template, updatedAt: "2026-08-29T02:30:00Z" })).toBe("84 days · updated Aug 28");
    expect(templateSummary(template, byId)).toBe("Compound A · 2 phase(s) + Compound B · 1 phase(s)");
    expect(templateWarning(template, byId)).toBeNull();
    expect(templateWarning({ plans: [{ peptideId: C, phases: [] }] }, byId)).toBe(
      "Includes a peptide that is no longer offered — researchers can't start from it.",
    );
    expect(templateUsage(0)).toBe("0 researcher cycle(s) were started from it — they won't change.");
    expect(templateUsage(3)).toBe("3 researcher cycle(s) were started from it — they won't change.");
  });

  it("phase titles show the day range once start and length are readable", () => {
    expect(phaseTitle({ kind: "active", day: "1", len: "29" })).toEqual({ word: "Active phase", range: "· day 1–29" });
    expect(phaseTitle({ kind: "break", day: "30", len: "7" })).toEqual({ word: "Break", range: "· day 30–36" });
    expect(phaseTitle({ kind: "break", day: "0", len: "7" })).toEqual({ word: "Break", range: "" });
    expect(phaseTitle({ kind: "active", day: "3", len: "" })).toEqual({ word: "Active phase", range: "" });
  });
});
