// V1 Today (design v3), pure: skipped doses, the Now block's choice, the
// header's progress and cycle day, the day rail, the injection-site
// rotation, R2's vial estimate and the v3 display formats.
// Sep 26, 2026 is a Saturday.
import { describe, expect, it } from "vitest";
import type { CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import type { RecordedConfirmation, ViewPeptides } from "@/lib/cycles/views";
import { clock12, inMassUnit, massLabel, massUnit, mgFromUnit, shortDate, untilLabel, wallWhen } from "@/lib/alpha/format";
import { dayProgress, dayRail } from "@/lib/doses/board";
import { lastSiteNote, lastSiteUse, nextSite, RECORDED_SITES, ROTATION } from "@/lib/doses/sites";
import { confirmFormError } from "@/lib/doses/rules";
import { pendingDoses, todayView, vialForActual } from "@/lib/doses/today";
import type { Mixture } from "@/lib/mixtures/rules";
import { setupSegments } from "@/lib/doses/setups";
import { isAwaitingConfirmation, nextDue, occurrenceState, scheduleOccurrences } from "@/lib/schedule/engine";
import type { SupplementRow } from "@/lib/supplements/view";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PA, PB] = [uuid(901), uuid(902)];
const peptides: ViewPeptides = new Map([
  [PA, { name: "Compound A", available: true }],
  [PB, { name: "Compound B", available: true }],
]);
const [PLAN_A, PLAN_B, A1, B1] = [uuid(1), uuid(2), uuid(10), uuid(20)];
const TORONTO = "America/Toronto";

/** A: every 2 days at 08:00 from Sep 20 to Oct 10; B: Mon/Wed/Fri at 20:00 from Sep 21. */
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
const setupsA = setupSegments(
  [{ mixtureId: mixture.id, linkedAt: "2026-09-01T12:00:00Z", unlinkedAt: null }],
  [{ id: mixture.setupId, mixtureId: mixture.id, number: 1, createdAt: "2026-09-01T12:00:00Z", setup: mixture.setup }],
);

const keyA = (index: number) => `${PLAN_A}:${A1}:${index}`;
const keyB = (date: string) => `${PLAN_B}:${B1}:${date}`;
/** Noon Saturday Sep 26 in Toronto (EDT, UTC-4). */
const NOON = "2026-09-26T16:00:00Z";
const taken = (key: string, actualAt: string, site = ""): RecordedConfirmation => ({ key, actualAt, recordedAt: actualAt, site });
const skipped = (key: string, recordedAt: string): RecordedConfirmation => ({ key, actualAt: recordedAt, recordedAt, skipped: true });

const view = (confirmations: RecordedConfirmation[], now = NOON, remainingMg = "0.7") =>
  todayView({
    cycles: [cycle],
    confirmations: new Map([[cycle.id, confirmations]]),
    peptides,
    mixtures: new Map([[PLAN_A, mixture]]),
    setups: new Map([[PLAN_A, setupsA]]),
    vials: new Map([[mixture.id, "R-07"]]),
    vialEstimates: new Map([[mixture.id, { label: "R-07", strengthMg: "10", remainingMg }]]),
    now,
  });

// A's doses: 0 Sep 20, 1 Sep 22, 2 Sep 24, 3 Sep 26 (today), 4 Sep 28.
const everythingBefore = [
  taken(keyA(0), "2026-09-20T12:00:00Z"),
  taken(keyA(1), "2026-09-22T12:00:00Z"),
  taken(keyA(2), "2026-09-24T12:00:00Z"),
  taken(keyB("2026-09-21"), "2026-09-22T00:00:00Z"),
  taken(keyB("2026-09-23"), "2026-09-24T00:00:00Z"),
];

describe("a skipped dose", () => {
  it("is resolved: not the Now dose, not unconfirmed, not in the badge; today's shows as Skipped", () => {
    const base = view(everythingBefore);
    expect(base.now).toEqual({ key: keyA(3), mode: "due" });
    // Friday's B dose is still open (overdue) and A's today is due.
    expect(base.badge).toBe(2);

    const skippedToday = view([...everythingBefore, skipped(keyA(3), "2026-09-26T15:00:00Z")]);
    expect(skippedToday.hero).toBeNull();
    expect(skippedToday.badge).toBe(1);
    expect(skippedToday.items.find((i) => i.key === keyA(3))).toMatchObject({ kind: "today", state: "skipped" });
    expect(skippedToday.rows.find((r) => r.key === keyA(3))).toMatchObject({ kind: "today", status: "Skipped", action: "Details" });
    expect(skippedToday.doses[keyA(3)]).toMatchObject({ state: "skipped", stateLabel: "Skipped", recorded: null, skipped: { entered: expect.any(String) } });
    // The Now block moves on to the next dose, shown without Taken.
    expect(skippedToday.now?.mode).toBe("next");

    const skippedOpen = view([...everythingBefore, skipped(keyB("2026-09-25"), "2026-09-26T15:00:00Z")]);
    expect(skippedOpen.items.filter((i) => i.kind === "open")).toEqual([]);
    expect(skippedOpen.badge).toBe(1);
    expect(pendingDoses([cycle], new Map([[cycle.id, [...everythingBefore, skipped(keyB("2026-09-25"), "2026-09-26T15:00:00Z")]]]), NOON)).toBe(1);
  });

  it("keeps every-N-days doses on the planned time (a Taken re-anchors them)", () => {
    const occurrences = (confirmation: RecordedConfirmation) =>
      scheduleOccurrences({ planId: PLAN_A, timeZone: TORONTO, phases: revision.plans[0].phases }, [confirmation]);
    // Sep 24's dose taken at 07:00 local: Sep 26's moves to 07:00.
    const afterTaken = occurrences(taken(keyA(2), "2026-09-24T11:00:00Z"));
    expect(afterTaken.find((o) => o.key === keyA(3))).toMatchObject({ localDate: "2026-09-26", localTime: "07:00" });
    // Skipped (entered at 07:00): Sep 26's stays at the planned 08:00.
    const afterSkip = occurrences(skipped(keyA(2), "2026-09-24T11:00:00Z"));
    const skippedOne = afterSkip.find((o) => o.key === keyA(2))!;
    expect(skippedOne).toMatchObject({ skipped: true, actualAt: null });
    expect(afterSkip.find((o) => o.key === keyA(3))).toMatchObject({ localDate: "2026-09-26", localTime: "08:00" });
    expect(occurrenceState(skippedOne, NOON)).toBe("skipped");
    expect(isAwaitingConfirmation(skippedOne, NOON)).toBe(false);
    expect(nextDue(afterSkip, "2026-09-24T00:00:00Z")?.key).not.toBe(keyA(2));
  });
});

describe("the Now block", () => {
  it("is the dose due now, else later today, else each plan's next dose", () => {
    expect(view(everythingBefore).now).toEqual({ key: keyA(3), mode: "due" });
    // 06:00 in Toronto: A's 08:00 dose is later today.
    expect(view(everythingBefore, "2026-09-26T10:00:00Z").now).toEqual({ key: keyA(3), mode: "later" });
    const done = view([...everythingBefore, taken(keyA(3), "2026-09-26T12:30:00Z")]);
    expect(done.now).toEqual({ key: keyA(4), mode: "next" });
    expect(done.items.find((i) => i.key === keyA(4))).toMatchObject({ kind: "next", schedule: "every 2 days" });
    expect(done.items.find((i) => i.key === keyB("2026-09-28"))).toMatchObject({ kind: "next", schedule: "Mon, Wed and Fri" });
  });

  it("dates the header and counts the cycle's day", () => {
    const today = view(everythingBefore);
    expect(today).toMatchObject({ shortDate: "Sat, Sep 26", today: "2026-09-26", cycleDay: "Day 7 of 21" });
    expect(todayView({ cycles: [], confirmations: new Map(), peptides, mixtures: new Map(), setups: new Map(), vials: new Map(), now: NOON }).cycleDay).toBeNull();
  });
});

describe("R2's vial after", () => {
  it("counts down from the open vial's estimate, low when under the next planned dose", () => {
    const detail = view(everythingBefore).doses[keyA(3)];
    // The next planned dose of the plans on the mixture, not this one: Sep 28's 0.4 mg.
    expect(detail.vialNextMg).toBe("0.4");
    expect(vialForActual(detail, null)).toEqual({ label: "R-07", strengthMg: "10", remainingMg: "0.7" });
    expect(vialForActual(detail, "2026-09-26T12:00:00Z")).toMatchObject({ label: "R-07" });
    // Before the mixture existed: no vial.
    expect(vialForActual(detail, "2026-08-01T12:00:00Z")).toBeNull();
    // Tracking off (no open vial): nothing.
    const off = todayView({ ...{ cycles: [cycle], confirmations: new Map([[cycle.id, everythingBefore]]), peptides }, mixtures: new Map([[PLAN_A, mixture]]), setups: new Map([[PLAN_A, setupsA]]), vials: new Map(), now: NOON });
    expect(vialForActual(off.doses[keyA(3)], null)).toBeNull();
  });
});

describe("injection sites", () => {
  it("rotates through the eight sites, after the last used one", () => {
    expect(ROTATION).toEqual(["Abdomen L", "Abdomen R", "Thigh L", "Thigh R", "Delt L", "Delt R", "Glute L", "Glute R"]);
    expect(nextSite("Abdomen L")).toBe("Abdomen R");
    expect(nextSite("Thigh R")).toBe("Delt L");
    expect(nextSite("Glute R")).toBe("Abdomen L");
    // No site yet, "Other" or none: the rotation's first.
    for (const site of [null, undefined, "", "Other"]) expect(nextSite(site)).toBe("Abdomen L");
  });

  it("takes the last used site by actual time, then entry time, skipping Other and none", () => {
    const uses = [
      { site: "Thigh L", actualAt: "2026-09-24T12:00:00Z", recordedAt: "2026-09-24T12:00:00Z" },
      { site: "Delt R", actualAt: "2026-09-25T12:00:00Z", recordedAt: "2026-09-26T12:00:00Z" },
      // Entered later but taken earlier (a backdated entry): not the last.
      { site: "Glute L", actualAt: "2026-09-23T12:00:00Z", recordedAt: "2026-09-26T13:00:00Z" },
      { site: "Other", actualAt: "2026-09-26T12:00:00Z" },
      { site: "", actualAt: "2026-09-26T13:00:00Z" },
      // Same actual time: the later entry wins.
      { site: "Abdomen R", actualAt: "2026-09-25T12:00:00Z", recordedAt: "2026-09-26T12:30:00Z" },
    ];
    expect(lastSiteUse(uses)?.site).toBe("Abdomen R");
    expect(lastSiteUse([{ site: "Other", actualAt: "2026-09-26T12:00:00Z" }])).toBeNull();
    // Today's view suggests the next site and names the last one.
    const today = view([...everythingBefore.slice(0, 2), taken(keyA(2), "2026-09-24T12:00:00Z", "Thigh R")]);
    expect(today.sites).toEqual({ suggested: "Delt L", last: { site: "Thigh R", note: "Last: Thigh R, Thu" } });
  });

  it("words when the last site was used", () => {
    expect(lastSiteNote("Thigh R", "2026-09-26", "2026-09-26")).toBe("Last: Thigh R, today");
    expect(lastSiteNote("Thigh R", "2026-09-25", "2026-09-26")).toBe("Last: Thigh R, yesterday");
    expect(lastSiteNote("Thigh R", "2026-09-21", "2026-09-26")).toBe("Last: Thigh R, Mon");
    expect(lastSiteNote("Thigh R", "2026-09-12", "2026-09-26")).toBe("Last: Thigh R, Sep 12");
  });

  it("keeps Other and older records valid; anything else is refused", () => {
    expect(RECORDED_SITES).toContain("Other");
    const form = { amount: "0.4", actual: null, notes: "" };
    for (const site of [...ROTATION, "Other", ""]) expect(confirmFormError({ ...form, site }, "2026-09-26T12:00")).toBeNull();
    expect(confirmFormError({ ...form, site: "Shoulder" }, "2026-09-26T12:00")).toBe("Choose a site from the list.");
  });
});

describe("the day's progress and rail", () => {
  const supplement = (key: string, time: string, state: SupplementRow["state"]): SupplementRow => ({
    key,
    kind: "supplement",
    title: key,
    sub: "",
    status: "",
    detail: null,
    time,
    takenTime: state === "taken" ? time : null,
    amountLabel: "1 capsule",
    state,
  });

  it("counts every item today with the check-in: done (taken or skipped), due, the rest", () => {
    const today = view([...everythingBefore]);
    const supplements = [supplement("D3", "07:30", "taken"), supplement("Mg", "21:00", "later"), supplement("Creatine", "11:00", "due")];
    const progress = dayProgress({ doses: today.items, supplements, checkedIn: false, today: today.today, now: NOON });
    // A (due), three supplements, the check-in.
    expect(progress).toMatchObject({ total: 5, done: 1, label: "1 of 5 done", segments: ["done", "due", "due", "rest", "rest"] });
    // Friday's B dose is overdue: from yesterday.
    expect(progress).toMatchObject({ overdue: 1, overdueLabel: "1 overdue from yesterday" });

    const skippedA = view([...everythingBefore, skipped(keyA(3), "2026-09-26T15:00:00Z")]);
    const after = dayProgress({ doses: skippedA.items, supplements: [], checkedIn: true, today: skippedA.today, now: NOON });
    expect(after).toMatchObject({ total: 2, done: 2, label: "2 of 2 done" });

    // Older overdue doses: just the count.
    const older = view(everythingBefore.filter((c) => c.key !== keyA(2)));
    expect(dayProgress({ doses: older.items, supplements: [], checkedIn: false, today: older.today, now: NOON }).overdueLabel).toBe("2 overdue");
    expect(dayProgress({ doses: [], supplements: [], checkedIn: false, today: "2026-09-26", now: NOON })).toMatchObject({ overdueLabel: null, label: "0 of 1 done" });
  });

  it("lists today's doses and supplements in time order", () => {
    const today = view([...everythingBefore]);
    const rail = dayRail(today.items, [supplement("Mg", "21:00", "later"), supplement("D3", "07:30", "taken"), supplement("Early", "08:00", "due")]);
    expect(rail.map((e) => (e.type === "dose" ? e.dose.peptideName : e.row.key))).toEqual(["D3", "Compound A", "Early", "Mg"]);
    // Unconfirmed and next doses are not on the rail.
    expect(rail.filter((e) => e.type === "dose")).toHaveLength(1);
  });
});

describe("v3 formats", () => {
  it("uses the 12-hour clock and short dates", () => {
    expect([clock12("00:05"), clock12("07:30"), clock12("12:00"), clock12("20:15")]).toEqual(["12:05 AM", "7:30 AM", "12:00 PM", "8:15 PM"]);
    expect(shortDate("2026-09-24")).toBe("Thu, Sep 24");
    expect(wallWhen("2026-09-26T20:00", "2026-09-26")).toBe("8:00 PM");
    expect(wallWhen("2026-09-23T20:00", "2026-09-26")).toBe("Wed 8:00 PM");
  });

  it("counts down to a later dose", () => {
    expect(untilLabel((10 * 60 + 48) * 60_000)).toBe("In 10 h 48 min");
    expect(untilLabel(25 * 60_000)).toBe("In 25 min");
    expect(untilLabel(2 * 3_600_000)).toBe("In 2 h");
    expect(untilLabel(10_000)).toBe("In 1 min");
  });

  it("shows amounts under 1 mg in mcg and the rest in mg, exactly", () => {
    expect(["0.25", "0.4", "0.05", "0.0001", "0.999", "1", "2.5", "10", "0"].map(massLabel)).toEqual([
      "250 mcg",
      "400 mcg",
      "50 mcg",
      "0.1 mcg",
      "999 mcg",
      "1 mg",
      "2.5 mg",
      "10 mg",
      "0 mg",
    ]);
    // Past a vial's contents, and never rounded into another value.
    expect(massLabel("-0.2")).toBe("-200 mcg");
    expect(massLabel("0.1234567")).toBe("123.4567 mcg");
    expect(massLabel("1.0000001")).toBe("≈1 mg");
    expect(massLabel("n/a")).toBe("n/a mg");
    expect([massUnit("0.25"), massUnit("1"), massUnit("0")]).toEqual(["mcg", "mg", "mg"]);
    // The sheet's amount field: typed in the planned dose's unit, sent in mg.
    expect(inMassUnit("0.25", "mcg")).toBe("250");
    expect(inMassUnit("2.5", "mg")).toBe("2.5");
    expect(mgFromUnit("250", "mcg")).toBe("0.25");
    expect(mgFromUnit("1500", "mcg")).toBe("1.5");
    expect(mgFromUnit("0,5", "mcg")).toBe("0.0005");
    expect(mgFromUnit("2.5", "mg")).toBe("2.5");
    expect(mgFromUnit("abc", "mcg")).toBe("abc");
    expect(mgFromUnit(inMassUnit("0.123456789", "mcg"), "mcg")).toBe("0.123456789");
  });
});
