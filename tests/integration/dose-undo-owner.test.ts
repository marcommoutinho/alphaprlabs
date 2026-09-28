// V1 undo_dose, as the database owner (psql): entries are moved back in
// time to prove the 60-second window without waiting, and an entry is given
// no schedule_version_after, as every dose recorded before V1 has, to prove
// those are never undoable. The accounts are unique to this run (committed).
// And two confirmations sharing a vial, really interleaved in two sessions
// (a psql transaction holds the vial while PostgREST's call waits on it):
// the one that took its time first deducts second, so the undo check orders
// deductions by their position on the vial, never by time.
// Runs in the integration-exclusive project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { confirmArgs, confirmArgsSeen, d, NOON, occurrenceOn } from "../support/doses";
import { ensureAccount, ok, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import { psql, psqlAsync, quote } from "../support/psql";

const people = {
  wren: { email: uniqueEmail("v1o-wren"), name: "Wren Window", role: "researcher" },
  grace: { email: uniqueEmail("v1o-grace"), name: "Grace Admin", role: "admin" },
} as const;
let wren: Client;
let wrenId = "";
let peptide = "";

const undoState = (entryId: string) => sqlState(wren.rpc("undo_dose", { p_request_key: randomUUID(), p_entry_id: entryId }), "undo_dose");

beforeAll(async () => {
  wrenId = await ensureAccount(people.wren);
  await ensureAccount(people.grace);
  wren = await signedInClient(people.wren.email);
  peptide = await createPeptide(await signedInClient(people.grace.email), `Window ${tag()}`);
});

describe("the undo window", () => {
  it("allows an undo up to 60 seconds after the entry, not after", async () => {
    const cycleId = await createCycle(wren, { timeZone: NOON, plans: [plan(peptide, [interval(d(-4), d(20), "0.4", 2, "08:00")])] });
    const recordAt = async (date: string) => {
      const o = await occurrenceOn(wren, cycleId, date);
      return (await ok(wren.rpc("confirm_dose", confirmArgs(o) as never), "confirm")) as unknown as { id: string };
    };
    const inside = await recordAt(d(-4));
    psql(`update public.dose_records set recorded_at = recorded_at - interval '50 seconds', actual_at = actual_at - interval '50 seconds' where id = ${quote(inside.id)};`);
    expect(await undoState(inside.id)).toBe("ok");

    const outside = await recordAt(d(-4));
    psql(`update public.dose_records set recorded_at = recorded_at - interval '61 seconds', actual_at = actual_at - interval '61 seconds' where id = ${quote(outside.id)};`);
    expect(await undoState(outside.id)).toBe("AP032");

    // A skip has the same window.
    const o = await occurrenceOn(wren, cycleId, d(-2));
    const skip = (await ok(
      wren.rpc("skip_dose", { p_request_key: randomUUID(), p_occurrence_key: o.key, p_seen_scheduled_at: o.scheduledAt, p_seen_dose_mg: o.doseMg }),
      "skip",
    )) as unknown as { id: string };
    psql(`update public.dose_skips set recorded_at = recorded_at - interval '61 seconds' where id = ${quote(skip.id)};`);
    expect(await undoState(skip.id)).toBe("AP032");
    const left = psql(`select 'doses', count(*) from public.dose_records where cycle_id = ${quote(cycleId)};
      select 'skips', count(*) from public.dose_skips where cycle_id = ${quote(cycleId)};
      select 'voids', count(*) from public.dose_voids where cycle_id = ${quote(cycleId)};`);
    expect(left).toEqual({ doses: "1", skips: "1", voids: "1" });
  });

  it("never undoes a dose recorded before V1 (no schedule_version_after)", async () => {
    const cycleId = await createCycle(wren, { timeZone: NOON, plans: [plan(peptide, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
    const o = await occurrenceOn(wren, cycleId, d(0));
    const dose = (await ok(wren.rpc("confirm_dose", confirmArgs(o) as never), "confirm")) as unknown as { id: string };
    psql(`update public.dose_records set schedule_version_after = null where id = ${quote(dose.id)};`);
    expect(await undoState(dose.id)).toBe("AP033");
  });
});

/** Polls pg_stat_activity until `where` matches another backend. */
async function until(where: string, what: string) {
  for (let i = 0; i < 200; i++) {
    const out = psql(`select 'n', count(*) from pg_stat_activity where pid <> pg_backend_pid() and ${where};`);
    if (out.n !== "0") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Never saw ${what}`);
}

/** A SQL named-argument list for a function call. */
const named = (args: Record<string, unknown>) =>
  Object.entries(args)
    .map(([name, value]) => `${name} => ${value === null ? "null" : quote(String(value))}`)
    .join(", ");

describe("later deductions from a shared vial, interleaved", () => {
  it("block the undo of an earlier deduction even when its dose's time is later", async () => {
    // Two cycles whose plans share one mixture and its tracked 10 mg vial.
    const one = await createCycle(wren, { timeZone: NOON, plans: [plan(peptide, [interval(d(-2), d(20), "0.5", 2, "08:00")])] });
    const two = await createCycle(wren, { timeZone: NOON, plans: [plan(peptide, [interval(d(-2), d(20), "0.5", 2, "08:00")])] });
    const planOf = async (cycleId: string) => (await ok(wren.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan"))[0].id;
    const [planOne, planTwo] = [await planOf(one), await planOf(two)];
    await ok(wren.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
    const mixtureId = await ok(
      wren.rpc("save_mixture", { p_peptide_id: peptide, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planOne, planTwo] }),
      "mixture",
    );
    const vialId = (await ok(
      wren.rpc("save_personal_vial", { p_label: `I-${tag()}`, p_peptide_id: peptide, p_strength_mg: "10", p_mixture_id: mixtureId }),
      "vial",
    )) as unknown as string;
    const argsA = await confirmArgsSeen(wren, await occurrenceOn(wren, one, d(0)));
    const argsB = await confirmArgsSeen(wren, await occurrenceOn(wren, two, d(0)));

    // Session 1 (psql) takes the vial's row lock, sleeps, then records B as the researcher in the same transaction.
    const claims = JSON.stringify({ sub: wrenId, role: "authenticated" });
    const sessionB = psqlAsync(`
      begin;
      select 'locked', id from public.personal_vials where id = ${quote(vialId)} for update;
      select 'slept', pg_sleep(3) is null;
      set local role authenticated;
      select 'claims', set_config('request.jwt.claims', ${quote(claims)}, true) is not null;
      select 'b', public.confirm_dose(${named(argsB)}) ->> 'id';
      commit;
    `);
    await until(`query like '%pg_sleep(3)%' and state = 'active'`, "session 1 holding the vial");
    // Session 2 (PostgREST): A takes its time now, then waits for the vial.
    const confirmA = ok(wren.rpc("confirm_dose", argsA as never), "confirm A") as unknown as Promise<{ id: string }>;
    await until(`wait_event_type = 'Lock' and query like '%confirm_dose%'`, "A waiting for the vial");
    const [b, a] = [(await sessionB).b, (await confirmA).id];

    const rows = psql(`
      select 'a_at', recorded_at::text from public.dose_records where id = ${quote(a)};
      select 'b_at', recorded_at::text from public.dose_records where id = ${quote(b)};
      select 'a_order', (recorded_at < (select recorded_at from public.dose_records where id = ${quote(b)}))::text from public.dose_records where id = ${quote(a)};
      select 'a', vial_sequence || ' ' || remaining_before_mg || ' ' || remaining_after_mg from public.personal_vial_deductions where dose_id = ${quote(a)};
      select 'b', vial_sequence || ' ' || remaining_before_mg || ' ' || remaining_after_mg from public.personal_vial_deductions where dose_id = ${quote(b)};
    `);
    // A's time is earlier, yet it deducted second, from what B left.
    expect(rows.a_order).toBe("true");
    expect(rows.b).toBe("1 10 9.5");
    expect(rows.a).toBe("2 9.5 9.0");

    // B can't be undone while A's "remaining before" counts it; A (the vial's last) can, then B can.
    expect(await undoState(b)).toBe("AP033");
    expect(await undoState(a)).toBe("ok");
    expect(await undoState(b)).toBe("ok");
    expect(psql(`select 'n', count(*) from public.personal_vial_deductions where vial_id = ${quote(vialId)};`).n).toBe("0");
  });
});
