// S14: reopen_personal_vial never interleaves or deadlocks with the writers
// that meet it on a mixture. A psql session (as the researcher, via
// request.jwt.claims) runs one writer and holds its transaction open; the
// other, sent meanwhile through PostgREST, waits for it and then judges what
// committed (tests/integration/dose-locks.test.ts's pattern), in both orders:
//   * confirm_dose: a dose confirmed while the vial reopens deducts from it
//     once the reopen commits; a reopen during a confirmation waits for it;
//   * save_personal_vial opening another vial on the same mixture: exactly
//     one open vial on the mixture results;
//   * delete_mixture: the vial ends open and unlinked, never linked to a
//     deleted mixture.
// Owner-level psql, so it runs in integration-exclusive (vitest.config.mts).
import { beforeAll, describe, expect, it } from "vitest";
import { getMixture } from "@/lib/mixtures/service";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { confirmArgsSeen, d, NOON, occurrenceOn } from "../support/doses";
import { ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import { HOLD_FUNCTION, holdingLocks, holdUntilWaited, psqlAsync, quote } from "../support/psql";

const researcher = { email: uniqueEmail("s14-locks"), name: "Supply Lock Researcher", role: "researcher" } as const;
const admin = { email: uniqueEmail("s14-locks-admin"), name: "Supply Lock Admin", role: "admin" } as const;
let uid = "";
let db: Client;
let peptideId = "";

beforeAll(async () => {
  uid = await ensureAccount(researcher);
  await ensureAccount(admin);
  db = await signedInClient(researcher.email);
  peptideId = await createPeptide(await signedInClient(admin.email), `Supply lock ${tag()}`);
  await ok(db.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
});

/** A 10 mg mixture (linked to a cycle plan whose 08:00 dose is due today, or to none) and a finished vial on it. */
async function setUp(linked: boolean) {
  let planId: string | null = null;
  let cycleId = "";
  if (linked) {
    cycleId = await createCycle(db, { timeZone: NOON, plans: [plan(peptideId, [interval(d(-2), d(6), "0.4", 2, "08:00")])] });
    planId = (await ok(db.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan"))[0].id;
  }
  const mixtureId = (await ok(
    db.rpc("save_mixture", {
      p_peptide_id: peptideId,
      p_vial_mg: "10",
      p_liquid_ml: "2",
      p_syringe_units: 100,
      p_line_spacing: "2",
      p_plan_ids: planId ? [planId] : [],
    }),
    "mixture",
  ))!;
  const vialId = (await ok(db.rpc("save_personal_vial", { p_label: `R-${tag()}`, p_peptide_id: peptideId, p_strength_mg: "10", p_mixture_id: mixtureId }), "vial"))!;
  await ok(db.rpc("finish_personal_vial", { p_vial_id: vialId }), "finish");
  return { cycleId, mixtureId, vialId };
}

/**
 * `call` as the researcher, in a transaction held open after it returns until
 * another session waits on its locks: its result is `saved`, and `waited` is
 * t once a call sent meanwhile was seen waiting for it (tests/support/psql.ts).
 */
function slowCall(call: string) {
  const claims = JSON.stringify({ sub: uid, role: "authenticated" });
  return psqlAsync(`
    begin;
    ${HOLD_FUNCTION}
    set local role authenticated;
    select 'claims', set_config('request.jwt.claims', ${quote(claims)}, true) is not null;
    select 'saved', ${call};
    ${holdUntilWaited()}
    commit;
  `);
}

const vialRow = (vialId: string) =>
  ok(serviceClient().from("personal_vials").select("mixture_id, finished_at").eq("id", vialId).single(), "vial row");
const openOn = (mixtureId: string) =>
  ok(serviceClient().from("personal_vials").select("id").eq("mixture_id", mixtureId).is("finished_at", null), "open vials");
const deductionsOf = (vialId: string) =>
  ok(serviceClient().from("personal_vial_deductions").select("amount_mg::text, remaining_after_mg::text").eq("vial_id", vialId), "deductions");

type Dose = { deduction: { vial_id: string; amount_mg: string } | null };

describe("reopen_personal_vial and confirm_dose", () => {
  it("a confirmation during a reopen waits, then deducts from the reopened vial", async () => {
    const { cycleId, mixtureId, vialId } = await setUp(true);
    const shown = await confirmArgsSeen(db, await occurrenceOn(db, cycleId, d(0)));
    const reopen = slowCall(`public.reopen_personal_vial(${quote(vialId)})`);
    await holdingLocks();
    const confirmed = await ok(db.rpc("confirm_dose", shown), "confirm during reopen");
    expect((await reopen).saved).toBe("reopened");
    // It waited on the mixture (the reopen's transaction held it), then found the vial open under its locks.
    expect((await reopen).waited).toBe("t");
    expect((confirmed as unknown as Dose).deduction).toMatchObject({ vial_id: vialId, amount_mg: "0.4" });
    expect(await deductionsOf(vialId)).toEqual([{ amount_mg: "0.4", remaining_after_mg: "9.6" }]);
    expect(await vialRow(vialId)).toMatchObject({ mixture_id: mixtureId, finished_at: null });
  });

  it("a reopen during a confirmation waits for it; the dose taken while the vial was finished deducts nothing", async () => {
    const { cycleId, mixtureId, vialId } = await setUp(true);
    const shown = await confirmArgsSeen(db, await occurrenceOn(db, cycleId, d(0)));
    const confirm = slowCall(
      `(public.confirm_dose(p_request_key => ${quote(shown.p_request_key)}, p_occurrence_key => ${quote(shown.p_occurrence_key)},
         p_seen_scheduled_at => ${quote(shown.p_seen_scheduled_at)}, p_seen_dose_mg => ${quote(shown.p_seen_dose_mg)},
         p_seen_mixture_version_id => ${quote(String(shown.p_seen_mixture_version_id))}, p_amount_mg => ${quote(shown.p_amount_mg)}))->>'deduction'`,
    );
    await holdingLocks();
    const reopened = await ok(db.rpc("reopen_personal_vial", { p_vial_id: vialId }), "reopen during confirm");
    expect((await confirm).saved).toBe("");
    expect((await confirm).waited).toBe("t");
    expect(reopened).toBe("reopened");
    expect(await deductionsOf(vialId)).toEqual([]);
    expect(await vialRow(vialId)).toMatchObject({ mixture_id: mixtureId, finished_at: null });
    expect(await ok(serviceClient().from("dose_records").select("id").eq("cycle_id", cycleId), "doses")).toHaveLength(1);
  });
});

describe("reopen_personal_vial and save_personal_vial on the same mixture", () => {
  it("a new vial during a reopen waits, then is refused: one open vial", async () => {
    const { mixtureId, vialId } = await setUp(false);
    const reopen = slowCall(`public.reopen_personal_vial(${quote(vialId)})`);
    await holdingLocks();
    const added = await sqlState(
      db.rpc("save_personal_vial", { p_label: `N-${tag()}`, p_peptide_id: peptideId, p_strength_mg: "10", p_mixture_id: mixtureId }),
      "add during reopen",
    );
    expect((await reopen).saved).toBe("reopened");
    expect((await reopen).waited).toBe("t");
    expect(added).toBe("AP015");
    expect((await openOn(mixtureId)).map((v) => v.id)).toEqual([vialId]);
  });

  it("a reopen during a new vial waits, then reopens unlinked: one open vial", async () => {
    const { mixtureId, vialId } = await setUp(false);
    const add = slowCall(
      `public.save_personal_vial(p_label => ${quote(`N-${tag()}`)}, p_peptide_id => ${quote(peptideId)}, p_strength_mg => '10', p_mixture_id => ${quote(mixtureId)})`,
    );
    await holdingLocks();
    const reopened = await ok(db.rpc("reopen_personal_vial", { p_vial_id: vialId }), "reopen during add");
    const newVial = (await add).saved;
    expect((await add).waited).toBe("t");
    expect(reopened).toBe("unlinked");
    expect((await openOn(mixtureId)).map((v) => v.id)).toEqual([newVial]);
    expect(await vialRow(vialId)).toMatchObject({ mixture_id: null, finished_at: null });
  });
});

describe("reopen_personal_vial and delete_mixture", () => {
  it("a reopen during a delete waits, then reopens unlinked", async () => {
    const { mixtureId, vialId } = await setUp(false);
    const { version } = (await getMixture(db, mixtureId))!;
    const remove = slowCall(`public.delete_mixture(${quote(mixtureId)}, ${version})`);
    await holdingLocks();
    const reopened = await ok(db.rpc("reopen_personal_vial", { p_vial_id: vialId }), "reopen during delete");
    expect((await remove).saved).toBe("t");
    expect((await remove).waited).toBe("t");
    expect(reopened).toBe("unlinked");
    expect(await vialRow(vialId)).toMatchObject({ mixture_id: null, finished_at: null });
  });

  it("a delete during a reopen waits, then unlinks the reopened vial", async () => {
    const { mixtureId, vialId } = await setUp(false);
    const { version } = (await getMixture(db, mixtureId))!;
    const reopen = slowCall(`public.reopen_personal_vial(${quote(vialId)})`);
    await holdingLocks();
    const deleted = await ok(db.rpc("delete_mixture", { p_mixture_id: mixtureId, p_version: version }), "delete during reopen");
    expect((await reopen).saved).toBe("reopened");
    expect((await reopen).waited).toBe("t");
    expect(deleted).toBe(true);
    // Open, and not linked to the mixture now deleted.
    expect(await vialRow(vialId)).toMatchObject({ mixture_id: null, finished_at: null });
    expect(await openOn(mixtureId)).toEqual([]);
  });
});
