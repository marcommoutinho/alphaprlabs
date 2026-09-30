// V2 Cycles (design v3): adherence (taken ÷ taken + skipped + missed, from
// the engine's occurrences with recorded doses and skips, across edits,
// breaks and phases) and what R10, R3 and D2 show. Pure. Sep 20, 2026 is a
// Sunday; Toronto is UTC-4 in September.
import { describe, expect, it } from "vitest";
import { adherence, adherenceCount, percentLabel } from "@/lib/cycles/adherence";
import type { CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import { cycleOccurrences } from "@/lib/cycles/schedule";
import { andList, cycleCard, cycleScreen, groupCards, scheduleWords } from "@/lib/cycles/screens";
import type { RecordedConfirmation, ViewPeptides } from "@/lib/cycles/views";
import type { Mixture } from "@/lib/mixtures/rules";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PA, PB] = [uuid(901), uuid(902)];
const peptides: ViewPeptides = new Map([
  [PA, { name: "BPC-157", available: true, cyclingOff: "Four weeks off." }],
  [PB, { name: "TB-500", available: false }],
]);
const [PLAN_A, PLAN_B] = [uuid(1), uuid(2)];
const [A1, BREAK, A2, B1] = [uuid(10), uuid(11), uuid(12), uuid(20)];
const TORONTO = "America/Toronto";
/** Noon in Toronto, Sun Sep 20. */
const NOW = "2026-09-20T16:00:00Z";

/**
 * A: every 2 days at 20:00 Sep 10–30 (0.25 mg), a break Oct 1–7, then daily
 * at 20:00 Oct 8–14 (0.5 mg). B: Mon/Wed/Fri 07:30 Sep 14 – Oct 14 (2.5 mg).
 */
const revision1: CycleRevision = {
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
        { id: A1, kind: "active", start: "2026-09-10", end: "2026-09-30", doseMg: "0.25", time: "20:00", schedule: { type: "interval", everyDays: 2 } },
        { id: BREAK, kind: "break", start: "2026-10-01", end: "2026-10-07" },
        { id: A2, kind: "active", start: "2026-10-08", end: "2026-10-14", doseMg: "0.5", time: "20:00", schedule: { type: "interval", everyDays: 1 } },
      ],
    },
    {
      planId: PLAN_B,
      peptideId: PB,
      effectiveFrom: null,
      phases: [{ id: B1, kind: "active", start: "2026-09-14", end: "2026-10-14", doseMg: "2.5", time: "07:30", schedule: { type: "weekdays", days: [1, 3, 5] } }],
    },
  ],
};

const cycleOf = (revisions: CycleRevision[], name = "Recovery protocol"): CycleRecord => ({
  id: uuid(500),
  ownerId: uuid(600),
  name,
  goal: "Recover",
  baseline: "",
  templateId: null,
  templateName: "Recovery stack",
  templateGuidance: "",
  templateUpdatedAt: null,
  currentRevision: revisions.length,
  version: revisions.length,
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-01T12:00:00Z",
  revisions,
});

const taken = (key: string, at: string, extra: Partial<RecordedConfirmation> = {}): RecordedConfirmation => ({ key, actualAt: at, recordedAt: at, ...extra });
const skipped = (key: string, at: string): RecordedConfirmation => ({ key, actualAt: at, recordedAt: at, skipped: true });

// A: Sep 10 taken, Sep 12 skipped, Sep 14 taken; Sep 16 and 18 missed; Sep 20 due tonight.
// B: Mon Sep 14 and Wed Sep 16 taken; Fri Sep 18 missed.
const confirmations: RecordedConfirmation[] = [
  taken(`${PLAN_A}:${A1}:0`, "2026-09-11T00:00:00Z", { amountMg: "0.3", site: "Abdomen L" }),
  skipped(`${PLAN_A}:${A1}:1`, "2026-09-12T23:00:00Z"),
  taken(`${PLAN_A}:${A1}:2`, "2026-09-15T00:00:00Z"),
  taken(`${PLAN_B}:${B1}:2026-09-14`, "2026-09-14T11:34:00Z", { site: "Thigh R", notes: "Slight redness" }),
  taken(`${PLAN_B}:${B1}:2026-09-16`, "2026-09-16T11:30:00Z"),
];

describe("adherence", () => {
  const occurrences = cycleOccurrences(revision1.plans.length ? [revision1] : [], confirmations);

  it("counts taken, skipped and missed doses; today's and later ones wait", () => {
    const value = adherence(occurrences, NOW);
    expect(value).toMatchObject({ taken: 4, skipped: 1, missed: 3, counted: 8, percent: 50 });
    // The latest by scheduled time: A at 20:00 on Fri Sep 18, after B at 07:30.
    expect(value.lastMissed?.key).toBe(`${PLAN_A}:${A1}:4`);
    expect(value.lastSkipped?.key).toBe(`${PLAN_A}:${A1}:1`);
    expect(percentLabel(value)).toBe("50%");
    expect(adherenceCount(value)).toBe("4 of 8 doses");
    expect(adherenceCount(value, false)).toBe("4 of 8");
  });

  it("is empty before any dose is settled, and a taken dose today counts at once", () => {
    const before = adherence(cycleOccurrences([revision1], []), "2026-09-10T16:00:00Z");
    expect(before).toMatchObject({ counted: 0, percent: null });
    expect(percentLabel(before)).toBe("—");
    expect(adherenceCount(before)).toBe("No doses yet");
    // Tonight's A taken early: counted today, before its day is over.
    const tonight = [...confirmations, taken(`${PLAN_A}:${A1}:5`, "2026-09-20T15:00:00Z")];
    expect(adherence(cycleOccurrences([revision1], tonight), NOW)).toMatchObject({ taken: 5, counted: 9, percent: 56 });
  });

  it("a break has no doses, and a later phase counts once its days come", () => {
    // Oct 10, noon: A's first phase (Sep 10–30, 11 doses) and Oct 8–9 of the daily phase are past; the break adds nothing.
    const value = adherence(cycleOccurrences([revision1], confirmations), "2026-10-10T16:00:00Z");
    const a = cycleOccurrences([revision1], confirmations).filter((o) => o.planId === PLAN_A && o.localDate < "2026-10-10");
    expect(a.map((o) => o.localDate)).not.toContain("2026-10-01");
    expect(a).toHaveLength(13);
    // B: Mon/Wed/Fri Sep 14 – Oct 9: 12 doses. 4 taken + 1 skipped of 25.
    expect(value).toMatchObject({ taken: 4, skipped: 1, missed: 20, counted: 25, percent: 16 });
  });

  it("an edit changes future doses only: past outcomes and counts stay", () => {
    // Edited Sun Sep 20 at noon: A from Mon Sep 21 at 0.5 mg, 07:15, same rhythm.
    const revision2: CycleRevision = {
      ...revision1,
      id: uuid(101),
      number: 2,
      createdAt: NOW,
      plans: [
        {
          ...revision1.plans[0],
          effectiveFrom: "2026-09-21",
          phases: [
            {
              ...(revision1.plans[0].phases[0] as Extract<CycleRevision["plans"][0]["phases"][0], { kind: "active" }>),
              doseChanges: [{ from: "2026-09-21", doseMg: "0.5" }],
              timeChanges: [{ from: "2026-09-21", time: "07:15" }],
            },
            ...revision1.plans[0].phases.slice(1),
          ],
        },
        { ...revision1.plans[1], effectiveFrom: "2026-09-21" },
      ],
    };
    const before = adherence(cycleOccurrences([revision1], confirmations), NOW);
    const after = adherence(cycleOccurrences([revision1, revision2], confirmations), NOW);
    expect(after).toEqual(before);
    // Two days on, the edited doses count like any other: Sep 22's 07:15 dose is missed by Sep 23.
    const later = adherence(cycleOccurrences([revision1, revision2], confirmations), "2026-09-23T16:00:00Z");
    expect(later.lastMissed).toMatchObject({ localDate: "2026-09-22", localTime: "07:15", doseMg: "0.5" });
  });
});

describe("R10 cards", () => {
  it("an active cycle: its day, peptides, next dose, adherence and missed count", () => {
    const card = cycleCard(cycleOf([revision1]), confirmations, peptides, NOW);
    expect(card).toMatchObject({
      name: "Recovery protocol",
      status: "Active",
      group: "active",
      peptides: "BPC-157 · TB-500",
      dayLabel: "Day 11 of 35",
      total: 35,
      day: 11,
      startLabel: "Sep 10",
      endLabel: "Oct 14",
      adherence: "50%",
      missed: 3,
      next: { title: "BPC-157 · 250 mcg", when: "due at 8:00 PM", due: true },
    });
    // After tonight's 20:00, the dose is due now.
    expect(cycleCard(cycleOf([revision1]), confirmations, peptides, "2026-09-21T00:30:00Z").next).toMatchObject({ when: "due now", due: true });
  });

  it("upcoming and ended cycles, and the groups in order", () => {
    const upcoming = cycleCard(cycleOf([revision1], "Later"), [], peptides, "2026-09-05T16:00:00Z");
    expect(upcoming).toMatchObject({ group: "upcoming", startsLabel: "Starts Sep 10", lengthLabel: "35 days", adherence: "—" });
    expect(upcoming.next).toMatchObject({ title: "BPC-157 · 250 mcg", when: "next Thu 8:00 PM", due: false });
    const ended = cycleCard(cycleOf([revision1], "Done"), confirmations, peptides, "2027-01-05T16:00:00Z");
    expect(ended).toMatchObject({ group: "ended", rangeLabel: "Sep 10 – Oct 14, 2026", next: null });
    const active = cycleCard(cycleOf([revision1]), confirmations, peptides, NOW);
    expect(groupCards([ended, upcoming, active]).map((g) => [g.label, g.cards.map((c) => c.name)])).toEqual([
      ["Active", ["Recovery protocol"]],
      ["Upcoming", ["Later"]],
      ["Ended", ["Done"]],
    ]);
  });

  it("a cycle in a break is Active, with its next dose after the break", () => {
    const card = cycleCard(cycleOf([{ ...revision1, plans: [revision1.plans[0]] }]), [], peptides, "2026-10-03T16:00:00Z");
    expect(card).toMatchObject({ status: "In break", group: "active", next: { when: "next Thu 8:00 PM" } });
  });
});

describe("R3 / D2 cycle screen", () => {
  const mixture: Mixture = {
    id: uuid(700),
    ownerId: uuid(600),
    peptideId: PA,
    version: 1,
    setupNumber: 1,
    setupId: uuid(701),
    setup: { vialMg: "10", liquidMl: "2", syringe: 30, lineSpacing: "0.5" },
    setupSince: "2026-09-01T12:00:00Z",
    createdAt: "2026-09-01T12:00:00Z",
    planIds: [PLAN_A],
  };
  const screen = cycleScreen(cycleOf([revision1]), confirmations, peptides, new Map([[PLAN_A, mixture]]), NOW);

  it("header, Now block, ruler labels and tiles", () => {
    expect(screen.header).toBe("Active · Sep 10 – Oct 14");
    expect(screen.subtitle).toBe("BPC-157 and TB-500 · from the Recovery stack template");
    expect(screen.from).toBe("from Recovery stack");
    // The template note goes with the template reference (cycles.template_id), not the snapshot's name.
    expect(screen.fromTemplate).toBe(false);
    expect(cycleScreen({ ...cycleOf([revision1]), templateId: uuid(900) }, confirmations, peptides, new Map([[PLAN_A, mixture]]), NOW).fromTemplate).toBe(true);
    expect(screen.now).toEqual({ label: "Day", value: "11", unit: "of 35", right: "24 days left", rightSub: "Ends Wed, Oct 14" });
    expect(screen.ticks.labels.map((l) => l.text)).toEqual(["Sep 10", "Today", "Oct 1", "Oct 14"]);
    expect(screen.tiles).toEqual({
      adherence: { value: "50", unit: "%", context: "4 of 8 doses", short: "4 of 8" },
      missed: { count: 3, context: "Fri 8:00 PM" },
      skipped: { count: 1, context: "Sat, Sep 12" },
    });
  });

  it("each peptide: count, schedule, lane, phase rows and mix", () => {
    const [a, b] = screen.plans;
    expect(a).toMatchObject({
      name: "BPC-157",
      count: "2 of 5",
      schedule: "250 mcg · every 2 days · 8:00 PM",
      cadence: "every 2 days · 8:00 PM",
      guidance: "Four weeks off.",
      notOffered: false,
      mix: { setup: "10 mg + 2 mL · 5 mg/mL", concentration: "5 mg/mL", units: "5 units", draw: "5 units · 30-unit" },
    });
    expect(a.phases.map((p) => [p.days, p.dates, p.amount, p.when])).toEqual([
      ["Days 1–21", "Sep 10 – 30", "250 mcg", "now"],
      ["Days 22–28", "Oct 1 – 7", "Break", "next"],
      ["Days 29–35", "Oct 8 – 14", "500 mcg", "next"],
    ]);
    expect(a.bars.map((bar) => [bar.kind, bar.level])).toEqual([
      ["active", 0],
      ["break", null],
      ["active", 1],
    ]);
    expect(b).toMatchObject({ name: "TB-500", notOffered: true, count: "2 of 3", schedule: "2.5 mg · Mon, Wed and Fri · 7:30 AM", mix: null });
  });

  it("history: newest first, taken with amount and site, missed linking to its log-late sheet, skipped, and today's", () => {
    const rows = screen.history.map((h) => [h.state, h.peptide, h.amount, h.date, h.time, h.site, h.logHref !== null]);
    expect(rows).toEqual([
      ["due", "BPC-157", "250 mcg", "Sun, Sep 20", "planned 8:00 PM", "", true],
      ["missed", "BPC-157", "250 mcg", "Fri, Sep 18", "planned 8:00 PM", "", true],
      ["missed", "TB-500", "2.5 mg", "Fri, Sep 18", "planned 7:30 AM", "", true],
      ["missed", "BPC-157", "250 mcg", "Wed, Sep 16", "planned 8:00 PM", "", true],
      ["taken", "TB-500", "2.5 mg", "Wed, Sep 16", "7:30 AM", "", false],
      ["taken", "BPC-157", "250 mcg", "Mon, Sep 14", "8:00 PM", "", false],
      ["taken", "TB-500", "2.5 mg", "Mon, Sep 14", "7:34 AM", "Thigh R", false],
      ["skipped", "BPC-157", "250 mcg", "Sat, Sep 12", "planned 8:00 PM", "", false],
      ["taken", "BPC-157", "300 mcg", "Thu, Sep 10", "8:00 PM", "Abdomen L", false],
    ]);
    expect(screen.history[2].logHref).toBe(`/app/today?dose=${encodeURIComponent(`${PLAN_B}:${B1}:2026-09-18`)}`);
    expect(screen.history[6].note).toBe("Slight redness");
    // A different amount taken keeps the plan quietly beside it.
    expect(screen.history.map((h) => h.planned).filter(Boolean)).toEqual(["250 mcg"]);
  });

  it("upcoming and ended Now blocks", () => {
    const upcoming = cycleScreen(cycleOf([revision1]), [], peptides, new Map(), "2026-09-07T16:00:00Z");
    expect(upcoming.now).toEqual({ label: "Starts in", value: "3", unit: "days", right: "35 days", rightSub: "Starts Thu, Sep 10" });
    expect(upcoming.ticks.labels.map((l) => l.text)).toEqual(["Sep 10", "Oct 1", "Oct 14"]);
    expect(upcoming.todayPercent).toBeNull();
    const ended = cycleScreen(cycleOf([revision1]), confirmations, peptides, new Map(), "2026-11-01T16:00:00Z");
    expect(ended.now).toMatchObject({ label: "Ended", value: "35", unit: "days", rightSub: "Ended Wed, Oct 14" });
    expect(ended.header).toBe("Ended · Sep 10 – Oct 14");
  });
});

describe("words", () => {
  it("lists and schedules", () => {
    expect([andList([]), andList(["A"]), andList(["A", "B"]), andList(["A", "B", "C"])]).toEqual(["", "A", "A and B", "A, B and C"]);
    const phase = revision1.plans[1].phases[0] as Extract<CycleRevision["plans"][0]["phases"][0], { kind: "active" }>;
    expect(scheduleWords(phase)).toBe("Mon, Wed and Fri");
    expect(scheduleWords({ ...phase, schedule: { type: "interval", everyDays: 1 } })).toBe("daily");
    expect(scheduleWords({ ...phase, schedule: { type: "weekdays", days: [0, 1, 2, 3, 4, 5, 6] } })).toBe("daily");
  });
});
