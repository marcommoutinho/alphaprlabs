// S12 R1 Today and R5 rules, pure: what Today shows from cycles, recorded
// doses and saved mixtures (hero, today's rows, unconfirmed doses, each
// plan's next dose, the badge, ?dose= links), and the sheet's checks and
// schedule-effect line. Sep 26, 2026 is a Saturday.
import { describe, expect, it } from "vitest";
import type { CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import type { ViewPeptides } from "@/lib/cycles/views";
import {
  AMOUNT_REQUIRED,
  confirmFormError,
  effectText,
  nextIntervalDose,
  readConfirmForm,
  type ScheduleEffect,
  sheetUnitsLabel,
  STALE_LINK,
  TIME_FUTURE,
  TIME_REQUIRED,
  wallOf,
} from "@/lib/doses/rules";
import { pendingDoses, setupForActual, todayView } from "@/lib/doses/today";
import type { Mixture } from "@/lib/mixtures/rules";
import { setupAt, setupSegments, versionAt } from "@/lib/doses/setups";
import { cycleDetail, type RecordedConfirmation } from "@/lib/cycles/views";
import type { Confirmation } from "@/lib/schedule/engine";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PA, PB] = [uuid(901), uuid(902)];
const peptides: ViewPeptides = new Map([
  [PA, { name: "Compound A", available: true }],
  [PB, { name: "Compound B", available: true }],
]);
const [PLAN_A, PLAN_B, A1, B1] = [uuid(1), uuid(2), uuid(10), uuid(20)];
const TORONTO = "America/Toronto";

/** A: every 2 days at 08:00 from Sep 20; B: Mon/Wed/Fri at 20:00 from Sep 21. */
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
      phases: [{ id: A1, kind: "active", start: "2026-09-20", end: "2026-10-10", doseMg: "0.4", time: "08:00", schedule: { type: "interval", everyDays: 2 } }],
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
/** Ended Sep 10: its unconfirmed doses stay in its history, not on Today or the badge. */
const ended: CycleRecord = {
  ...cycle,
  id: uuid(501),
  name: "Old cycle",
  revisions: [
    {
      ...revision,
      id: uuid(102),
      plans: [{ ...revision.plans[0], planId: uuid(3), phases: [{ ...revision.plans[0].phases[0], id: uuid(11), start: "2026-09-01", end: "2026-09-10" }] }],
    },
  ],
};
const mixture: Mixture = {
  id: uuid(700),
  ownerId: cycle.ownerId,
  peptideId: PA,
  version: 1,
  setupNumber: 1,
  setupId: uuid(701),
  setup: { vialMg: "10", liquidMl: "2", syringe: 100, lineSpacing: "2" },
  setupSince: "2026-09-01T12:00:00Z",
  createdAt: "2026-09-01T12:00:00Z",
  planIds: [PLAN_A],
};

const keyA = (index: number) => `${PLAN_A}:${A1}:${index}`;
const keyB = (date: string) => `${PLAN_B}:${B1}:${date}`;
/** Noon Saturday Sep 26 in Toronto (EDT, UTC-4). */
const NOON = "2026-09-26T16:00:00Z";
/** A's Sep 24 dose taken at 07:00, entered at 07:05: the Sep 26 dose moves to 07:00. */
const taken24: Confirmation = { key: keyA(2), actualAt: "2026-09-24T11:00:00Z", recordedAt: "2026-09-24T11:05:00Z" };

/** A's setups: 10 mg / 1 mL until Sep 5, then 10 mg / 2 mL (the current one). */
const oldSetup = { id: uuid(702), mixtureId: mixture.id, number: 1, createdAt: "2026-09-01T12:00:00Z", setup: { ...mixture.setup, liquidMl: "1" } };
const newSetup = { id: mixture.setupId, mixtureId: mixture.id, number: 2, createdAt: "2026-09-05T12:00:00Z", setup: mixture.setup };
const setupsA = setupSegments([{ mixtureId: mixture.id, linkedAt: "2026-09-01T12:00:00Z", unlinkedAt: null }], [oldSetup, newSetup]);

const view = (confirmations: RecordedConfirmation[], requestedKey: string | null = null, now = NOON) =>
  todayView({
    cycles: [cycle, ended],
    confirmations: new Map([[cycle.id, confirmations]]),
    peptides,
    mixtures: new Map([[PLAN_A, mixture]]),
    setups: new Map([[PLAN_A, setupsA]]),
    vials: new Map([[mixture.id, "R-07"]]),
    now,
    requestedKey,
  });

describe("R1 Today", () => {
  it("leads with today's dose in syringe units, then unconfirmed doses newest first, then each plan's next dose", () => {
    const today = view([taken24]);
    expect(today.dateLabel).toBe("Saturday, September 26");
    expect(today.timeZone).toBe(TORONTO);
    expect(today.hero).toMatchObject({ key: keyA(3), dueWord: "Due", time: "07:00", peptideName: "Compound A", doseMg: "0.4", mixtureLabel: "10 mg / 2 mL" });
    expect(today.hero?.draw).toMatchObject({ kind: "units", units: "8", onLine: true, flag: null });
    expect(today.rows.map((r) => [r.kind, r.key, r.action])).toEqual([
      ["open", keyB("2026-09-25"), "Confirm"],
      ["open", keyB("2026-09-23"), "Confirm"],
      ["open", keyA(1), "Confirm"],
      ["open", keyB("2026-09-21"), "Confirm"],
      ["open", keyA(0), "Confirm"],
      ["next", keyA(4), null],
      ["next", keyB("2026-09-28"), null],
    ]);
    expect(today.rows[5]).toMatchObject({ status: "Next", sub: expect.stringContaining("8 units · interval counted from the last actual dose") });
    expect(today.rows[6].sub).toContain("no saved mixture");
    // Five unconfirmed, plus today's due dose; the ended cycle's open doses don't count.
    expect(today.badge).toBe(6);
    expect(pendingDoses([cycle, ended], new Map([[cycle.id, [taken24]]]), NOON)).toBe(6);
    expect(today.doses[keyA(3)]).toMatchObject({
      vialLabel: "R-07",
      calculatorHref: `/app/calculator?plan=${PLAN_A}`,
      recorded: null,
      mixtureVersionId: mixture.setupId,
      setups: setupsA,
    });
    expect(today.doses[keyA(3)].effect).toMatchObject({ kind: "interval", everyDays: 2, floor: "2026-09-24T07:00", next: "moves" });
    expect(today.doses[keyB("2026-09-25")].effect).toEqual({ kind: "weekdays", days: "Mon/Wed/Fri", time: "20:00" });
  });

  it("shows today's taken doses with what was recorded, and what's next once everything due is confirmed", () => {
    const taken26: RecordedConfirmation = {
      key: keyA(3),
      actualAt: "2026-09-26T15:30:00Z",
      recordedAt: "2026-09-26T15:31:00Z",
      amountMg: "0.3",
      site: "Thigh L",
      notes: "Mild redness",
    };
    const today = view([taken24, taken26]);
    expect(today.hero).toBeNull();
    expect(today.nothingDue).toEqual({ title: "All done for today", body: expect.stringContaining("Next: Compound A") });
    // The amount taken, not the plan; the plan quietly where it differs; the site.
    expect(today.rows[0]).toMatchObject({
      kind: "today",
      key: keyA(3),
      status: "Taken 11:30 · 0.3 mg",
      statusNote: "(planned 0.4 mg)",
      sub: "Planned 07:00 · Thigh L",
      action: "Details",
    });
    expect(today.doses[keyA(3)].recorded).toMatchObject({ amount: "0.3 mg", planned: "(planned 0.4 mg)", site: "Thigh L", notes: "Mild redness" });
    // Taken as planned: no planned note.
    const asPlanned = view([taken24, { ...taken26, amountMg: "0.40", site: "", notes: "" }]);
    expect(asPlanned.rows[0]).toMatchObject({ status: "Taken 11:30 · 0.40 mg", statusNote: "", sub: "Planned 07:00" });
    expect(today.badge).toBe(5);
    // Before 07:00 the dose is ahead: "Later today", not counted.
    const early = view([taken24], null, "2026-09-26T10:00:00Z");
    expect(early.hero).toMatchObject({ key: keyA(3), dueWord: "Later today" });
    expect(early.badge).toBe(5);
  });

  it("opens a notification's dose, or says why not", () => {
    expect(view([taken24], keyB("2026-09-23")).requested).toEqual({ key: keyB("2026-09-23"), notice: null });
    expect(view([taken24], keyB("2026-09-24")).requested).toEqual({ key: keyB("2026-09-24"), notice: STALE_LINK });
    expect(view([taken24], keyA(5)).requested?.notice).toMatch(/^Compound A is planned for .* — you can confirm it on its day\.$/);
    // A dose already taken opens its sheet in the recorded state.
    const recorded = view([taken24], keyA(2));
    expect(recorded.requested).toEqual({ key: keyA(2), notice: null });
    expect(recorded.doses[keyA(2)].recorded).not.toBeNull();
  });
});

describe("R5 rules", () => {
  it("checks the amount, time, site and notes; the server re-checks the rest", () => {
    const form = { amount: "0.4", actual: null, site: "", notes: "" };
    expect(confirmFormError(form, "2026-09-26T12:00")).toBeNull();
    expect(confirmFormError({ ...form, amount: "0" }, "2026-09-26T12:00")).toBe(AMOUNT_REQUIRED);
    expect(confirmFormError({ ...form, actual: "" }, "2026-09-26T12:00")).toBe(TIME_REQUIRED);
    expect(confirmFormError({ ...form, actual: "2026-09-26T12:01" }, "2026-09-26T12:00")).toBe(TIME_FUTURE);
    expect(confirmFormError({ ...form, actual: "2026-09-25T06:00" }, "2026-09-26T12:00")).toBeNull();
    expect(confirmFormError({ ...form, site: "Arm" }, "2026-09-26T12:00")).not.toBeNull();
    expect(confirmFormError({ ...form, notes: "x".repeat(1001) }, "2026-09-26T12:00")).not.toBeNull();
  });

  it("reads only well-formed confirmations", () => {
    const good = { requestKey: uuid(1), key: keyA(3), seenScheduledAt: NOON, seenDoseMg: "0.4", seenMixtureVersion: null, amount: "0.4", actual: null, site: "", notes: "" };
    expect(readConfirmForm(good)).toEqual(good);
    expect(readConfirmForm({ ...good, requestKey: "x" })).toBeNull();
    expect(readConfirmForm({ ...good, key: "a:b:c" })).toBeNull();
    expect(readConfirmForm({ ...good, actual: 5 })).toBeNull();
    expect(readConfirmForm(null)).toBeNull();
    // The shown mixture version is required: a version id, or null for none.
    expect(readConfirmForm({ ...good, seenMixtureVersion: "not-a-uuid" })).toBeNull();
    expect(readConfirmForm({ ...good, seenMixtureVersion: undefined })).toBeNull();
    expect(readConfirmForm({ ...good, seenMixtureVersion: uuid(9).toUpperCase() })?.seenMixtureVersion).toBe(uuid(9));
  });

  it("says where the next every-N-days dose moves, never before a newer recorded dose", () => {
    const effect: Extract<ScheduleEffect, { kind: "interval" }> = {
      kind: "interval",
      everyDays: 2,
      phaseEnd: "2026-10-10",
      timeChanges: [{ from: "2026-09-28", time: "21:00" }],
      floor: null,
      next: "moves",
    };
    expect(nextIntervalDose(effect, "2026-09-25T06:10")).toBe("2026-09-27T06:10");
    expect(nextIntervalDose(effect, "2026-09-26T06:10")).toBe("2026-09-28T21:00");
    expect(nextIntervalDose({ ...effect, floor: "2026-09-26T09:00" }, "2026-09-25T06:10")).toBe("2026-09-28T21:00");
    expect(nextIntervalDose(effect, "2026-10-09T08:00")).toBeNull();
    expect(effectText(effect, "A", "2026-09-25T06:10", "2026-09-26T12:00")).toMatch(/^Next A moves to .*06:10 — the 2-day interval counts from this actual time/);
    expect(effectText({ ...effect, next: "kept" }, "A", "2026-09-25T06:10", "2026-09-26T12:00")).toMatch(/^Later A doses that are already due keep their times/);
    expect(effectText({ kind: "weekdays", days: "Mon/Wed/Fri", time: "20:00" }, "B", null, "2026-09-26T12:00")).toMatch(/keeps its fixed weekdays \(Mon\/Wed\/Fri 20:00\)/);
  });

  it("shows units for the amount entered and wall-clock times in the dose's zone", () => {
    expect(sheetUnitsLabel(mixture.setup, "0.4")).toBe("= 8 units");
    expect(sheetUnitsLabel(mixture.setup, "0.41")).toBe("= 8.2 units · not on a line");
    expect(sheetUnitsLabel(null, "0.4")).toBe("no saved mixture");
    expect(sheetUnitsLabel(mixture.setup, "")).toBe("enter an amount");
    expect(wallOf(NOON, TORONTO)).toBe("2026-09-26T12:00");
    expect(wallOf("2026-09-26T04:00:00Z", TORONTO)).toBe("2026-09-26T00:00");
  });
});

describe("the setup in effect at an actual time (R5, AP020)", () => {
  it("follows links and versions exactly, as plan_mixture_version_at does", () => {
    const other = { id: uuid(703), mixtureId: uuid(710), number: 1, createdAt: "2026-09-10T00:00:00Z", setup: { ...mixture.setup, vialMg: "5" } };
    const links = [
      { mixtureId: mixture.id, linkedAt: "2026-09-01T12:00:00Z", unlinkedAt: "2026-09-12T00:00:00.000001Z" },
      { mixtureId: other.mixtureId, linkedAt: "2026-09-12T00:00:00.000001Z", unlinkedAt: "2026-09-20T00:00:00Z" },
    ];
    const versions = [oldSetup, newSetup, other];
    const segments = setupSegments(links, versions);
    expect(segments.map((s) => [s.from, s.to, s.versionId])).toEqual([
      ["2026-09-01T12:00:00Z", "2026-09-05T12:00:00Z", oldSetup.id],
      ["2026-09-05T12:00:00Z", "2026-09-12T00:00:00.000001Z", newSetup.id],
      ["2026-09-12T00:00:00.000001Z", "2026-09-20T00:00:00Z", other.id],
    ]);
    // Microseconds count: the old link is still in effect a microsecond before it ends.
    for (const at of ["2026-08-31T00:00:00Z", "2026-09-03T00:00:00Z", "2026-09-05T12:00:00Z", "2026-09-12T00:00:00Z", "2026-09-12T00:00:00.000001Z", "2026-09-25T00:00:00Z"]) {
      expect(setupAt(segments, at)?.versionId ?? null, at).toBe(versionAt(links, versions, at)?.id ?? null);
    }
    expect(setupAt(segments, "2026-09-12T00:00:00Z")?.versionId).toBe(newSetup.id);
    expect(setupAt(segments, "2026-09-25T00:00:00Z")).toBeNull();
    // Still linked: the last segment stays open.
    expect(setupsA.at(-1)).toMatchObject({ to: null, versionId: mixture.setupId });
  });

  it("gives the sheet the setup, and its version, for a backdated time", () => {
    const detail = view([taken24]).doses[keyA(3)];
    expect(setupAt(detail.setups, "2026-09-03T12:00:00Z")).toMatchObject({ versionId: oldSetup.id, setup: { liquidMl: "1" } });
    expect(sheetUnitsLabel(setupAt(detail.setups, "2026-09-03T12:00:00Z")!.setup, "0.4")).toBe("= 4 units");
    expect(sheetUnitsLabel(detail.setup, "0.4")).toBe("= 8 units");
  });
});

describe("the sheet's deduction notice follows the setup of the actual time", () => {
  // A used mixture OLD (vial "OLD-1") until Sep 20, then was relinked to the current mixture (vial "R-07").
  const oldMixture = uuid(720);
  const oldVersion = { id: uuid(721), mixtureId: oldMixture, number: 1, createdAt: "2026-09-02T12:00:00Z", setup: { ...mixture.setup, vialMg: "5" } };
  const relinked = setupSegments(
    [
      { mixtureId: oldMixture, linkedAt: "2026-09-02T12:00:00Z", unlinkedAt: "2026-09-20T12:00:00Z" },
      { mixtureId: mixture.id, linkedAt: "2026-09-20T12:00:00Z", unlinkedAt: null },
    ],
    [oldVersion, oldSetup, newSetup],
  );
  const detailWith = (vials: Map<string, string>) =>
    todayView({
      cycles: [cycle],
      confirmations: new Map([[cycle.id, [taken24]]]),
      peptides,
      mixtures: new Map([[PLAN_A, mixture]]),
      setups: new Map([[PLAN_A, relinked]]),
      vials,
      now: NOON,
    }).doses[keyA(3)];
  const tracked = detailWith(new Map([[mixture.id, "R-07"], [oldMixture, "OLD-1"]]));

  it("names the current mixture's vial now, and the old mixture's vial for a time before the relink", () => {
    expect(setupForActual(tracked, null)).toEqual({ setup: mixture.setup, versionId: mixture.setupId, vialLabel: "R-07" });
    expect(setupForActual(tracked, "2026-09-19T12:00:00Z")).toEqual({ setup: oldVersion.setup, versionId: oldVersion.id, vialLabel: "OLD-1" });
    expect(setupForActual(tracked, "2026-09-21T12:00:00Z")).toMatchObject({ versionId: mixture.setupId, vialLabel: "R-07" });
  });

  it("shows no deduction before any mixture, for a mixture without an open vial, or with tracking off", () => {
    expect(setupForActual(tracked, "2026-09-01T12:00:00Z")).toEqual({ setup: null, versionId: null, vialLabel: null });
    // The old mixture's vial was finished: the current one still has its vial.
    const oldFinished = detailWith(new Map([[mixture.id, "R-07"]]));
    expect(setupForActual(oldFinished, "2026-09-19T12:00:00Z")).toMatchObject({ versionId: oldVersion.id, vialLabel: null });
    // Tracking off: the page passes no vials.
    const off = detailWith(new Map());
    expect(setupForActual(off, null).vialLabel).toBeNull();
    expect(setupForActual(off, "2026-09-19T12:00:00Z").vialLabel).toBeNull();
  });
});

describe("R4 history shows what was recorded", () => {
  it("the amount taken, the plan where it differs, and the site and notes", () => {
    const detail = cycleDetail(cycle, peptides, NOON, [
      taken24,
      { key: keyB("2026-09-25"), actualAt: "2026-09-26T00:10:00Z", recordedAt: "2026-09-26T00:11:00Z", amountMg: "0.75", site: "Abdomen R", notes: "Late" },
    ]);
    const rowOf = (key: string) => detail.history.find((row) => row.key === key)!;
    expect(rowOf(keyB("2026-09-25"))).toMatchObject({ mg: "0.75 mg", plannedMg: "(planned 1 mg)", details: "Abdomen R · Late", state: "taken" });
    // A confirmation without recorded details (older callers) shows the plan.
    expect(rowOf(keyA(2))).toMatchObject({ mg: "0.4 mg", plannedMg: "", details: "" });
    expect(rowOf(keyA(1))).toMatchObject({ mg: "0.4 mg", plannedMg: "", details: "", state: "open" });
    const dot = detail.timeline.lanes[1].dots.find((x) => x.key === keyB("2026-09-25"))!;
    expect(dot.label).toMatch(/Taken 20:10 · 0\.75 mg$/);
  });
});
