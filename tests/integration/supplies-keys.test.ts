// S14 personal supplies: the composite keys, tried as the database owner
// (psql, one transaction, always rolled back), so nothing but the keys stands
// between a row and another owner's records: a vial can't point at another
// owner's mixture or at a mixture of another peptide, and a deduction can't
// join one owner's dose to another owner's vial. Signed-in roles can't write
// these tables at all. Runs in the integration-exclusive project.
import { beforeAll, describe, expect, it } from "vitest";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { confirmArgsSeen, d, NOON, occurrenceOn } from "../support/doses";
import { ensureAccount, ok, signedInClient, uniqueEmail } from "../support/local-supabase";
import { psql, quote } from "../support/psql";

const people = {
  alex: { email: uniqueEmail("s14k-alex"), name: "Alex Keys", role: "researcher" },
  blair: { email: uniqueEmail("s14k-blair"), name: "Blair Keys", role: "researcher" },
  admin: { email: uniqueEmail("s14k-admin"), name: "Keys Admin", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
/** Alex: a tracked vial on a mixture of A, a dose deducted from it and one taken with tracking off. Blair: a vial of A and a mixture of B. */
const f = { peptideA: "", alexMixture: "", alexVial: "", alexUndeducted: "", blairVial: "", blairMixtureB: "" };

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  const t = tag();
  f.peptideA = await createPeptide(db.admin, `Keys A ${t}`);
  const peptideB = await createPeptide(db.admin, `Keys B ${t}`);

  const cycleId = await createCycle(db.alex, { timeZone: NOON, plans: [plan(f.peptideA, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
  const [{ id: planId }] = await ok(db.alex.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan");
  await ok(db.alex.rpc("set_supply_tracking", { p_enabled: true }), "alex tracking");
  const mixture = { p_peptide_id: f.peptideA, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2" };
  f.alexMixture = (await ok(db.alex.rpc("save_mixture", { ...mixture, p_plan_ids: [planId] }), "alex mixture"))!;
  f.alexVial = (await ok(db.alex.rpc("save_personal_vial", { p_label: "AK", p_peptide_id: f.peptideA, p_strength_mg: "10", p_mixture_id: f.alexMixture }), "alex vial"))!;
  const confirm = async (date: string) =>
    ((await ok(db.alex.rpc("confirm_dose", (await confirmArgsSeen(db.alex, await occurrenceOn(db.alex, cycleId, date))) as never), date)) as unknown as { id: string; deduction: unknown });
  expect((await confirm(d(0))).deduction).not.toBeNull();
  await ok(db.alex.rpc("set_supply_tracking", { p_enabled: false }), "alex tracking off");
  const undeducted = await confirm(d(-2));
  expect(undeducted.deduction).toBeNull();
  f.alexUndeducted = undeducted.id;

  await ok(db.blair.rpc("set_supply_tracking", { p_enabled: true }), "blair tracking");
  f.blairVial = (await ok(db.blair.rpc("save_personal_vial", { p_label: "BK", p_peptide_id: f.peptideA, p_strength_mg: "10" }), "blair vial"))!;
  f.blairMixtureB = (await ok(db.blair.rpc("save_mixture", { ...mixture, p_peptide_id: peptideB, p_plan_ids: [] }), "blair mixture B"))!;
});

/** Runs a statement; reports the affected row count, or the SQLSTATE it failed with. */
const attempt = (label: string, statement: string) => `do $$
declare n bigint;
begin
  ${statement};
  get diagnostics n = row_count;
  perform set_config('s14_keys.result', n::text, true);
exception when others then
  perform set_config('s14_keys.result', sqlstate, true);
end $$;
select ${quote(label)}, current_setting('s14_keys.result');\n`;

const as = (who: Name) =>
  `set local role authenticated;\nset local "request.jwt.claims" to '${JSON.stringify({ sub: id[who], role: "authenticated" })}';\n`;

const deduction = (owner: Name, doseId: string, vialId: string) =>
  `insert into public.personal_vial_deductions (owner_id, dose_id, vial_id, amount_mg, remaining_before_mg, remaining_after_mg, recorded_at, vial_sequence)
   values ('${id[owner]}', '${doseId}', '${vialId}', 0.4, 9.6, 9.2, now(), 1000)`;

describe("composite keys keep supplies on one owner", () => {
  it("refuse another owner's mixture, another peptide's mixture, and a dose and vial of different owners", () => {
    const script =
      "begin;\n" +
      // Controls: the same statements on matching rows succeed, so each refusal below is the key's.
      attempt("unlink own", `update public.personal_vials set mixture_id = null where id = '${f.alexVial}'`) +
      attempt("relink own", `update public.personal_vials set mixture_id = '${f.alexMixture}' where id = '${f.alexVial}'`) +
      // Alex's vial finished, so the one-open-vial-per-mixture index doesn't answer first.
      attempt("finish alex's vial", `update public.personal_vials set finished_at = now() where id = '${f.alexVial}'`) +
      // A vial pointing at another owner's mixture (update or insert).
      attempt("vial to other's mixture", `update public.personal_vials set mixture_id = '${f.alexMixture}' where id = '${f.blairVial}'`) +
      attempt(
        "new vial on other's mixture",
        `insert into public.personal_vials (owner_id, peptide_id, label, strength_mg, mixture_id)
         values ('${id.blair}', '${f.peptideA}', 'Forged', 10, '${f.alexMixture}')`,
      ) +
      // A vial of A on its owner's own mixture of B.
      attempt("vial to a mixture of another peptide", `update public.personal_vials set mixture_id = '${f.blairMixtureB}' where id = '${f.blairVial}'`) +
      // A deduction joining Alex's dose to Blair's vial, under either owner.
      attempt("deduction as blair", deduction("blair", f.alexUndeducted, f.blairVial)) +
      attempt("deduction as alex", deduction("alex", f.alexUndeducted, f.blairVial)) +
      attempt("own dose and vial", deduction("alex", f.alexUndeducted, f.alexVial)) +
      // Signed-in roles write none of these tables directly, own rows included.
      as("alex") +
      attempt("alex updates own vial", `update public.personal_vials set label = 'X' where id = '${f.alexVial}'`) +
      attempt("alex inserts a deduction", deduction("alex", f.alexUndeducted, f.alexVial)) +
      attempt("alex deletes own deductions", `delete from public.personal_vial_deductions where owner_id = '${id.alex}'`) +
      attempt("alex updates own setting", `update public.personal_supply_settings set tracking_enabled = true where owner_id = '${id.alex}'`) +
      as("blair") +
      attempt("blair relinks her vial", `update public.personal_vials set mixture_id = '${f.alexMixture}' where id = '${f.blairVial}'`) +
      "rollback;\n";

    expect(psql(script)).toEqual({
      "unlink own": "1",
      "relink own": "1",
      "finish alex's vial": "1",
      "own dose and vial": "1",
      "vial to other's mixture": "23503",
      "new vial on other's mixture": "23503",
      "vial to a mixture of another peptide": "23503",
      "deduction as blair": "23503",
      "deduction as alex": "23503",
      "alex updates own vial": "42501",
      "alex inserts a deduction": "42501",
      "alex deletes own deductions": "42501",
      "alex updates own setting": "42501",
      "blair relinks her vial": "42501",
    });
  });

  it("leaves nothing behind", async () => {
    const [vial] = await ok(db.alex.from("personal_vials").select("mixture_id, label").eq("id", f.alexVial), "alex vial");
    expect(vial).toEqual({ mixture_id: f.alexMixture, label: "AK" });
    expect(await ok(db.alex.from("personal_vial_deductions").select("id").eq("dose_id", f.alexUndeducted), "no deduction")).toEqual([]);
    const [blair] = await ok(db.blair.from("personal_vials").select("mixture_id").eq("id", f.blairVial), "blair vial");
    expect(blair.mixture_id).toBeNull();
  });
});
