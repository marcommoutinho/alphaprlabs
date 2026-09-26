// S11 saved mixtures (pure): the form ↔ saved setup ↔ S7 calculator mapping
// (a saved mixture reproduces the calculation it was saved from), explicit
// incomplete states, unknown line spacing flagged, the preselected spacing
// per syringe, save validation (comma decimals, thousands refused, limits),
// and the plans offered for linking with their dose.
import { describe, expect, it } from "vitest";
import { calculate, DOSE_OVER_VIAL, LIQUID_REQUIRED, UNKNOWN_LINES_MESSAGE, VIAL_REQUIRED } from "@/lib/calculator/calculator";
import type { CycleRecord } from "@/lib/cycles/rules";
import { planOccurrences } from "@/lib/cycles/schedule";
import { linkablePlans, planDose, plansFor } from "@/lib/mixtures/plans";
import {
  blankForm,
  calculatorInput,
  choiceOf,
  drawFor,
  drawLabel,
  formFromMixture,
  formInput,
  INVALID_MIXTURE,
  LIQUID_TOO_LARGE,
  type Mixture,
  mixtureDetail,
  mixtureLabel,
  NO_MIXTURE_LINE,
  PEPTIDE_REQUIRED,
  planMixtureLine,
  savedToast,
  spacingOf,
  validateMixture,
  VIAL_TOO_LARGE,
} from "@/lib/mixtures/rules";
import type { ActivePhase } from "@/lib/schedule/engine";

const PEPTIDE = "11111111-1111-4111-8111-111111111111";
const MIXTURE = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";

const mixture = (setup: Partial<Mixture["setup"]> = {}): Mixture => ({
  id: MIXTURE,
  ownerId: "owner",
  peptideId: PEPTIDE,
  version: 1,
  setupNumber: 1,
  setupId: "setup",
  setup: { vialMg: "8", liquidMl: "2", syringe: 100, lineSpacing: "2", ...setup },
  setupSince: "2026-09-26T12:00:00Z",
  createdAt: "2026-09-26T12:00:00Z",
  planIds: [PLAN],
});

describe("a saved mixture reproduces the calculation", () => {
  it("saves what the calculator used, and the saved setup gives the same result for the same dose", () => {
    const form = { ...blankForm(PEPTIDE), vialMg: "8", liquidMl: "2,5", doseMg: "0,35", syringe: 50 as const, lineChoice: "" as const };
    const typed = calculate(formInput(form));
    const saved = validateMixture({ ...form, mixtureId: null, version: null, lineSpacing: spacingOf(form.syringe, form.lineChoice), planIds: [PLAN] });
    if (!saved.ok) throw new Error(saved.errors.join());
    expect(saved.value.setup).toEqual({ vialMg: "8", liquidMl: "2.5", syringe: 50, lineSpacing: "1" });

    const stored = mixture(saved.value.setup);
    const draw = drawFor(stored, "0.35");
    expect(draw.state).toBe("calculated");
    if (draw.state !== "calculated" || !typed.ok) throw new Error("expected results");
    expect(draw.result).toEqual(typed);
    expect(draw.result.display).toEqual({ concentration: "3.2", volume: "0.109375", units: "10.9375" });
    expect(drawLabel(draw)).toBe("10.9375 units");

    // Reopening loads the same fields back (the dose is the researcher's).
    const reopened = formFromMixture(stored, "0.35");
    expect(calculate(formInput(reopened))).toEqual(typed);
    expect(reopened).toMatchObject({ mixtureId: MIXTURE, peptideId: PEPTIDE, vialMg: "8", liquidMl: "2.5", syringe: 50, lineChoice: "" });
  });

  it("maps a setup and dose onto the calculator's input unchanged", () => {
    expect(calculatorInput(mixture().setup, "0.4")).toEqual({ vialMg: "8", liquidMl: "2", doseMg: "0.4", syringe: 100, lineSpacing: "2" });
    const draw = drawFor(mixture(), "0.4");
    expect(draw.state === "calculated" && draw.result.display.units).toBe("10");
  });
});

describe("incomplete setups stay explicit", () => {
  it("no mixture gives no units, never a guess", () => {
    expect(drawFor(null, "0.4")).toEqual({ state: "no-mixture" });
    expect(drawLabel(drawFor(null, "0.4"))).toBe("no saved mixture");
    expect(planMixtureLine(null)).toBe(NO_MIXTURE_LINE);
  });

  it("a dose the mixture can't hold is not calculable, with the reason", () => {
    const draw = drawFor(mixture(), "9");
    expect(draw).toMatchObject({ state: "not-calculable", errors: [DOSE_OVER_VIAL] });
    expect(drawLabel(draw)).toBe("units can't be calculated");
  });

  it("unknown line spacing still converts, flagged, and nothing is rounded", () => {
    const draw = drawFor(mixture({ lineSpacing: "unknown" }), "0.35");
    if (draw.state !== "calculated") throw new Error("expected a result");
    expect(draw.result.display.units).toBe("8.75");
    expect(draw.result.onLine).toBeNull();
    expect(draw.result.flags).toEqual([{ kind: "unknown-lines", message: UNKNOWN_LINES_MESSAGE }]);
    expect(mixtureDetail(mixture({ lineSpacing: "unknown" }).setup, [])).toBe("4 mg/mL · line spacing unknown · not linked to a plan");
  });

  it("between lines is flagged with the lines either side", () => {
    const draw = drawFor(mixture(), "0.35");
    if (draw.state !== "calculated") throw new Error("expected a result");
    expect(draw.result.betweenLines).toEqual({ lower: "8", upper: "10" });
    expect(draw.result.flags.map((flag) => flag.kind)).toEqual(["between-lines"]);
  });
});

describe("line spacing", () => {
  it("preselects 100 → 2, 50 → 1, 30 → 0.5 units, which the researcher can change or mark unknown", () => {
    expect([100, 50, 30].map((s) => spacingOf(s as 100 | 50 | 30, ""))).toEqual(["2", "1", "0.5"]);
    expect(spacingOf(100, "0.5")).toBe("0.5");
    expect(spacingOf(30, "unknown")).toBe("unknown");
    // The default reads back as "Lines as printed"; anything else as itself.
    expect(choiceOf({ syringe: 50, lineSpacing: "1" })).toBe("");
    expect(choiceOf({ syringe: 100, lineSpacing: "1" })).toBe("1");
    expect(choiceOf({ syringe: 30, lineSpacing: "unknown" })).toBe("unknown");
  });
});

describe("saving a mixture", () => {
  const base = { mixtureId: null, version: null, peptideId: PEPTIDE, vialMg: "8", liquidMl: "2", syringe: 100, lineSpacing: "2", planIds: [] };

  it("accepts comma decimals, refuses thousands-looking forms, and canonicalises", () => {
    expect(validateMixture({ ...base, vialMg: "1,50", liquidMl: " 0,5 " })).toMatchObject({ ok: true, value: { setup: { vialMg: "1.5", liquidMl: "0.5" } } });
    expect(validateMixture({ ...base, vialMg: "1,000" })).toEqual({ ok: false, errors: [VIAL_REQUIRED] });
    expect(validateMixture({ ...base, vialMg: "2." })).toMatchObject({ ok: true, value: { setup: { vialMg: "2" } } });
  });

  it("lists every problem in the calculator's order, with the entry limits", () => {
    expect(validateMixture({ ...base, peptideId: "", vialMg: "", liquidMl: "", syringe: 40, lineSpacing: "3" })).toEqual({
      ok: false,
      errors: [PEPTIDE_REQUIRED, VIAL_REQUIRED, LIQUID_REQUIRED, "Choose a syringe size.", "Choose the line spacing on your syringe, or mark it unknown."],
    });
    expect(validateMixture({ ...base, vialMg: "100000.5", liquidMl: "1000.1" })).toEqual({ ok: false, errors: [VIAL_TOO_LARGE, LIQUID_TOO_LARGE] });
    expect(validateMixture({ ...base, vialMg: "100000", liquidMl: "1000" }).ok).toBe(true);
  });

  it("refuses a tampered shape: an id without a version, bad plan ids, numbers for amounts", () => {
    expect(validateMixture({ ...base, mixtureId: MIXTURE })).toEqual({ ok: false, errors: [INVALID_MIXTURE] });
    expect(validateMixture({ ...base, planIds: ["nope"] })).toEqual({ ok: false, errors: [INVALID_MIXTURE] });
    expect(validateMixture({ ...base, vialMg: 8 })).toEqual({ ok: false, errors: [VIAL_REQUIRED] });
    expect(validateMixture({ ...base, mixtureId: MIXTURE.toUpperCase(), version: 3, planIds: [PLAN, PLAN] })).toMatchObject({
      ok: true,
      value: { mixtureId: MIXTURE, version: 3, planIds: [PLAN] },
    });
  });

  it("names the mixture as the design does", () => {
    expect(mixtureLabel("Compound A", mixture().setup)).toBe("Compound A · 8 mg / 2 mL · 1 mL");
    expect(mixtureDetail(mixture().setup, ["Spring", "Spring", "Winter"], "A-01")).toBe("4 mg/mL · lines every 2 u · used by Spring, Winter · vial A-01 tracked");
    expect(planMixtureLine(mixture())).toBe("Mixture 8 mg / 2 mL (4 mg/mL) · 1 mL syringe");
    expect(savedToast(false, "Compound A", mixture().setup)).toBe("Saved mixture · Compound A 8 mg / 2 mL");
    expect(savedToast(true, "", mixture().setup)).toBe("Updated mixture · 8 mg / 2 mL");
  });
});

describe("plans to link", () => {
  const active = (id: string, start: string, end: string, doseMg: string, doseChanges?: ActivePhase["doseChanges"]): ActivePhase => ({
    id,
    kind: "active",
    start,
    end,
    doseMg,
    time: "08:00",
    schedule: { type: "interval", everyDays: 2 },
    ...(doseChanges ? { doseChanges } : {}),
  });
  // Every 2 days at 08:00 UTC: Oct 1, 3, 5, 7, 9; the dose rises to 0.5 from Oct 3; a break; then 0.6.
  const phases = [
    active("p1", "2026-10-01", "2026-10-10", "0.4", [{ from: "2026-10-03", doseMg: "0.5" }]),
    { id: "b", kind: "break" as const, start: "2026-10-11", end: "2026-10-15" },
    active("p2", "2026-10-16", "2026-10-20", "0.6"),
  ];
  const revision = { id: "r1", number: 1, timeZone: "UTC", createdAt: "2026-09-01T00:00:00Z", plans: [{ planId: "plan", peptideId: PEPTIDE, effectiveFrom: null, phases }] };
  const doseAt = (now: string) => planDose(planOccurrences([revision]).get("plan") ?? [], now);

  it("shows today's occurrence's dose, else the next occurrence's, else the last", () => {
    expect(doseAt("2026-09-20T12:00:00Z")).toBe("0.4");
    // Oct 2 has no dose; the next one (Oct 3) already has the increase.
    expect(doseAt("2026-10-02T12:00:00Z")).toBe("0.5");
    // Oct 3: today's occurrence, before and after its time.
    expect(doseAt("2026-10-03T06:00:00Z")).toBe("0.5");
    expect(doseAt("2026-10-03T20:00:00Z")).toBe("0.5");
    expect(doseAt("2026-10-01T20:00:00Z")).toBe("0.4");
    // In the break: the next phase's first dose; after the end: the last dose.
    expect(doseAt("2026-10-12T12:00:00Z")).toBe("0.6");
    expect(doseAt("2026-11-01T12:00:00Z")).toBe("0.6");
    expect(planDose([], "2026-11-01T12:00:00Z")).toBeNull();
  });

  it("lists current plans with their mixture, hiding ended cycles unless linked to this mixture", () => {
    const cycle = (id: string, name: string, end: string): CycleRecord => ({
      id,
      ownerId: "owner",
      name,
      goal: "g",
      baseline: "",
      templateId: null,
      templateName: "",
      templateGuidance: "",
      templateUpdatedAt: null,
      currentRevision: 1,
      version: 1,
      createdAt: "",
      updatedAt: "",
      revisions: [
        { id: `${id}-r1`, number: 1, timeZone: "UTC", createdAt: "", plans: [{ planId: `${id}-plan`, peptideId: PEPTIDE, effectiveFrom: null, phases: [active("x", "2026-09-01", end, "0.3")] }] },
      ],
    });
    const plans = linkablePlans([cycle("now", "Current", "2026-12-01"), cycle("old", "Finished", "2026-09-10")], [{ ...mixture(), planIds: ["old-plan"] }], "2026-09-26T12:00:00Z");
    expect(plans.map((p) => [p.cycleName, p.status, p.mixtureId, p.doseMg])).toEqual([
      ["Current", "Active", null, "0.3"],
      ["Finished", "Ended", MIXTURE, "0.3"],
    ]);
    expect(plansFor(plans, PEPTIDE, "").map((p) => p.cycleName)).toEqual(["Current"]);
    expect(plansFor(plans, PEPTIDE, MIXTURE).map((p) => p.cycleName)).toEqual(["Current", "Finished"]);
    expect(plansFor(plans, "other", MIXTURE)).toEqual([]);
  });
});
