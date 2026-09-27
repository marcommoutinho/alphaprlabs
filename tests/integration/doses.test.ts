// S12 dose confirmation against the real local Supabase, through PostgREST as
// each signed-in person, exactly as the app calls it: confirm_dose() records
// one dose per request and per occurrence (a retry or a double tap returns
// the recorded result), judges the occurrence from the stored plan and the
// recorded doses (never from client times), refuses future and far-early
// actual times, other people's plans, unknown keys and changed occurrences;
// a backdated every-N-days dose moves the next due time while fixed weekdays
// stay put and old open doses stay confirmable; personal-vial deductions
// happen only while tracking is on, flag a discrepancy without blocking; the
// mixture snapshot is the setup in effect at the actual time.
// Cycles use a fixed-offset zone where it is about 12:00 now (tests/support/doses.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { getMixture } from "@/lib/mixtures/service";
import { type Client, createCycle, createPeptide, interval, plan, tag, weekdays } from "../support/cycles";
import { drawDisplay } from "@/lib/doses/rules";
import { cycleConfirmations, planSetups } from "@/lib/doses/service";
import { setupAt } from "@/lib/doses/setups";
import { confirmArgs, confirmArgsSeen, d, NOON, noonZoneInstant, occurrenceOn, occurrencesOf } from "../support/doses";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const people = {
  alex: { email: uniqueEmail("s12-alex"), name: "Alex Doses", role: "researcher" },
  blair: { email: uniqueEmail("s12-blair"), name: "Blair Other", role: "researcher" },
  una: { email: uniqueEmail("s12-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("s12-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("s12-noah"), name: "Noah Not Granted", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
let peptideA = "";
let peptideB = "";

type Result = { id: string; replayed: boolean; actual_at: string; recorded_at: string; amount_mg: string; mixture_version_id: string | null; deduction: null | { amount_mg: string; remaining_after_mg: string; stock_discrepancy: boolean } };

const confirm = async (who: Client, args: Record<string, unknown>, what = "confirm_dose") =>
  (await ok(who.rpc("confirm_dose", args as never), what)) as unknown as Result | null;

async function planIds(who: Client, cycleId: string) {
  const rows = await ok(who.from("cycle_plans").select("id, peptide_id").eq("cycle_id", cycleId), "plans");
  return new Map(rows.map((row) => [row.peptide_id, row.id]));
}

const doseRows = (cycleId: string) =>
  ok(serviceClient().from("dose_records").select("id, occurrence_key, request_key, mixture_version_id").eq("cycle_id", cycleId), "dose rows");
const deductionsOfVial = (vialId: string) => ok(serviceClient().from("personal_vial_deductions").select("id").eq("vial_id", vialId), "vial deductions");
const deductionRows = (doseIds: string[]) =>
  ok(serviceClient().from("personal_vial_deductions").select("dose_id, amount_mg::text, remaining_after_mg::text, stock_discrepancy").in("dose_id", doseIds), "deductions");

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  const t = tag();
  peptideA = await createPeptide(db.grace, `Dose A ${t}`);
  peptideB = await createPeptide(db.grace, `Dose B ${t}`);
  await ok(db.alex.rpc("grant_support_access", { p_admin_id: id.grace }), "grant grace");
});

describe("one confirmation request records one dose", () => {
  it("returns the recorded result on a retry and for a concurrent double tap, with one deduction", async () => {
    const cycleId = await createCycle(db.alex, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-4), d(20), "0.5", 2, "08:00")])] });
    const planId = (await planIds(db.alex, cycleId)).get(peptideA)!;
    // Tracking on, a mixture for the plan and an open vial for it: confirmations deduct.
    await ok(db.alex.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
    const mixtureId = await ok(
      db.alex.rpc("save_mixture", { p_peptide_id: peptideA, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] }),
      "mixture",
    );
    await ok(db.alex.rpc("save_personal_vial", { p_label: `R-${tag()}`, p_peptide_id: peptideA, p_strength_mg: "10", p_mixture_id: mixtureId }), "vial");

    const today = await occurrenceOn(db.alex, cycleId, d(0));
    const args = await confirmArgsSeen(db.alex, today);
    const first = (await confirm(db.alex, args))!;
    expect(first.replayed).toBe(false);
    expect(first.deduction).toMatchObject({ amount_mg: "0.5", remaining_after_mg: "9.5", stock_discrepancy: false });
    // The same request again (a retry after a lost answer): the recorded dose, nothing new.
    const again = (await confirm(db.alex, args))!;
    expect(again).toMatchObject({ id: first.id, replayed: true, actual_at: first.actual_at, recorded_at: first.recorded_at });

    // A double tap: the same request key twice at once records once.
    const open = await occurrenceOn(db.alex, cycleId, d(-2));
    const tap = confirmArgs(open, { p_actual_at: open.scheduledAt });
    const [x, y] = await Promise.all([confirm(db.alex, tap, "tap 1"), confirm(db.alex, tap, "tap 2")]);
    expect(x!.id).toBe(y!.id);
    expect([x!.replayed, y!.replayed].sort()).toEqual([false, true]);
    // Two taps with different request keys (two devices): one records, the other is refused.
    const older = await occurrenceOn(db.alex, cycleId, d(-4));
    const states = await Promise.all([
      sqlState(db.alex.rpc("confirm_dose", confirmArgs(older, { p_actual_at: older.scheduledAt })), "device 1"),
      sqlState(db.alex.rpc("confirm_dose", confirmArgs(older, { p_actual_at: older.scheduledAt })), "device 2"),
    ]);
    expect(states.sort()).toEqual(["AP018", "ok"]);

    const rows = await doseRows(cycleId);
    expect(rows.map((row) => row.occurrence_key).sort()).toEqual([older.key, open.key, today.key].sort());
    // The two backdated doses were taken before the mixture was linked: no setup then, no deduction.
    const deductions = await deductionRows(rows.map((row) => row.id));
    expect(deductions).toHaveLength(1);
    expect(deductions[0]).toMatchObject({ dose_id: first.id, amount_mg: "0.5" });
  });
});

describe("the actual time", () => {
  it("can be earlier, not in the future, and not more than a day before the planned time", async () => {
    const cycleId = await createCycle(db.alex, { timeZone: NOON, plans: [plan(peptideB, [interval(d(-2), d(20), "1", 2, "08:00")])] });
    const today = await occurrenceOn(db.alex, cycleId, d(0));
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(await sqlState(db.alex.rpc("confirm_dose", confirmArgs(today, { p_actual_at: future })), "future")).toBe("AP021");
    const early = noonZoneInstant(d(-1), "07:59");
    expect(await sqlState(db.alex.rpc("confirm_dose", confirmArgs(today, { p_actual_at: early })), "too early")).toBe("AP022");
    const earlier = noonZoneInstant(d(0), "06:30");
    const recorded = (await confirm(db.alex, confirmArgs(today, { p_actual_at: earlier, p_amount_mg: "0.9", p_site: "Thigh L", p_notes: " fine " })))!;
    expect(Date.parse(recorded.actual_at)).toBe(Date.parse(earlier));
    expect(Date.parse(recorded.recorded_at)).toBeGreaterThan(Date.parse(earlier));
    expect(recorded.amount_mg).toBe("0.9");
    const row = await ok(serviceClient().from("dose_records").select("site, notes, planned_mg::text").eq("id", recorded.id).single(), "row");
    expect(row).toEqual({ site: "Thigh L", notes: "fine", planned_mg: "1" });
    // The views read what was recorded, not only the times.
    expect(await cycleConfirmations(db.alex, cycleId)).toEqual([
      expect.objectContaining({ key: today.key, amountMg: "0.9", site: "Thigh L", notes: "fine" }),
    ]);

    // Invalid inputs change nothing.
    const next = await occurrenceOn(db.alex, cycleId, d(-2));
    for (const bad of [{ p_amount_mg: "0" }, { p_amount_mg: "1,5" }, { p_site: "Arm" }, { p_notes: "x".repeat(1001) }]) {
      expect(await sqlState(db.alex.rpc("confirm_dose", confirmArgs(next, bad)), JSON.stringify(bad).slice(0, 40))).toBe("22023");
    }
    expect((await doseRows(cycleId)).length).toBe(1);
  });
});

describe("the schedule after a confirmation", () => {
  it("moves the next every-N-days dose from a backdated actual time; fixed weekdays stay put; old doses stay open", async () => {
    const cycleId = await createCycle(db.alex, {
      timeZone: NOON,
      plans: [plan(peptideA, [interval(d(-2), d(20), "0.4", 2, "08:00")]), plan(peptideB, [weekdays(d(-3), d(20), [0, 1, 2, 3, 4, 5, 6], "1", "07:15")])],
    });
    const plans = await planIds(db.alex, cycleId);
    const before = await occurrencesOf(db.alex, cycleId);
    const at = (list: typeof before, planId: string, date: string) => list.find((o) => o.planId === planId && o.localDate === date);
    expect(at(before, plans.get(peptideA)!, d(2))?.localTime).toBe("08:00");

    // Today's 08:00 dose, actually taken at 06:10: the next moves to d+2 06:10.
    const today = at(before, plans.get(peptideA)!, d(0))!;
    await confirm(db.alex, confirmArgs(today, { p_actual_at: noonZoneInstant(d(0), "06:10") }));
    // A weekday dose confirmed late with an earlier time: its schedule doesn't move.
    const weekday = at(before, plans.get(peptideB)!, d(-1))!;
    await confirm(db.alex, confirmArgs(weekday, { p_actual_at: noonZoneInstant(d(-1), "09:40") }));

    const after = await occurrencesOf(db.alex, cycleId);
    expect(at(after, plans.get(peptideA)!, d(2))?.localTime).toBe("06:10");
    expect(at(after, plans.get(peptideA)!, d(4))?.localTime).toBe("06:10");
    const weekdayTimes = (list: typeof before) => list.filter((o) => o.planId === plans.get(peptideB)).map((o) => `${o.localDate} ${o.localTime}`);
    expect(weekdayTimes(after)).toEqual(weekdayTimes(before));

    // The old unconfirmed dose (d-2) is still open with its key and time, and still confirmable;
    // confirming it now doesn't rewind the newer dose's rhythm.
    const old = at(after, plans.get(peptideA)!, d(-2))!;
    expect(old).toMatchObject({ key: at(before, plans.get(peptideA)!, d(-2))!.key, localTime: "08:00", actualAt: null });
    await confirm(db.alex, confirmArgs(old, { p_actual_at: noonZoneInstant(d(-2), "08:30") }));
    const last = await occurrencesOf(db.alex, cycleId);
    expect(at(last, plans.get(peptideA)!, d(2))?.localTime).toBe("06:10");

    // Today's confirmed dose can't be confirmed again with a new request.
    expect(await sqlState(db.alex.rpc("confirm_dose", confirmArgs(today)), "again")).toBe("AP018");
  });
});

describe("refusals", () => {
  it("refuses other people's plans, unknown keys, keys outside the current schedule, changed details and later days", async () => {
    const cycleId = await createCycle(db.alex, {
      timeZone: NOON,
      plans: [plan(peptideA, [interval(d(-2), d(6), "0.4", 2, "08:00")]), plan(peptideB, [weekdays(d(-3), d(6), [1, 3, 5], "1", "07:15")])],
    });
    const plans = await planIds(db.alex, cycleId);
    const due = await occurrenceOn(db.alex, cycleId, d(0), plans.get(peptideA));
    const [planA, phase] = due.key.split(":");

    // Another researcher, an admin without a grant, a granted admin: the plan isn't theirs (null, nothing written).
    for (const who of ["blair", "noah", "grace"] as const) expect(await confirm(db[who], confirmArgs(due), who)).toBeNull();
    // An unacknowledged account and an anonymous caller.
    expect(await sqlState(db.una.rpc("confirm_dose", confirmArgs(due)), "una")).toBe("42501");
    expect(await sqlState(anonClient().rpc("confirm_dose", confirmArgs(due)), "anon")).toBe("42501");

    // Keys that are not occurrences of the current schedule.
    // (Mon/Wed/Fri: of the four days d-3..d0 at least one is none of them.)
    const onB = (await occurrencesOf(db.alex, cycleId)).filter((o) => o.planId === plans.get(peptideB));
    const phaseB = onB[0].key.split(":")[1];
    const offDay = [d(-3), d(-2), d(-1), d(0)].find((date) => !onB.some((o) => o.localDate === date))!;
    const outside = {
      "past the phase": `${planA}:${phase}:999`,
      "unknown phase": `${planA}:${crypto.randomUUID()}:1`,
      "a date on an interval phase": `${planA}:${phase}:${d(0)}`,
      "not one of the weekdays": `${plans.get(peptideB)}:${phaseB}:${offDay}`,
    };
    for (const [what, key] of Object.entries(outside)) {
      expect(await sqlState(db.alex.rpc("confirm_dose", confirmArgs(due, { p_occurrence_key: key })), what), what).toBe("AP017");
    }
    // A plan that doesn't exist is nobody's: nothing to confirm.
    expect(await confirm(db.alex, confirmArgs(due, { p_occurrence_key: `${crypto.randomUUID()}:${phase}:1` }))).toBeNull();
    expect(await sqlState(db.alex.rpc("confirm_dose", confirmArgs(due, { p_occurrence_key: "not-a-key" })), "malformed")).toBe("22023");
    // Details that differ from the current occurrence (a stale screen or notification).
    expect(await sqlState(db.alex.rpc("confirm_dose", confirmArgs(due, { p_seen_dose_mg: "0.5" })), "changed dose")).toBe("AP020");
    const moved = new Date(Date.parse(due.scheduledAt) + 3_600_000).toISOString();
    expect(await sqlState(db.alex.rpc("confirm_dose", confirmArgs(due, { p_seen_scheduled_at: moved })), "changed time")).toBe("AP020");
    // A dose on a later day can't be confirmed yet.
    const later = await occurrenceOn(db.alex, cycleId, d(2), plans.get(peptideA));
    expect(await sqlState(db.alex.rpc("confirm_dose", confirmArgs(later)), "later day")).toBe("AP019");
    expect(await doseRows(cycleId)).toEqual([]);

    // Nobody writes the tables directly; reads follow ownership and grants.
    await confirm(db.alex, confirmArgs(due));
    const direct = await sqlState(db.alex.from("dose_records").insert({ occurrence_key: "x" } as never), "direct insert");
    expect(direct).toBe("42501");
    // The schedule function is the dispatcher's (service role), not the app's.
    expect(await sqlState(db.alex.rpc("cycle_plan_occurrences", { p_plan_id: planA }), "schedule function")).toBe("42501");
    const read = (who: Client) => ok(who.from("dose_records").select("id").eq("cycle_id", cycleId), "read");
    expect(await read(db.alex)).toHaveLength(1);
    expect(await read(db.grace)).toHaveLength(1);
    expect(await read(db.blair)).toEqual([]);
    expect(await read(db.noah)).toEqual([]);
  });
});

describe("personal supplies", () => {
  it("records a stock discrepancy without blocking the dose, and deducts nothing while tracking is off", async () => {
    const who = await signedInClient(people.blair.email);
    const cycleId = await createCycle(who, { timeZone: NOON, plans: [plan(peptideB, [interval(d(-6), d(6), "0.4", 2, "08:00")])] });
    const planId = (await planIds(who, cycleId)).get(peptideB)!;
    await ok(who.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
    const mixtureId = await ok(
      who.rpc("save_mixture", { p_peptide_id: peptideB, p_vial_mg: "1", p_liquid_ml: "1", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] }),
      "mixture",
    );
    await ok(who.rpc("save_personal_vial", { p_label: `S-${tag()}`, p_peptide_id: peptideB, p_strength_mg: "1", p_mixture_id: mixtureId }), "vial");

    // Taken now (after the mixture was linked): 1 mg vial, 0.4 mg each.
    const results = [];
    for (const date of [d(-6), d(-4), d(-2)]) results.push((await confirm(who, await confirmArgsSeen(who, await occurrenceOn(who, cycleId, date))))!);
    expect(results.map((r) => r.deduction)).toEqual([
      expect.objectContaining({ remaining_after_mg: "0.6", stock_discrepancy: false }),
      expect.objectContaining({ remaining_after_mg: "0.2", stock_discrepancy: false }),
      expect.objectContaining({ remaining_after_mg: "-0.2", stock_discrepancy: true }),
    ]);

    await ok(who.rpc("set_supply_tracking", { p_enabled: false }), "tracking off");
    const off = (await confirm(who, await confirmArgsSeen(who, await occurrenceOn(who, cycleId, d(0)))))!;
    expect(off.deduction).toBeNull();
    expect(off.mixture_version_id).not.toBeNull();
    expect(await deductionRows([off.id])).toEqual([]);
  });

  it("snapshots the mixture setup in effect at the actual time", async () => {
    const who = await signedInClient(people.blair.email);
    const cycleId = await createCycle(who, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-4), d(6), "0.4", 2, "08:00")])] });
    const planId = (await planIds(who, cycleId)).get(peptideA)!;
    const mixtureId = (await ok(
      who.rpc("save_mixture", { p_peptide_id: peptideA, p_vial_mg: "8", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] }),
      "mixture v1",
    ))!;
    const between = new Date(Date.now() + 1500).toISOString();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const current = await getMixture(who, mixtureId);
    if (!current) throw new Error("mixture not readable");
    await ok(
      who.rpc("save_mixture", {
        p_mixture_id: mixtureId,
        p_version: current.version,
        p_peptide_id: peptideA,
        p_vial_mg: "10",
        p_liquid_ml: "2",
        p_syringe_units: 100,
        p_line_spacing: "2",
        p_plan_ids: [planId],
      }),
      "mixture v2",
    );
    const versions = await ok(who.from("mixture_versions").select("id, number").eq("mixture_id", mixtureId).order("number"), "versions");
    expect(versions).toHaveLength(2);

    const early = (await confirm(who, await confirmArgsSeen(who, await occurrenceOn(who, cycleId, d(0)), { p_actual_at: between })))!;
    const late = (await confirm(who, await confirmArgsSeen(who, await occurrenceOn(who, cycleId, d(-2)))))!;
    const before = (await confirm(who, await confirmArgsSeen(who, await occurrenceOn(who, cycleId, d(-4)), { p_actual_at: noonZoneInstant(d(-4), "08:00") })))!;
    expect(early.mixture_version_id).toBe(versions[0].id);
    expect(late.mixture_version_id).toBe(versions[1].id);
    expect(before.mixture_version_id).toBeNull();
  });
});

describe("the mixture shown", () => {
  it("refuses a confirmation made from a setup that changed since the page showed it", async () => {
    const who = await signedInClient(people.alex.email);
    const cycleId = await createCycle(who, { timeZone: NOON, plans: [plan(peptideB, [interval(d(-2), d(6), "0.4", 2, "08:00")])] });
    const planId = (await planIds(who, cycleId)).get(peptideB)!;
    await ok(who.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
    const setup = { p_peptide_id: peptideB, p_vial_mg: "10", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] };
    const mixtureId = (await ok(who.rpc("save_mixture", { ...setup, p_liquid_ml: "2" }), "mixture v1"))!;
    await ok(who.rpc("save_personal_vial", { p_label: `M-${tag()}`, p_peptide_id: peptideB, p_strength_mg: "10", p_mixture_id: mixtureId }), "vial");

    // Today shows 0.4 mg as 8 units from the 10 mg / 2 mL setup.
    const today = await occurrenceOn(who, cycleId, d(0));
    const shown = await confirmArgsSeen(who, today);
    const shownSegment = setupAt((await planSetups(who, id.alex)).get(planId) ?? [], new Date().toISOString())!;
    expect(shownSegment.versionId).toBe(shown.p_seen_mixture_version_id);
    expect(drawDisplay(shownSegment.setup, "0.4")).toMatchObject({ kind: "units", units: "8" });

    // Another session changes the setup to 10 mg / 4 mL (16 units).
    const elsewhere = await signedInClient(people.alex.email);
    const v1 = (await getMixture(elsewhere, mixtureId))!;
    // An instant before the change, on the database's clock: when the first setup took effect.
    const beforeChange = v1.setupSince;
    await ok(elsewhere.rpc("save_mixture", { ...setup, p_liquid_ml: "4", p_mixture_id: mixtureId, p_version: v1.version }), "mixture v2");

    // The stale page's Taken is refused; nothing is recorded or deducted.
    expect(await sqlState(who.rpc("confirm_dose", shown), "stale setup")).toBe("AP020");
    expect(await doseRows(cycleId)).toEqual([]);
    const vials = await ok(serviceClient().from("personal_vials").select("id").eq("mixture_id", mixtureId), "vial");
    expect(vials).toHaveLength(1);
    expect(await deductionsOfVial(vials[0].id)).toEqual([]);

    // Backdated to before the change, the old setup is the one in effect: accepted with it, refused with the new one.
    const fresh = await confirmArgsSeen(who, today);
    expect(fresh.p_seen_mixture_version_id).not.toBe(shown.p_seen_mixture_version_id);
    expect(await sqlState(who.rpc("confirm_dose", { ...fresh, p_actual_at: beforeChange }), "new setup, earlier time")).toBe("AP020");
    const earlier = (await confirm(who, { ...shown, p_request_key: crypto.randomUUID(), p_actual_at: beforeChange }))!;
    expect(earlier.mixture_version_id).toBe(shown.p_seen_mixture_version_id);
    expect(earlier.deduction).toMatchObject({ amount_mg: "0.4", remaining_after_mg: "9.6" });
    // After a refresh the new setup is shown and recorded.
    const recorded = (await confirm(who, await confirmArgsSeen(who, await occurrenceOn(who, cycleId, d(-2)))))!;
    expect(recorded.mixture_version_id).toBe(fresh.p_seen_mixture_version_id);
    expect(await deductionsOfVial(vials[0].id)).toHaveLength(2);
  });
});
