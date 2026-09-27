// S14 R8 personal supplies, pure: a tracked vial's estimate (exact decimals,
// never silently below zero), the low-stock outlook against the next planned
// dose (and nothing guessed when the plan can't tell), the screen's view,
// Today's notes, and the vial form's rules. Sep 26, 2026 is a Saturday.
import { describe, expect, it } from "vitest";
import type { CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import type { ViewPeptides } from "@/lib/cycles/views";
import { todayView } from "@/lib/doses/today";
import type { Mixture } from "@/lib/mixtures/rules";
import type { PersonalVial } from "@/lib/mixtures/service";
import type { Confirmation } from "@/lib/schedule/engine";
import {
  outlookFor,
  outlookLine,
  type PlannedDose,
  remainingLabel,
  stockOutlook,
  upcomingByPlan,
  vialEstimate,
  vialState,
} from "@/lib/supplies/estimate";
import {
  defaultVialLabel,
  LABEL_TOO_LONG,
  PEPTIDE_REQUIRED,
  STRENGTH_REQUIRED,
  STRENGTH_TOO_LARGE,
  validateVialForm,
  VIAL_INVALID,
} from "@/lib/supplies/rules";
import { type DeductionInput, suppliesView, todayStockNotes } from "@/lib/supplies/view";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PA, PB] = [uuid(901), uuid(902)];
const [PLAN_A, PLAN_B, A1, A2, B1] = [uuid(1), uuid(2), uuid(10), uuid(11), uuid(20)];
const TORONTO = "America/Toronto";
/** Noon Saturday Sep 26 in Toronto (EDT, UTC-4). */
const NOON = "2026-09-26T16:00:00Z";

/**
 * A: every 2 days at 08:00, 0.4 mg Sep 20–Oct 2, then 0.5 mg Oct 4–10.
 * B: Mon/Wed/Fri at 20:00 from Sep 21, 1 mg.
 */
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
        { id: A1, kind: "active", start: "2026-09-20", end: "2026-10-02", doseMg: "0.4", time: "08:00", schedule: { type: "interval", everyDays: 2 } },
        { id: A2, kind: "active", start: "2026-10-04", end: "2026-10-10", doseMg: "0.5", time: "08:00", schedule: { type: "interval", everyDays: 2 } },
      ],
    },
    {
      planId: PLAN_B,
      peptideId: PB,
      effectiveFrom: null,
      phases: [{ id: B1, kind: "active", start: "2026-09-21", end: "2026-10-10", doseMg: "1", time: "20:00", schedule: { type: "weekdays", days: [1, 3, 5] } }],
    },
  ],
};
const cycle: CycleRecord = {
  id: uuid(500),
  ownerId: uuid(600),
  name: "Recomp Fall 26",
  goal: "",
  baseline: "",
  templateId: null,
  templateName: "",
  templateGuidance: "",
  templateUpdatedAt: null,
  currentRevision: 1,
  version: 1,
  createdAt: revision.createdAt,
  updatedAt: revision.createdAt,
  revisions: [revision],
};
const keyA = (index: number, phase = A1) => `${PLAN_A}:${phase}:${index}`;
const none = new Map<string, Confirmation[]>();

const mixtureA: Mixture = {
  id: uuid(700),
  ownerId: cycle.ownerId,
  peptideId: PA,
  version: 1,
  setupNumber: 1,
  setupId: uuid(701),
  setup: { vialMg: "8", liquidMl: "2", syringe: 100, lineSpacing: "2" },
  setupSince: "2026-09-01T12:00:00Z",
  createdAt: "2026-09-01T12:00:00Z",
  planIds: [PLAN_A],
};
const vial = (overrides: Partial<PersonalVial> = {}): PersonalVial => ({
  id: uuid(800),
  peptideId: PA,
  label: "A-01",
  strengthMg: "8",
  mixtureId: mixtureA.id,
  createdAt: "2026-09-01T12:00:00Z",
  finishedAt: null,
  ...overrides,
});
const deduction = (n: number, amountMg: string, beforeMg: string, vialId = uuid(800)): DeductionInput => {
  const after = (Number(beforeMg) * 1000 - Number(amountMg) * 1000) / 1000;
  return { id: uuid(3000 + n), doseId: uuid(4000 + n), vialId, amountMg, remainingBeforeMg: beforeMg, remainingAfterMg: String(after), stockDiscrepancy: after < 0 };
};
const planned = (doseMg: string, day: number): PlannedDose => ({
  key: `${PLAN_A}:${A1}:${day}`,
  planId: PLAN_A,
  scheduledAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`,
  localDate: `2026-10-${String(day).padStart(2, "0")}`,
  localTime: "08:00",
  timeZone: TORONTO,
  doseMg,
});

describe("the estimate", () => {
  it("is the strength minus the deductions, in exact decimals", () => {
    expect(vialEstimate("1", [{ amountMg: "0.1" }, { amountMg: "0.2" }])).toMatchObject({ usedMg: "0.3", remainingMg: "0.7", state: "in-use", overMg: null, uses: 2 });
    // Ten thousand tenths: no float drift.
    const many = Array.from({ length: 10_000 }, () => ({ amountMg: "0.1" }));
    expect(vialEstimate("1000", many)).toMatchObject({ usedMg: "1000", remainingMg: "0", state: "empty", percentLeft: 0 });
    expect(vialEstimate("0.000001", [{ amountMg: "0.0000001" }]).remainingMg).toBe("0.0000009");
    expect(vialEstimate("8", [])).toMatchObject({ usedMg: "0", remainingMg: "8", state: "unused", percentLeft: 100, uses: 0 });
    expect(vialEstimate("8", [{ amountMg: "2" }]).percentLeft).toBe(75);
  });

  it("never goes silently below zero: more recorded than the vial held is 'over'", () => {
    const over = vialEstimate("1", [{ amountMg: "0.4" }, { amountMg: "0.4" }, { amountMg: "0.4" }]);
    expect(over).toMatchObject({ remainingMg: "-0.2", state: "over", overMg: "0.2", percentLeft: 0 });
    expect(remainingLabel(over, mixtureA.setup)).toBe("0 mg · 0.2 mg over");
    expect(vialState(over, stockOutlook(over.remainingMg, [planned("0.4", 2)]), true)).toEqual({ text: "Estimate exceeds vial — check your records", tone: "alert" });
  });

  it("shows the remaining mL at the mixture's concentration, exact or marked approximate", () => {
    const e = vialEstimate("8", [{ amountMg: "0.4" }]);
    expect(remainingLabel(e, mixtureA.setup)).toBe("7.6 mg · 1.9 mL");
    expect(remainingLabel(e, null)).toBe("7.6 mg");
    expect(remainingLabel(vialEstimate("10", [{ amountMg: "9" }]), { vialMg: "10", liquidMl: "3" })).toBe("1 mg · 0.3 mL");
    expect(remainingLabel(vialEstimate("3", [{ amountMg: "2" }]), { vialMg: "3", liquidMl: "1" })).toBe("1 mg · ≈0.333333 mL");
    expect(remainingLabel(vialEstimate("1", [{ amountMg: "1" }]), mixtureA.setup)).toBe("0 mg");
  });
});

describe("low stock", () => {
  it("is low only when the estimate is less than the next planned dose", () => {
    expect(stockOutlook("0.39", [planned("0.4", 2)])).toMatchObject({ kind: "known", low: true, dosesLeft: 0 });
    expect(stockOutlook("0.4", [planned("0.4", 2)])).toMatchObject({ kind: "known", low: false, dosesLeft: 1, coversAll: true });
    // Decimal edge: 0.1 + 0.2 left vs a 0.3 mg dose is exactly enough.
    expect(stockOutlook(vialEstimate("1", [{ amountMg: "0.7" }]).remainingMg, [planned("0.3", 2)])).toMatchObject({ low: false });
    expect(stockOutlook("-0.2", [planned("0.4", 2)])).toMatchObject({ low: true, dosesLeft: 0 });
  });

  it("counts the planned doses ahead at their own amounts, in time order", () => {
    // Given out of order: 0.4 (Oct 2), then 0.5 (Oct 4), 0.5 (Oct 6).
    const ahead = [planned("0.5", 6), planned("0.4", 2), planned("0.5", 4)];
    expect(stockOutlook("0.8", ahead)).toMatchObject({ next: { doseMg: "0.4" }, low: false, dosesLeft: 1, coversAll: false, planned: 3 });
    expect(stockOutlook("1.4", ahead)).toMatchObject({ dosesLeft: 3, coversAll: true });
    expect(stockOutlook("1", ahead)).toMatchObject({ dosesLeft: 2 });
    const line = (remaining: string) => outlookLine(stockOutlook(remaining, ahead), (d) => d.localDate);
    expect(line("1")).toBe("About 2 doses left at the planned amounts. Next: 0.4 mg, 2026-10-02.");
    expect(line("1.4")).toBe("Enough for the 3 doses planned ahead. Next: 0.4 mg, 2026-10-02.");
    expect(line("0.1")).toBe("Less than the next planned dose (0.4 mg, 2026-10-02).");
  });

  it("guesses nothing when the plan is incomplete: not mixed, no plan, nothing planned ahead", () => {
    const e = vialEstimate("8", [{ amountMg: "7.9" }]);
    const upcoming = upcomingByPlan([cycle], none, NOON);
    expect(outlookFor(e, null, [], upcoming)).toEqual({ kind: "unknown", reason: "not-mixed" });
    expect(outlookFor(e, mixtureA.id, [], upcoming)).toEqual({ kind: "unknown", reason: "no-plan" });
    expect(stockOutlook(e.remainingMg, [])).toEqual({ kind: "unknown", reason: "no-upcoming" });
    // The cycle has ended (Oct 11): nothing ahead, so not "low" even with 0.1 mg left.
    const after = upcomingByPlan([cycle], none, "2026-10-11T16:00:00Z");
    const ended = outlookFor(e, mixtureA.id, [PLAN_A], after);
    expect(ended).toEqual({ kind: "unknown", reason: "no-upcoming" });
    expect(vialState(e, ended, true)).toEqual({ text: "In use", tone: "quiet" });
    expect(outlookLine(ended, () => "")).toBe("No dose is planned ahead, so low stock isn't judged.");
    expect(outlookLine({ kind: "unknown", reason: "no-plan" }, () => "")).toBe("No cycle plan uses this mixture, so low stock isn't judged.");
    expect(outlookLine({ kind: "unknown", reason: "not-mixed" }, () => "")).toBeNull();
  });

  it("takes the plan's doses still to take: today's included, earlier unconfirmed and confirmed ones not", () => {
    // A's Sep 26 dose (today) is the next; Sep 20–24 are open and don't count.
    const ahead = upcomingByPlan([cycle], none, NOON).get(PLAN_A)!;
    expect(ahead.map((d) => [d.localDate, d.doseMg])).toEqual([
      ["2026-09-26", "0.4"],
      ["2026-09-28", "0.4"],
      ["2026-09-30", "0.4"],
      ["2026-10-02", "0.4"],
      ["2026-10-04", "0.5"],
      ["2026-10-06", "0.5"],
      ["2026-10-08", "0.5"],
      ["2026-10-10", "0.5"],
    ]);
    // Confirmed today: the next is Sep 28.
    const taken: Confirmation = { key: keyA(3), actualAt: "2026-09-26T12:00:00Z", recordedAt: "2026-09-26T12:01:00Z" };
    const afterTaken = upcomingByPlan([cycle], new Map([[cycle.id, [taken]]]), NOON).get(PLAN_A)!;
    expect(afterTaken[0].localDate).toBe("2026-09-28");
    // 3.6 mg covers 0.4 × 4 + 0.5 × 4 exactly.
    expect(stockOutlook("3.6", ahead)).toMatchObject({ dosesLeft: 8, coversAll: true });
    expect(stockOutlook("3.5", ahead)).toMatchObject({ dosesLeft: 7, coversAll: false });
  });
});

describe("the supplies screen", () => {
  const peptides: ViewPeptides = new Map([
    [PA, { name: "Compound A", available: true }],
    [PB, { name: "Compound B", available: false }],
    [uuid(903), { name: "Compound C", available: false }],
  ]);
  const build = (vials: PersonalVial[], deductions: DeductionInput[], tracking = true, mixtures = [mixtureA]) =>
    suppliesView({
      tracking,
      vials,
      mixtures,
      peptides,
      deductions,
      doses: deductions.map((d, n) => ({ id: d.doseId, cycleId: cycle.id, occurrenceKey: keyA(n), actualAt: `2026-09-2${n}T12:05:00Z` })),
      cycles: [cycle],
      confirmations: none,
      now: NOON,
    });

  it("groups vials by peptide, open ones first, with the estimate, the outlook and the history newest first", () => {
    const view = build(
      [
        vial({ id: uuid(801), label: "A-00", finishedAt: "2026-09-10T12:00:00Z", mixtureId: mixtureA.id }),
        vial(),
        vial({ id: uuid(802), label: "B-01", peptideId: PB, strengthMg: "5", mixtureId: null }),
      ],
      // Given in any order: the one from 8 mg came first.
      [deduction(2, "0.4", "7.6"), deduction(1, "0.4", "8"), deduction(3, "5", "5", uuid(801))],
    );
    expect(view.groups.map((g) => [g.name, g.vials.map((v) => v.label)])).toEqual([
      ["Compound A", ["A-01", "A-00"]],
      ["Compound B", ["B-01"]],
    ]);
    const [open, finished] = view.groups[0].vials;
    expect(open).toMatchObject({
      open: true,
      state: "In use",
      tone: "quiet",
      remaining: "7.2 mg · 1.8 mL",
      uses: "2 confirmed doses deducted",
      mixLine: "Mixture 8 mg / 2 mL · An estimate from confirmed doses, not a measurement of the vial.",
      // 7.2 mg covers A's 8 doses ahead (0.4 × 4 + 0.5 × 4).
      outlook: "Enough for the 8 doses planned ahead. Next: 0.4 mg, Sat Sep 26 · 08:00.",
    });
    expect(open.history.map((h) => [h.amount, h.after, h.discrepancy])).toEqual([
      ["0.4 mg", "7.2 mg left", false],
      ["0.4 mg", "7.6 mg left", false],
    ]);
    expect(open.history[0].href).toBe(`/app/today?dose=${encodeURIComponent(keyA(0))}`);
    expect(open.history[0]).toMatchObject({ when: "Sun Sep 20 · 08:05", cycleName: "Recomp Fall 26" });
    expect(finished).toMatchObject({ open: false, state: "Finished", finished: "Finished Sep 10, 2026", remaining: "3 mg", outlook: null });
    expect(view.groups[1].vials[0]).toMatchObject({ state: "Not mixed yet", outlook: null, mixLine: expect.stringContaining("Not mixed yet") });
    expect(view.mixtures).toEqual([{ id: mixtureA.id, peptideId: PA, label: "Compound A · 8 mg / 2 mL · 1 mL", strengthMg: "8", openVial: "A-01" }]);
    // Offered peptides plus the researcher's own (B is in a vial; C is neither).
    expect(view.peptides.map((p) => p.name)).toEqual(["Compound A", "Compound B"]);
    expect(view.labels).toEqual(["A-00", "A-01", "B-01"]);
  });

  it("flags low stock, an empty vial and a recorded discrepancy", () => {
    const low = build([vial()], [deduction(1, "7.7", "8")]).groups[0].vials[0];
    expect(low).toMatchObject({ state: "Low (estimate)", tone: "warn", remaining: "0.3 mg · 0.075 mL" });
    expect(low.outlook).toBe("Less than the next planned dose (0.4 mg, Sat Sep 26 · 08:00).");
    const empty = build([vial()], [deduction(1, "8", "8")]).groups[0].vials[0];
    expect(empty).toMatchObject({ state: "Empty (estimate)", tone: "alert", remaining: "0 mg" });
    const over = build([vial()], [deduction(1, "7.8", "8"), deduction(2, "0.4", "0.2")]).groups[0].vials[0];
    expect(over).toMatchObject({ state: "Estimate exceeds vial — check your records", tone: "alert", remaining: "0 mg · 0.2 mg over" });
    expect(over.history[0]).toMatchObject({ after: "0.2 mg over", discrepancy: true });
  });

  it("says when a vial's mixture was deleted, and hides nothing it can't judge", () => {
    const view = build([vial()], [], true, []);
    expect(view.groups[0].vials[0]).toMatchObject({ state: "Not mixed yet", outlook: null, mixLine: expect.stringContaining("was deleted") });
  });
});

describe("Today's low-stock notes", () => {
  const input = (deductions: DeductionInput[], tracking = true, vials = [vial()]) => ({
    tracking,
    vials,
    mixtures: new Map([[PLAN_A, mixtureA]]),
    deductions,
    cycles: [cycle],
    confirmations: none,
    now: NOON,
  });

  it("names the low vial beside every dose of the plans using its mixture, and nothing otherwise", () => {
    expect(todayStockNotes(input([deduction(1, "7.7", "8")]))).toEqual(new Map([[PLAN_A, "Vial A-01 is low · 0.3 mg left (estimate)"]]));
    expect(todayStockNotes(input([deduction(1, "7.6", "8")]))).toEqual(new Map());
    expect(todayStockNotes(input([deduction(1, "8", "8")])).get(PLAN_A)).toBe("Vial A-01 is empty (estimate)");
    expect(todayStockNotes(input([deduction(1, "8.4", "8")])).get(PLAN_A)).toBe("Vial A-01: the estimate exceeds the vial — check Personal supplies");
    // Tracking off, or the vial finished: nothing.
    expect(todayStockNotes(input([deduction(1, "7.7", "8")], false))).toEqual(new Map());
    expect(todayStockNotes(input([deduction(1, "7.7", "8")], true, [vial({ finishedAt: "2026-09-25T12:00:00Z" })]))).toEqual(new Map());
  });

  it("shows on Today beside the hero and the plan's next dose", () => {
    const today = todayView({
      cycles: [cycle],
      confirmations: none,
      peptides: new Map([
        [PA, { name: "Compound A", available: true }],
        [PB, { name: "Compound B", available: true }],
      ]),
      mixtures: new Map([[PLAN_A, mixtureA]]),
      setups: new Map(),
      vials: new Map([[mixtureA.id, "A-01"]]),
      stock: todayStockNotes(input([deduction(1, "7.7", "8")])),
      now: NOON,
    });
    expect(today.hero).toMatchObject({ key: keyA(3), stockNote: "Vial A-01 is low · 0.3 mg left (estimate)" });
    expect(today.rows.filter((r) => r.stockNote).map((r) => [r.kind, r.key])).toEqual([["next", keyA(4)]]);
    expect(today.rows.filter((r) => r.kind === "open").every((r) => r.stockNote === null)).toBe(true);
  });
});

describe("the vial form", () => {
  const form = (overrides: Record<string, unknown> = {}) => ({ id: null, label: " A-02 ", mixtureId: null, peptideId: PA, strengthMg: "8", ...overrides });

  it("accepts a blank label (named later), a comma decimal, and canonicalizes the strength", () => {
    expect(validateVialForm(form())).toEqual({ ok: true, value: { id: null, label: "A-02", mixtureId: null, peptideId: PA, strengthMg: "8" } });
    expect(validateVialForm(form({ label: "", strengthMg: "2,50" }))).toMatchObject({ ok: true, value: { label: "", strengthMg: "2.5" } });
    expect(validateVialForm(form({ mixtureId: mixtureA.id.toUpperCase() }))).toMatchObject({ ok: true, value: { mixtureId: mixtureA.id } });
  });

  it("refuses what the database would", () => {
    expect(validateVialForm(form({ label: "x".repeat(41) }))).toEqual({ ok: false, error: LABEL_TOO_LONG });
    expect(validateVialForm(form({ peptideId: "" }))).toEqual({ ok: false, error: PEPTIDE_REQUIRED });
    for (const strength of ["", "0", "-1", "abc", "1,000", "1e3", 8]) expect(validateVialForm(form({ strengthMg: strength }))).toEqual({ ok: false, error: STRENGTH_REQUIRED });
    expect(validateVialForm(form({ strengthMg: "100000.1" }))).toEqual({ ok: false, error: STRENGTH_TOO_LARGE });
    expect(validateVialForm(form({ strengthMg: "100000" })).ok).toBe(true);
    expect(validateVialForm(form({ id: "nope" }))).toEqual({ ok: false, error: VIAL_INVALID });
    expect(validateVialForm(form({ mixtureId: "nope" }))).toEqual({ ok: false, error: VIAL_INVALID });
    expect(validateVialForm(null)).toEqual({ ok: false, error: PEPTIDE_REQUIRED });
  });

  it("names an unlabelled vial 'Vial N', skipping labels in use", () => {
    expect(defaultVialLabel([])).toBe("Vial 1");
    expect(defaultVialLabel(["A-01", "A-02"])).toBe("Vial 3");
    expect(defaultVialLabel(["vial 2", "Vial 3"])).toBe("Vial 4");
  });
});
