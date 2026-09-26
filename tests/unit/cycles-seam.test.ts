// The seam between revisions (src/lib/cycles/schedule.ts): a revision takes
// over a plan at one instant, the start of its effective date in its own
// zone, and each occurrence key belongs to exactly one revision. Checked on
// the review's example (Tokyo to Los Angeles after an early confirmation)
// and as a property over random plans, time zone changes (DST included),
// late, early and backdated confirmations, and chained edits: no occurrence
// is dropped or duplicated, and nothing due or confirmed ever changes.
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { editWindow, reviseCycle, type RevisedPlan } from "@/lib/cycles/revise";
import { type CycleRecord, type CycleRevision, formOfCycle, validateCycle } from "@/lib/cycles/rules";
import { cycleOccurrences, seamOf } from "@/lib/cycles/schedule";
import { type Confirmation, type Occurrence, type Phase, type Schedule, scheduleOccurrences } from "@/lib/schedule/engine";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PEPTIDE = uuid(900);
const PLAN = uuid(1);
const peptides = [{ id: PEPTIDE, name: "Compound A", available: true }];

const record = (revisions: CycleRevision[]): CycleRecord => ({
  id: uuid(500),
  ownerId: uuid(600),
  name: "Seam",
  goal: "Checks",
  baseline: "",
  templateId: null,
  templateName: "",
  templateGuidance: "",
  templateUpdatedAt: null,
  currentRevision: revisions.length,
  version: revisions.length,
  createdAt: revisions[0].createdAt,
  updatedAt: revisions[0].createdAt,
  revisions,
});

function stored(plans: RevisedPlan[], number: number, timeZone: string, createdAt: string): CycleRevision {
  let n = 1000 * number;
  return {
    id: uuid(100 + number),
    number,
    timeZone,
    createdAt,
    plans: plans.map((plan) => ({
      planId: plan.planId ?? uuid(n++),
      peptideId: plan.peptideId,
      effectiveFrom: plan.effectiveFrom,
      phases: plan.phases.map((phase) => ({ ...phase, id: phase.id ?? uuid(n++) }) as Phase),
    })),
  };
}

/** Edits the current revision through the builder's form as of `now`. */
function editCycle(revisions: CycleRevision[], now: string, change: (form: ReturnType<typeof formOfCycle>) => void, confirmations: Confirmation[]) {
  const current = revisions[revisions.length - 1];
  const form = formOfCycle(record(revisions), editWindow(revisions, now, confirmations).effective, current.plans[0].phases[0].start);
  change(form);
  const valid = validateCycle(form, peptides);
  if (!valid.ok) throw new Error(`Invalid form: ${valid.errors.join("; ")}`);
  return reviseCycle(revisions, valid.value, now, confirmations);
}

const at = (o: Occurrence) => Temporal.Instant.from(o.scheduledAt);
const settled = (o: Occurrence, now: string) => o.actualAt !== null || Temporal.Instant.compare(at(o), Temporal.Instant.from(now)) <= 0;
const same = (o: Occurrence) => `${o.key} ${o.scheduledAt} ${o.doseMg} ${o.actualAt ?? "-"}`;

/** The seam's guarantees for `next` taking over from `revisions` at `now`. */
function checkSeam(revisions: CycleRevision[], next: CycleRevision, now: string, confirmations: Confirmation[]) {
  const before = cycleOccurrences(revisions, confirmations);
  const after = cycleOccurrences([...revisions, next], confirmations);
  const plan = next.plans[0];
  const seam = seamOf(plan.effectiveFrom!, next.timeZone);
  const fresh = scheduleOccurrences({ planId: plan.planId, timeZone: next.timeZone, phases: plan.phases }, confirmations);
  // No duplicate.
  expect(new Set(after.map((o) => o.key)).size).toBe(after.length);
  // No drop: every key is the earlier version's before the seam, or the new revision's.
  const kept = before.filter((o) => Temporal.Instant.compare(at(o), seam) < 0);
  const keys = new Set([...kept.map((o) => o.key), ...fresh.map((o) => o.key)]);
  expect(new Set(after.map((o) => o.key))).toEqual(keys);
  // Nothing due or confirmed changes; everything else that changed is ahead and open.
  const afterByKey = new Map(after.map((o) => [o.key, same(o)]));
  for (const o of before.filter((o) => settled(o, now))) expect(afterByKey.get(o.key)).toBe(same(o));
  const beforeSame = new Set(before.map(same));
  for (const o of after.filter((o) => !beforeSame.has(same(o)))) expect(settled(o, now)).toBe(false);
  return after;
}

describe("the review's example: Tokyo to Los Angeles after an early confirmation", () => {
  const revision1: CycleRevision = {
    id: uuid(101),
    number: 1,
    timeZone: "Asia/Tokyo",
    createdAt: "2026-08-20T00:00:00Z",
    plans: [
      {
        planId: PLAN,
        peptideId: PEPTIDE,
        effectiveFrom: null,
        phases: [{ id: uuid(10), kind: "active", start: "2026-09-01", end: "2026-09-30", doseMg: "1", time: "08:00", schedule: { type: "interval", everyDays: 1 } }],
      },
    ],
  };
  // Sep 15's dose taken at 01:00 Tokyo: the next is re-anchored to Sep 16 01:00 Tokyo, which is Sep 15 in Los Angeles.
  const early: Confirmation = { key: `${PLAN}:${uuid(10)}:14`, actualAt: "2026-09-14T16:00:00Z", recordedAt: "2026-09-14T16:00:00Z" };
  const reanchored = `${PLAN}:${uuid(10)}:15`;
  const now = "2026-09-15T17:00:00Z"; // Sep 15 10:00 in Los Angeles; the re-anchored dose was due an hour ago.

  it("keeps the re-anchored dose exactly once, at its Tokyo time", () => {
    const result = editCycle([revision1], now, (form) => void (form.timeZone = "America/Los_Angeles"), [early]);
    expect(result.ok && result.plans[0].effectiveFrom).toBe("2026-09-16");
    if (!result.ok) return;
    const next = stored(result.plans, 2, "America/Los_Angeles", now);
    const after = checkSeam([revision1], next, now, [early]);
    expect(after.filter((o) => o.key === reanchored)).toMatchObject([{ scheduledAt: "2026-09-15T16:00:00Z", localDate: "2026-09-16", timeZone: "Asia/Tokyo" }]);
    // The next dose is the new revision's, a day after in Los Angeles.
    expect(after.find((o) => o.key === `${PLAN}:${uuid(10)}:16`)).toMatchObject({ scheduledAt: "2026-09-16T16:00:00Z", timeZone: "America/Los_Angeles" });
  });
});

// ── Property ──────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONES = [
  "Asia/Tokyo",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/Lisbon",
  "Australia/Lord_Howe",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
  "Asia/Kolkata",
  "UTC",
];
// Around daylight-saving changes: US Mar 8 / Nov 1, EU Mar 29 / Oct 25, Lord Howe Apr 5 / Oct 4.
const STARTS = ["2026-03-01", "2026-03-22", "2026-03-30", "2026-09-26", "2026-10-20", "2026-10-28"];
const TIMES = ["00:30", "01:30", "02:15", "02:30", "08:00", "13:45", "23:30"];

describe("property: across zone changes, DST and late or backdated confirmations", () => {
  it("never drops or duplicates an occurrence, and never changes one that is due or confirmed", () => {
    const random = mulberry32(20260926);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    let revised = 0;
    let chained = 0;

    for (let run = 0; run < 150; run++) {
      const start = Temporal.PlainDate.from(pick(STARTS)).add({ days: int(0, 6) });
      const days = int(8, 24);
      const schedule: Schedule = random() < 0.6 ? { type: "interval", everyDays: int(1, 4) } : { type: "weekdays", days: [1, 3, 5, 6] };
      const phase = { id: uuid(10), kind: "active" as const, start: start.toString(), end: start.add({ days }).toString(), doseMg: "1", time: pick(TIMES), schedule };
      const revision1: CycleRevision = {
        id: uuid(101),
        number: 1,
        timeZone: pick(ZONES),
        createdAt: `${start.subtract({ days: 5 }).toString()}T00:00:00Z`,
        plans: [{ planId: PLAN, peptideId: PEPTIDE, effectiveFrom: null, phases: [phase] }],
      };
      // Confirmations: some doses taken early or late, some recorded days later.
      const planned = scheduleOccurrences({ planId: PLAN, timeZone: revision1.timeZone, phases: [phase] });
      const confirmations: Confirmation[] = [];
      for (const o of planned) {
        if (random() > 0.35) continue;
        const actual = at(o).add({ minutes: int(-6 * 60, 30 * 60) });
        const recorded = actual.add({ minutes: random() < 0.5 ? 0 : int(1, 72 * 60) });
        confirmations.push({ key: o.key, actualAt: actual.toString(), recordedAt: recorded.toString() });
      }
      const now = at(pick(planned)).add({ minutes: int(-20 * 60, 20 * 60) }).toString();
      // Only what was recorded by then exists.
      const recordedBy = (instant: string) =>
        confirmations.filter((c) => Temporal.Instant.compare(Temporal.Instant.from(c.recordedAt as string), Temporal.Instant.from(instant)) <= 0);
      const zone = pick(ZONES);
      const time = pick(TIMES);
      const every = String(int(1, 4));
      const result = editCycle(
        [revision1],
        now,
        (form) => {
          form.timeZone = zone;
          const p = form.plans[0].phases[0];
          if (random() < 0.5) p.time = time;
          if (random() < 0.5) p.mg = "2";
          if (random() < 0.2 && p.schedule === "interval") p.every = every;
        },
        recordedBy(now),
      );
      if (!result.ok) continue;
      revised++;
      const revision2 = stored(result.plans, 2, zone, now);
      checkSeam([revision1], revision2, now, recordedBy(now));

      // A second edit a little later, in yet another zone, after more (late or backdated) confirmations.
      const later = Temporal.Instant.from(now).add({ hours: int(6, 48) }).toString();
      const zone3 = pick(ZONES);
      const second = editCycle(
        [revision1, revision2],
        later,
        (form) => {
          form.timeZone = zone3;
          form.plans[0].phases[form.plans[0].phases.length - 1].mg = "3";
        },
        recordedBy(later),
      );
      if (!second.ok) continue;
      chained++;
      checkSeam([revision1, revision2], stored(second.plans, 3, zone3, later), later, recordedBy(later));
    }
    // The property was exercised, not skipped.
    expect(revised).toBeGreaterThan(100);
    expect(chained).toBeGreaterThan(60);
  });
});
