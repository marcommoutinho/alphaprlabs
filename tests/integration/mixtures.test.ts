// S11 saved mixtures and personal vials against the real local Supabase
// (npm run db:start), through PostgREST as each signed-in person, exactly as
// the app reads and writes: only the owner writes (save_mixture and friends),
// a granted admin reads and never writes, others (researcher, non-granted
// admin, anon, unacknowledged) get nothing; a mixture links only to the
// owner's own plans for its peptide; a changed setup is a new version while
// the old one stays, and the mixture in effect at a past instant is still
// known; personal vials follow their opt-in and strength rules.
import { beforeAll, describe, expect, it } from "vitest";
import { getCycle, plansArgument } from "@/lib/cycles/service";
import { getMixture, listMixtures, listPersonalVials, mixtureHistory, planMixtures } from "@/lib/mixtures/service";
import { type Client, createCycle, createPeptide, day, interval, plan, saveCycle, setAvailable, tag } from "../support/cycles";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const people = {
  alex: { email: uniqueEmail("s11-alex"), name: "Alex Owner", role: "researcher" },
  blair: { email: uniqueEmail("s11-blair"), name: "Blair Other", role: "researcher" },
  una: { email: uniqueEmail("s11-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("s11-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("s11-noah"), name: "Noah Not Granted", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const peptide = { a: "", b: "", withdrawn: "", withdrawnName: "" };
const planOf = { alexA: "", alexB: "", blairA: "" };

const TABLES = ["mixtures", "mixture_versions", "cycle_plan_mixtures", "personal_vials", "personal_supply_settings"] as const;

const setup = (overrides: Record<string, unknown> = {}) => ({
  p_peptide_id: peptide.a,
  p_vial_mg: "8",
  p_liquid_ml: "2",
  p_syringe_units: 100,
  p_line_spacing: "2",
  p_plan_ids: [] as string[],
  ...overrides,
});

async function planIdOf(who: Client, cycleId: string, peptideId: string) {
  const rows = await ok(who.from("cycle_plans").select("id").eq("cycle_id", cycleId).eq("peptide_id", peptideId), "plan id");
  if (rows.length !== 1) throw new Error(`Expected one plan, got ${rows.length}`);
  return rows[0].id;
}

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  const t = tag();
  peptide.a = await createPeptide(db.grace, `Mixture A ${t}`);
  peptide.b = await createPeptide(db.grace, `Mixture B ${t}`);
  peptide.withdrawnName = `Mixture withdrawn ${t}`;
  peptide.withdrawn = await createPeptide(db.grace, peptide.withdrawnName);
  const alexCycle = await createCycle(db.alex, {
    plans: [plan(peptide.a, [interval(day(1), day(20))]), plan(peptide.b, [interval(day(1), day(20))])],
  });
  const blairCycle = await createCycle(db.blair, { plans: [plan(peptide.a, [interval(day(1), day(20))])] });
  planOf.alexA = await planIdOf(db.alex, alexCycle, peptide.a);
  planOf.alexB = await planIdOf(db.alex, alexCycle, peptide.b);
  planOf.blairA = await planIdOf(db.blair, blairCycle, peptide.a);
});

describe("mixtures are the owner's; grants read, never write", () => {
  it("links only to the owner's own plans for the mixture's peptide", async () => {
    const mixtureId = await ok(db.alex.rpc("save_mixture", setup({ p_plan_ids: [planOf.alexA] })), "save");
    expect((await planMixtures(db.alex, id.alex)).get(planOf.alexA)?.id).toBe(mixtureId);

    // Another researcher's plan, or a plan for another peptide, is refused and changes nothing.
    expect(await sqlState(db.alex.rpc("save_mixture", setup({ p_plan_ids: [planOf.blairA] })), "foreign plan")).toBe("AP012");
    expect(await sqlState(db.alex.rpc("save_mixture", setup({ p_plan_ids: [planOf.alexB] })), "other peptide")).toBe("AP012");
    const mixture = (await getMixture(db.alex, mixtureId!))!;
    expect(
      await sqlState(
        db.alex.rpc("save_mixture", setup({ p_mixture_id: mixtureId, p_version: mixture.version, p_plan_ids: [planOf.alexA, planOf.blairA] })),
        "update with a foreign plan",
      ),
    ).toBe("AP012");
    // Blair can't point their plan at Alex's mixture either: the mixture isn't theirs.
    expect(await ok(db.blair.rpc("save_mixture", setup({ p_mixture_id: mixtureId, p_version: mixture.version, p_plan_ids: [planOf.blairA] })), "blair")).toBeNull();
    expect((await planMixtures(db.blair, id.blair)).size).toBe(0);
    expect((await getMixture(db.alex, mixtureId!))!.planIds).toEqual([planOf.alexA]);
  });

  it("isolates researchers and admins, lets a granted admin read only, and denies again on revoke", async () => {
    const mixtureId = (await ok(db.alex.rpc("save_mixture", setup({ p_vial_mg: "5" })), "save"))!;
    await ok(db.alex.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
    await ok(db.alex.rpc("save_personal_vial", { p_label: "A-01", p_peptide_id: peptide.a, p_strength_mg: "5", p_mixture_id: mixtureId }), "vial");
    const rows = (who: Client, table: (typeof TABLES)[number]) => ok(who.from(table).select("owner_id").eq("owner_id", id.alex), `read ${table}`);
    for (const table of TABLES) expect(await rows(db.alex, table), `alex ${table}`).not.toHaveLength(0);
    const before = await getMixture(db.alex, mixtureId);

    for (const who of ["blair", "noah", "grace", "una"] as const) {
      for (const table of TABLES) expect(await rows(db[who], table), `${who} ${table}`).toEqual([]);
      expect(await getMixture(db[who], mixtureId), who).toBeNull();
    }
    for (const table of TABLES) expect(await sqlState(anonClient().from(table).select("owner_id"), `anon ${table}`)).toBe("42501");

    // Nobody but the acknowledged owner writes, and never directly.
    const update = setup({ p_vial_mg: "9", p_mixture_id: mixtureId, p_version: before!.version });
    expect(await ok(db.blair.rpc("save_mixture", update), "blair")).toBeNull();
    expect(await ok(db.noah.rpc("delete_mixture", { p_mixture_id: mixtureId, p_version: before!.version }), "noah delete")).toBeNull();
    expect(await sqlState(db.una.rpc("save_mixture", setup()), "unacknowledged")).toBe("42501");
    expect(await sqlState(db.una.rpc("set_supply_tracking", { p_enabled: true }), "unacknowledged tracking")).toBe("42501");
    expect(await sqlState(anonClient().rpc("save_mixture", setup()), "anon")).toBe("42501");
    expect(await sqlState(db.alex.from("mixtures").insert({ owner_id: id.alex, peptide_id: peptide.a }), "direct insert")).toBe("42501");
    expect(await sqlState(db.alex.from("mixtures").update({ deleted_at: new Date().toISOString() }).eq("id", mixtureId), "direct update")).toBe("42501");
    expect(await sqlState(db.alex.from("mixture_versions").delete().eq("mixture_id", mixtureId), "direct delete")).toBe("42501");
    expect(await sqlState(db.alex.rpc("plan_mixture_version_at" as never, { p_plan_id: planOf.alexA, p_at: new Date().toISOString() } as never), "internal")).toBe("42501");

    // A grant lets Grace read, and only read.
    await ok(db.alex.rpc("grant_support_access", { p_admin_id: id.grace }), "grant");
    try {
      expect(await getMixture(db.grace, mixtureId)).toEqual(before);
      expect((await listMixtures(db.grace, id.alex)).map((m) => m.id)).toContain(mixtureId);
      expect((await listPersonalVials(db.grace, id.alex)).map((v) => v.label)).toContain("A-01");
      expect(await getMixture(db.noah, mixtureId)).toBeNull();
      expect(await ok(db.grace.rpc("save_mixture", update), "granted admin saves")).toBeNull();
      expect(await ok(db.grace.rpc("delete_mixture", { p_mixture_id: mixtureId, p_version: before!.version }), "granted admin deletes")).toBeNull();
      expect(await getMixture(db.alex, mixtureId)).toEqual(before);
    } finally {
      await ok(db.alex.rpc("revoke_support_access", { p_admin_id: id.grace }), "revoke");
    }
    expect(await getMixture(db.grace, mixtureId)).toBeNull();
    for (const table of TABLES) expect(await rows(db.grace, table), `revoked ${table}`).toEqual([]);
  });
});

describe("versions keep history", () => {
  it("a changed setup is the next version, an unchanged one adds none, and the past mixture stays known", async () => {
    const mixtureId = (await ok(db.alex.rpc("save_mixture", setup({ p_peptide_id: peptide.b, p_plan_ids: [planOf.alexB] })), "save"))!;
    const first = (await getMixture(db.alex, mixtureId))!;
    expect(first).toMatchObject({ setupNumber: 1, setup: { vialMg: "8", liquidMl: "2", syringe: 100, lineSpacing: "2" } });

    // Stale version, and a different peptide, are refused.
    expect(await sqlState(db.alex.rpc("save_mixture", setup({ p_peptide_id: peptide.b, p_mixture_id: mixtureId, p_version: first.version + 1 })), "stale")).toBe("AP011");
    expect(await sqlState(db.alex.rpc("save_mixture", setup({ p_mixture_id: mixtureId, p_version: first.version })), "peptide change")).toBe("22023");

    // "1.50" is stored as 1.5; spacing unknown is stored as unknown, never guessed.
    await ok(
      db.alex.rpc("save_mixture", setup({ p_peptide_id: peptide.b, p_liquid_ml: "1.50", p_syringe_units: 50, p_line_spacing: "unknown", p_mixture_id: mixtureId, p_version: first.version, p_plan_ids: [planOf.alexB] })),
      "update",
    );
    const second = (await getMixture(db.alex, mixtureId))!;
    expect(second).toMatchObject({ setupNumber: 2, setup: { vialMg: "8", liquidMl: "1.5", syringe: 50, lineSpacing: "unknown" }, planIds: [planOf.alexB] });

    // Saving the same setup again only moves the token.
    await ok(db.alex.rpc("save_mixture", setup({ p_peptide_id: peptide.b, p_liquid_ml: "1.5", p_syringe_units: 50, p_line_spacing: "unknown", p_mixture_id: mixtureId, p_version: second.version, p_plan_ids: [planOf.alexB] })), "same");
    const history = await mixtureHistory(db.alex, mixtureId);
    expect(history.map((v) => [v.number, v.setup.liquidMl, v.setup.lineSpacing])).toEqual([[1, "2", "2"], [2, "1.5", "unknown"]]);

    // The mixture in effect for the plan at an earlier instant is still version 1
    // (instants from the database's own clock: each version's start).
    const at = (instant: string) => ok(serviceClient().rpc("plan_mixture_version_at" as never, { p_plan_id: planOf.alexB, p_at: instant } as never), "at") as Promise<unknown>;
    const between = new Date(Date.parse(history[1].createdAt) - 1).toISOString();
    expect(await at(history[0].createdAt)).toBe(history[0].id);
    expect(await at(between)).toBe(history[0].id);
    expect(await at(history[1].createdAt)).toBe(history[1].id);
    expect(await at("2000-01-01T00:00:00Z")).toBeNull();

    // Deleting is refused while linked; unlinking then deleting keeps the history.
    const current = (await getMixture(db.alex, mixtureId))!;
    expect(await sqlState(db.alex.rpc("delete_mixture", { p_mixture_id: mixtureId, p_version: current.version }), "linked")).toBe("AP013");
    await ok(db.alex.rpc("save_mixture", setup({ p_peptide_id: peptide.b, p_liquid_ml: "1.5", p_syringe_units: 50, p_line_spacing: "unknown", p_mixture_id: mixtureId, p_version: current.version })), "unlink");
    expect(await at("2100-01-01T00:00:00Z")).toBeNull();
    expect(await at(between)).toBe(history[0].id);
    const bare = (await getMixture(db.alex, mixtureId))!;
    expect(await ok(db.alex.rpc("delete_mixture", { p_mixture_id: mixtureId, p_version: bare.version }), "delete")).toBe(true);
    expect((await listMixtures(db.alex, id.alex)).map((m) => m.id)).not.toContain(mixtureId);
    expect((await getMixture(db.alex, mixtureId))!.deleted).toBe(true);
    expect(await mixtureHistory(db.alex, mixtureId)).toHaveLength(2);
    expect(await ok(db.alex.rpc("save_mixture", setup({ p_peptide_id: peptide.b, p_mixture_id: mixtureId, p_version: bare.version + 1 })), "deleted")).toBeNull();
  });

  it("a plan an edit removed from its cycle doesn't block deleting its mixture", async () => {
    const cycleId = await createCycle(db.alex, { plans: [plan(peptide.a, [interval(day(5), day(9))]), plan(peptide.b, [interval(day(5), day(9))])] });
    const dropped = await planIdOf(db.alex, cycleId, peptide.a);
    const mixtureId = (await ok(db.alex.rpc("save_mixture", setup({ p_plan_ids: [dropped] })), "save"))!;
    const kept = (await getCycle(db.alex, cycleId))!.revisions[0].plans.filter((p) => p.peptideId === peptide.b);
    await ok(saveCycle(db.alex, { cycleId, version: 1, plans: plansArgument(kept.map((p) => ({ ...p, effectiveFrom: day(0) }))) as unknown[] }), "drop plan");
    const mixture = (await getMixture(db.alex, mixtureId))!;
    expect(mixture.planIds).toEqual([dropped]);
    expect(await ok(db.alex.rpc("delete_mixture", { p_mixture_id: mixtureId, p_version: mixture.version }), "delete")).toBe(true);
    expect((await getMixture(db.alex, mixtureId))!.planIds).toEqual([]);
  });

  it("rejects values the calculator would refuse", async () => {
    for (const bad of [{ p_vial_mg: "0" }, { p_vial_mg: "1,5" }, { p_vial_mg: "1e3" }, { p_vial_mg: "100000.1" }, { p_liquid_ml: "1001" }, { p_syringe_units: 40 }, { p_line_spacing: "3" }]) {
      expect(await sqlState(db.alex.rpc("save_mixture", setup(bad)), JSON.stringify(bad))).toBe("22023");
    }
  });
});

describe("peptides no longer offered", () => {
  it("need the researcher's own cycle for a new mixture, and stay readable through their mixtures", async () => {
    await setAvailable(db.grace, peptide.withdrawn, peptide.withdrawnName, false);
    expect(await sqlState(db.alex.rpc("save_mixture", setup({ p_peptide_id: peptide.withdrawn })), "withdrawn")).toBe("AP007");
    await setAvailable(db.grace, peptide.withdrawn, peptide.withdrawnName, true);
    await ok(db.alex.rpc("save_mixture", setup({ p_peptide_id: peptide.withdrawn })), "while offered");
    await setAvailable(db.grace, peptide.withdrawn, peptide.withdrawnName, false);
    const readable = async (who: Client) => (await ok(who.from("peptides").select("id").eq("id", peptide.withdrawn), "read")).length === 1;
    expect(await readable(db.alex)).toBe(true);
    expect(await readable(db.blair)).toBe(false);
    // Alex already has a mixture of it, so another may be saved (a new vial mixed differently).
    expect(await sqlState(db.alex.rpc("save_mixture", setup({ p_peptide_id: peptide.withdrawn, p_vial_mg: "10" })), "again")).toBe("ok");
  });
});

describe("personal vials (optional)", () => {
  it("need tracking on, match their mixture's strength, and allow one open vial per mixture", async () => {
    const who = db.blair;
    const mixtureId = (await ok(who.rpc("save_mixture", setup({ p_vial_mg: "10" })), "mixture"))!;
    const vial = (overrides: Record<string, unknown> = {}) =>
      who.rpc("save_personal_vial", { p_label: "B-01", p_peptide_id: peptide.a, p_strength_mg: "10", p_mixture_id: mixtureId, ...overrides });
    expect(await ok(who.rpc("set_supply_tracking", { p_enabled: false }), "off")).toBe(false);
    expect(await sqlState(vial(), "tracking off")).toBe("AP016");
    await ok(who.rpc("set_supply_tracking", { p_enabled: true }), "on");
    expect(await sqlState(vial({ p_strength_mg: "5" }), "strength")).toBe("AP014");
    expect(await sqlState(vial({ p_peptide_id: peptide.b }), "peptide")).toBe("22023");
    expect(await sqlState(vial({ p_label: "  " }), "label")).toBe("22023");
    const first = (await ok(vial(), "vial"))!;
    expect(await sqlState(vial({ p_label: "B-02" }), "second open")).toBe("AP015");
    // "Not mixed yet" needs no mixture.
    expect(await sqlState(vial({ p_label: "B-03", p_mixture_id: null }), "not mixed")).toBe("ok");

    // The mixture's strength can't move under an open vial.
    const mixture = (await getMixture(who, mixtureId))!;
    expect(await sqlState(who.rpc("save_mixture", setup({ p_vial_mg: "12", p_mixture_id: mixtureId, p_version: mixture.version })), "strength change")).toBe("AP014");

    expect(await ok(who.rpc("finish_personal_vial", { p_vial_id: first }), "finish")).toBe(true);
    expect(await ok(who.rpc("finish_personal_vial", { p_vial_id: first }), "finish again")).toBeNull();
    expect(await ok(db.alex.rpc("finish_personal_vial", { p_vial_id: first }), "someone else's")).toBeNull();
    expect(await sqlState(vial({ p_label: "B-04" }), "after finishing")).toBe("ok");
    expect((await listPersonalVials(who, id.blair)).map((v) => [v.label, v.finishedAt !== null])).toEqual([
      ["B-01", true],
      ["B-03", false],
      ["B-04", false],
    ]);
  });
});
