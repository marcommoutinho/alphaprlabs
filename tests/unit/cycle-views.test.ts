// S10 R2/R4 derivation (statuses, the list's lines, the timeline, plan cards
// and scheduled vs actual) and R6 display text. Pure: the S7 engine across
// S9 revisions, no database. Sep 15, 2026 is a Tuesday.
import { describe, expect, it } from "vitest";
import type { CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import { cycleOccurrences } from "@/lib/cycles/schedule";
import { cycleSummary } from "@/lib/cycles/service";
import { cycleDetail, cycleRow, groupCycles, type ViewPeptides } from "@/lib/cycles/views";
import {
  includesWithdrawn,
  peptideSub,
  phaseText,
  phaseWhen,
  templateDays,
  templateSearchText,
  templateSummary,
  usedIn,
} from "@/lib/library/research-view";
import type { ActivePhase, Confirmation } from "@/lib/schedule/engine";
import type { TemplatePlan } from "@/lib/templates/rules";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PA, PB, PC] = [uuid(901), uuid(902), uuid(903)];
const peptides: ViewPeptides = new Map([
  [PA, { name: "Compound A", available: true, cyclingOff: "Cycle off for 4 weeks." }],
  [PB, { name: "Compound B", available: false, cyclingOff: "" }],
  [PC, { name: "Compound C", available: true }],
]);
const [PLAN_A, PLAN_B] = [uuid(1), uuid(2)];
const [A1, BREAK, B1] = [uuid(10), uuid(11), uuid(20)];
const TORONTO = "America/Toronto";

/** A: every 2 days at 20:00 Sep 10–30, then a break; B: Mon/Wed/Fri 07:30 Sep 14 – Oct 9. */
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
        { id: A1, kind: "active", start: "2026-09-10", end: "2026-09-30", doseMg: "0.4", time: "20:00", schedule: { type: "interval", everyDays: 2 } },
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

/** Edited at noon on Sun Sep 20: A takes 0.5 mg at 07:15 from Mon Sep 21, keeping its every-2-days rhythm. */
const revision2: CycleRevision = {
  ...revision1,
  id: uuid(101),
  number: 2,
  createdAt: "2026-09-20T16:00:00Z",
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
        revision1.plans[0].phases[1],
      ],
    },
    { ...revision1.plans[1], effectiveFrom: "2026-09-21" },
  ],
};

const cycleOf = (revisions: CycleRevision[], name = "Recomp Spring 26"): CycleRecord => ({
  id: uuid(500),
  ownerId: uuid(600),
  name,
  goal: "Body composition",
  baseline: "",
  templateId: null,
  templateName: "",
  templateGuidance: "",
  templateUpdatedAt: null,
  currentRevision: revisions.length,
  version: revisions.length,
  createdAt: revisions[0].createdAt,
  updatedAt: revisions[revisions.length - 1].createdAt,
  revisions,
});

/** Noon in Toronto on Mon Sep 21 (EDT, UTC-4). */
const MONDAY_NOON = "2026-09-21T16:00:00Z";
const row = (cycle: CycleRecord, now: string, confirmations: Confirmation[] = []) =>
  cycleRow(cycle, cycleSummary(cycle, now), cycleOccurrences(cycle.revisions, confirmations), peptides, now);

describe("R2 statuses and groups", () => {
  it("is Upcoming, Active, In break and Ended by today in the cycle's zone", () => {
    const cycle = cycleOf([revision1]);
    const at = (iso: string) => row(cycle, iso).status;
    expect(at("2026-09-10T03:59:00Z")).toBe("Upcoming"); // Sep 9, 23:59 in Toronto
    expect(at("2026-09-10T04:00:00Z")).toBe("Active");
    expect(at("2026-10-10T03:59:00Z")).toBe("Active"); // B runs to Oct 9
    expect(at("2026-10-10T04:00:00Z")).toBe("Ended");
    const onlyA = cycleOf([{ ...revision1, plans: [revision1.plans[0]] }]);
    expect(row(onlyA, "2026-10-03T16:00:00Z").status).toBe("In break");

    const rows = [
      row(cycleOf([revision1], "Ended one"), "2026-11-01T16:00:00Z"),
      row(cycleOf([revision1], "Current one"), MONDAY_NOON),
      row(onlyA, "2026-10-03T16:00:00Z"),
      row(cycleOf([revision1], "Upcoming one"), "2026-09-01T16:00:00Z"),
    ];
    expect(groupCycles(rows).map((group) => [group.title, group.rows.map((r) => r.status)])).toEqual([
      ["Current", ["Active", "In break"]],
      ["Upcoming", ["Upcoming"]],
      ["Past", ["Ended"]],
    ]);
  });

  it("shows dates, peptides, the next dose from the latest revision and the unconfirmed count", () => {
    const edited = row(cycleOf([revision1, revision2]), MONDAY_NOON);
    expect(edited).toMatchObject({
      dates: "Sep 10 – Oct 9, 2026",
      peptides: "Compound A + Compound B",
      // Today's 07:30 B dose is due (not "next"); A moved to 07:15 on the same every-2-days days.
      nextLine: "Next: Compound A · Tue Sep 22 · 07:15",
      // A: Sep 10, 12, 14, 16, 18, 20; B: Mon 14, Wed 16, Fri 18 (today's is due, not open).
      unconfirmed: 9,
    });
    expect(row(cycleOf([revision1]), MONDAY_NOON).nextLine).toBe("Next: Compound A · Tue Sep 22 · 20:00");
  });

  it("counts recorded doses once ended, and shows the last one otherwise", () => {
    const cycle = cycleOf([revision1]);
    const taken: Confirmation[] = [
      { key: `${PLAN_A}:${A1}:0`, actualAt: "2026-09-11T00:10:00Z", recordedAt: "2026-09-11T00:12:00Z" },
      { key: `${PLAN_B}:${B1}:2026-09-14`, actualAt: "2026-09-14T11:40:00Z", recordedAt: "2026-09-14T11:41:00Z" },
    ];
    const total = cycleOccurrences(cycle.revisions).length;
    expect(row(cycle, "2026-11-01T16:00:00Z", taken)).toMatchObject({
      nextLine: `Ended · 2 of ${total} doses recorded`,
      unconfirmed: total - 2,
    });
    expect(row(cycle, "2026-11-01T16:00:00Z").nextLine).toBe(`Ended · 0 of ${total} doses recorded`);
    // No dose left ahead in an active cycle: the last recorded one, in its zone.
    const lastDay = cycleOf([{ ...revision1, plans: [revision1.plans[1]] }]);
    expect(row(lastDay, "2026-10-09T20:00:00Z", taken).nextLine).toBe("Last recorded Mon Sep 14 · 07:40");
    expect(row(lastDay, "2026-10-09T20:00:00Z").nextLine).toBe("No doses recorded yet");
  });
});

describe("R4 cycle detail", () => {
  const detail = cycleDetail(cycleOf([revision1, revision2]), peptides, MONDAY_NOON);

  it("heads with the status, day, dates, zone, goal and baseline", () => {
    expect(detail.statusLine).toBe("Active · day 12 of 30");
    expect(detail.meta).toBe("Sep 10, 2026 – Oct 9, 2026 · America/Toronto · Goal: Body composition · Baseline: not set");
    expect(cycleDetail(cycleOf([revision1]), peptides, "2026-09-01T16:00:00Z").statusLine).toBe("Upcoming · starts Sep 10");
    expect(cycleDetail(cycleOf([revision1]), peptides, "2026-11-01T16:00:00Z").statusLine).toBe("Ended · 30 days");
  });

  it("lays out months, phase bars (a raised dose and a break) and today", () => {
    const { timeline } = detail;
    expect(timeline.total).toBe(30);
    expect(timeline.months).toEqual([
      { label: "September", from: 1, to: 21 },
      { label: "October", from: 22, to: 30 },
    ]);
    expect(timeline.todayPercent).toBe(38.33);
    const [a, b] = timeline.lanes;
    expect(a).toMatchObject({ name: "Compound A", sub: "every 2 days · 20:00" });
    expect(a.bars.map(({ from, to, kind, raised, caption }) => [from, to, kind, raised, caption])).toEqual([
      [1, 11, "active", false, "0.4 mg"],
      [12, 21, "active", true, "0.5 mg · planned increase"],
      [22, 28, "break", false, "Break"],
    ]);
    expect(a.bars.map((bar) => bar.title)).toEqual([
      "0.4 mg · every 2 days · 20:00",
      "0.5 mg · every 2 days · 07:15",
      "Break Oct 1 – Oct 7",
    ]);
    expect(b).toMatchObject({ name: "Compound B", sub: "Mon · Wed · Fri · 07:30" });
    expect(cycleDetail(cycleOf([revision1]), peptides, "2026-11-01T16:00:00Z").timeline.todayPercent).toBeNull();
  });

  it("cuts a bar at a time-only change: titled with the time in force, one dose caption", () => {
    const timeOnly: CycleRevision = {
      ...revision2,
      plans: [
        {
          ...revision2.plans[0],
          phases: [{ ...(revision2.plans[0].phases[0] as ActivePhase), doseChanges: undefined }, revision2.plans[0].phases[1]],
        },
        revision2.plans[1],
      ],
    };
    const [a] = cycleDetail(cycleOf([revision1, timeOnly]), peptides, MONDAY_NOON).timeline.lanes;
    expect(a.bars.map(({ from, to, title, caption }) => [from, to, title, caption])).toEqual([
      [1, 11, "0.4 mg · every 2 days · 20:00", "0.4 mg"],
      [12, 21, "0.4 mg · every 2 days · 07:15", ""],
      [22, 28, "Break Oct 1 – Oct 7", "Break"],
    ]);
    // The markers agree: 20:00 before the change, 07:15 after, on the same every-2-days days.
    expect(a.dots.slice(5, 7).map((dot) => dot.label)).toEqual([
      "Compound A · Sun Sep 20 · 20:00 · Unconfirmed",
      "Compound A · Tue Sep 22 · 07:15 · Planned",
    ]);
  });

  it("places one marker per dose from every revision: earlier ones kept, later ones at the new time, same rhythm", () => {
    const [a, b] = detail.timeline.lanes;
    expect(a.dots.map((dot) => `${dot.day} ${dot.state} ${dot.label}`)).toEqual([
      "1 open Compound A · Thu Sep 10 · 20:00 · Unconfirmed",
      "3 open Compound A · Sat Sep 12 · 20:00 · Unconfirmed",
      "5 open Compound A · Mon Sep 14 · 20:00 · Unconfirmed",
      "7 open Compound A · Wed Sep 16 · 20:00 · Unconfirmed",
      "9 open Compound A · Fri Sep 18 · 20:00 · Unconfirmed",
      "11 open Compound A · Sun Sep 20 · 20:00 · Unconfirmed",
      "13 planned Compound A · Tue Sep 22 · 07:15 · Planned",
      "15 planned Compound A · Thu Sep 24 · 07:15 · Planned",
      "17 planned Compound A · Sat Sep 26 · 07:15 · Planned",
      "19 planned Compound A · Mon Sep 28 · 07:15 · Planned",
      "21 planned Compound A · Wed Sep 30 · 07:15 · Planned",
    ]);
    expect(b.dots.slice(0, 4).map((dot) => `${dot.day} ${dot.state}`)).toEqual(["5 open", "7 open", "9 open", "12 due"]);
    const taken = cycleDetail(cycleOf([revision1, revision2]), peptides, MONDAY_NOON, [
      { key: `${PLAN_A}:${A1}:0`, actualAt: "2026-09-11T00:10:00Z", recordedAt: "2026-09-11T00:12:00Z" },
    ]);
    expect(taken.timeline.lanes[0].dots[0]).toMatchObject({ state: "taken", label: "Compound A · Thu Sep 10 · 20:00 · Taken 20:10 · 0.4 mg" });
  });

  it("describes each phase as of today, and a withdrawn peptide", () => {
    const [a, b] = detail.plans;
    expect(a).toMatchObject({ name: "Compound A", availability: "", guidance: "Cycle off for 4 weeks." });
    expect(a.phases).toEqual([
      { word: "Now", current: true, text: "0.5 mg · every 2 days · 07:15", sub: "Sep 10 – Sep 30, 2026" },
      { word: "Break", current: false, text: "No doses Oct 1 – Oct 7", sub: "Oct 1 – Oct 7, 2026" },
    ]);
    expect(b).toMatchObject({ availability: "No longer offered for new cycles · history kept", guidance: "" });
    // Before the change, the phase shows what applies then and what is coming.
    const before = cycleDetail(cycleOf([revision1, revision2]), peptides, "2026-09-12T16:00:00Z");
    expect(before.plans[0].phases[0]).toMatchObject({ text: "0.4 mg · every 2 days · 20:00", sub: "Sep 10 – Sep 30, 2026 · from Sep 21: 0.5 mg, 07:15" });
    const ended = cycleDetail(cycleOf([revision1]), peptides, "2026-11-01T16:00:00Z");
    expect(ended.plans[0].phases[0].word).toBe("Done");
    expect(cycleDetail(cycleOf([revision1]), peptides, "2026-09-01T16:00:00Z").plans[0].phases[0].word).toBe("Next");
  });

  it("lists scheduled vs actual up to today, newest first, with actual and entered times", () => {
    const confirmed = cycleDetail(cycleOf([revision1, revision2]), peptides, MONDAY_NOON, [
      { key: `${PLAN_A}:${A1}:5`, actualAt: "2026-09-21T00:30:00Z", recordedAt: "2026-09-21T13:05:00Z" },
    ]);
    expect(confirmed.history.slice(0, 3)).toEqual([
      expect.objectContaining({ planned: "Mon Sep 21 · 07:30", peptide: "Compound B", mg: "1 mg", actual: "—", entered: "—", stateLabel: "Due" }),
      expect.objectContaining({ planned: "Sun Sep 20 · 20:00", peptide: "Compound A", mg: "0.4 mg", actual: "Sun Sep 20 · 20:30", entered: "Mon Sep 21 · 09:05", stateLabel: "Taken" }),
      expect.objectContaining({ planned: "Fri Sep 18 · 20:00", peptide: "Compound A", stateLabel: "Unconfirmed" }),
    ]);
    // Six A doses and four B doses up to today; nothing planned later.
    expect(confirmed.history).toHaveLength(10);
  });
});

describe("R6 display", () => {
  const names = new Map([
    [PA, { name: "Compound A", available: true }],
    [PB, { name: "Compound B", available: false }],
  ]);
  const plans: TemplatePlan[] = [
    {
      peptideId: PA,
      phases: [
        { kind: "active", offset: 0, len: 29, doseMg: "0.4", time: "20:00", schedule: { type: "interval", everyDays: 5 } },
        { kind: "break", offset: 29, len: 7 },
        { kind: "active", offset: 36, len: 14, doseMg: "0.5", time: "20:00", schedule: { type: "interval", everyDays: 1 } },
      ],
    },
    { peptideId: PB, phases: [{ kind: "active", offset: 0, len: 40, doseMg: "0.3", time: "07:30", schedule: { type: "weekdays", days: [5, 1, 3] } }] },
  ];

  it("summarises templates and their phases", () => {
    expect(templateDays({ plans })).toBe(50);
    expect(templateSummary({ plans }, names)).toBe("Compound A · 2 phases + Compound B · 1 phase");
    expect(includesWithdrawn({ plans }, names)).toBe(true);
    expect(includesWithdrawn({ plans: [plans[0]] }, names)).toBe(false);
    expect(plans[0].phases.map((phase) => `${phaseWhen(phase)} ${phaseText(phase)}`)).toEqual([
      "Day 1–29 0.4 mg · every 5 days · 20:00",
      "Day 30–36 Break",
      "Day 37–50 0.5 mg · every 1 day · 20:00",
    ]);
    expect(phaseText(plans[1].phases[0])).toBe("0.3 mg · Mon/Wed/Fri · 07:30");
    expect(templateSearchText({ name: "Recomp Starter", plans }, names)).toEqual(["recomp starter", "compound a", "compound b"]);
  });

  it("describes entries and where the caller uses them", () => {
    expect(peptideSub({ cyclingOff: "", supplement: "" })).toBe("Information");
    expect(peptideSub({ cyclingOff: "x", supplement: "y" })).toBe("Information · cycling-off guidance · supplement guidance");
    expect(peptideSub({ cyclingOff: "", supplement: "y" })).toBe("Information · supplement guidance");
    expect(usedIn([])).toBe("Not used in any of your cycles.");
    expect(usedIn(["One", "Two"])).toBe("In your cycles: One, Two");
  });
});
