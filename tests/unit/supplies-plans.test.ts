// S14 R8 low stock and history against plans that change: a dose change
// taking effect at a revision seam, a cycle moving time zones, and two plans
// (in two cycles) sharing one mixture, with Today's notes naming the right
// vial for each plan. History times are each dose's own zone, as the
// cycle's history and Today's sheet show them. Sep 26, 2026 is a Saturday.
import { describe, expect, it } from "vitest";
import type { CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import { cycleDetail, type RecordedConfirmation } from "@/lib/cycles/views";
import { todayView } from "@/lib/doses/today";
import type { Mixture } from "@/lib/mixtures/rules";
import type { PersonalVial } from "@/lib/mixtures/service";
import type { Confirmation } from "@/lib/schedule/engine";
import { outlookFor, upcomingByPlan, vialEstimate } from "@/lib/supplies/estimate";
import { type DeductionInput, suppliesView, todayStockNotes } from "@/lib/supplies/view";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PA, PB] = [uuid(901), uuid(902)];
const [P1, P2, P3, PH1, PH2, PH3] = [uuid(1), uuid(2), uuid(3), uuid(10), uuid(20), uuid(30)];
const TORONTO = "America/Toronto";
const VANCOUVER = "America/Vancouver";
/** Noon Saturday Sep 26 in Toronto (EDT, UTC-4). */
const NOON = "2026-09-26T16:00:00Z";
const none = new Map<string, Confirmation[]>();
const peptides = new Map([
  [PA, { name: "Compound A", available: true }],
  [PB, { name: "Compound B", available: true }],
]);

const every2 = (id: string, start: string, end: string, doseMg: string) =>
  ({ id, kind: "active", start, end, doseMg, time: "08:00", schedule: { type: "interval", everyDays: 2 } }) as const;

const revision = (n: number, timeZone: string, createdAt: string, plans: CycleRevision["plans"]): CycleRevision => ({
  id: uuid(100 + n),
  number: n,
  timeZone,
  createdAt,
  plans,
});

const cycleOf = (id: string, name: string, revisions: CycleRevision[]): CycleRecord => ({
  id,
  ownerId: uuid(600),
  name,
  goal: "",
  baseline: "",
  templateId: null,
  templateName: "",
  templateGuidance: "",
  templateUpdatedAt: null,
  currentRevision: revisions.length,
  version: revisions.length,
  createdAt: revisions[0].createdAt,
  updatedAt: revisions.at(-1)!.createdAt,
  revisions,
});

/** P1 (A): every 2 days at 08:00 Toronto from Sep 20, 0.4 mg. */
const r1 = revision(1, TORONTO, "2026-09-01T12:00:00Z", [{ planId: P1, peptideId: PA, effectiveFrom: null, phases: [every2(PH1, "2026-09-20", "2026-10-10", "0.4")] }]);

const mixture = (id: number, peptideId: string, planIds: string[], vialMg = "8"): Mixture => ({
  id: uuid(id),
  ownerId: uuid(600),
  peptideId,
  version: 1,
  setupNumber: 1,
  setupId: uuid(id + 1),
  setup: { vialMg, liquidMl: "2", syringe: 100, lineSpacing: "2" },
  setupSince: "2026-09-01T12:00:00Z",
  createdAt: "2026-09-01T12:00:00Z",
  planIds,
});
const vial = (id: number, label: string, m: Mixture, strengthMg = m.setup.vialMg): PersonalVial => ({
  id: uuid(id),
  peptideId: m.peptideId,
  label,
  strengthMg,
  mixtureId: m.id,
  createdAt: "2026-09-01T12:00:00Z",
  finishedAt: null,
});
/** One deduction leaving `leftMg` of an 8 mg vial. */
const used = (vialId: string, amountMg: string, leftMg: string, n = 1): DeductionInput => ({
  id: uuid(3000 + n),
  doseId: uuid(4000 + n),
  vialId,
  amountMg,
  remainingBeforeMg: String(Number(leftMg) + Number(amountMg)),
  remainingAfterMg: leftMg,
  stockDiscrepancy: false,
});

const outlook = (cycles: CycleRecord[], planIds: string[], remainingMg: string, now = NOON, confirmations = none) =>
  outlookFor({ remainingMg }, uuid(700), planIds, upcomingByPlan(cycles, confirmations, now));

describe("low stock across a revision seam", () => {
  // Revision 2 (made Sep 26 at 13:00Z) changes P1 to 0.6 mg from Sep 28.
  const r2 = revision(2, TORONTO, "2026-09-26T13:00:00Z", [{ planId: P1, peptideId: PA, effectiveFrom: "2026-09-28", phases: [every2(PH1, "2026-09-20", "2026-10-10", "0.6")] }]);
  const cycle = cycleOf(uuid(500), "Seam", [r1, r2]);

  it("takes each planned dose at the amount its revision gives it", () => {
    const ahead = upcomingByPlan([cycle], none, NOON).get(P1)!;
    expect(ahead.map((o) => [o.localDate, o.doseMg])).toEqual([
      ["2026-09-26", "0.4"],
      ["2026-09-28", "0.6"],
      ["2026-09-30", "0.6"],
      ["2026-10-02", "0.6"],
      ["2026-10-04", "0.6"],
      ["2026-10-06", "0.6"],
      ["2026-10-08", "0.6"],
      ["2026-10-10", "0.6"],
    ]);
    // Today's 0.4 mg is the next dose: 0.5 mg left is enough for it, then not for the 0.6 mg after the seam.
    expect(outlook([cycle], [P1], "0.5")).toMatchObject({ kind: "known", low: false, dosesLeft: 1, next: { doseMg: "0.4" } });
    expect(outlook([cycle], [P1], "1")).toMatchObject({ low: false, dosesLeft: 2 });
  });

  it("judges the next dose after the seam at its new amount", () => {
    // Sunday: Saturday's dose is past (unconfirmed, not counted); next is Monday's 0.6 mg.
    const sunday = "2026-09-27T16:00:00Z";
    expect(outlook([cycle], [P1], "0.5", sunday)).toMatchObject({ low: true, dosesLeft: 0, next: { localDate: "2026-09-28", doseMg: "0.6" } });
    // Without the revision, 0.5 mg would cover Monday's 0.4 mg: the seam is what makes it low.
    expect(outlook([cycleOf(uuid(500), "Seam", [r1])], [P1], "0.5", sunday)).toMatchObject({ low: false, dosesLeft: 1 });
  });
});

describe("a cycle that moves time zones", () => {
  // Revision 2 (made Sep 26 at 13:00Z) moves the cycle to Vancouver from Sep 28 (08:00 there is 15:00Z).
  const r2 = revision(2, VANCOUVER, "2026-09-26T13:00:00Z", [{ planId: P1, peptideId: PA, effectiveFrom: "2026-09-28", phases: [every2(PH1, "2026-09-20", "2026-10-10", "0.4")] }]);
  const cycle = cycleOf(uuid(500), "Moving", [r1, r2]);
  const key = (i: number) => `${P1}:${PH1}:${i}`;

  it("plans the doses ahead in their own zones, and judges them the same way", () => {
    const ahead = upcomingByPlan([cycle], none, NOON).get(P1)!;
    expect(ahead.slice(0, 2).map((o) => [o.key, o.timeZone, o.scheduledAt])).toEqual([
      [key(3), TORONTO, "2026-09-26T12:00:00Z"],
      [key(4), VANCOUVER, "2026-09-28T15:00:00Z"],
    ]);
    const m = mixture(700, PA, [P1]);
    const card = suppliesView({
      tracking: true,
      vials: [vial(800, "A-01", m)],
      mixtures: [m],
      peptides,
      deductions: [used(uuid(800), "7.7", "0.3")],
      doses: [],
      cycles: [cycle],
      confirmations: none,
      now: "2026-09-27T16:00:00Z",
    }).groups[0].vials[0];
    // Sunday: the next dose is Monday 08:00 in Vancouver, not 08:00 Toronto.
    expect(card).toMatchObject({ state: "Low (estimate)", outlook: "Less than the next planned dose (0.4 mg, Mon Sep 28 · 08:00)." });
  });

  it("shows each deduction in its dose's zone, as the cycle's history does, not in the cycle's latest zone", () => {
    // Taken Thursday 08:05 Toronto (before the move) and Monday 08:05 Vancouver (after it).
    const confirmations: RecordedConfirmation[] = [
      { key: key(2), actualAt: "2026-09-24T12:05:00Z", recordedAt: "2026-09-24T12:06:00Z", amountMg: "0.4" },
      { key: key(4), actualAt: "2026-09-28T15:05:00Z", recordedAt: "2026-09-28T15:06:00Z", amountMg: "0.4" },
    ];
    const m = mixture(700, PA, [P1]);
    const deductions = [used(uuid(800), "0.4", "7.6", 1), used(uuid(800), "0.4", "7.2", 2)];
    const doses = [
      { id: deductions[0].doseId, cycleId: cycle.id, occurrenceKey: key(2), actualAt: "2026-09-24T12:05:00Z" },
      { id: deductions[1].doseId, cycleId: cycle.id, occurrenceKey: key(4), actualAt: "2026-09-28T15:05:00Z" },
    ];
    const card = suppliesView({
      tracking: true,
      vials: [vial(800, "A-01", m)],
      mixtures: [m],
      peptides,
      deductions,
      doses,
      cycles: [cycle],
      confirmations: new Map([[cycle.id, confirmations]]),
      now: "2026-09-28T18:00:00Z",
    }).groups[0].vials[0];
    expect(card.history.map((h) => h.when)).toEqual(["Mon Sep 28 · 08:05", "Thu Sep 24 · 08:05"]);
    // The same as R4's "Actual" column for those doses.
    const history = cycleDetail(cycle, peptides, "2026-09-28T18:00:00Z", confirmations).history;
    expect(history.filter((row) => row.key === key(2) || row.key === key(4)).map((row) => row.actual)).toEqual(["Mon Sep 28 · 08:05", "Thu Sep 24 · 08:05"]);
  });
});

describe("two plans sharing one mixture", () => {
  // P2 (A, another cycle): every day at 20:00 Toronto from Sep 25, 1 mg. P3 (B): every 2 days, 0.2 mg.
  const other = cycleOf(uuid(501), "Evening", [
    revision(1, TORONTO, "2026-09-01T12:00:00Z", [
      { planId: P2, peptideId: PA, effectiveFrom: null, phases: [{ ...every2(PH2, "2026-09-25", "2026-10-10", "1"), time: "20:00", schedule: { type: "interval", everyDays: 1 } }] },
      { planId: P3, peptideId: PB, effectiveFrom: null, phases: [every2(PH3, "2026-09-20", "2026-10-10", "0.2")] },
    ]),
  ]);
  const cycle = cycleOf(uuid(500), "Morning", [r1]);
  // P1's Saturday 08:00 dose is taken: P1's next is Monday 0.4 mg, P2's is tonight's 1 mg.
  const taken: Confirmation = { key: `${P1}:${PH1}:3`, actualAt: "2026-09-26T12:00:00Z", recordedAt: "2026-09-26T12:01:00Z" };
  const confirmations = new Map([[cycle.id, [taken]]]);

  it("judges against the earliest next dose across the plans", () => {
    expect(outlook([cycle, other], [P1, P2], "0.5", NOON, confirmations)).toMatchObject({ low: true, next: { planId: P2, doseMg: "1" } });
    // P1 alone would not be low with 0.5 mg.
    expect(outlook([cycle, other], [P1], "0.5", NOON, confirmations)).toMatchObject({ low: false, next: { planId: P1, doseMg: "0.4" } });
    // 2.4 mg: tonight's 1 mg, Sunday's 1 mg, then Monday 08:00's 0.4 mg; not Monday 20:00's 1 mg.
    expect(outlook([cycle, other], [P1, P2], "2.4", NOON, confirmations)).toMatchObject({ low: false, dosesLeft: 3 });
  });

  it("names the right vial on Today for each plan", () => {
    const mA = mixture(700, PA, [P1, P2]);
    const mB = mixture(710, PB, [P3], "5");
    const vA = vial(800, "A-01", mA);
    const vB = vial(801, "B-01", mB);
    const stock = todayStockNotes({
      tracking: true,
      vials: [vA, vB],
      mixtures: new Map([
        [P1, mA],
        [P2, mA],
        [P3, mB],
      ]),
      deductions: [used(vA.id, "7.5", "0.5", 1), used(vB.id, "4.9", "0.1", 2)],
      cycles: [cycle, other],
      confirmations,
      now: NOON,
    });
    expect(stock).toEqual(
      new Map([
        [P1, "Vial A-01 is low · 500 mcg left (estimate)"],
        [P2, "Vial A-01 is low · 500 mcg left (estimate)"],
        [P3, "Vial B-01 is low · 100 mcg left (estimate)"],
      ]),
    );
    const today = todayView({
      cycles: [cycle, other],
      confirmations,
      peptides,
      mixtures: new Map([
        [P1, mA],
        [P2, mA],
        [P3, mB],
      ]),
      setups: new Map(),
      vials: new Map([
        [mA.id, "A-01"],
        [mB.id, "B-01"],
      ]),
      stock,
      now: NOON,
    });
    const noteOf = (planId: string) => [today.hero, ...today.rows].filter((r) => r?.key.startsWith(planId) && r.stockNote).map((r) => r!.stockNote);
    expect(new Set(noteOf(P1))).toEqual(new Set(["Vial A-01 is low · 500 mcg left (estimate)"]));
    expect(new Set(noteOf(P2))).toEqual(new Set(["Vial A-01 is low · 500 mcg left (estimate)"]));
    expect(new Set(noteOf(P3))).toEqual(new Set(["Vial B-01 is low · 100 mcg left (estimate)"]));
    // An estimate check: the same vial, same numbers.
    expect(vialEstimate(vA.strengthMg, [{ amountMg: "7.5" }]).remainingMg).toBe("0.5");
  });
});
