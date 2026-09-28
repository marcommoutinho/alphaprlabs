// V2 builder edits end to end, below the screen: the builder's own model as
// "Edit future plan" opens it (builderForEdit, the page's code), the change a
// researcher makes (togglePlan, "End it now" through endBefore, the mix
// fields), and the save the builder sends (formFromBuilder, mixEntry with
// planLink, a request key) through the real server action, reviseCycle and
// save_cycle_with_mixtures against the local Supabase. The action runs as the
// signed-in researcher: only its cookie session is swapped for a signed-in
// client.
//   * Unchecking an upcoming peptide and checking it again keeps its plan,
//     so its mix saves as unchanged (keep), cleared (remove) or changed (set).
//     A fresh plan with the old link (the model before the fix) is refused.
//   * "End it now" on the only phase under way ends it the day before the
//     edit applies: the plan (and a one-peptide cycle) ends, nothing is
//     planned after, and every settled dose stays attached.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  blankMix,
  type BuilderState,
  builderForEdit,
  endBefore,
  formFromBuilder,
  mixEntry,
  newBuilderPlan,
  planLink,
  togglePlan,
} from "@/lib/cycles/builder";
import { MIX_CHANGED } from "@/lib/cycles/display";
import { cycleOccurrences, cycleStatus } from "@/lib/cycles/schedule";
import { getCycle } from "@/lib/cycles/service";
import { cycleConfirmations } from "@/lib/doses/service";
import { getMixture, listMixtures, mixtureHistory } from "@/lib/mixtures/service";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { ensureAccount, ok, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";
import { d, NOON, noonZoneInstant } from "../support/noon";

const acting = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const { saveCycleAction } = await import("@/app/(private)/app/cycles/actions");

const admin = { email: uniqueEmail("v2-edits-admin"), name: "V2 Edits Admin" };
const riley = { email: uniqueEmail("v2-edits-riley"), name: "V2 Riley" };
let db: Client;
let rileyId: string;
const peptide = { a: "", b: "", c: "" };

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  rileyId = await ensureAccount({ ...riley, role: "researcher" });
  const adminDb = await signedInClient(admin.email);
  db = await signedInClient(riley.email);
  acting.client = db;
  const t = tag();
  peptide.a = await createPeptide(adminDb, `Edits A ${t}`);
  peptide.b = await createPeptide(adminDb, `Edits B ${t}`);
  peptide.c = await createPeptide(adminDb, `Edits C ${t}`);
});

/** The builder as "Edit future plan" opens it now. */
async function open(cycleId: string) {
  const [cycle, confirmations, mixtures] = await Promise.all([getCycle(db, cycleId), cycleConfirmations(db, cycleId), listMixtures(db, rileyId)]);
  return builderForEdit(cycle!, confirmations, mixtures, new Date());
}

/** What the builder's save sends, with a new request key. */
const save = (state: BuilderState) =>
  saveCycleAction({
    ...formFromBuilder(state),
    mixes: state.plans.map((p) => mixEntry(p, planLink(state, p))).filter((entry) => entry !== null),
    requestKey: randomUUID(),
  });

const plansOf = async (cycleId: string) => ok(serviceClient().from("cycle_plans").select("id, peptide_id").eq("cycle_id", cycleId), "plans");
const linksOf = async (planId: string) =>
  ok(serviceClient().from("cycle_plan_mixtures").select("mixture_id, linked_at, unlinked_at").eq("plan_id", planId).order("linked_at"), "links");

describe("unchecking and checking an upcoming peptide again", () => {
  /** A under way since three days ago; C from day 5 on, with a saved 10 mg / 2 mL mix. */
  async function seed() {
    const cycleId = await createCycle(db, {
      name: `Round trip ${tag()}`,
      timeZone: NOON,
      plans: [plan(peptide.a, [interval(d(-3), d(20), "0.25", 1, "08:00")]), plan(peptide.c, [interval(d(5), d(20), "0.5", 1, "20:00")])],
    });
    const cPlan = (await plansOf(cycleId)).find((p) => p.peptide_id === peptide.c)!.id;
    const mixtureId = (await ok(
      db.rpc("save_mixture", { p_peptide_id: peptide.c, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 30, p_line_spacing: "0.5", p_plan_ids: [cPlan] }),
      "mixture",
    ))!;
    const before = await linksOf(cPlan);
    const opened = await open(cycleId);
    const fresh = () => newBuilderPlan(peptide.c, opened.savedMixes[peptide.c] ?? blankMix());
    const roundTrip = togglePlan(togglePlan(opened.initial, peptide.c, fresh), peptide.c, fresh);
    const c = roundTrip.plans.findIndex((p) => p.peptideId === peptide.c);
    const withMix = (patch: Partial<BuilderState["plans"][number]["mix"]>): BuilderState => ({
      ...roundTrip,
      plans: roundTrip.plans.map((p, i) => (i === c ? { ...p, mix: { ...p.mix, ...patch } } : p)),
    });
    return { cycleId, cPlan, mixtureId, before, opened, fresh, roundTrip, withMix };
  }

  it("with its mix unchanged: the same plan keeps the same link", async () => {
    const { cycleId, cPlan, mixtureId, before, roundTrip } = await seed();
    const version = (await getMixture(db, mixtureId))!.version;
    expect(await save(roundTrip)).toMatchObject({ saved: true, cycleId });
    expect((await plansOf(cycleId)).map((p) => p.id).sort()).toContain(cPlan);
    expect(await plansOf(cycleId)).toHaveLength(2);
    expect(await linksOf(cPlan)).toEqual(before);
    expect((await getMixture(db, mixtureId))!.version).toBe(version);
  });

  it("with its mix cleared: the plan's link ends; the mixture stays", async () => {
    const { cycleId, cPlan, mixtureId, withMix } = await seed();
    expect(await save(withMix({ vialMg: "", liquidMl: "" }))).toMatchObject({ saved: true, cycleId });
    expect(await plansOf(cycleId)).toHaveLength(2);
    const links = await linksOf(cPlan);
    expect(links).toHaveLength(1);
    expect(links[0].mixture_id).toBe(mixtureId);
    expect(links[0].unlinked_at).not.toBeNull();
    expect((await getMixture(db, mixtureId))!.planIds).toEqual([]);
  });

  it("with its mix changed: the next version of the same mixture, on the same plan and link", async () => {
    const { cycleId, cPlan, mixtureId, before, withMix } = await seed();
    expect(await save(withMix({ liquidMl: "3" }))).toMatchObject({ saved: true, cycleId });
    expect(await plansOf(cycleId)).toHaveLength(2);
    expect(await linksOf(cPlan)).toEqual(before);
    expect((await mixtureHistory(db, mixtureId)).map((v) => [v.number, v.setup.liquidMl])).toEqual([
      [1, "2"],
      [2, "3"],
    ]);
  });

  it("a fresh plan sent with the old plan's link (the model before the fix) is refused, and saves nothing", async () => {
    const { cycleId, cPlan, before, opened, fresh } = await seed();
    const out = togglePlan(opened.initial, peptide.c, fresh);
    // Added back as a new plan (no stored id), with the same schedule typed again.
    const original = opened.initial.plans.find((p) => p.peptideId === peptide.c)!;
    const again = { ...original, planId: null, phases: original.phases.map((phase) => ({ ...phase, id: null, lock: null })) };
    const old: BuilderState = { ...out, removed: {}, plans: [...out.plans, again] };
    const oldLink = opened.initial.links[cPlan];
    const mixes = old.plans.map((p) => mixEntry(p, p.peptideId === peptide.c ? oldLink : planLink(old, p))).filter((entry) => entry !== null);
    expect(mixes).toContainEqual(expect.objectContaining({ kind: "keep", peptideId: peptide.c }));
    expect(await saveCycleAction({ ...formFromBuilder(old), mixes, requestKey: randomUUID() })).toEqual({ errors: [MIX_CHANGED] });
    expect(await plansOf(cycleId)).toHaveLength(2);
    expect(await linksOf(cPlan)).toEqual(before);
  });
});

describe("End it now on the only phase under way", () => {
  /** Taken three days ago, skipped two days ago, missed yesterday: settled history. */
  async function settle(cycleId: string, peptideId: string, time: string) {
    const cycle = (await getCycle(db, cycleId))!;
    const stored = cycle.revisions[0].plans.find((p) => p.peptideId === peptideId)!;
    const key = (index: number) => `${stored.planId}:${stored.phases[0].id}:${index}`;
    await ok(
      db.rpc("confirm_dose", {
        p_request_key: randomUUID(),
        p_occurrence_key: key(0),
        p_seen_scheduled_at: noonZoneInstant(d(-3), time),
        p_seen_dose_mg: "0.25",
        p_seen_mixture_version_id: null as unknown as string,
        p_amount_mg: "0.25",
        p_actual_at: noonZoneInstant(d(-3), time),
        p_site: "Abdomen L",
      }),
      "confirm_dose",
    );
    await ok(
      db.rpc("skip_dose", { p_request_key: randomUUID(), p_occurrence_key: key(1), p_seen_scheduled_at: noonZoneInstant(d(-2), time), p_seen_dose_mg: "0.25" }),
      "skip_dose",
    );
    return stored.planId;
  }

  /** The occurrences before `date` with what was recorded (key, date, taken, skipped). */
  async function history(cycleId: string, before: string) {
    const [cycle, confirmations] = await Promise.all([getCycle(db, cycleId), cycleConfirmations(db, cycleId)]);
    return cycleOccurrences(cycle!.revisions, confirmations)
      .filter((o) => o.localDate < before)
      .map((o) => [o.key, o.localDate, o.actualAt !== null, o.skipped === true]);
  }

  /** "End it now" on the peptide's phase under way, as the schedule step does. */
  function endNow(opened: Awaited<ReturnType<typeof open>>, peptideId: string): BuilderState {
    const { initial, effective } = opened;
    return {
      ...initial,
      plans: initial.plans.map((p) => {
        if (p.peptideId !== peptideId) return p;
        return {
          ...p,
          phases: p.phases.map((phase) => {
            if (phase.lock !== "started") return phase;
            const ending = endBefore(phase, initial.start, effective[p.planId!] ?? null);
            if (!ending) throw new Error("the phase can't end now");
            return { ...phase, ...ending };
          }),
        };
      }),
    };
  }

  it("a one-peptide cycle: it ends yesterday (today's dose isn't due yet), with its history kept", async () => {
    // Daily at 20:00 in a zone where it is about noon: today's dose is still ahead, so the edit applies from today.
    const cycleId = await createCycle(db, { name: `End one ${tag()}`, timeZone: NOON, plans: [plan(peptide.a, [interval(d(-3), d(20), "0.25", 1, "20:00")])] });
    const planId = await settle(cycleId, peptide.a, "20:00");
    const settled = await history(cycleId, d(0));
    expect(settled).toHaveLength(3);
    const opened = await open(cycleId);
    expect(opened.effective[planId]).toBe(d(0));

    // The model before the fix removed the phase, which the builder's own rules refuse.
    const removed = { ...opened.initial, plans: opened.initial.plans.map((p) => ({ ...p, phases: p.phases.filter((phase) => phase.lock !== "started") })) };
    expect((await save(removed)).errors).toEqual([expect.stringMatching(/add at least one active phase/)]);

    expect(await save(endNow(opened, peptide.a))).toMatchObject({ saved: true, cycleId });
    const cycle = (await getCycle(db, cycleId))!;
    const current = cycle.revisions[cycle.revisions.length - 1];
    expect(current.plans[0].phases.map((p) => [p.start, p.end])).toEqual([[d(-3), d(-1)]]);
    expect(cycleStatus(current, new Date())).toBe("Ended");
    expect(cycleOccurrences(cycle.revisions).filter((o) => o.localDate >= d(0))).toEqual([]);
    expect(await history(cycleId, d(0))).toEqual(settled);
  });

  it("one peptide of two: it ends today (its dose today is already due); the other goes on", async () => {
    // A daily at 08:00 (today's is due, so the edit applies from tomorrow); B daily at 20:00.
    const cycleId = await createCycle(db, {
      name: `End one of two ${tag()}`,
      timeZone: NOON,
      plans: [plan(peptide.a, [interval(d(-3), d(20), "0.25", 1, "08:00")]), plan(peptide.b, [interval(d(-3), d(20), "0.25", 1, "20:00")])],
    });
    const planId = await settle(cycleId, peptide.a, "08:00");
    const settled = await history(cycleId, d(1));
    const opened = await open(cycleId);
    expect(opened.effective[planId]).toBe(d(1));

    expect(await save(endNow(opened, peptide.a))).toMatchObject({ saved: true, cycleId });
    const cycle = (await getCycle(db, cycleId))!;
    const current = cycle.revisions[cycle.revisions.length - 1];
    const [a, b] = [current.plans.find((p) => p.peptideId === peptide.a)!, current.plans.find((p) => p.peptideId === peptide.b)!];
    expect(a.phases.map((p) => [p.start, p.end])).toEqual([[d(-3), d(0)]]);
    expect(b.phases.map((p) => [p.start, p.end])).toEqual([[d(-3), d(20)]]);
    expect(cycleStatus(current, new Date())).toBe("Active");
    const future = cycleOccurrences(cycle.revisions).filter((o) => o.localDate >= d(1));
    expect(future.some((o) => o.planId === a.planId)).toBe(false);
    expect(future.filter((o) => o.planId === b.planId)).toHaveLength(20);
    // Today's A dose (due) and everything before it stay as they were.
    expect(await history(cycleId, d(1))).toEqual(settled);
  });
});
