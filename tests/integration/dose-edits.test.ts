// S12: cycle edits respect recorded doses. save_cycle()'s effective-date rule
// and its "started" check (a plan with a due or confirmed dose can't be
// removed) now read the schedule with the recorded doses, and the app's
// editWindow/reviseCycle, given the same confirmations, choose what the
// database accepts. Through PostgREST, in a zone where it is about 12:00 now.
import { beforeAll, describe, expect, it } from "vitest";
import { editWindow, reviseCycle } from "@/lib/cycles/revise";
import { formOfCycle, validateCycle } from "@/lib/cycles/rules";
import { getCycle, listCyclePeptides, plansArgument, saveCycle as saveRevision } from "@/lib/cycles/service";
import { cycleConfirmations } from "@/lib/doses/service";
import { type Client, createCycle, createPeptide, interval, plan, saveCycle, tag, weekdays } from "../support/cycles";
import { confirmArgs, d, NOON, noonZoneInstant, occurrenceOn, occurrencesOf } from "../support/doses";
import { ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const alex = { email: uniqueEmail("s12-edit-alex"), name: "S12 Edit Alex", role: "researcher" } as const;
const admin = { email: uniqueEmail("s12-edit-admin"), name: "S12 Edit Admin", role: "admin" } as const;
let db: Client;
const peptide = { a: "", b: "" };

beforeAll(async () => {
  await ensureAccount(admin);
  await ensureAccount(alex);
  const adminDb = await signedInClient(admin.email);
  db = await signedInClient(alex.email);
  const t = tag();
  peptide.a = await createPeptide(adminDb, `Dose edit A ${t}`);
  peptide.b = await createPeptide(adminDb, `Dose edit B ${t}`);
});

type PlanArg = { plan_id: string | null; peptide_id: string; effective_from: string | null; phases: Record<string, unknown>[] };

/** The cycle's current plans as save_cycle() arguments, each effective from `from`. */
async function current(cycleId: string, from: string) {
  const cycle = (await getCycle(db, cycleId))!;
  const revision = cycle.revisions[cycle.revisions.length - 1];
  const plans = revision.plans.map((p) => ({ ...p, effectiveFrom: from }));
  return { version: cycle.version, plans: plansArgument(plans) as PlanArg[], cycle };
}

const edit = async (cycleId: string, from: string, change: (plans: PlanArg[]) => PlanArg[] | void) => {
  const { version, plans } = await current(cycleId, from);
  const changed = change(plans) ?? plans;
  return sqlState(saveCycle(db, { cycleId, version, timeZone: NOON, plans: changed }), `edit from ${from}`);
};
const doseChange = (from: string) => (plans: PlanArg[]) => void (plans[0].phases[0].dose_changes = [{ from, dose_mg: "2" }]);

describe("save_cycle with recorded doses", () => {
  it("won't remove a plan whose dose was confirmed early, before its first planned time", async () => {
    // A is due (08:00 passed). B starts today at 20:00; its dose is taken early, at 12:xx.
    const id = await createCycle(db, {
      timeZone: NOON,
      plans: [plan(peptide.a, [interval(d(-1), d(10), "1", 1, "08:00")]), plan(peptide.b, [interval(d(0), d(10), "1", 1, "20:00")])],
    });
    const b = await occurrenceOn(db, id, d(0), (await current(id, d(1))).plans[1].plan_id!);
    await ok(db.rpc("confirm_dose", confirmArgs(b)), "confirm B early");
    const cycle = (await getCycle(db, id))!;
    const confirmations = await cycleConfirmations(db, id);
    expect(confirmations).toHaveLength(1);
    expect(editWindow(cycle.revisions, new Date(), confirmations).started.has(b.planId)).toBe(true);
    expect(editWindow(cycle.revisions, new Date()).started.has(b.planId)).toBe(false);

    expect(await edit(id, d(1), (plans) => [plans[0]]), "remove B").toBe("AP009");
    expect((await getCycle(db, id))!.revisions).toHaveLength(1);
  });

  it("moves the effective date past a dose confirmed today, or one a backdated dose made due", async () => {
    // A: today's 20:00 dose taken early. B: every 2 days at 20:00 from d-2, taken at 09:00 that
    // day, so today's dose moved to 09:00 and is due.
    const id = await createCycle(db, {
      timeZone: NOON,
      plans: [plan(peptide.a, [interval(d(-3), d(10), "1", 1, "20:00")])],
    });
    const other = await createCycle(db, { timeZone: NOON, plans: [plan(peptide.b, [interval(d(-2), d(10), "1", 2, "20:00")])] });

    // Before any confirmation, both may change from today.
    for (const cycleId of [id, other]) {
      const cycle = (await getCycle(db, cycleId))!;
      expect([...editWindow(cycle.revisions, new Date(), await cycleConfirmations(db, cycleId)).effective.values()]).toEqual([d(0)]);
    }

    await ok(db.rpc("confirm_dose", confirmArgs(await occurrenceOn(db, id, d(0)))), "confirm A early");
    const backdated = await occurrenceOn(db, other, d(-2));
    await ok(db.rpc("confirm_dose", confirmArgs(backdated, { p_actual_at: noonZoneInstant(d(-2), "09:00") })), "confirm B backdated");
    expect((await occurrenceOn(db, other, d(0))).localTime).toBe("09:00");

    for (const cycleId of [id, other]) {
      expect(await edit(cycleId, d(0), doseChange(d(0))), "from today").toBe("AP009");
      expect(await edit(cycleId, d(0), () => {}), "unchanged from today").toBe("AP009");

      // The app, given the recorded doses, starts the change tomorrow, and the database takes it.
      const cycle = (await getCycle(db, cycleId))!;
      const confirmations = await cycleConfirmations(db, cycleId);
      const now = new Date();
      const window = editWindow(cycle.revisions, now, confirmations);
      expect([...window.effective.values()]).toEqual([d(1)]);
      expect([...editWindow(cycle.revisions, now).effective.values()]).toEqual([d(0)]);
      const form = formOfCycle(cycle, window.effective, d(0));
      form.plans[0].phases[0].mg = "2";
      const valid = validateCycle(form, await listCyclePeptides(db));
      if (!valid.ok) throw new Error(valid.errors.join("; "));
      const revision = reviseCycle(cycle.revisions, valid.value, now, confirmations);
      if (!revision.ok) throw new Error(JSON.stringify(revision.issues));
      expect(revision.plans.map((p) => p.effectiveFrom)).toEqual([d(1)]);
      // Without the recorded doses the app would pick today, which the database refuses.
      const blind = reviseCycle(cycle.revisions, valid.value, now);
      if (!blind.ok) throw new Error(JSON.stringify(blind.issues));
      expect(blind.plans.map((p) => p.effectiveFrom)).toEqual([d(0)]);
      expect(await sqlState(db.rpc("save_cycle", saveArgs(cycle.version, cycleId, blind.plans)), "blind")).toBe("AP009");
      expect(await saveRevision(db, valid.value, revision.plans)).toEqual({ kind: "saved", id: cycleId });
    }
    // The recorded doses keep their keys: today's A dose is still confirmed under the new revision.
    expect((await occurrenceOn(db, id, d(0))).actualAt).not.toBeNull();
  });
});

describe("the database's schedule of a real cycle matches the app's", () => {
  it("across revisions, time and dose changes, and recorded doses", async () => {
    const id = await createCycle(db, {
      timeZone: NOON,
      plans: [plan(peptide.a, [interval(d(-6), d(12), "0.5", 2, "08:00")]), plan(peptide.b, [weekdays(d(-5), d(12), [0, 1, 2, 3, 4, 5, 6], "1", "07:15")])],
    });
    const planIds = (await current(id, d(1))).plans.map((p) => p.plan_id!);
    // Backdated, late and early doses before the edit.
    await ok(db.rpc("confirm_dose", confirmArgs(await occurrenceOn(db, id, d(-6), planIds[0]), { p_actual_at: noonZoneInstant(d(-6), "06:00") })), "a -6");
    await ok(db.rpc("confirm_dose", confirmArgs(await occurrenceOn(db, id, d(-3), planIds[1]), { p_actual_at: noonZoneInstant(d(-3), "10:30") })), "b -3");
    // An edit from tomorrow: A's dose and time change, B's time changes later on.
    expect(
      await edit(id, d(1), (plans) => {
        plans[0].phases[0].dose_changes = [{ from: d(3), dose_mg: "0.75" }];
        plans[0].phases[0].time_changes = [{ from: d(2), local_time: "21:00" }];
        plans[1].phases[0].time_changes = [{ from: d(4), local_time: "06:45" }];
      }),
    ).toBe("ok");
    // More doses after the edit, one taken early today.
    await ok(db.rpc("confirm_dose", confirmArgs(await occurrenceOn(db, id, d(-2), planIds[0]))), "a -2 late");
    await ok(db.rpc("confirm_dose", confirmArgs(await occurrenceOn(db, id, d(0), planIds[1]))), "b 0");

    const app = (await occurrencesOf(db, id)).map((o) => `${o.key}@${Date.parse(o.scheduledAt)}@${o.actualAt ? Date.parse(o.actualAt) : "-"}@${o.doseMg}@${o.localDate}`);
    const database: string[] = [];
    for (const planId of planIds) {
      const rows = await ok(serviceClient().rpc("cycle_plan_occurrences", { p_plan_id: planId }), "cycle_plan_occurrences");
      for (const o of rows) {
        database.push(`${o.occurrence_key}@${Date.parse(o.scheduled_at!)}@${o.actual_at ? Date.parse(o.actual_at) : "-"}@${o.dose_mg}@${o.local_date}`);
      }
    }
    expect(database.sort()).toEqual(app.sort());
    // Not vacuous: four recorded doses, the edit's changes and a moved rhythm are all in there.
    expect(app.filter((row) => !row.includes("@-@"))).toHaveLength(4);
    const after = await occurrencesOf(db, id);
    expect(after.some((o) => o.doseMg === "0.75")).toBe(true);
    expect(after.some((o) => o.planId === planIds[1] && o.localTime === "06:45")).toBe(true);
    expect(after.filter((o) => o.planId === planIds[0] && o.localDate > d(0)).map((o) => o.localTime)).not.toContain("08:00");
    expect(app.length).toBeGreaterThan(20);
  });
});

/** save_cycle arguments for revised plans, as the service sends them. */
function saveArgs(version: number, cycleId: string, plans: Parameters<typeof plansArgument>[0]) {
  return { p_name: `Blind ${tag()}`, p_goal: "Recomposition", p_baseline: "", p_time_zone: NOON, p_plans: plansArgument(plans), p_cycle_id: cycleId, p_version: version } as never;
}
