// A realistic researcher and admin for the feel measurement
// (tests/perf/feel.spec.ts). No server-only imports: Playwright runs it.
//
// Researcher: one cycle in the noon zone from 30 days ago. A (a saved mixture
// on a tracked vial) daily at 08:00 and B daily at 09:00 have 30 days of
// history (Taken at the planned time, a skip every 7th day, B's yesterday
// left unlogged: one overdue row); DUE_NOW more plans start today, all due
// before noon, so each measured Taken has a dose due. 30 days of check-ins
// with a weight, supplement tracking on with two routines. Admin: three
// stock items bought and ten sales to outside buyers.
import { randomUUID } from "node:crypto";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { ensureAccount, ok, signedInClient, uniqueEmail } from "../support/local-supabase";
import { psql, quote } from "../support/psql";
import { d, NOON, noonZoneInstant } from "../support/noon";
import { recordPreviewedSale } from "../support/sales";
import { seedPeptide } from "../support/today";

export const HISTORY_DAYS = 30;
/** Plans with a dose due now (one per measured Taken, and a warm-up). */
export const DUE_NOW = 7;
const DUE_TIMES = ["10:00", "10:15", "10:30", "10:45", "11:00", "11:15", "11:30"];

export type PerfSeed = {
  researcher: { email: string; name: string };
  admin: { email: string; name: string };
};

export async function seedPerf(): Promise<PerfSeed> {
  const t = tag();
  const name = `Jordan Perf ${t}`;
  const email = uniqueEmail(`perf-${t}`);
  const researcherId = await ensureAccount({ email, name, role: "researcher" });
  const db = await signedInClient(email);

  const [A, B] = [await seedPeptide(`Perf BPC-157 ${t}`), await seedPeptide(`Perf TB-500 ${t}`)];
  const extra: string[] = [];
  for (let i = 0; i < DUE_NOW; i += 1) extra.push(await seedPeptide(`Perf P${i + 1} ${t}`));

  const cycleId = await createCycle(db, {
    name: `Recomp ${t}`,
    timeZone: NOON,
    plans: [
      plan(A, [interval(d(-HISTORY_DAYS), d(30), "0.25", 1, "08:00")]),
      plan(B, [interval(d(-HISTORY_DAYS), d(30), "2", 1, "09:00")]),
      ...extra.map((id, i) => plan(id, [interval(d(0), d(30), "0.5", 1, DUE_TIMES[i])])),
    ],
  });
  const plans = await ok(db.from("cycle_plans").select("id, peptide_id").eq("cycle_id", cycleId), "plans");
  const planOf = (peptide: string) => plans.find((p) => p.peptide_id === peptide)!.id;
  const phases = await ok(db.from("cycle_revision_phases").select("plan_id, phase_id").in("plan_id", [planOf(A), planOf(B)]), "phases");
  const phaseOf = (planId: string) => phases.find((p) => p.plan_id === planId)!.phase_id;

  // History: occurrence i of a daily phase starting d(-30) is on d(-30 + i).
  for (const [peptide, dose, time] of [
    [A, "0.25", "08:00"],
    [B, "2", "09:00"],
  ] as const) {
    const planId = planOf(peptide);
    const phaseId = phaseOf(planId);
    for (let i = 0; i < HISTORY_DAYS; i += 1) {
      const date = d(-HISTORY_DAYS + i);
      if (peptide === B && i === HISTORY_DAYS - 1) continue; // yesterday's B: overdue
      const key = `${planId}:${phaseId}:${i}`;
      const scheduledAt = noonZoneInstant(date, time);
      if (i % 7 === 3) {
        await ok(db.rpc("skip_dose", { p_request_key: randomUUID(), p_occurrence_key: key, p_seen_scheduled_at: scheduledAt, p_seen_dose_mg: dose }), "skip");
        continue;
      }
      await ok(
        db.rpc("confirm_dose", {
          p_request_key: randomUUID(),
          p_occurrence_key: key,
          p_seen_scheduled_at: scheduledAt,
          p_seen_dose_mg: dose,
          p_seen_mixture_version_id: null as unknown as string,
          p_amount_mg: dose,
          p_actual_at: scheduledAt,
          p_site: ["Abdomen L", "Abdomen R", "Thigh L", "Thigh R"][i % 4],
          p_notes: "",
        }),
        "confirm",
      );
    }
  }

  // A's mixture on a tracked vial (today on).
  const mixtureId = (await ok(
    db.rpc("save_mixture", { p_peptide_id: A, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planOf(A)] }),
    "mixture",
  ))!;
  await ok(db.rpc("set_supply_tracking", { p_enabled: true }), "tracking");
  await ok(db.rpc("save_personal_vial", { p_label: `A-${t}`, p_peptide_id: A, p_strength_mg: "10", p_mixture_id: mixtureId }), "vial");

  // Check-ins: one a day before today, with a weight (as the database owner: no API writes past days).
  psql(`
    insert into public.progress_check_ins (owner_id, day, feeling, effects, note, measurement_name, measurement_value, measurement_unit, measured_at)
    select ${quote(researcherId)}::uuid, day, 2 + (n % 4), case when n % 5 = 0 then array['Headache'] else array[]::text[] end,
           case when n % 3 = 0 then 'Slept well.' else '' end, 'Weight', trim_scale(82 - n * 0.05), 'kg', day + time '07:30'
      from generate_series(0, ${HISTORY_DAYS - 1}) as n, lateral (select ${quote(d(-HISTORY_DAYS))}::date + n as day) as days;
  `);

  // Supplements.
  await ok(db.rpc("set_supplement_tracking", { p_enabled: true }), "supplement tracking");
  for (const [routine, time] of [
    [`Magnesium ${t}`, "21:00"],
    [`Vitamin D3 ${t}`, "23:30"],
  ]) {
    await ok(
      db.rpc("save_supplement_routine", {
        p_id: null as unknown as string,
        p_version: null as unknown as number,
        p_name: routine,
        p_amount: "1",
        p_unit: "capsule",
        p_time: time,
      }),
      routine,
    );
  }

  // Admin: stock and sales.
  const adminName = `Perf Admin ${t}`;
  const adminEmail = uniqueEmail(`perf-admin-${t}`);
  const adminId = await ensureAccount({ email: adminEmail, name: adminName, role: "admin" });
  const adminDb = await signedInClient(adminEmail);
  for (const [i, peptide] of [A, B, extra[0]].entries()) {
    const bought = await adminDb
      .rpc("record_business_purchase", {
        p_idempotency_key: randomUUID(),
        p_peptide_id: peptide,
        p_strength_mg: "10",
        p_received_on: "2026-09-01",
        p_quantity: 30,
        p_unit_cost: String(18 + i * 4),
      })
      .single();
    if (bought.error) throw bought.error;
    for (let s = 0; s < (i === 0 ? 4 : 3); s += 1) {
      const sold = await recordPreviewedSale(adminDb, {
        p_idempotency_key: randomUUID(),
        p_stock_item_id: bought.data.stock_item_id,
        p_sold_on: `2026-09-${String(3 + s * 5 + i).padStart(2, "0")}`,
        p_quantity: 1 + (s % 3),
        p_unit_price: String(45 + i * 5),
        p_buyer_name: `Outside buyer ${s + 1} ${t}`,
        p_seller_id: adminId,
      });
      if (sold.error) throw sold.error;
    }
  }

  return { researcher: { email, name }, admin: { email: adminEmail, name: adminName } };
}
