// V2 builder: save_cycle_with_mixtures() (20260928120000) against the real
// local Supabase, through PostgREST as each signed-in person, exactly as the
// builder's server action calls it. The cycle and each peptide's mix are one
// transaction: a new mixture, or a saved one at the version shown (a changed
// setup is its next version, earlier ones kept), linked to that peptide's
// plan, the plan's previous link closed; other plans on the same mixture keep
// theirs. `keep` leaves the plan's mixture as it is; `remove` ends the plan's
// link (the mixture, its versions and its vial stay). Any refusal (stale
// mixture, a tracked vial of another strength, a malformed entry, someone
// else's mixture) saves nothing, the cycle included. A request key makes a
// save idempotent: a retry returns the first save; the key with other
// details, or from another account, is refused.
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getMixture, mixtureHistory, planDraws, planMixtures } from "@/lib/mixtures/service";
import { type Client, createPeptide, cycleArgs, day, interval, plan, saveCycle, tag } from "../support/cycles";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const people = {
  alex: { email: uniqueEmail("v2-mix-alex"), name: "Alex Mixer", role: "researcher" },
  blair: { email: uniqueEmail("v2-mix-blair"), name: "Blair Other", role: "researcher" },
  una: { email: uniqueEmail("v2-mix-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("v2-mix-grace"), name: "Grace Admin", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const peptide = { a: "", b: "" };

type Entry = {
  kind: "set";
  peptide_id: string;
  mixture_id: string | null;
  version: number | null;
  vial_mg: string;
  liquid_ml: string;
  syringe_units: number;
  line_spacing: string;
};
const mix = (peptideId: string, overrides: Partial<Entry> = {}): Entry => ({
  kind: "set",
  peptide_id: peptideId,
  mixture_id: null,
  version: null,
  vial_mg: "10",
  liquid_ml: "2",
  syringe_units: 30,
  line_spacing: "0.5",
  ...overrides,
});

/** The plan's current mixture, as the builder showed it: kept as it is, or removed from the plan. */
const linkEntry = (kind: "keep" | "remove", peptideId: string, mixtureId: string, version: number) => ({
  kind,
  peptide_id: peptideId,
  mixture_id: mixtureId,
  version,
});

/** A builder submission's key and hash (the app hashes what it sent; any 64 hex digits here). */
const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");
const request = () => ({ p_request_key: randomUUID(), p_request_hash: hashOf(randomUUID()) });
type Request = ReturnType<typeof request>;

const withMixes = (who: Client, args: Parameters<typeof cycleArgs>[0], mixes: unknown, req: Request = request()) =>
  who.rpc("save_cycle_with_mixtures", { ...cycleArgs(args), ...req, p_mixtures: mixes as never });

/** An edit of a one-peptide cycle that keeps its phase as it is. */
async function keptPlan(cycleId: string, peptideId: string, phase = interval(day(1), day(20), "0.25", 1)) {
  const planId = await planIdOf(db.alex, cycleId, peptideId);
  const { data } = await serviceClient().from("cycle_revision_phases").select("phase_id").eq("plan_id", planId);
  const kept = { ...phase, phase_id: data![0].phase_id };
  return { planId, plans: [plan(peptideId, [kept], planId, day(1))] };
}

const linksOf = async (planId: string) =>
  ok(serviceClient().from("cycle_plan_mixtures").select("mixture_id, linked_at, unlinked_at").eq("plan_id", planId).order("linked_at"), "links");

async function planIdOf(who: Client, cycleId: string, peptideId: string) {
  const rows = await ok(who.from("cycle_plans").select("id").eq("cycle_id", cycleId).eq("peptide_id", peptideId), "plan id");
  if (rows.length !== 1) throw new Error(`Expected one plan, got ${rows.length}`);
  return rows[0].id;
}

const cyclesNamed = async (name: string) => ok(serviceClient().from("cycles").select("id, current_revision").eq("name", name), "cycles");
/** The cycle's version: each save moves it on (AP010 for a tab holding an older one). */
const cycleVersion = async (cycleId: string) => (await ok(serviceClient().from("cycles").select("version").eq("id", cycleId), "cycle version"))[0]?.version;
const mixtureCount = async (ownerId: string) => (await ok(serviceClient().from("mixtures").select("id").eq("owner_id", ownerId), "mixtures")).length;

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  const t = tag();
  peptide.a = await createPeptide(db.grace, `Cycle mix A ${t}`);
  peptide.b = await createPeptide(db.grace, `Cycle mix B ${t}`);
});

describe("save_cycle_with_mixtures", () => {
  it("creates a cycle with a new mixture and a saved one, in one transaction", async () => {
    // B's saved mixture already serves another of Alex's cycles.
    const other = await ok(saveCycle(db.alex, { name: `Other ${tag()}`, plans: [plan(peptide.b, [interval(day(1), day(10))])] }), "other");
    const otherPlan = await planIdOf(db.alex, other!, peptide.b);
    const saved = (await ok(
      db.alex.rpc("save_mixture", {
        p_peptide_id: peptide.b,
        p_vial_mg: "5",
        p_liquid_ml: "2",
        p_syringe_units: 100,
        p_line_spacing: "2",
        p_plan_ids: [otherPlan],
      }),
      "saved mixture",
    ))!;
    const before = (await getMixture(db.alex, saved))!;

    const name = `Mixed ${tag()}`;
    const cycleId = (await ok(
      withMixes(
        db.alex,
        { name, plans: [plan(peptide.a, [interval(day(1), day(20), "0.25", 1)]), plan(peptide.b, [interval(day(1), day(20), "2.5", 3)])] },
        [mix(peptide.a), mix(peptide.b, { mixture_id: saved, version: before.version, vial_mg: "10" })],
      ),
      "save",
    ))!;
    const [planA, planB] = [await planIdOf(db.alex, cycleId, peptide.a), await planIdOf(db.alex, cycleId, peptide.b)];
    const linked = await planMixtures(db.alex, id.alex);

    // A: a new mixture, version 1, as set.
    const a = linked.get(planA)!;
    expect(a.setup).toEqual({ vialMg: "10", liquidMl: "2", syringe: 30, lineSpacing: "0.5" });
    expect(a.setupNumber).toBe(1);
    expect(a.planIds).toEqual([planA]);

    // B: the saved mixture, its next version (the first kept), serving both cycles now.
    const b = linked.get(planB)!;
    expect(b.id).toBe(saved);
    expect(b.setup).toMatchObject({ vialMg: "10", liquidMl: "2", syringe: 30 });
    expect(b.version).toBeGreaterThan(before.version);
    expect([...b.planIds].sort()).toEqual([otherPlan, planB].sort());
    expect((await mixtureHistory(db.alex, saved)).map((v) => [v.number, v.setup.vialMg])).toEqual([
      [1, "5"],
      [2, "10"],
    ]);
  });

  it("keeps an unchanged mix as it is, and moves a plan off its previous mixture", async () => {
    const name = `Edit mix ${tag()}`;
    const phases = [interval(day(1), day(20), "0.25", 1)];
    const cycleId = (await ok(withMixes(db.alex, { name, plans: [plan(peptide.a, phases)] }, [mix(peptide.a)]), "create"))!;
    const planA = await planIdOf(db.alex, cycleId, peptide.a);
    const first = (await planMixtures(db.alex, id.alex)).get(planA)!;

    // The same setup again with the mixture as shown: no new version, no version bump.
    const { data: phaseRows } = await serviceClient().from("cycle_revision_phases").select("phase_id").eq("plan_id", planA);
    const kept = [interval(day(1), day(20), "0.25", 1, "08:00", phaseRows![0].phase_id)];
    await ok(
      withMixes(db.alex, { name, cycleId, version: 1, plans: [plan(peptide.a, kept, planA, day(1))] }, [
        mix(peptide.a, { mixture_id: first.id, version: first.version }),
      ]),
      "same mix",
    );
    const same = (await getMixture(db.alex, first.id))!;
    expect(same.version).toBe(first.version);
    expect((await mixtureHistory(db.alex, first.id)).length).toBe(1);

    // A new mixture for the plan: the old link ends, and the old mixture's version moves on.
    await ok(
      withMixes(db.alex, { name, cycleId, version: 2, plans: [plan(peptide.a, kept, planA, day(1))] }, [mix(peptide.a, { vial_mg: "20" })]),
      "new mix",
    );
    const now = (await planMixtures(db.alex, id.alex)).get(planA)!;
    expect(now.id).not.toBe(first.id);
    expect(now.setup.vialMg).toBe("20");
    const old = (await getMixture(db.alex, first.id))!;
    expect(old.planIds).toEqual([]);
    expect(old.version).toBe(first.version + 1);
    const links = await ok(serviceClient().from("cycle_plan_mixtures").select("mixture_id, unlinked_at").eq("plan_id", planA).order("linked_at"), "links");
    expect(links.map((l) => [l.mixture_id, l.unlinked_at === null])).toEqual([
      [first.id, false],
      [now.id, true],
    ]);
  });

  it("saves nothing when a mix is refused: a stale mixture, a tracked vial of another strength", async () => {
    const saved = (await ok(
      db.alex.rpc("save_mixture", { p_peptide_id: peptide.a, p_vial_mg: "5", p_liquid_ml: "1", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [] }),
      "saved",
    ))!;
    const current = (await getMixture(db.alex, saved))!;
    const plans = [plan(peptide.a, [interval(day(1), day(20))])];
    const mixtures = await mixtureCount(id.alex);

    const stale = `Stale ${tag()}`;
    expect(await sqlState(withMixes(db.alex, { name: stale, plans }, [mix(peptide.a, { mixture_id: saved, version: current.version + 1 })]), "stale")).toBe("AP011");
    expect(await cyclesNamed(stale)).toEqual([]);

    await ok(db.alex.rpc("set_supply_tracking", { p_enabled: true }), "tracking");
    await ok(db.alex.rpc("save_personal_vial", { p_label: `T-${tag()}`, p_peptide_id: peptide.a, p_strength_mg: "5", p_mixture_id: saved }), "vial");
    const fresh = (await getMixture(db.alex, saved))!;
    const tracked = `Tracked ${tag()}`;
    expect(
      await sqlState(withMixes(db.alex, { name: tracked, plans }, [mix(peptide.a, { mixture_id: saved, version: fresh.version, vial_mg: "10" })]), "vial strength"),
    ).toBe("AP014");
    expect(await cyclesNamed(tracked)).toEqual([]);
    expect((await mixtureHistory(db.alex, saved)).length).toBe(1);
    expect(await mixtureCount(id.alex)).toBe(mixtures);

    // The same strength is fine: the vial follows its mixture onto the plan.
    const fine = `Fine ${tag()}`;
    const cycleId = (await ok(withMixes(db.alex, { name: fine, plans }, [mix(peptide.a, { mixture_id: saved, version: fresh.version, vial_mg: "5", liquid_ml: "2" })]), "same strength"))!;
    expect((await planMixtures(db.alex, id.alex)).get(await planIdOf(db.alex, cycleId, peptide.a))?.id).toBe(saved);
  });

  it("refuses malformed entries, other people's mixtures and callers who may not write", async () => {
    const plans = [plan(peptide.a, [interval(day(1), day(20))])];
    const name = `Refused ${tag()}`;
    const cases: [string, unknown][] = [
      ["not an array", { peptide_id: peptide.a }],
      ["a peptide outside the cycle", [mix(peptide.b)]],
      ["the same peptide twice", [mix(peptide.a), mix(peptide.a)]],
      ["a thousands-looking vial", [mix(peptide.a, { vial_mg: "1,000" })]],
      ["too much liquid", [mix(peptide.a, { liquid_ml: "1001" })]],
      ["a syringe that doesn't exist", [mix(peptide.a, { syringe_units: 40 })]],
      ["a version without a mixture", [mix(peptide.a, { version: 1 })]],
      ["a mixture without a version", [mix(peptide.a, { mixture_id: peptide.a })]],
      ["a number as a decimal", [{ ...mix(peptide.a), vial_mg: 10 }]],
      ["no kind", [{ ...mix(peptide.a), kind: undefined }]],
      ["an unknown kind", [{ ...mix(peptide.a), kind: "clear" }]],
      ["a keep without its mixture", [{ kind: "keep", peptide_id: peptide.a, mixture_id: null, version: null }]],
      ["a remove with a setup", [{ ...linkEntry("remove", peptide.a, peptide.a, 1), vial_mg: "10" }]],
    ];
    for (const [label, mixes] of cases) expect(await sqlState(withMixes(db.alex, { name, plans }, mixes), label), label).toBe("22023");
    for (const [label, req] of [
      ["a malformed request hash", { ...request(), p_request_hash: "not-a-hash" }],
      ["an upper-case request hash", { ...request(), p_request_hash: hashOf("x").toUpperCase() }],
    ] as const) {
      expect(await sqlState(withMixes(db.alex, { name, plans }, [], req), label), label).toBe("22023");
    }

    const blairs = (await ok(
      db.blair.rpc("save_mixture", { p_peptide_id: peptide.a, p_vial_mg: "5", p_liquid_ml: "1", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [] }),
      "blair's",
    ))!;
    const version = (await getMixture(db.blair, blairs))!.version;
    expect(await sqlState(withMixes(db.alex, { name, plans }, [mix(peptide.a, { mixture_id: blairs, version })]), "someone else's")).toBe("AP011");
    expect(await cyclesNamed(name)).toEqual([]);
    expect((await getMixture(db.blair, blairs))!.version).toBe(version);

    expect(await sqlState(withMixes(db.una, { name, plans }, [mix(peptide.a)]), "unacknowledged")).toBe("42501");
    expect(await sqlState(anonClient().rpc("save_cycle_with_mixtures", { ...cycleArgs({ name, plans }), ...request(), p_mixtures: [] }), "anon")).toBe("42501");
    expect(await sqlState(anonClient().rpc("cycle_save_replay", request()), "anon replay")).toBe("42501");
    expect(await sqlState(db.una.rpc("cycle_save_replay", request()), "unacknowledged replay")).toBe("42501");
    expect(await cyclesNamed(name)).toEqual([]);
  });

  it("with no mixes, is save_cycle", async () => {
    const name = `Plain ${tag()}`;
    const cycleId = (await ok(withMixes(db.alex, { name, plans: [plan(peptide.a, [interval(day(1), day(20))])] }, []), "plain"))!;
    expect(await cyclesNamed(name)).toEqual([{ id: cycleId, current_revision: 1 }]);
    // An edit of someone else's cycle is null, as save_cycle's.
    expect(await ok(withMixes(db.blair, { name, cycleId, version: 1, plans: [plan(peptide.a, [interval(day(1), day(20))])] }, [mix(peptide.a)]), "blair")).toBeNull();
  });
});

describe("keep, set and remove", () => {
  it("remove: a cleared mix comes off the plan; the mixture, its versions and its vial stay; Today has no units for it", async () => {
    const name = `Remove ${tag()}`;
    const cycleId = (await ok(withMixes(db.alex, { name, plans: [plan(peptide.a, [interval(day(1), day(20), "0.25", 1)])] }, [mix(peptide.a)]), "create"))!;
    const { planId, plans } = await keptPlan(cycleId, peptide.a);
    const created = (await planMixtures(db.alex, id.alex)).get(planId)!;
    expect(await planDraws(db.alex, id.alex, [{ planId, doseMg: "0.25" }])).toEqual([expect.objectContaining({ state: "calculated" })]);
    // A tracked open vial of that mixture.
    await ok(db.alex.rpc("set_supply_tracking", { p_enabled: true }), "tracking");
    const vial = (await ok(
      db.alex.rpc("save_personal_vial", { p_label: `R-${tag()}`, p_peptide_id: peptide.a, p_strength_mg: "10", p_mixture_id: created.id }),
      "vial",
    ))!;
    const shown = (await getMixture(db.alex, created.id))!;

    await ok(withMixes(db.alex, { name, cycleId, version: 1, plans }, [linkEntry("remove", peptide.a, shown.id, shown.version)]), "remove");
    expect((await planMixtures(db.alex, id.alex)).has(planId)).toBe(false);
    expect(await planDraws(db.alex, id.alex, [{ planId, doseMg: "0.25" }])).toEqual([{ state: "no-mixture" }]);
    const links = await linksOf(planId);
    expect(links).toHaveLength(1);
    expect(links[0].mixture_id).toBe(created.id);
    expect(links[0].unlinked_at).not.toBeNull();
    // Still saved, with its setup and history; its vial keeps it; a tab showing it before can't save over it.
    const after = (await getMixture(db.alex, created.id))!;
    expect(after.setup).toEqual(created.setup);
    expect(after.version).toBe(shown.version + 1);
    expect((await mixtureHistory(db.alex, created.id)).length).toBe(1);
    const vials = await ok(serviceClient().from("personal_vials").select("mixture_id, finished_at").eq("id", vial), "vial row");
    expect(vials).toEqual([{ mixture_id: created.id, finished_at: null }]);

    // Removing it again (a stale builder) is refused, and saves nothing.
    expect(
      await sqlState(withMixes(db.alex, { name, cycleId, version: 2, plans }, [linkEntry("remove", peptide.a, after.id, after.version)]), "not linked"),
    ).toBe("AP011");
    expect(await cycleVersion(cycleId)).toBe(2);
  });

  it("keep leaves the plan's mixture as it is; set with a changed setup is its next version on the same link", async () => {
    const name = `Keep ${tag()}`;
    const cycleId = (await ok(withMixes(db.alex, { name, plans: [plan(peptide.a, [interval(day(1), day(20), "0.25", 1)])] }, [mix(peptide.a)]), "create"))!;
    const { planId, plans } = await keptPlan(cycleId, peptide.a);
    const first = (await planMixtures(db.alex, id.alex)).get(planId)!;
    const firstLinks = await linksOf(planId);

    // Unchanged: nothing written.
    await ok(withMixes(db.alex, { name, cycleId, version: 1, plans }, [linkEntry("keep", peptide.a, first.id, first.version)]), "keep");
    const kept = (await getMixture(db.alex, first.id))!;
    expect(kept.version).toBe(first.version);
    expect(kept.planIds).toEqual([planId]);
    expect((await mixtureHistory(db.alex, first.id)).length).toBe(1);
    expect(await linksOf(planId)).toEqual(firstLinks);

    // Changed: the next version of the same mixture, on the same link.
    await ok(
      withMixes(db.alex, { name, cycleId, version: 2, plans }, [mix(peptide.a, { mixture_id: first.id, version: first.version, liquid_ml: "3" })]),
      "change",
    );
    const changed = (await planMixtures(db.alex, id.alex)).get(planId)!;
    expect(changed.id).toBe(first.id);
    expect(changed.setup.liquidMl).toBe("3");
    expect((await mixtureHistory(db.alex, first.id)).map((v) => [v.number, v.setup.liquidMl])).toEqual([
      [1, "2"],
      [2, "3"],
    ]);
    expect(await linksOf(planId)).toEqual(firstLinks);

    // Keeping it at the version the builder showed before the change is stale.
    expect(await sqlState(withMixes(db.alex, { name, cycleId, version: 3, plans }, [linkEntry("keep", peptide.a, first.id, first.version)]), "stale keep")).toBe(
      "AP011",
    );
    // So is keeping a mixture the plan doesn't use.
    const unlinked = (await ok(
      db.alex.rpc("save_mixture", { p_peptide_id: peptide.a, p_vial_mg: "5", p_liquid_ml: "1", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [] }),
      "unlinked",
    ))!;
    const other = (await getMixture(db.alex, unlinked))!;
    expect(await sqlState(withMixes(db.alex, { name, cycleId, version: 3, plans }, [linkEntry("keep", peptide.a, other.id, other.version)]), "not its mixture")).toBe(
      "AP011",
    );
    expect(await cycleVersion(cycleId)).toBe(3);
  });
});

describe("request keys", () => {
  it("a retry of a save returns that save and writes nothing more: a new cycle, an edit, two at once", async () => {
    const name = `Replay ${tag()}`;
    const args = { name, plans: [plan(peptide.a, [interval(day(1), day(20), "0.25", 1)])] };
    const req = request();
    const cycleId = (await ok(withMixes(db.alex, args, [mix(peptide.a)], req), "first"))!;
    const mixtures = await mixtureCount(id.alex);
    // The answer was lost; the builder sends the same submission again.
    expect(await ok(withMixes(db.alex, args, [mix(peptide.a)], req), "retry")).toBe(cycleId);
    expect(await cyclesNamed(name)).toEqual([{ id: cycleId, current_revision: 1 }]);
    expect(await mixtureCount(id.alex)).toBe(mixtures);
    expect(await ok(db.alex.rpc("cycle_save_replay", req), "replay")).toBe(cycleId);
    expect(await ok(db.alex.rpc("cycle_save_replay", request()), "unknown key")).toBeNull();

    // An edit: the retry returns the cycle and saves nothing again (and no AP010, though the version moved on).
    const { planId, plans } = await keptPlan(cycleId, peptide.a);
    const linked = (await planMixtures(db.alex, id.alex)).get(planId)!;
    const edit = { name, cycleId, version: 1, plans };
    const changed = [mix(peptide.a, { mixture_id: linked.id, version: linked.version, vial_mg: "20" })];
    const editReq = request();
    expect(await ok(withMixes(db.alex, edit, changed, editReq), "edit")).toBe(cycleId);
    expect(await ok(withMixes(db.alex, edit, changed, editReq), "edit retry")).toBe(cycleId);
    expect(await cycleVersion(cycleId)).toBe(2);
    expect((await mixtureHistory(db.alex, linked.id)).length).toBe(2);

    // Two at once with one key: the second waits for the first, then returns its cycle.
    const raced = `Raced ${tag()}`;
    const raceReq = request();
    const both = await Promise.all([0, 1].map(() => ok(withMixes(db.alex, { ...args, name: raced }, [mix(peptide.a)], raceReq), "raced")));
    expect(both[0]).toBe(both[1]);
    expect(await cyclesNamed(raced)).toEqual([{ id: both[0], current_revision: 1 }]);
  });

  it("refuses the key with other details or from another account; a refused save claims no key", async () => {
    const plans = [plan(peptide.a, [interval(day(1), day(20))])];
    const name = `Claimed ${tag()}`;
    const req = request();
    const cycleId = (await ok(withMixes(db.alex, { name, plans }, [], req), "first"))!;

    // Other details under the same key.
    const other = `Other details ${tag()}`;
    const otherReq = { ...req, p_request_hash: hashOf(other) };
    expect(await sqlState(withMixes(db.alex, { name: other, plans }, [], otherReq), "other details")).toBe("22023");
    expect(await sqlState(db.alex.rpc("cycle_save_replay", otherReq), "other details replay")).toBe("22023");
    expect(await cyclesNamed(other)).toEqual([]);

    // Another account's key, even with the same details.
    const blairs = `Blair's ${tag()}`;
    expect(await sqlState(withMixes(db.blair, { name: blairs, plans }, [], req), "another account")).toBe("22023");
    expect(await sqlState(db.blair.rpc("cycle_save_replay", req), "another account replay")).toBe("22023");
    expect(await cyclesNamed(blairs)).toEqual([]);
    expect(await cyclesNamed(name)).toEqual([{ id: cycleId, current_revision: 1 }]);

    // A refused save (a stale mixture) claims nothing: the retry saves.
    const saved = (await ok(
      db.alex.rpc("save_mixture", { p_peptide_id: peptide.a, p_vial_mg: "5", p_liquid_ml: "1", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [] }),
      "saved",
    ))!;
    const version = (await getMixture(db.alex, saved))!.version;
    const retried = `Retried ${tag()}`;
    const retryReq = request();
    expect(await sqlState(withMixes(db.alex, { name: retried, plans }, [mix(peptide.a, { mixture_id: saved, version: version + 1 })], retryReq), "stale")).toBe(
      "AP011",
    );
    expect(await ok(db.alex.rpc("cycle_save_replay", retryReq), "unclaimed")).toBeNull();
    const retriedId = (await ok(withMixes(db.alex, { name: retried, plans }, [mix(peptide.a, { mixture_id: saved, version })], retryReq), "retry"))!;
    expect(await cyclesNamed(retried)).toEqual([{ id: retriedId, current_revision: 1 }]);
  });
});
