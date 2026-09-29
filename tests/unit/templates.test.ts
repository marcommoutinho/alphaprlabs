// A3 Cycle templates: relative days mapped onto the S7 engine, every
// validation message in the design's order with "(+N more)", and the list's
// and editor's display text (handoff "A3 Cycle templates" and the prototype).
import { describe, expect, it } from "vitest";
import { scheduleOccurrences, validatePlan } from "@/lib/schedule/engine";
import {
  draftPlans,
  editorMeta,
  footerNote,
  formOfRow,
  laneAxis,
  newRow,
  rowOfPhase,
  templateDays,
  templateLanes,
  templateLength,
  usageLine,
  WEEKDAY_TOGGLES,
  withdrawnLine,
  withdrawnNotice,
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
  templatePlanToEngine,
  unavailableAdded,
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
  it("first failure wins for the name, an empty template and a peptide no longer offered being added", () => {
    expect(NAME_REQUIRED).toBe("Name is required.");
    expect(PEPTIDE_REQUIRED).toBe("Add at least one peptide — an empty template can't be saved.");
    const added = "Compound C is no longer offered, so it can't be added. Remove it before saving.";
    expect(unavailableAdded("Compound C")).toBe(added);
    // Name first, even with an empty template and bad phases.
    expect(errorOf(form([], { name: " \t" })).errors).toEqual([NAME_REQUIRED]);
    expect(errorOf(form([{ peptideId: A, phases: [] }], { name: "" })).error).toBe(NAME_REQUIRED);
    expect(errorOf(form([])).error).toBe(PEPTIDE_REQUIRED);
    // Adding an unavailable peptide blocks saving before any phase message.
    expect(errorOf(form([newPlan(A), { peptideId: C, phases: [active()] }])).errors).toEqual([added]);
    // A peptide not in the library at all is malformed input.
    expect(errorOf(form([{ peptideId: "00000000-0000-4000-8000-0000000000ff", phases: [active()] }])).error).toBe(INVALID_TEMPLATE);
    expect(errorOf(form([newPlan(A)], { name: "x".repeat(121) })).error).toBe(NAME_TOO_LONG);
    expect(errorOf(form([newPlan(A)], { guidance: "x".repeat(4001) })).error).toBe(GUIDANCE_TOO_LONG);
  });

  it("keeps a peptide no longer offered that the stored template already names (Marco, 2026-09-26)", () => {
    const withC = form([{ peptideId: A, phases: [active()] }, { peptideId: C, phases: [active()] }], { id: A });
    const kept = validateTemplate(withC, LIBRARY, new Set([C]));
    expect(kept.ok).toBe(true);
    // Still never newly added: B kept, C not.
    const other = validateTemplate(withC, LIBRARY, new Set([B]));
    expect(other.ok ? null : other.errors).toEqual(["Compound C is no longer offered, so it can't be added. Remove it before saving."]);
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

describe("A10 / D7 display text", () => {
  const template: TemplateRecord = { id: "t", name: "Recomp starter", guidance: "", updatedAt: "2026-08-28T16:00:00Z", version: 1, plans: recomp, cycleCount: 4 };

  it("card and editor lines: length, usage, updated (Toronto's date)", () => {
    expect(templateDays(template)).toBe(84);
    expect(templateLength(template)).toBe("84 days");
    expect(usageLine(template)).toBe("Used for 4 cycles · updated Aug 28");
    expect(usageLine({ ...template, cycleCount: 1, updatedAt: "2026-08-29T02:30:00Z" })).toBe("Used for 1 cycle · updated Aug 28");
    expect(usageLine({ ...template, cycleCount: 0 })).toBe("Not used yet · updated Aug 28");
    expect(editorMeta(template)).toBe("84 days · used for 4 cycles · updated Aug 28");
    expect(templateLength({ plans: [] })).toBe("0 days");
  });

  it("the footer note counts the cycles that won't change", () => {
    expect(footerNote(template)).toBe("Saving changes future copies only. The 4 cycles started from this template won't change.");
    expect(footerNote({ cycleCount: 1 })).toBe("Saving changes future copies only. The 1 cycle started from this template won't change.");
    expect(footerNote({ cycleCount: 0 })).toBe("Saving changes future copies only. No cycle has been started from this template yet.");
    expect(footerNote(null)).toBe("Researchers will see it as a starting point once it's saved.");
  });

  it("names a peptide no longer offered, without blocking the template", () => {
    expect(withdrawnLine(template, byId)).toBeNull();
    expect(withdrawnNotice(template, byId)).toBeNull();
    const withC = { plans: [...recomp, { peptideId: C, phases: [] }] };
    expect(withdrawnLine(withC, byId)).toBe("Includes Compound C, no longer offered");
    expect(withdrawnNotice(withC, byId)).toMatch(/^Compound C is no longer offered\. The template keeps it/);
    const both = new Map([...byId, [A, { id: A, name: "Compound A", available: false }]]);
    expect(withdrawnLine(withC, both)).toBe("Includes Compound A and Compound C, no longer offered");
  });

  it("lanes: a bar per phase over the template's length, dose-height levels, breaks", () => {
    const { total, lanes } = templateLanes(template);
    expect(total).toBe(84);
    expect(lanes[0].bars.map((b) => [b.kind, b.from, b.to, b.level])).toEqual([
      ["active", 2, 30, 0],
      ["break", 31, 37, null],
      ["active", 38, 84, 1],
    ]);
    expect(lanes[1].bars.map((b) => [b.kind, b.from, b.to, b.level])).toEqual([["active", 1, 40, null]]);
    // Day 2 sits too close to Day 1 to get a label of its own.
    expect(laneAxis(lanes, total).map((l) => l.text)).toEqual(["Day 1", "31", "38", "84"]);
    expect(laneAxis(lanes, total)[0]).toEqual({ text: "Day 1", percent: 0, align: "start" });
    expect(laneAxis(lanes, total).at(-1)).toEqual({ text: "84", percent: 100, align: "end" });
  });

  it("phase rows: from–to days, the dose in mcg under 1 mg, Daily / Every N / Weekdays, and back", () => {
    const opened = formOf({ id: "t", name: "Recomp starter", guidance: "", plans: recomp });
    const row = rowOfPhase(opened.plans[0].phases[0], "k");
    expect(row).toMatchObject({ from: "2", to: "30", amount: "400", unit: "mcg", frequency: "every", every: "5", time: "20:00" });
    expect(formOfRow(row)).toEqual(opened.plans[0].phases[0]);
    const weekdays = rowOfPhase(opened.plans[1].phases[0], "w");
    expect(weekdays).toMatchObject({ from: "1", to: "40", frequency: "weekdays", days: [1, 3, 5] });
    expect(formOfRow(weekdays)).toMatchObject({ day: "1", len: "40", mg: "0.3", schedule: "weekdays" });
    expect(formOfRow({ ...row, frequency: "daily" })).toMatchObject({ schedule: "interval", every: "1" });
    expect(formOfRow({ ...row, amount: "2", unit: "mg" })).toMatchObject({ mg: "2" });
    expect(formOfRow({ ...row, to: "" })).toMatchObject({ len: "" });
  });

  it("+ Phase and + Break start the day after the last row ends", () => {
    expect(newRow("active", [], "a")).toMatchObject({ kind: "active", from: "1", to: "28", frequency: "daily", time: "08:00", amount: "" });
    const first = { ...newRow("active", [], "a"), to: "30" };
    expect(newRow("break", [first], "b")).toMatchObject({ kind: "break", from: "31", to: "44" });
  });

  it("draft lanes skip rows that don't read as a phase yet", () => {
    const rows = [newRow("active", [], "a"), { ...newRow("break", [], "b"), from: "x" }];
    expect(draftPlans([{ peptideId: A, rows }])[0].phases).toEqual([
      { kind: "active", offset: 0, len: 28, doseMg: "1", time: "08:00", schedule: { type: "interval", everyDays: 1 } },
    ]);
  });

  it("weekday toggles run Monday to Sunday", () => {
    expect(WEEKDAY_TOGGLES.map((d) => d.letter).join("")).toBe("MTWTFSS");
    expect(WEEKDAY_TOGGLES.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});
