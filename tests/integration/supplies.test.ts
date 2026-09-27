// S14 personal supplies (R8) against the real local Supabase, through
// PostgREST as each signed-in person, exactly as the app reads and writes:
// the owner reads and writes (only through the functions); a granted admin
// reads and never writes; a revoked or non-granted admin, another
// researcher, an unacknowledged account and anonymous callers get nothing;
// nobody can link another owner's mixture. reopen_personal_vial keeps a
// vial's mixture only while it still fits. Calculating (saving mixtures)
// never deducts, and a business sale to the researcher's own account never
// adds to their supplies. The estimate the screen shows is the strength
// minus the recorded deductions, read completely (keyset paging).
// Cycles use a fixed-offset zone where it is about 12:00 now (tests/support/noon).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { confirmationsByCycle, listDoseRecords } from "@/lib/doses/service";
import { recordPurchase, recordSale } from "@/lib/inventory/service";
import { getMixture, getSupplyTracking, listMixtures, listPersonalVials } from "@/lib/mixtures/service";
import { deductionsOfVials, listDeductions, reopenPersonalVial } from "@/lib/supplies/service";
import { suppliesView } from "@/lib/supplies/view";
import { type Client, createCycle, createPeptide, day, interval, plan, tag } from "../support/cycles";
import { confirmArgsSeen, d, NOON, occurrenceOn } from "../support/doses";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const people = {
  alex: { email: uniqueEmail("s14-alex"), name: "Alex Supplies", role: "researcher" },
  blair: { email: uniqueEmail("s14-blair"), name: "Blair Other", role: "researcher" },
  cara: { email: uniqueEmail("s14-cara"), name: "Cara Calculates", role: "researcher" },
  una: { email: uniqueEmail("s14-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("s14-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("s14-noah"), name: "Noah Admin", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
let peptideA = "";

const TABLES = ["personal_vials", "personal_supply_settings", "personal_vial_deductions"] as const;

async function planIdOf(who: Client, cycleId: string) {
  const rows = await ok(who.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan id");
  return rows[0].id;
}

const mixtureArgs = (planIds: string[], overrides: Record<string, unknown> = {}) => ({
  p_peptide_id: peptideA,
  p_vial_mg: "10",
  p_liquid_ml: "2",
  p_syringe_units: 100,
  p_line_spacing: "2",
  p_plan_ids: planIds,
  ...overrides,
});

/** A researcher with tracking on, a cycle (0.4 mg every 2 days at 08:00 from 4 days ago), a mixture for it and an open vial. */
async function tracked(who: Name, strength = "10") {
  const cycleId = await createCycle(db[who], { timeZone: NOON, plans: [plan(peptideA, [interval(d(-4), d(20), "0.4", 2, "08:00")])] });
  const planId = await planIdOf(db[who], cycleId);
  await ok(db[who].rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
  const mixtureId = (await ok(db[who].rpc("save_mixture", mixtureArgs([planId], { p_vial_mg: strength })), "mixture"))!;
  const vialId = (await ok(
    db[who].rpc("save_personal_vial", { p_label: `V-${tag()}`, p_peptide_id: peptideA, p_strength_mg: strength, p_mixture_id: mixtureId }),
    "vial",
  ))!;
  return { cycleId, planId, mixtureId, vialId };
}

const confirmOn = async (who: Name, cycleId: string, date: string) =>
  ok(db[who].rpc("confirm_dose", (await confirmArgsSeen(db[who], await occurrenceOn(db[who], cycleId, date))) as never), `confirm ${date}`);

const vialRow = (vialId: string) =>
  ok(serviceClient().from("personal_vials").select("label, mixture_id, strength_mg::text, finished_at, updated_at").eq("id", vialId).single(), "vial row");

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  peptideA = await createPeptide(db.grace, `Supplies A ${tag()}`);
});

describe("personal supplies are the owner's; a grant reads, never writes", () => {
  it("isolates everyone else, lets a granted admin read only, and denies again on revoke", async () => {
    const alex = await tracked("alex");
    await confirmOn("alex", alex.cycleId, d(0));
    await ok(db.alex.rpc("share_with_team"), "share with the team");

    // The owner reads everything, and writes only through the functions.
    expect((await listPersonalVials(db.alex, id.alex)).map((v) => v.id)).toEqual([alex.vialId]);
    expect(await listDeductions(db.alex, id.alex)).toEqual([expect.objectContaining({ vialId: alex.vialId, amountMg: "0.4", remainingAfterMg: "9.6" })]);
    expect(await getSupplyTracking(db.alex, id.alex)).toBe(true);
    for (const table of TABLES) {
      expect(await sqlState(db.alex.from(table).update({ owner_id: id.alex } as never).eq("owner_id", id.alex), `owner updates ${table}`)).toBe("42501");
      expect(await sqlState(db.alex.from(table).delete().eq("owner_id", id.alex), `owner deletes ${table}`)).toBe("42501");
    }
    expect(await sqlState(db.alex.from("personal_vials").insert({ owner_id: id.alex, peptide_id: peptideA, label: "X", strength_mg: 1 } as never), "owner inserts")).toBe("42501");

    // The granted admin reads Alex's supplies ...
    expect((await listPersonalVials(db.grace, id.alex)).map((v) => v.id)).toEqual([alex.vialId]);
    expect(await listDeductions(db.grace, id.alex)).toHaveLength(1);
    expect(await getSupplyTracking(db.grace, id.alex)).toBe(true);
    // ... and changes none of it: her own tracking is hers, Alex's vial isn't.
    await ok(db.grace.rpc("set_supply_tracking", { p_enabled: true }), "grace's own tracking");
    const before = await vialRow(alex.vialId);
    expect(await ok(db.grace.rpc("finish_personal_vial", { p_vial_id: alex.vialId }), "grace finishes")).toBeNull();
    expect(
      await ok(db.grace.rpc("save_personal_vial", { p_label: "Hijack", p_peptide_id: peptideA, p_strength_mg: "10", p_vial_id: alex.vialId }), "grace edits"),
    ).toBeNull();
    expect(await ok(db.grace.rpc("reopen_personal_vial", { p_vial_id: alex.vialId }), "grace reopens")).toBeNull();
    // Linking her own vial to Alex's mixture is refused (not hers).
    expect(
      await sqlState(db.grace.rpc("save_personal_vial", { p_label: "G", p_peptide_id: peptideA, p_strength_mg: "10", p_mixture_id: alex.mixtureId }), "grace links"),
    ).toBe("22023");
    for (const table of TABLES) {
      expect(await sqlState(db.grace.from(table).delete().eq("owner_id", id.alex), `grace deletes ${table}`)).toBe("42501");
    }
    expect(await vialRow(alex.vialId)).toEqual(before);
    expect(await getSupplyTracking(db.alex, id.alex)).toBe(true);

    // Another researcher reads nothing; every admin reads while Alex shares; neither's writes reach Alex's vial.
    expect(await listPersonalVials(db.blair, id.alex)).toEqual([]);
    expect(await listDeductions(db.blair, id.alex)).toEqual([]);
    expect(await getSupplyTracking(db.blair, id.alex)).toBe(false);
    expect((await listPersonalVials(db.noah, id.alex)).map((v) => v.id)).toEqual([alex.vialId]);
    for (const who of ["blair", "noah"] as const) {
      expect(await ok(db[who].rpc("finish_personal_vial", { p_vial_id: alex.vialId }), `${who} finishes`)).toBeNull();
    }
    await ok(db.blair.rpc("set_supply_tracking", { p_enabled: true }), "blair's own tracking");
    expect(
      await sqlState(db.blair.rpc("save_personal_vial", { p_label: "B", p_peptide_id: peptideA, p_strength_mg: "10", p_mixture_id: alex.mixtureId }), "blair links"),
    ).toBe("22023");
    expect(
      await ok(db.blair.rpc("save_personal_vial", { p_label: "B", p_peptide_id: peptideA, p_strength_mg: "10", p_vial_id: alex.vialId }), "blair edits"),
    ).toBeNull();

    // Unacknowledged: reads nothing of Alex's, writes nothing at all.
    expect(await listPersonalVials(db.una, id.alex)).toEqual([]);
    expect(await listDeductions(db.una, id.alex)).toEqual([]);
    expect(await sqlState(db.una.rpc("set_supply_tracking", { p_enabled: true }), "una tracking")).toBe("42501");
    expect(await sqlState(db.una.rpc("save_personal_vial", { p_label: "U", p_peptide_id: peptideA, p_strength_mg: "1" }), "una vial")).toBe("42501");
    expect(await sqlState(db.una.rpc("reopen_personal_vial", { p_vial_id: alex.vialId }), "una reopens")).toBe("42501");

    // Anonymous: no rows and no functions.
    const anon = anonClient();
    for (const table of TABLES) {
      const { data } = await anon.from(table).select("owner_id").eq("owner_id", id.alex);
      expect(data ?? [], table).toEqual([]);
    }
    for (const [name, args] of [
      ["set_supply_tracking", { p_enabled: true }],
      ["finish_personal_vial", { p_vial_id: alex.vialId }],
      ["reopen_personal_vial", { p_vial_id: alex.vialId }],
    ] as const) {
      expect(await sqlState(anon.rpc(name, args as never), `anon ${name}`)).not.toBe("ok");
    }
    expect(await vialRow(alex.vialId)).toEqual(before);

    // Revoked: denied on the next read.
    await ok(db.alex.rpc("stop_sharing_with_team"), "stop sharing");
    expect(await listPersonalVials(db.grace, id.alex)).toEqual([]);
    expect(await listDeductions(db.grace, id.alex)).toEqual([]);
    expect(await getSupplyTracking(db.grace, id.alex)).toBe(false);
  });
});

describe("reopening a finished vial", () => {
  it("keeps its mixture while it fits, reopens it unlinked otherwise, and keeps its history", async () => {
    const blair = await tracked("blair", "2");
    const [first] = [(await confirmOn("blair", blair.cycleId, d(-4)))!];
    expect(first).toMatchObject({ deduction: { remaining_after_mg: "1.6" } });

    // Finished by mistake, reopened as it was: its mixture and deductions stay.
    expect(await ok(db.blair.rpc("finish_personal_vial", { p_vial_id: blair.vialId }), "finish")).toBe(true);
    expect(await ok(db.blair.rpc("reopen_personal_vial", { p_vial_id: blair.vialId }), "reopen")).toBe("reopened");
    expect(await vialRow(blair.vialId)).toMatchObject({ mixture_id: blair.mixtureId, finished_at: null });
    expect(await ok(db.blair.rpc("reopen_personal_vial", { p_vial_id: blair.vialId }), "reopen an open vial")).toBeNull();
    // The estimate carries on from where it was.
    expect(await confirmOn("blair", blair.cycleId, d(-2))).toMatchObject({ deduction: { remaining_before_mg: "1.6", remaining_after_mg: "1.2" } });

    // Another vial took the mixture meanwhile: reopened "Not mixed yet".
    await ok(db.blair.rpc("finish_personal_vial", { p_vial_id: blair.vialId }), "finish again");
    const second = (await ok(
      db.blair.rpc("save_personal_vial", { p_label: `W-${tag()}`, p_peptide_id: peptideA, p_strength_mg: "2", p_mixture_id: blair.mixtureId }),
      "second vial",
    ))!;
    expect(await reopenPersonalVial(db.blair, blair.vialId)).toEqual({ kind: "unlinked" });
    expect(await vialRow(blair.vialId)).toMatchObject({ mixture_id: null, finished_at: null });

    // The mixture's strength changed while its vial was finished: reopened unlinked.
    await ok(db.blair.rpc("finish_personal_vial", { p_vial_id: second }), "finish second");
    const mixture = (await getMixture(db.blair, blair.mixtureId))!;
    await ok(db.blair.rpc("save_mixture", mixtureArgs([blair.planId], { p_vial_mg: "5", p_mixture_id: blair.mixtureId, p_version: mixture.version })), "strength change");
    expect(await reopenPersonalVial(db.blair, second)).toEqual({ kind: "unlinked" });

    // Its mixture was deleted: reopened unlinked.
    const spare = (await ok(db.blair.rpc("save_mixture", mixtureArgs([], { p_vial_mg: "3" })), "spare mixture"))!;
    const third = (await ok(
      db.blair.rpc("save_personal_vial", { p_label: `X-${tag()}`, p_peptide_id: peptideA, p_strength_mg: "3", p_mixture_id: spare }),
      "third vial",
    ))!;
    await ok(db.blair.rpc("finish_personal_vial", { p_vial_id: third }), "finish third");
    await ok(db.blair.rpc("delete_mixture", { p_mixture_id: spare, p_version: (await getMixture(db.blair, spare))!.version }), "delete spare");
    expect(await reopenPersonalVial(db.blair, third)).toEqual({ kind: "unlinked" });

    // Tracking off: refused. Someone else's vial: nothing.
    await ok(db.blair.rpc("finish_personal_vial", { p_vial_id: third }), "finish third again");
    await ok(db.blair.rpc("set_supply_tracking", { p_enabled: false }), "tracking off");
    expect(await reopenPersonalVial(db.blair, third)).toEqual({ kind: "tracking_off" });
    await ok(db.blair.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
    expect(await reopenPersonalVial(db.alex, third)).toEqual({ kind: "not_found" });

    // History intact: both deductions on the first vial (in the order taken: the DB clock may step back, so by estimate).
    const history = await deductionsOfVials(db.blair, [blair.vialId, second, third], { chunkSize: 1, pageSize: 1 });
    expect(history.map((x) => [x.vialId, x.amountMg, x.remainingAfterMg]).sort((a, b) => Number(b[2]) - Number(a[2]))).toEqual([
      [blair.vialId, "0.4", "1.6"],
      [blair.vialId, "0.4", "1.2"],
    ]);
  });
});

describe("the estimate as the screen reads it", () => {
  it("is the strength minus every recorded deduction, read completely a page at a time", async () => {
    const cara = await tracked("cara", "1");
    for (const date of [d(-4), d(-2), d(0)]) await confirmOn("cara", cara.cycleId, date);
    const all = await listDeductions(db.cara, id.cara);
    expect(await listDeductions(db.cara, id.cara, { pageSize: 1 })).toEqual(all);
    expect(all.map((x) => [x.remainingAfterMg, x.stockDiscrepancy]).sort((a, b) => Number(b[0]) - Number(a[0]))).toEqual([
      ["0.6", false],
      ["0.2", false],
      ["-0.2", true],
    ]);

    const [vials, mixtures, library, records, cycles] = await Promise.all([
      listPersonalVials(db.cara, id.cara),
      listMixtures(db.cara, id.cara),
      listCyclePeptides(db.cara),
      listDoseRecords(db.cara, id.cara),
      listCycles(db.cara, id.cara),
    ]);
    const view = suppliesView({
      tracking: true,
      vials,
      mixtures,
      peptides: new Map(library.map((p) => [p.id, p])),
      deductions: all,
      doses: records,
      cycles,
      confirmations: confirmationsByCycle(records),
      now: new Date(),
    });
    const card = view.groups.flatMap((g) => g.vials).find((v) => v.id === cara.vialId)!;
    expect(card).toMatchObject({ state: "Estimate exceeds vial — check your records", remaining: "0 mg · 0.2 mg over", uses: "3 confirmed doses deducted" });
    expect(card.history.map((h) => [h.after, h.discrepancy])).toEqual([
      ["0.2 mg over", true],
      ["0.2 mg left", false],
      ["0.6 mg left", false],
    ]);
    expect(card.history[0].href).toContain(`/app/today?dose=${encodeURIComponent(records.at(-1)!.occurrenceKey)}`);
  });
});

describe("deleting a mixture", () => {
  it("unlinks its open vial (never linked to a deleted mixture) and leaves finished vials' history as it was", async () => {
    const mixtureId = (await ok(db.blair.rpc("save_mixture", mixtureArgs([], { p_vial_mg: "4" })), "mixture"))!;
    const vial = (label: string) =>
      ok(db.blair.rpc("save_personal_vial", { p_label: `${label}-${tag()}`, p_peptide_id: peptideA, p_strength_mg: "4", p_mixture_id: mixtureId }), label);
    const finished = (await vial("F"))!;
    await ok(db.blair.rpc("finish_personal_vial", { p_vial_id: finished }), "finish");
    const open = (await vial("O"))!;
    await ok(db.blair.rpc("delete_mixture", { p_mixture_id: mixtureId, p_version: (await getMixture(db.blair, mixtureId))!.version }), "delete");
    expect(await vialRow(open)).toMatchObject({ mixture_id: null, finished_at: null });
    expect(await vialRow(finished)).toMatchObject({ mixture_id: mixtureId });
    // Someone else can't delete it (nothing locked or changed): null.
    const other = (await ok(db.blair.rpc("save_mixture", mixtureArgs([], { p_vial_mg: "4" })), "other"))!;
    expect(await ok(db.alex.rpc("delete_mixture", { p_mixture_id: other, p_version: 1 }), "alex deletes blair's")).toBeNull();
    expect((await getMixture(db.blair, other))!.deleted).toBe(false);
  });
});

describe("nothing adds to or deducts from personal supplies but a confirmed dose", () => {
  it("calculating never deducts: saving and relinking mixtures changes no vial and records no deduction", async () => {
    const cara = await tracked("cara", "8");
    const before = await vialRow(cara.vialId);
    for (const liquid of ["4", "2.5"]) {
      const current = (await getMixture(db.cara, cara.mixtureId))!;
      await ok(db.cara.rpc("save_mixture", mixtureArgs([cara.planId], { p_vial_mg: "8", p_liquid_ml: liquid, p_mixture_id: cara.mixtureId, p_version: current.version })), `save ${liquid}`);
    }
    // Unlinked and linked again, as the calculator's plan ticks do.
    const current = (await getMixture(db.cara, cara.mixtureId))!;
    await ok(db.cara.rpc("save_mixture", mixtureArgs([], { p_vial_mg: "8", p_mixture_id: cara.mixtureId, p_version: current.version })), "unlink");
    const unlinked = (await getMixture(db.cara, cara.mixtureId))!;
    await ok(db.cara.rpc("save_mixture", mixtureArgs([cara.planId], { p_vial_mg: "8", p_mixture_id: cara.mixtureId, p_version: unlinked.version })), "relink");

    expect(await vialRow(cara.vialId)).toEqual(before);
    expect(await deductionsOfVials(db.cara, [cara.vialId])).toEqual([]);
    expect(await ok(serviceClient().from("dose_records").select("id").eq("cycle_id", cara.cycleId), "doses")).toEqual([]);
  });

  it("a business sale to the researcher's own account never adds to their supplies", async () => {
    const alexVials = await listPersonalVials(db.alex, id.alex);
    const alexDeductions = await listDeductions(db.alex, id.alex);
    const tracking = await getSupplyTracking(db.alex, id.alex);

    const purchase = await recordPurchase(db.grace, {
      idempotencyKey: randomUUID(),
      stockItemId: null,
      peptideId: peptideA,
      strengthMg: "10",
      receivedOn: day(-3),
      quantity: 5,
      unitCost: "20",
    });
    if (purchase.kind !== "recorded") throw new Error(`purchase: ${purchase.kind}`);
    const sale = await recordSale(db.grace, {
      idempotencyKey: randomUUID(),
      stockItemId: purchase.stockItemId,
      soldOn: day(-1),
      quantity: 2,
      unitPrice: "40",
      sellerId: id.grace,
      buyer: { type: "account", profileId: id.alex },
    });
    expect(sale.kind).toBe("recorded");

    expect(await listPersonalVials(db.alex, id.alex)).toEqual(alexVials);
    expect(await listDeductions(db.alex, id.alex)).toEqual(alexDeductions);
    expect(await getSupplyTracking(db.alex, id.alex)).toBe(tracking);
    // Nor anyone's: no personal vial exists for the sold peptide beyond the ones researchers added.
    const sold = await ok(serviceClient().from("personal_vials").select("owner_id").eq("peptide_id", peptideA).eq("owner_id", id.grace), "grace vials");
    expect(sold).toEqual([]);
  });
});
