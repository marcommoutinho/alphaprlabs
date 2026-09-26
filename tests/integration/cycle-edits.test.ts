// S9 review fixes, in the database, through direct calls to save_cycle() as
// the signed-in researcher (what the app would never send): the effective
// date rule (a change starts today only while none of the plan's doses today
// is due, old or new), "started" meaning the first dose time has passed, the
// cycle version as the concurrency token (metadata-only saves included), and
// time changes stored and checked like dose changes. Against the real local
// Supabase.
//
// The cycles use a fixed-offset zone where it is about 12:00 now, so a dose
// at 08:00 today is due and one at 20:00 is not, whenever the test runs.
import { beforeAll, describe, expect, it } from "vitest";
import { editWindow, reviseCycle } from "@/lib/cycles/revise";
import { formOfCycle, validateCycle } from "@/lib/cycles/rules";
import { getCycle, listCyclePeptides, plansArgument, saveCycle as saveRevision } from "@/lib/cycles/service";
import { type Client, createCycle, createPeptide, day, interval, plan, saveCycle, tag, weekdays } from "../support/cycles";
import { ensureAccount, ok, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const alex = { email: uniqueEmail("s9-edit-alex"), name: "S9 Edit Alex" };
const admin = { email: uniqueEmail("s9-edit-admin"), name: "S9 Edit Admin" };
let alexDb: Client;
const peptide = { a: "", b: "", c: "" };

/** An IANA fixed-offset zone where the local time now is 12:xx (Etc/GMT signs are inverted). */
const NOON = (() => {
  const offset = 12 - new Date().getUTCHours();
  return offset === 0 ? "Etc/GMT" : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
})();
const d = (days: number) => day(days, NOON);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...alex, role: "researcher" });
  const adminDb = await signedInClient(admin.email);
  alexDb = await signedInClient(alex.email);
  const t = tag();
  peptide.a = await createPeptide(adminDb, `Edit A ${t}`);
  peptide.b = await createPeptide(adminDb, `Edit B ${t}`);
  peptide.c = await createPeptide(adminDb, `Edit C ${t}`);
});

type PlanArg = { plan_id: string | null; effective_from: string | null; phases: Record<string, unknown>[] };

/** The cycle's current plans as save_cycle() arguments, each effective from `from` (per plan id, or all). */
async function current(cycleId: string, from: string | ((planId: string) => string)) {
  const cycle = (await getCycle(alexDb, cycleId))!;
  const revision = cycle.revisions[cycle.revisions.length - 1];
  const plans = revision.plans.map((p) => ({ ...p, effectiveFrom: typeof from === "string" ? from : from(p.planId) }));
  return { version: cycle.version, plans: plansArgument(plans) as PlanArg[], cycle };
}

describe("the effective date rule, in the database", () => {
  it("starts a change today only while none of the plan's doses today is due", async () => {
    // A: every day at 08:00 (today's is due). B: every day at 20:00 (today's is ahead).
    const id = await createCycle(alexDb, {
      timeZone: NOON,
      plans: [plan(peptide.a, [weekdays(d(-10), d(20), ALL_DAYS, "1", "08:00")]), plan(peptide.b, [interval(d(-10), d(20), "1", 1, "20:00")])],
    });
    const edit = async (from: string, change: (plans: PlanArg[]) => void) => {
      const { version, plans } = await current(id, from);
      change(plans);
      return sqlState(saveCycle(alexDb, { cycleId: id, version, timeZone: NOON, plans }), `edit from ${from}`);
    };
    const doseA = (from: string) => (plans: PlanArg[]) => void (plans[0].phases[0].dose_changes = [{ from, dose_mg: "2" }]);

    // A dose change from today would rewrite today's 08:00 dose, already due.
    expect(await edit(d(0), doseA(d(0)))).toBe("AP009");
    // Even left unchanged, A can't take today as its effective date.
    expect(await edit(d(0), () => {})).toBe("AP009");
    // B's 20:00 dose is ahead: its change may start today (A's from tomorrow).
    const planA = (await current(id, d(1))).plans[0].plan_id;
    const withB = async (from: string, change: (phase: Record<string, unknown>) => void) => {
      const { version, plans } = await current(id, (planId) => (planId === planA ? d(1) : from));
      change(plans[1].phases[0]);
      return sqlState(saveCycle(alexDb, { cycleId: id, version, timeZone: NOON, plans }), "edit B");
    };
    expect(await withB(d(0), (phase) => void (phase.dose_changes = [{ from: d(0), dose_mg: "1.5" }]))).toBe("ok");
    // Moving B's time to 09:00 from today would introduce a dose already due.
    expect(await withB(d(0), (phase) => void (phase.time_changes = [{ from: d(0), local_time: "09:00" }]))).toBe("AP009");
    expect(await withB(d(0), (phase) => void (phase.time_changes = [{ from: d(0), local_time: "21:00" }]))).toBe("ok");
    // A's change from tomorrow is fine.
    expect(await edit(d(1), doseA(d(1)))).toBe("ok");

    const saved = (await getCycle(alexDb, id))!;
    expect(saved.currentRevision).toBe(4);
    const [a, b] = saved.revisions[3].plans;
    expect(a.phases[0]).toMatchObject({ doseChanges: [{ from: d(1), doseMg: "2" }] });
    expect(b.phases[0]).toMatchObject({ time: "20:00", doseChanges: [{ from: d(0), doseMg: "1.5" }], timeChanges: [{ from: d(0), time: "21:00" }] });
  });

  it("never lets a peptide whose first dose time has passed be removed, even one that started today", async () => {
    // C started today at 08:00 (due); D starts today at 20:00 (ahead); E starts tomorrow.
    const id = await createCycle(alexDb, {
      timeZone: NOON,
      plans: [
        plan(peptide.a, [interval(d(0), d(10), "1", 1, "08:00")]),
        plan(peptide.b, [interval(d(0), d(10), "1", 1, "20:00")]),
        plan(peptide.c, [interval(d(1), d(10), "1", 1, "08:00")]),
      ],
    });
    const { version, plans, cycle } = await current(id, d(1));
    const [c, dPlan, e] = plans;
    expect(await sqlState(saveCycle(alexDb, { cycleId: id, version, timeZone: NOON, plans: [dPlan, e] }), "remove C")).toBe("AP009");
    expect(await sqlState(saveCycle(alexDb, { cycleId: id, version, timeZone: NOON, plans: [c, e] }), "remove D")).toBe("ok");
    const after = (await getCycle(alexDb, id))!;
    expect(after.revisions[1].plans.map((p) => p.peptideId)).toEqual([peptide.a, peptide.c]);
    expect(after.revisions[0]).toEqual(cycle.revisions[0]);
  });
});

describe("the app and the database agree on the effective date across time zone changes", () => {
  it("saves every edit the app accepts, with the effective dates it chose", async () => {
    // Fixed offsets from UTC+14 to UTC-12 now: keys land on different local dates on each side of the seam.
    const zones = ["Etc/GMT-14", "Etc/GMT-9", "Etc/GMT-3", "Etc/GMT", "Etc/GMT+5", "Etc/GMT+12", NOON];
    let saved = 0;
    for (let n = 0; n < 10; n++) {
      const from = zones[n % zones.length];
      const to = zones[(n * 3 + 2) % zones.length];
      const time = ["01:00", "08:00", "12:30", "20:00", "23:30"][n % 5];
      const phase = n % 2 ? weekdays(day(-3, from), day(10, from), ALL_DAYS, "1", time) : interval(day(-3, from), day(10, from), "1", 1, time);
      const id = await createCycle(alexDb, { timeZone: from, plans: [plan(peptide.a, [phase])] });
      const cycle = (await getCycle(alexDb, id))!;
      const now = new Date();
      const form = formOfCycle(cycle, editWindow(cycle.revisions, now).effective, day(0, from));
      form.timeZone = to;
      form.plans[0].phases[0].mg = "2";
      const valid = validateCycle(form, await listCyclePeptides(alexDb));
      if (!valid.ok) throw new Error(valid.errors.join("; "));
      const revision = reviseCycle(cycle.revisions, valid.value, now);
      if (!revision.ok) continue;
      expect(await saveRevision(alexDb, valid.value, revision.plans), `${from} -> ${to} at ${time}`).toEqual({ kind: "saved", id });
      saved++;
    }
    expect(saved).toBeGreaterThanOrEqual(8);
  });
});

describe("the cycle version is the concurrency token", () => {
  it("advances on every successful save, metadata-only included, and refuses the older one", async () => {
    const id = await createCycle(alexDb, { name: "Two editors", timeZone: NOON, plans: [plan(peptide.a, [interval(d(3), d(9))])] });
    const opened = await current(id, d(1));
    expect(opened.version).toBe(1);
    const base = { cycleId: id, timeZone: NOON, plans: opened.plans };
    // The first editor renames it: no schedule change, still a new version.
    expect(await ok(saveCycle(alexDb, { ...base, name: "First editor", version: 1 }), "first")).toBe(id);
    expect(await getCycle(alexDb, id)).toMatchObject({ name: "First editor", currentRevision: 1, version: 2 });
    // The second editor opened version 1 too: refused, and nothing changes.
    expect(await sqlState(saveCycle(alexDb, { ...base, name: "Second editor", goal: "Other", version: 1 }), "second")).toBe("AP010");
    expect(await getCycle(alexDb, id)).toMatchObject({ name: "First editor", goal: "Recomposition", version: 2 });
    // An unchanged save advances it too.
    expect(await ok(saveCycle(alexDb, { ...base, name: "First editor", version: 2 }), "unchanged")).toBe(id);
    expect(await sqlState(saveCycle(alexDb, { ...base, name: "First editor", version: 2 }), "again")).toBe("AP010");
    expect(await getCycle(alexDb, id)).toMatchObject({ currentRevision: 1, version: 3 });
    // Missing version on an edit: refused.
    expect(await sqlState(saveCycle(alexDb, { ...base }), "no version")).toBe("AP010");
  });
});

describe("time changes (Marco, 2026-09-26: the rhythm stays, only the clock time moves)", () => {
  it("are stored, read back, and checked like dose changes", async () => {
    const id = await createCycle(alexDb, { timeZone: NOON, plans: [plan(peptide.a, [interval(d(-4), d(20), "1", 2, "20:00")])] });
    const edit = async (from: string, change: (phase: Record<string, unknown>) => void) => {
      const { version, plans } = await current(id, from);
      change(plans[0].phases[0]);
      return sqlState(saveCycle(alexDb, { cycleId: id, version, timeZone: NOON, plans }), `edit from ${from}`);
    };
    for (const [label, times] of [
      ["an invalid time", [{ from: d(2), local_time: "25:00" }]],
      ["on the phase start", [{ from: d(-4), local_time: "09:00" }]],
      ["after the phase end", [{ from: d(21), local_time: "09:00" }]],
      ["two on one date", [{ from: d(2), local_time: "09:00" }, { from: d(2), local_time: "10:00" }]],
      ["a time as a number", [{ from: d(2), local_time: 9 }]],
    ] as const) {
      expect(await edit(d(1), (phase) => void (phase.time_changes = times)), label).toBe("22023");
    }
    // Changing the phase's own time instead of adding a time change would rewrite earlier doses.
    expect(await edit(d(1), (phase) => void (phase.local_time = "21:00")), "base time").toBe("AP009");
    expect(await edit(d(1), (phase) => void (phase.time_changes = [{ from: d(1), local_time: "07:15" }])), "from tomorrow").toBe("ok");
    const saved = (await getCycle(alexDb, id))!;
    expect(saved.revisions[1].plans[0].phases[0]).toMatchObject({ time: "20:00", timeChanges: [{ from: d(1), time: "07:15" }] });
    // A later edit must keep the time changes before its effective date.
    expect(await edit(d(2), (phase) => void (phase.time_changes = [])), "dropping an earlier change").toBe("AP009");
    expect(await edit(d(2), (phase) => void (phase.time_changes = [{ from: d(1), local_time: "07:15" }, { from: d(2), local_time: "06:00" }])), "adding").toBe("ok");
  });
});
