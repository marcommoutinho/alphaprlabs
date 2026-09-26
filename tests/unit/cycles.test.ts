// S9 cycles: the R3 builder's validation (every message, in the designed
// order), a template copied into a new cycle, and editing a cycle as a new
// revision that changes future doses only, with occurrence keys (and so
// confirmations) kept for everything before the change. Pure: the engine,
// no database.
import { describe, expect, it } from "vitest";
import { editIssueMessage } from "@/lib/cycles/display";
import { editWindow, reviseCycle, type RevisedPlan } from "@/lib/cycles/revise";
import {
  type CycleForm,
  type CyclePeptide,
  type CycleRecord,
  type CycleRevision,
  formFromTemplate,
  formOfCycle,
  newPlan,
  validateCycle,
} from "@/lib/cycles/rules";
import { cycleOccurrences, cycleStatus } from "@/lib/cycles/schedule";
import { type Confirmation, scheduleOccurrences } from "@/lib/schedule/engine";
import type { TemplatePlan } from "@/lib/templates/rules";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PA = uuid(901);
const PB = uuid(902);
const PC = uuid(903);
const peptides: CyclePeptide[] = [
  { id: PA, name: "Compound A", available: true },
  { id: PB, name: "Compound B", available: true },
  { id: PC, name: "Compound C", available: false },
];
const PLAN_A = uuid(1);
const PLAN_B = uuid(2);
const [A0, A1, BREAK, A2, B1] = [uuid(10), uuid(11), uuid(12), uuid(13), uuid(20)];
const TORONTO = "America/Toronto";

/** Revision 1, America/Toronto. Sep 15, 2026 is a Tuesday. */
const revision1: CycleRevision = {
  id: uuid(100),
  number: 1,
  timeZone: TORONTO,
  createdAt: "2026-07-20T12:00:00Z",
  plans: [
    {
      planId: PLAN_A,
      peptideId: PA,
      effectiveFrom: null,
      phases: [
        { id: A0, kind: "active", start: "2026-08-01", end: "2026-08-20", doseMg: "0.2", time: "09:00", schedule: { type: "interval", everyDays: 3 } },
        { id: A1, kind: "active", start: "2026-09-01", end: "2026-09-30", doseMg: "0.4", time: "08:00", schedule: { type: "interval", everyDays: 2 } },
        { id: BREAK, kind: "break", start: "2026-10-01", end: "2026-10-07" },
        { id: A2, kind: "active", start: "2026-10-08", end: "2026-10-31", doseMg: "0.3", time: "20:00", schedule: { type: "weekdays", days: [1, 3, 5] } },
      ],
    },
    {
      planId: PLAN_B,
      peptideId: PB,
      effectiveFrom: null,
      phases: [{ id: B1, kind: "active", start: "2026-09-10", end: "2026-10-10", doseMg: "1", time: "07:30", schedule: { type: "weekdays", days: [2, 4] } }],
    },
  ],
};
const cycle: CycleRecord = {
  id: uuid(500),
  ownerId: uuid(600),
  name: "Recomp Spring 26",
  goal: "Body composition",
  baseline: "",
  templateId: null,
  templateName: "",
  templateGuidance: "",
  templateUpdatedAt: null,
  currentRevision: 1,
  createdAt: revision1.createdAt,
  updatedAt: revision1.createdAt,
  revisions: [revision1],
};

/** 11:00 in Toronto on Tuesday Sep 15: today's 07:30 and 08:00 doses are already due. */
const LATE_MORNING = "2026-09-15T15:00:00Z";
/** 06:00 in Toronto on Sep 15: nothing due yet today. */
const EARLY_MORNING = "2026-09-15T10:00:00Z";

/** The builder's form for the cycle as of `now`, edited by `change`, validated and revised. */
function edit(now: string, change: (form: CycleForm) => void, confirmations: Confirmation[] = []) {
  const { effective } = editWindow(revision1, now, confirmations);
  const form = formOfCycle(cycle, effective, "2026-09-15");
  change(form);
  const valid = validateCycle(form, peptides);
  if (!valid.ok) throw new Error(`Invalid form: ${valid.errors.join("; ")}`);
  return reviseCycle(revision1, valid.value, now, confirmations);
}

const planA = (form: CycleForm) => form.plans[0];
const phaseById = (form: CycleForm, id: string) => form.plans.flatMap((p) => p.phases).find((p) => p.id === id)!;

/** The next revision as stored, with ids for new phases. */
function revision2(plans: RevisedPlan[], timeZone = TORONTO, createdAt = LATE_MORNING): CycleRevision {
  let n = 700;
  return {
    id: uuid(101),
    number: 2,
    timeZone,
    createdAt,
    plans: plans.map((plan) => ({
      planId: plan.planId ?? uuid(n++),
      peptideId: plan.peptideId,
      effectiveFrom: plan.effectiveFrom,
      phases: plan.phases.map((phase) => ({ ...phase, id: phase.id ?? uuid(n++) })),
    })),
  };
}

const summary = (o: { key: string; scheduledAt: string; doseMg: string; actualAt: string | null }) =>
  `${o.key} ${o.scheduledAt} ${o.doseMg} ${o.actualAt ?? "-"}`;

describe("R3 validation", () => {
  it("lists every message in the designed order", () => {
    const empty: CycleForm = { cycleId: null, revision: null, templateId: null, name: " ", timeZone: "Mars/Olympus", goal: "", baseline: "", plans: [] };
    expect(validateCycle(empty, peptides)).toEqual({
      ok: false,
      errors: ["Give the cycle a name.", "Choose the time zone this cycle follows.", "Add a goal — results are reviewed against it.", "Add at least one peptide."],
    });

    const form: CycleForm = { ...empty, name: "Recomp", timeZone: TORONTO, goal: "Strength", plans: [newPlan(PC, "2026-10-01"), newPlan(PA, "2026-10-01")] };
    const a = form.plans[1];
    a.phases = [
      { ...a.phases[0], start: "2026-10-10", end: "2026-10-05", mg: "", every: "0" },
      { ...a.phases[0], kind: "break", start: "", end: "2026-10-20" },
      { ...a.phases[0], start: "2026-10-01", end: "2026-10-12", mg: "0,4", schedule: "weekdays", days: [], time: "" },
      { ...a.phases[0], start: "2026-11-01", end: "2026-11-30", mg: "1", every: "400" },
    ];
    form.plans[0].phases = [{ ...form.plans[0].phases[0], kind: "break" }];
    const result = validateCycle(form, peptides);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual([
      "Compound C is no longer offered for new cycles. Remove it before saving.",
      "Compound C: add at least one active phase.",
      // Compound A's phases by start date: the break without a start, Oct 1, Oct 10, Nov 1.
      "Compound A: phase 1 needs start and end dates.",
      "Compound A: phases 1 and 2 overlap.",
      "Compound A: phase 2 needs at least one weekday.",
      "Compound A: phase 2 needs a time.",
      "Compound A: phase 3 ends before it starts.",
      "Compound A: phases 2 and 3 overlap.",
      "Compound A: phase 3 needs a dose in mg.",
      "Compound A: phase 3 needs an interval of at least 1 day.",
      "Compound A: phase 4 needs an interval of 365 days or fewer.",
    ]);
  });

  it("accepts a multi-peptide cycle with decimal commas, stored as plain decimals by start date", () => {
    const form: CycleForm = {
      cycleId: null,
      revision: null,
      templateId: null,
      name: " Recomp ",
      timeZone: TORONTO,
      goal: "Strength",
      baseline: "82.4 kg",
      plans: [newPlan(PA, "2026-10-01"), newPlan(PB, "2026-10-03")],
    };
    form.plans[0].phases[0].mg = "0,40";
    form.plans[1].phases = [{ ...form.plans[1].phases[0], start: "2026-11-01", end: "2026-11-10", mg: "2" }, { ...form.plans[1].phases[0], kind: "break", start: "2026-10-03", end: "2026-10-09" }];
    const result = validateCycle(form, peptides);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Recomp");
    expect(result.value.plans[0].phases[0]).toMatchObject({ id: null, kind: "active", doseMg: "0.4", start: "2026-10-01", end: "2026-10-28", time: "08:00" });
    expect(result.value.plans[1].phases.map((p) => p.start)).toEqual(["2026-10-03", "2026-11-01"]);
  });
});

describe("template copy", () => {
  it("turns relative days into dates from the start date, as the researcher's own plan", () => {
    const plans: TemplatePlan[] = [
      {
        peptideId: PA,
        phases: [
          { kind: "active", offset: 0, len: 29, doseMg: "0.4", time: "20:00", schedule: { type: "interval", everyDays: 5 } },
          { kind: "break", offset: 29, len: 7 },
        ],
      },
      { peptideId: PB, phases: [{ kind: "active", offset: 0, len: 40, doseMg: "0.3", time: "07:30", schedule: { type: "weekdays", days: [1, 3, 5] } }] },
    ];
    const form = formFromTemplate({ id: uuid(800), name: "Recomp starter", plans }, "2026-10-01", TORONTO);
    // Later edits to the template's objects never reach the copy.
    (plans[0].phases[0] as { doseMg: string }).doseMg = "9";
    expect(form).toMatchObject({ templateId: uuid(800), name: "Recomp starter", goal: "", timeZone: TORONTO });
    expect(form.plans[0].phases).toEqual([
      { id: null, kind: "active", start: "2026-10-01", end: "2026-10-29", mg: "0.4", time: "20:00", schedule: "interval", every: "5", days: [1, 3, 5] },
      { id: null, kind: "break", start: "2026-10-30", end: "2026-11-05", mg: "", time: "08:00", schedule: "interval", every: "5", days: [1, 3, 5] },
    ]);
    expect(form.plans[1].phases[0]).toMatchObject({ start: "2026-10-01", end: "2026-11-09", schedule: "weekdays", days: [1, 3, 5] });
    expect(validateCycle({ ...form, goal: "Strength" }, peptides).ok).toBe(true);
  });
});

describe("editing: a new revision that changes future doses only", () => {
  const confirmation: Confirmation = {
    // Compound A's 4th dose (Sep 7), taken half an hour late.
    key: `${PLAN_A}:${A1}:3`,
    actualAt: "2026-09-07T12:30:00Z",
    recordedAt: "2026-09-07T12:31:00Z",
  };

  it("a dose change continues the phase and its rhythm from tomorrow when today's dose is already due", () => {
    const result = edit(LATE_MORNING, (form) => void (phaseById(form, A1).mg = "0.5"), [confirmation]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.plans[0];
    expect(a.effectiveFrom).toBe("2026-09-16");
    expect(a.phases.map((p) => p.id)).toEqual([A0, A1, BREAK, A2]);
    expect(a.phases[1]).toMatchObject({ end: "2026-09-30", doseMg: "0.4", doseChanges: [{ from: "2026-09-16", doseMg: "0.5" }] });
    // Compound B is untouched and keeps its content.
    expect(result.plans[1]).toMatchObject({ planId: PLAN_B, phases: revision1.plans[1].phases });

    const before = cycleOccurrences([revision1], [confirmation]);
    const after = cycleOccurrences([revision1, revision2(result.plans)], [confirmation]);
    // Same keys and times throughout (the rhythm continues); only later doses change.
    expect(after.map((o) => `${o.key} ${o.scheduledAt}`)).toEqual(before.map((o) => `${o.key} ${o.scheduledAt}`));
    const past = (list: typeof before) => list.filter((o) => o.localDate < "2026-09-16").map(summary);
    expect(past(after)).toEqual(past(before));
    expect(after.find((o) => o.key === confirmation.key)?.actualAt).toBe("2026-09-07T12:30:00Z");
    const a1 = after.filter((o) => o.phaseId === A1);
    expect(a1.filter((o) => o.localDate < "2026-09-16").every((o) => o.doseMg === "0.4")).toBe(true);
    expect(a1.filter((o) => o.localDate >= "2026-09-16").map((o) => o.doseMg)).toEqual(["0.5", "0.5", "0.5", "0.5", "0.5", "0.5", "0.5"]);
    // Revision 1 itself is untouched: the old plan is still readable as it was.
    expect(scheduleOccurrences({ planId: PLAN_A, timeZone: TORONTO, phases: revision1.plans[0].phases }).find((o) => o.key === `${PLAN_A}:${A1}:10`)?.doseMg).toBe("0.4");
  });

  it("a later edit keeps an earlier dose change and the revisions chain without gaps", () => {
    const first = edit(LATE_MORNING, (form) => void (phaseById(form, A1).mg = "0.5"));
    if (!first.ok) throw new Error("first edit refused");
    const second = revision2(first.plans);
    const cycle2: CycleRecord = { ...cycle, currentRevision: 2, revisions: [revision1, second] };
    // Two days later, only Compound B's dose changes.
    const now = "2026-09-17T15:00:00Z";
    const { effective } = editWindow(second, now);
    const form = formOfCycle(cycle2, effective, "2026-09-17");
    expect(phaseById(form, A1).mg).toBe("0.5");
    phaseById(form, B1).mg = "2";
    const valid = validateCycle(form, peptides);
    const result = valid.ok ? reviseCycle(second, valid.value, now) : null;
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.plans[0].phases).toEqual(second.plans[0].phases);
    expect(result.plans[1].phases[0]).toMatchObject({ id: B1, doseChanges: [{ from: "2026-09-18", doseMg: "2" }] });

    const third = { ...revision2(result.plans, TORONTO, now), id: uuid(102), number: 3 };
    const all = cycleOccurrences([revision1, second, third]);
    expect(all.map((o) => `${o.key} ${o.scheduledAt}`)).toEqual(cycleOccurrences([revision1]).map((o) => `${o.key} ${o.scheduledAt}`));
    const doses = (phaseId: string, date: string) => all.find((o) => o.phaseId === phaseId && o.localDate === date)?.doseMg;
    expect([doses(A1, "2026-09-15"), doses(A1, "2026-09-17"), doses(B1, "2026-09-17"), doses(B1, "2026-09-22")]).toEqual(["0.4", "0.5", "1", "2"]);
  });

  it("changes today's doses too when none of them is due yet", () => {
    const result = edit(EARLY_MORNING, (form) => void (phaseById(form, A1).mg = "0.5"));
    expect(result.ok && result.plans.map((p) => p.effectiveFrom)).toEqual(["2026-09-15", "2026-09-15"]);
    if (!result.ok) return;
    const today = cycleOccurrences([revision1, revision2(result.plans, TORONTO, EARLY_MORNING)]).find((o) => o.localDate === "2026-09-15" && o.phaseId === A1);
    expect(today?.doseMg).toBe("0.5");
  });

  it("a time or schedule change ends the running phase yesterday and starts a new one; earlier keys stay", () => {
    const result = edit(LATE_MORNING, (form) => {
      phaseById(form, A1).time = "20:00";
      phaseById(form, B1).days = [2, 4, 6];
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [a, b] = result.plans;
    expect(a.phases.map((p) => [p.id, p.start, p.end])).toEqual([
      [A0, "2026-08-01", "2026-08-20"],
      [A1, "2026-09-01", "2026-09-15"],
      [null, "2026-09-16", "2026-09-30"],
      [BREAK, "2026-10-01", "2026-10-07"],
      [A2, "2026-10-08", "2026-10-31"],
    ]);
    expect(a.phases[2]).toMatchObject({ kind: "active", time: "20:00", schedule: { type: "interval", everyDays: 2 } });
    expect(b.phases.map((p) => [p.id, p.end])).toEqual([[B1, "2026-09-15"], [null, "2026-10-10"]]);

    const before = cycleOccurrences([revision1]);
    const after = cycleOccurrences([revision1, revision2(result.plans)]);
    const past = (list: typeof before) => list.filter((o) => o.localDate < "2026-09-16").map(summary);
    expect(past(after)).toEqual(past(before));
    const firstNew = after.find((o) => o.localDate >= "2026-09-16" && o.planId === PLAN_A);
    expect(firstNew).toMatchObject({ localDate: "2026-09-16", localTime: "20:00" });
    expect(firstNew?.phaseId).not.toBe(A1);
  });

  it("moving the cycle to another time zone keeps the times earlier doses had", () => {
    const result = edit(LATE_MORNING, (form) => void (form.timeZone = "Europe/Lisbon"));
    expect(result.ok && result.plans.map((p) => p.effectiveFrom)).toEqual(["2026-09-16", "2026-09-16"]);
    if (!result.ok) return;
    const after = cycleOccurrences([revision1, revision2(result.plans, "Europe/Lisbon")]);
    const a1 = after.filter((o) => o.phaseId === A1);
    expect(a1.find((o) => o.localDate === "2026-09-15")).toMatchObject({ scheduledAt: "2026-09-15T12:00:00Z", timeZone: TORONTO });
    expect(a1.find((o) => o.localDate === "2026-09-17")).toMatchObject({ scheduledAt: "2026-09-17T07:00:00Z", timeZone: "Europe/Lisbon" });
    expect(new Set(after.map((o) => o.key)).size).toBe(after.length);
  });

  it("refuses changes that would reach the past, with the builder's messages", () => {
    const result = edit(LATE_MORNING, (form) => {
      phaseById(form, A0).end = "2026-08-21";
      phaseById(form, A1).start = "2026-09-02";
      planA(form).phases.push({ ...phaseById(form, BREAK), id: null, start: "2026-09-15", end: "2026-09-15" });
      phaseById(form, A1).end = "2026-09-14";
      form.plans.splice(1, 1);
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const names = (id: string) => peptides.find((p) => p.id === id)!.name;
    expect(result.issues.map((issue) => editIssueMessage(issue, names))).toEqual([
      "Compound A: phase 1 has ended, so it can't be changed.",
      "Compound A: phase 2 has started, so its start date can't change.",
      "Compound A: phase 2 has started, so it can end Tue Sep 15 at the earliest.",
      "Compound A: phase 3 can start Wed Sep 16 at the earliest — changes apply to future doses only.",
      "Compound B has started, so it can't be removed. End its phases instead.",
    ]);
  });

  it("an unchanged edit gives the same plans, and the builder locks what has happened", () => {
    const result = edit(LATE_MORNING, () => {});
    expect(result.ok && result.plans.map((p) => p.phases)).toEqual(revision1.plans.map((p) => p.phases));
    const { effective, locks } = editWindow(revision1, LATE_MORNING);
    expect(Object.fromEntries(effective)).toEqual({ [PLAN_A]: "2026-09-16", [PLAN_B]: "2026-09-16" });
    expect(Object.fromEntries(locks)).toEqual({ [A0]: "ended", [A1]: "started", [BREAK]: null, [A2]: null, [B1]: "started" });
  });
});

describe("status", () => {
  it("Upcoming, Active, In break and Ended in the cycle's zone", () => {
    expect(cycleStatus(revision1, "2026-07-31T12:00:00Z")).toBe("Upcoming");
    expect(cycleStatus(revision1, "2026-08-10T12:00:00Z")).toBe("Active");
    expect(cycleStatus(revision1, "2026-08-25T12:00:00Z")).toBe("In break");
    // 23:30 on Oct 31 in Toronto is Nov 1 in UTC: still active there.
    expect(cycleStatus(revision1, "2026-11-01T03:30:00Z")).toBe("Active");
    expect(cycleStatus(revision1, "2026-11-01T04:30:00Z")).toBe("Ended");
  });
});
