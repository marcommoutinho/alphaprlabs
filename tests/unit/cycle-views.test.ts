// A cycle's status by today in its zone, and R6 display text. Pure: the S7
// engine across S9 revisions, no database. Sep 15, 2026 is a Tuesday. The v3
// cycle screens themselves are in tests/unit/cycle-screens.test.ts.
import { describe, expect, it } from "vitest";
import type { CycleRevision } from "@/lib/cycles/rules";
import { cycleStatus } from "@/lib/cycles/schedule";
import { withdrawnNotice, includesWithdrawn, phaseText, phaseWhen, templateDays } from "@/lib/library/research-view";
import type { TemplatePlan } from "@/lib/templates/rules";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PA, PB] = [uuid(901), uuid(902)];
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

describe("a cycle's status", () => {
  it("is Upcoming, Active, In break and Ended by today in the cycle's zone", () => {
    expect(cycleStatus(revision1, "2026-09-10T03:59:00Z")).toBe("Upcoming"); // Sep 9, 23:59 in Toronto
    expect(cycleStatus(revision1, "2026-09-10T04:00:00Z")).toBe("Active");
    expect(cycleStatus(revision1, "2026-10-10T03:59:00Z")).toBe("Active"); // B runs to Oct 9
    expect(cycleStatus(revision1, "2026-10-10T04:00:00Z")).toBe("Ended");
    expect(cycleStatus({ ...revision1, plans: [revision1.plans[0]] }, "2026-10-03T16:00:00Z")).toBe("In break");
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
    expect(includesWithdrawn({ plans }, names)).toBe(true);
    expect(includesWithdrawn({ plans: [plans[0]] }, names)).toBe(false);
    expect(plans[0].phases.map((phase) => `${phaseWhen(phase)} ${phaseText(phase)}`)).toEqual([
      "Day 1–29 0.4 mg · every 5 days · 20:00",
      "Day 30–36 Break",
      "Day 37–50 0.5 mg · every 1 day · 20:00",
    ]);
    expect(phaseText(plans[1].phases[0])).toBe("0.3 mg · Mon/Wed/Fri · 07:30");
  });

  it("the template page's notice names every peptide no longer offered, or is absent", () => {
    expect(withdrawnNotice({ plans }, names)).toBe("Your copy will include Compound B, which is no longer offered.");
    expect(withdrawnNotice({ plans: [plans[0]] }, names)).toBeNull();
    const more = new Map([
      ...names,
      [PA, { name: "Compound A", available: false }],
      ["c", { name: "Compound C", available: false }],
    ]);
    const cPlan: TemplatePlan = { peptideId: "c", phases: plans[1].phases };
    expect(withdrawnNotice({ plans }, more)).toBe("Your copy will include Compound A and Compound B, which are no longer offered.");
    expect(withdrawnNotice({ plans: [...plans, cPlan] }, more)).toBe(
      "Your copy will include Compound A, Compound B and Compound C, which are no longer offered.",
    );
  });
});
