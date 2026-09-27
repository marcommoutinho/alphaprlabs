// S12: confirm_dose() and a concurrent mixture save never interleave. A psql
// session (as the researcher, via request.jwt.claims) runs save_mixture and
// holds its transaction open; a confirmation sent meanwhile through
// PostgREST waits for it, then judges the setup as committed: refused (AP020)
// when the page showed the setup that the save replaced or unlinked, so no
// dose records a setup the plan no longer had at that time. Owner-level psql,
// so it runs in integration-exclusive (vitest.config.mts).
import { beforeAll, describe, expect, it } from "vitest";
import { getMixture } from "@/lib/mixtures/service";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { confirmArgsSeen, d, NOON, occurrenceOn } from "../support/doses";
import { ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import { psql, psqlAsync, quote } from "../support/psql";

const researcher = { email: uniqueEmail("s12-locks"), name: "Lock Researcher", role: "researcher" } as const;
const admin = { email: uniqueEmail("s12-locks-admin"), name: "Lock Admin", role: "admin" } as const;
let uid = "";
let db: Client;
let peptideId = "";

beforeAll(async () => {
  uid = await ensureAccount(researcher);
  await ensureAccount(admin);
  db = await signedInClient(researcher.email);
  peptideId = await createPeptide(await signedInClient(admin.email), `Lock ${tag()}`);
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

/** save_mixture as the researcher in a transaction held open for `seconds` after it returns. */
function slowSave(args: string, seconds: number) {
  const claims = JSON.stringify({ sub: uid, role: "authenticated" });
  return psqlAsync(`
    begin;
    set local role authenticated;
    select 'claims', set_config('request.jwt.claims', ${quote(claims)}, true) is not null;
    select 'saved', public.save_mixture(${args});
    select 'slept', pg_sleep(${seconds}) is null;
    commit;
  `);
}

/** Waits until the psql session is sleeping inside its transaction (so it holds its locks). */
async function holdingLocks() {
  for (let i = 0; i < 100; i++) {
    const out = psql(`select 'n', count(*) from pg_stat_activity where state = 'active' and query like '%pg_sleep(2)%' and pid <> pg_backend_pid();`);
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
