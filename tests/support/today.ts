// Seeds for the Today journeys (tests/e2e/today*.spec.ts). No server-only
// imports: Playwright specs use it.
import { createCycle, interval, plan, tag, weekdays } from "./cycles";
import { d, NOON } from "./noon";
import { ensureAccount, ok, serviceClient, signedInClient, uniqueEmail } from "./local-supabase";

export async function seedPeptide(name: string) {
  const { data, error } = await serviceClient()
    .from("peptides")
    .insert({ name, information: `[Supplied information for ${name}]`, available: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not seed ${name}: ${error?.message ?? "no row"}`);
  return data.id;
}

/**
 * A researcher with one cycle in the noon zone: A every 2 days at 08:00 from
 * two days ago (0.4 mg, a saved 10 mg / 2 mL mixture: 8 units) and B every
 * day at 09:00 from yesterday (1 mg, no mixture). Due now: A and B today;
 * unconfirmed: A two days ago, B yesterday. `vial`: A's mixture is that vial
 * (mg + mL) instead, with supply tracking on and an open vial of it. `supplements`: tracking on and
 * routines at these America/Toronto times.
 */
export async function seedToday(label: string, options: { vial?: { mg: string; ml: string }; supplements?: { name: string; time: string }[] } = {}) {
  const t = tag();
  const email = uniqueEmail(`v1-today-${label}`);
  const researcherId = await ensureAccount({ email, name: `Jordan ${label} Reyes`, role: "researcher" });
  const [A, B] = [`Today A ${t}`, `Today B ${t}`];
  const [aId, bId] = [await seedPeptide(A), await seedPeptide(B)];
  const db = await signedInClient(email);
  const cycleId = await createCycle(db, {
    name: `Today cycle ${t}`,
    timeZone: NOON,
    plans: [plan(aId, [interval(d(-2), d(20), "0.4", 2, "08:00")]), plan(bId, [weekdays(d(-1), d(20), [0, 1, 2, 3, 4, 5, 6], "1", "09:00")])],
  });
  const plans = await ok(db.from("cycle_plans").select("id, peptide_id").eq("cycle_id", cycleId), "plans");
  const planA = plans.find((p) => p.peptide_id === aId)!.id;
  const mixtureId = (await ok(
    db.rpc("save_mixture", {
      p_peptide_id: aId,
      ...(options.vial ? { p_vial_mg: options.vial.mg, p_liquid_ml: options.vial.ml } : { p_vial_mg: "10", p_liquid_ml: "2" }),
      p_syringe_units: 100,
      p_line_spacing: "2",
      p_plan_ids: [planA],
    }),
    "mixture",
  ))!;
  let vialLabel: string | null = null;
  if (options.vial) {
    vialLabel = `V-${t}`;
    await ok(db.rpc("set_supply_tracking", { p_enabled: true }), "tracking");
    await ok(db.rpc("save_personal_vial", { p_label: vialLabel, p_peptide_id: aId, p_strength_mg: options.vial.mg, p_mixture_id: mixtureId }), "vial");
  }
  if (options.supplements?.length) {
    await ok(db.rpc("set_supplement_tracking", { p_enabled: true }), "supplement tracking");
    for (const routine of options.supplements) {
      await ok(
        db.rpc("save_supplement_routine", {
          p_id: null as unknown as string,
          p_version: null as unknown as number,
          p_name: routine.name,
          p_amount: "1",
          p_unit: "capsule",
          p_time: routine.time,
        }),
        `routine ${routine.name}`,
      );
    }
  }
  return { email, researcherId, A, B, cycleId, db, vialLabel };
}

/** A researcher with no cycle at all. */
export async function seedEmpty(label: string) {
  const email = uniqueEmail(`v1-empty-${label}`);
  const researcherId = await ensureAccount({ email, name: `Empty ${label}`, role: "researcher" });
  return { email, researcherId };
}
