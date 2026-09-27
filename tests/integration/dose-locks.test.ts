// S12: confirm_dose() and concurrent mixture, vial and cycle writes never
// interleave or deadlock. A psql session (as the researcher, via
// request.jwt.claims) runs a writer and holds its transaction open; a call
// sent meanwhile through PostgREST waits for it, then judges what committed:
// a confirmation made from a setup the save replaced or unlinked is refused
// (AP020); a deduction never lands on a vial finished or moved meanwhile,
// and goes to the vial open once the write commits; an edit of a cycle takes
// its plans in id order, as save_mixture does. Owner-level psql, so it runs
// in integration-exclusive (vitest.config.mts).
import { beforeAll, describe, expect, it } from "vitest";
import { getCycle, plansArgument } from "@/lib/cycles/service";
import { getMixture } from "@/lib/mixtures/service";
import { type Client, createCycle, createPeptide, interval, plan, saveCycle, tag } from "../support/cycles";
import { confirmArgsSeen, d, NOON, occurrenceOn } from "../support/doses";
import { ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import { psql, psqlAsync, quote } from "../support/psql";

const researcher = { email: uniqueEmail("s12-locks"), name: "Lock Researcher", role: "researcher" } as const;
const admin = { email: uniqueEmail("s12-locks-admin"), name: "Lock Admin", role: "admin" } as const;
let uid = "";
let db: Client;
let peptideId = "";
let otherPeptideId = "";

beforeAll(async () => {
  uid = await ensureAccount(researcher);
  await ensureAccount(admin);
  db = await signedInClient(researcher.email);
  const adminDb = await signedInClient(admin.email);
  peptideId = await createPeptide(adminDb, `Lock ${tag()}`);
  otherPeptideId = await createPeptide(adminDb, `Lock other ${tag()}`);
});

/** A cycle with today's 08:00 dose due and a 10 mg / 2 mL mixture linked to its plan. */
async function setUp() {
  const cycleId = await createCycle(db, { timeZone: NOON, plans: [plan(peptideId, [interval(d(-2), d(6), "0.4", 2, "08:00")])] });
  const planId = (await ok(db.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan"))[0].id;
  const mixtureId = (await ok(
    db.rpc("save_mixture", { p_peptide_id: peptideId, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] }),
    "mixture",
  ))!;
  const today = await occurrenceOn(db, cycleId, d(0));
  return { cycleId, planId, mixtureId, today, shown: await confirmArgsSeen(db, today) };
}

/** `call` (a function call) as the researcher, in a transaction held open for `seconds` after it returns; its result is `saved`. */
function slowCall(call: string, seconds: number) {
  const claims = JSON.stringify({ sub: uid, role: "authenticated" });
  return psqlAsync(`
    begin;
    set local role authenticated;
    select 'claims', set_config('request.jwt.claims', ${quote(claims)}, true) is not null;
    select 'saved', ${call};
    select 'slept', pg_sleep(${seconds}) is null;
    commit;
  `);
}

/** save_mixture as the researcher in a transaction held open for `seconds` after it returns. */
const slowSave = (args: string, seconds: number) => slowCall(`public.save_mixture(${args})`, seconds);

/** Waits until the psql session is sleeping inside its transaction (so it holds its locks). */
async function holdingLocks(sleep = "pg_sleep(2)") {
  for (let i = 0; i < 100; i++) {
    const out = psql(`select 'n', count(*) from pg_stat_activity where state = 'active' and query like '%${sleep}%' and pid <> pg_backend_pid();`);
    if (out.n !== "0") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The psql session never reached its sleep");
}

async function timed<T>(call: () => Promise<T>) {
  const start = Date.now();
  const value = await call();
  return { value, ms: Date.now() - start };
}

describe("confirm_dose waits for a mixture save on the same plan", () => {
  it("that changes the setup, then refuses the confirmation made from the old one", async () => {
    const { cycleId, planId, mixtureId, shown } = await setUp();
    const v1 = (await getMixture(db, mixtureId))!;
    const save = slowSave(
      `p_peptide_id => ${quote(peptideId)}, p_vial_mg => '10', p_liquid_ml => '4', p_syringe_units => 100, p_line_spacing => '2',
       p_plan_ids => array[${quote(planId)}]::uuid[], p_mixture_id => ${quote(mixtureId)}, p_version => ${v1.version}`,
      2,
    );
    await holdingLocks();
    const confirmed = await timed(() => sqlState(db.rpc("confirm_dose", shown), "confirm during save"));
    expect((await save).saved).toBe(mixtureId);
    // It waited for the save's commit (the plan row lock), then saw the new setup.
    expect(confirmed.ms).toBeGreaterThan(1000);
    expect(confirmed.value).toBe("AP020");
    expect(await ok(serviceClient().from("dose_records").select("id").eq("cycle_id", cycleId), "doses")).toEqual([]);
    // With the page refreshed, the new setup is recorded.
    const fresh = await confirmArgsSeen(db, await occurrenceOn(db, cycleId, d(0)));
    const recorded = (await ok(db.rpc("confirm_dose", fresh), "confirm after refresh")) as unknown as { mixture_version_id: string };
    const versions = await ok(serviceClient().from("mixture_versions").select("id, number").eq("mixture_id", mixtureId).order("number"), "versions");
    expect(recorded.mixture_version_id).toBe(versions[1].id);
  });

  it("that unlinks the plan without locking it, then refuses the setup the plan no longer had", async () => {
    const { cycleId, mixtureId, shown } = await setUp();
    const v1 = (await getMixture(db, mixtureId))!;
    // Saving the mixture for no plan ends this plan's link: save_mixture locks the mixture, not the plan.
    const save = slowSave(
      `p_peptide_id => ${quote(peptideId)}, p_vial_mg => '10', p_liquid_ml => '2', p_syringe_units => 100, p_line_spacing => '2',
       p_plan_ids => '{}'::uuid[], p_mixture_id => ${quote(mixtureId)}, p_version => ${v1.version}`,
      2,
    );
    await holdingLocks();
    const confirmed = await timed(() => sqlState(db.rpc("confirm_dose", shown), "confirm during unlink"));
    expect((await save).saved).toBe(mixtureId);
    // It waited on the mixture row, then found no mixture in effect: not the one it was shown.
    expect(confirmed.ms).toBeGreaterThan(1000);
    expect(confirmed.value).toBe("AP020");
    expect(await ok(serviceClient().from("dose_records").select("id").eq("cycle_id", cycleId), "doses")).toEqual([]);
    const fresh = await confirmArgsSeen(db, await occurrenceOn(db, cycleId, d(0)));
    expect(fresh.p_seen_mixture_version_id).toBeNull();
    expect(await sqlState(db.rpc("confirm_dose", fresh), "confirm after refresh")).toBe("ok");
  });
});

type Deduction = { vial_label: string; amount_mg: string } | null;
const deductionsOf = (vialId: string) => ok(serviceClient().from("personal_vial_deductions").select("id").eq("vial_id", vialId), "deductions");

describe("confirm_dose waits for a vial write on the vial it would deduct from", () => {
  /** setUp with supply tracking on and an open 10 mg vial for the mixture. */
  async function withVial() {
    const base = await setUp();
    await ok(db.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
    const vialId = (await ok(
      db.rpc("save_personal_vial", { p_label: `V-${tag()}`, p_peptide_id: peptideId, p_strength_mg: "10", p_mixture_id: base.mixtureId }),
      "vial",
    ))!;
    return { ...base, vialId };
  }

  it("that finishes it: the dose is recorded, with no deduction from the closed vial", async () => {
    const { cycleId, vialId, shown } = await withVial();
    const finish = slowCall(`public.finish_personal_vial(${quote(vialId)})`, 2);
    await holdingLocks();
    const confirmed = await timed(() => ok(db.rpc("confirm_dose", shown), "confirm during finish"));
    expect((await finish).saved).toBe("t");
    expect(confirmed.ms).toBeGreaterThan(1000);
    const dose = confirmed.value as unknown as { deduction: Deduction; mixture_version_id: string };
    expect(dose.mixture_version_id).toBe(shown.p_seen_mixture_version_id);
    expect(dose.deduction).toBeNull();
    expect(await deductionsOf(vialId)).toEqual([]);
    expect(await ok(serviceClient().from("dose_records").select("id").eq("cycle_id", cycleId), "doses")).toHaveLength(1);
  });

  it("that moves it to another mixture: no deduction from the moved vial", async () => {
    const { vialId, shown } = await withVial();
    const other = (await ok(
      db.rpc("save_mixture", { p_peptide_id: peptideId, p_vial_mg: "10", p_liquid_ml: "5", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [] }),
      "other mixture",
    ))!;
    const move = slowCall(
      `public.save_personal_vial(p_label => 'Moved', p_peptide_id => ${quote(peptideId)}, p_strength_mg => '10', p_mixture_id => ${quote(other)}, p_vial_id => ${quote(vialId)})`,
      2,
    );
    await holdingLocks();
    const confirmed = await timed(() => ok(db.rpc("confirm_dose", shown), "confirm during move"));
    expect((await move).saved).toBe(vialId);
    expect(confirmed.ms).toBeGreaterThan(1000);
    expect((confirmed.value as unknown as { deduction: Deduction }).deduction).toBeNull();
    expect(await deductionsOf(vialId)).toEqual([]);
  });

  it("and deducts from the vial that is open once the write commits", async () => {
    const { mixtureId, vialId, shown } = await withVial();
    // The vial is finished and a new one opened for the mixture while the confirmation waits.
    const label = `N-${tag()}`;
    const swap = psqlAsync(`
      begin;
      set local role authenticated;
      select 'claims', set_config('request.jwt.claims', ${quote(JSON.stringify({ sub: uid, role: "authenticated" }))}, true) is not null;
      select 'finished', public.finish_personal_vial(${quote(vialId)});
      select 'opened', public.save_personal_vial(p_label => ${quote(label)}, p_peptide_id => ${quote(peptideId)}, p_strength_mg => '10', p_mixture_id => ${quote(mixtureId)});
      select 'slept', pg_sleep(2) is null;
      commit;
    `);
    await holdingLocks();
    const confirmed = await timed(() => ok(db.rpc("confirm_dose", shown), "confirm during swap"));
    const opened = (await swap).opened;
    expect(confirmed.ms).toBeGreaterThan(1000);
    expect((confirmed.value as unknown as { deduction: Deduction }).deduction).toMatchObject({ vial_label: label, amount_mg: "0.4" });
    expect(await deductionsOf(vialId)).toEqual([]);
    expect(await deductionsOf(opened)).toHaveLength(1);
  });
});

describe("save_cycle locks a cycle's plans in id order", () => {
  it("so a writer taking them by id (as save_mixture does) never deadlocks with an edit", async () => {
    // Plans whose insertion (row) order is the reverse of their id order: an
    // update in row order would take the higher id first.
    let cycleId = "";
    let low = "";
    let high = "";
    for (let tries = 0; tries < 20 && !cycleId; tries++) {
      const id = await createCycle(db, {
        timeZone: NOON,
        plans: [plan(peptideId, [interval(d(3), d(9), "0.4", 2, "08:00")]), plan(otherPeptideId, [interval(d(3), d(9), "0.4", 2, "08:00")])],
      });
      const order = psql(`
        select 'first', id from public.cycle_plans where cycle_id = ${quote(id)} order by ctid limit 1;
        select 'low', id from public.cycle_plans where cycle_id = ${quote(id)} order by id limit 1;
        select 'high', id from public.cycle_plans where cycle_id = ${quote(id)} order by id desc limit 1;`);
      if (order.first === order.high) [cycleId, low, high] = [id, order.low, order.high];
    }
    expect(cycleId).not.toBe("");

    // Another writer: the lower plan, a pause, then the higher one.
    const writer = psqlAsync(`
      begin;
      select 'low', id from public.cycle_plans where id = ${quote(low)} for no key update;
      select 'slept', pg_sleep(1.5) is null;
      select 'high', id from public.cycle_plans where id = ${quote(high)} for no key update;
      commit;`);
    await holdingLocks("pg_sleep(1.5)");
    const cycle = (await getCycle(db, cycleId))!;
    const plans = cycle.revisions[0].plans.map((p) => ({
      ...p,
      effectiveFrom: d(0),
      phases: p.phases.map((phase) => (phase.kind === "active" ? { ...phase, doseMg: "0.5" } : phase)),
    }));
    const edit = await timed(() => sqlState(saveCycle(db, { cycleId, version: cycle.version, timeZone: NOON, plans: plansArgument(plans) as unknown[] }), "edit"));
    expect(await writer).toMatchObject({ low, high });
    expect(edit.value).toBe("ok");
    expect(edit.ms).toBeGreaterThan(700);
    expect((await getCycle(db, cycleId))!.revisions).toHaveLength(2);
  });
});
