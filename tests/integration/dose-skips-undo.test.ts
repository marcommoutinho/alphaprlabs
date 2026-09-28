// V1 skip, undo and the eight injection sites against the real local
// Supabase, through PostgREST as each signed-in person (as the app calls
// them): skip_dose() resolves an occurrence as skipped (not open, not in the
// badge, never confirmable, interval doses after it keep counting from its
// planned time); undo_dose() retracts a Taken or a skip just recorded into
// the dose_voids audit trail, restoring the vial estimate and the schedule,
// and refuses when later records depend on it; both are idempotent by request
// key (one namespace of keys across the three writes) and serialized per
// cycle. The 60-second window and entries recorded
// before V1 are proved at owner level (dose-undo-owner.test.ts).
// Cycles use a fixed-offset zone where it is about 12:00 now (tests/support/noon.ts).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { cycleConfirmations } from "@/lib/doses/service";
import { pendingDoses } from "@/lib/doses/today";
import { getCycle, plansArgument } from "@/lib/cycles/service";
import { type Client, createCycle, createPeptide, interval, plan, saveCycle, tag } from "../support/cycles";
import { confirmArgs, confirmArgsSeen, d, NOON, noonZoneInstant, occurrenceOn, occurrencesOf } from "../support/doses";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import type { Occurrence } from "@/lib/schedule/engine";

const people = {
  sam: { email: uniqueEmail("v1-sam"), name: "Sam Skips", role: "researcher" },
  blair: { email: uniqueEmail("v1-blair"), name: "Blair Other", role: "researcher" },
  una: { email: uniqueEmail("v1-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("v1-grace"), name: "Grace Admin", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
let peptideA = "";
let peptideB = "";

type Skip = { id: string; occurrence_key: string; scheduled_at: string; planned_mg: string; recorded_at: string; replayed: boolean };
type Void = {
  id: string;
  kind: "taken" | "skipped";
  entry_id: string;
  occurrence_key: string;
  replayed: boolean;
  deduction: null | { vial_id: string; vial_label: string; amount_mg: string };
};
type Dose = { id: string; replayed: boolean; site: string; deduction: null | { remaining_after_mg: string } };

const skipArgs = (o: Occurrence, overrides: Record<string, unknown> = {}) => ({
  p_request_key: randomUUID(),
  p_occurrence_key: o.key,
  p_seen_scheduled_at: o.scheduledAt,
  p_seen_dose_mg: o.doseMg,
  ...overrides,
});
const skip = async (who: Client, args: Record<string, unknown>, what = "skip_dose") => (await ok(who.rpc("skip_dose", args as never), what)) as unknown as Skip | null;
const confirm = async (who: Client, args: Record<string, unknown>, what = "confirm_dose") =>
  (await ok(who.rpc("confirm_dose", args as never), what)) as unknown as Dose | null;
const undo = async (who: Client, entryId: string, requestKey: string = randomUUID(), what = "undo_dose") =>
  (await ok(who.rpc("undo_dose", { p_request_key: requestKey, p_entry_id: entryId }), what)) as unknown as Void | null;
const undoState = (who: Client, entryId: string, requestKey: string = randomUUID()) =>
  sqlState(who.rpc("undo_dose", { p_request_key: requestKey, p_entry_id: entryId }), "undo_dose");

async function planIds(who: Client, cycleId: string) {
  const rows = await ok(who.from("cycle_plans").select("id, peptide_id").eq("cycle_id", cycleId), "plans");
  return new Map(rows.map((row) => [row.peptide_id, row.id]));
}
const service = () => serviceClient();
const doseRows = (cycleId: string) => ok(service().from("dose_records").select("id, occurrence_key, site").eq("cycle_id", cycleId), "doses");
const skipRows = (cycleId: string) => ok(service().from("dose_skips").select("id, occurrence_key, request_key").eq("cycle_id", cycleId), "skips");
const voidRows = (cycleId: string) =>
  ok(service().from("dose_voids").select("id, kind, entry_id, entry_request_key, occurrence_key, entry, deduction, request_key").eq("cycle_id", cycleId), "voids");
const scheduleVersion = async (planId: string) =>
  (await ok(service().from("cycle_plans").select("schedule_version").eq("id", planId), "plan version"))[0].schedule_version;

/** Tracking on, a 10 mg / 2 mL mixture for `planIds` and an open vial for it: confirmations deduct. */
async function trackedVial(who: Client, peptideId: string, planIdList: string[]) {
  await ok(who.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
  const mixtureId = await ok(
    who.rpc("save_mixture", { p_peptide_id: peptideId, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: planIdList }),
    "mixture",
  );
  const label = `U-${tag()}`;
  const vialId = await ok(who.rpc("save_personal_vial", { p_label: label, p_peptide_id: peptideId, p_strength_mg: "10", p_mixture_id: mixtureId }), "vial");
  return { vialId: vialId as unknown as string, label };
}
const deductionsOf = (vialId: string) =>
  ok(service().from("personal_vial_deductions").select("dose_id, amount_mg::text, remaining_after_mg::text").eq("vial_id", vialId), "deductions");

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  const t = tag();
  peptideA = await createPeptide(db.grace, `Skip A ${t}`);
  peptideB = await createPeptide(db.grace, `Skip B ${t}`);
});

describe("skip", () => {
  it("resolves the dose as skipped: not open, not in the badge, never confirmable; replays return it", async () => {
    const cycleId = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
    const before = await occurrencesOf(db.sam, cycleId);
    const cycle = (await getCycle(db.sam, cycleId))!;
    const badge = async () => pendingDoses([cycle], new Map([[cycleId, await cycleConfirmations(db.sam, cycleId)]]), new Date());
    // d-2 unconfirmed and d0 due.
    expect(await badge()).toBe(2);

    const open = before.find((o) => o.localDate === d(-2))!;
    const args = skipArgs(open);
    const first = (await skip(db.sam, args))!;
    expect(first).toMatchObject({ occurrence_key: open.key, planned_mg: "0.4", replayed: false });
    expect(Date.parse(first.scheduled_at)).toBe(Date.parse(open.scheduledAt));
    // The same request again (a retry after a lost answer): the recorded skip.
    expect(await skip(db.sam, args)).toMatchObject({ id: first.id, replayed: true, recorded_at: first.recorded_at });
    // Another request for the same dose: already skipped. A Taken for it is refused.
    expect(await sqlState(db.sam.rpc("skip_dose", skipArgs(open)), "skip again")).toBe("AP031");
    expect(await sqlState(db.sam.rpc("confirm_dose", confirmArgs(open)), "confirm a skipped dose")).toBe("AP031");
    // A skip's request key can't record a dose.
    expect(await sqlState(db.sam.rpc("confirm_dose", confirmArgs(open, { p_request_key: args.p_request_key })), "reused key")).toBe("22023");
    expect(await skipRows(cycleId)).toHaveLength(1);
    expect(await doseRows(cycleId)).toEqual([]);

    // The app's schedule: skipped, not open, not in the badge.
    const after = await occurrencesOf(db.sam, cycleId);
    expect(after.find((o) => o.key === open.key)).toMatchObject({ skipped: true, actualAt: null });
    expect(await badge()).toBe(1);

    // A confirmed dose can't be skipped.
    const due = after.find((o) => o.localDate === d(0))!;
    await confirm(db.sam, confirmArgs(due));
    expect(await sqlState(db.sam.rpc("skip_dose", skipArgs(due)), "skip a taken dose")).toBe("AP018");
    expect(await badge()).toBe(0);
  });

  it("keeps every-N-days doses on the planned time after a skip (a Taken re-anchors them), and the server agrees", async () => {
    // Every 2 days at 08:00 from yesterday: yesterday, tomorrow, ...
    const skipped = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-1), d(20), "0.4", 2, "08:00")])] });
    const taken = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideB, [interval(d(-1), d(20), "0.4", 2, "08:00")])] });
    const skippedDose = await occurrenceOn(db.sam, skipped, d(-1));
    const takenDose = await occurrenceOn(db.sam, taken, d(-1));
    await skip(db.sam, skipArgs(skippedDose));
    await confirm(db.sam, confirmArgs(takenDose, { p_actual_at: noonZoneInstant(d(-1), "20:00") }));

    const nextAfterSkip = await occurrenceOn(db.sam, skipped, d(1));
    expect(Date.parse(nextAfterSkip.scheduledAt)).toBe(Date.parse(noonZoneInstant(d(1), "08:00")));
    const nextAfterTaken = await occurrenceOn(db.sam, taken, d(1));
    expect(Date.parse(nextAfterTaken.scheduledAt)).toBe(Date.parse(noonZoneInstant(d(1), "20:00")));
    // The server's schedule (S13's dispatcher reads it) agrees on both.
    const server = async (cycleId: string, key: string) => {
      const planId = key.split(":")[0];
      const rows = (await ok(service().rpc("cycle_plan_occurrences", { p_plan_id: planId }), "server schedule")) as unknown as {
        occurrence_key: string;
        scheduled_at: string;
      }[];
      return Date.parse(rows.find((row) => row.occurrence_key === key)!.scheduled_at);
    };
    expect(await server(skipped, nextAfterSkip.key)).toBe(Date.parse(nextAfterSkip.scheduledAt));
    expect(await server(taken, nextAfterTaken.key)).toBe(Date.parse(nextAfterTaken.scheduledAt));
  });

  it("refuses other people's plans, unknown and later doses, changed details and direct writes", async () => {
    const cycleId = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-2), d(6), "0.4", 2, "08:00")])] });
    const due = await occurrenceOn(db.sam, cycleId, d(0));
    const [planA, phase] = due.key.split(":");
    // Not theirs: nothing (null), nothing written.
    for (const who of ["blair", "grace"] as const) expect(await skip(db[who], skipArgs(due), who)).toBeNull();
    expect(await sqlState(db.una.rpc("skip_dose", skipArgs(due)), "una")).toBe("42501");
    expect(await sqlState(anonClient().rpc("skip_dose", skipArgs(due)), "anon")).toBe("42501");
    expect(await sqlState(db.sam.rpc("skip_dose", skipArgs(due, { p_occurrence_key: `${planA}:${phase}:999` })), "past the phase")).toBe("AP017");
    expect(await sqlState(db.sam.rpc("skip_dose", skipArgs(due, { p_occurrence_key: "not-a-key" })), "malformed")).toBe("22023");
    expect(await sqlState(db.sam.rpc("skip_dose", skipArgs(due, { p_seen_dose_mg: "0.5" })), "changed dose")).toBe("AP020");
    const later = await occurrenceOn(db.sam, cycleId, d(2));
    expect(await sqlState(db.sam.rpc("skip_dose", skipArgs(later)), "later day")).toBe("AP019");
    expect(await skipRows(cycleId)).toEqual([]);

    // Nobody writes the tables directly; reads follow ownership.
    const first = (await skip(db.sam, skipArgs(due)))!;
    expect(await sqlState(db.sam.from("dose_skips").insert({ occurrence_key: "x" } as never), "direct skip")).toBe("42501");
    expect(await sqlState(db.sam.from("dose_skips").delete().eq("id", first.id), "direct delete")).toBe("42501");
    expect(await sqlState(db.sam.from("dose_voids").insert({ kind: "taken" } as never), "direct void")).toBe("42501");
    const read = (who: Client) => ok(who.from("dose_skips").select("id").eq("cycle_id", cycleId), "read");
    expect(await read(db.sam)).toHaveLength(1);
    expect(await read(db.blair)).toEqual([]);
    // Another account can't undo it, and a skip's key is not another account's.
    expect(await undo(db.blair, first.id)).toBeNull();
    expect(await skipRows(cycleId)).toHaveLength(1);
  });
});

describe("undo", () => {
  it("retracts a Taken into the audit trail, restores the vial, and is idempotent by request key", async () => {
    const cycleId = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-2), d(20), "0.5", 2, "08:00")])] });
    const planId = (await planIds(db.sam, cycleId)).get(peptideA)!;
    const { vialId, label } = await trackedVial(db.sam, peptideA, [planId]);
    const due = await occurrenceOn(db.sam, cycleId, d(0));
    const args = await confirmArgsSeen(db.sam, due, { p_site: "Delt R", p_notes: "left arm sore" });
    const dose = (await confirm(db.sam, args))!;
    expect(dose.deduction).toMatchObject({ remaining_after_mg: "9.5" });
    const versionAfterTaken = await scheduleVersion(planId);

    const key = randomUUID();
    const voided = (await undo(db.sam, dose.id, key))!;
    expect(voided).toMatchObject({ kind: "taken", entry_id: dose.id, occurrence_key: due.key, replayed: false });
    expect(voided.deduction).toMatchObject({ vial_id: vialId, vial_label: label, amount_mg: "0.5" });
    // The entry and its deduction are gone; the audit trail keeps them as they were.
    expect(await doseRows(cycleId)).toEqual([]);
    expect(await deductionsOf(vialId)).toEqual([]);
    const [audit] = await voidRows(cycleId);
    expect(audit).toMatchObject({ kind: "taken", entry_id: dose.id, entry_request_key: args.p_request_key, request_key: key });
    expect(audit.entry).toMatchObject({ id: dose.id, site: "Delt R", notes: "left arm sore", amount_mg: 0.5 });
    expect(audit.deduction).toMatchObject({ dose_id: dose.id, vial_id: vialId });
    // The plan moved on (queued reminders recheck).
    expect(await scheduleVersion(planId)).toBe(versionAfterTaken + 1);

    // The same undo again returns it; another undo request, and the original Taken's replay, are refused.
    expect(await undo(db.sam, dose.id, key)).toMatchObject({ id: voided.id, replayed: true });
    expect(await undoState(db.sam, dose.id)).toBe("AP034");
    expect(await sqlState(db.sam.rpc("confirm_dose", args as never), "replayed Taken")).toBe("AP034");
    // The undo key can't be reused for another entry.
    expect(await undoState(db.sam, randomUUID(), key)).toBe("22023");
    // Its readers see the dose open again: a new Taken records and deducts from the full vial.
    expect((await occurrencesOf(db.sam, cycleId)).find((o) => o.key === due.key)).toMatchObject({ actualAt: null });
    const again = (await confirm(db.sam, await confirmArgsSeen(db.sam, due)))!;
    expect(again.deduction).toMatchObject({ remaining_after_mg: "9.5" });
    // Readable as dose records are: the owner, not another researcher.
    expect(await ok(db.sam.from("dose_voids").select("id").eq("cycle_id", cycleId), "own voids")).toHaveLength(1);
    expect(await ok(db.blair.from("dose_voids").select("id").eq("cycle_id", cycleId), "other voids")).toEqual([]);
  });

  it("undoes a skip: the dose is open again and can be logged", async () => {
    const cycleId = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
    const due = await occurrenceOn(db.sam, cycleId, d(0));
    const args = skipArgs(due);
    const skipped = (await skip(db.sam, args))!;
    expect((await undo(db.sam, skipped.id))!).toMatchObject({ kind: "skipped", entry_id: skipped.id, deduction: null });
    expect(await skipRows(cycleId)).toEqual([]);
    expect((await voidRows(cycleId))[0].entry).toMatchObject({ id: skipped.id, occurrence_key: due.key });
    // The original skip request can't record again; a new one could, and so can a Taken.
    expect(await sqlState(db.sam.rpc("skip_dose", args), "replayed skip")).toBe("AP034");
    expect((await occurrencesOf(db.sam, cycleId)).find((o) => o.key === due.key)?.skipped).toBeUndefined();
    expect(await confirm(db.sam, confirmArgs(due))).toMatchObject({ replayed: false });
  });

  it("re-anchors every-N-days doses when a backdated Taken is undone", async () => {
    const cycleId = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-1), d(20), "0.4", 2, "08:00")])] });
    const yesterday = await occurrenceOn(db.sam, cycleId, d(-1));
    const dose = (await confirm(db.sam, confirmArgs(yesterday, { p_actual_at: noonZoneInstant(d(-1), "20:00") })))!;
    expect(Date.parse((await occurrenceOn(db.sam, cycleId, d(1))).scheduledAt)).toBe(Date.parse(noonZoneInstant(d(1), "20:00")));
    await undo(db.sam, dose.id);
    const next = await occurrenceOn(db.sam, cycleId, d(1));
    expect(Date.parse(next.scheduledAt)).toBe(Date.parse(noonZoneInstant(d(1), "08:00")));
    // The server's schedule agrees: yesterday's dose is confirmable again as the app shows it.
    expect(await confirm(db.sam, confirmArgs(await occurrenceOn(db.sam, cycleId, d(-1))))).toMatchObject({ replayed: false });
  });

  it("refuses when something recorded since depends on the entry", async () => {
    // A later Taken of the same plan was judged with this one in place.
    const cycleId = await createCycle(db.sam, {
      timeZone: NOON,
      plans: [plan(peptideA, [interval(d(-2), d(20), "0.4", 2, "08:00")]), plan(peptideB, [interval(d(-2), d(20), "1", 2, "09:00")])],
    });
    const plans = await planIds(db.sam, cycleId);
    const older = await occurrenceOn(db.sam, cycleId, d(-2), plans.get(peptideA));
    const first = (await confirm(db.sam, confirmArgs(older)))!;
    const due = await occurrenceOn(db.sam, cycleId, d(0), plans.get(peptideA));
    const second = (await skip(db.sam, skipArgs(due)))!;
    expect(await undoState(db.sam, first.id)).toBe("AP033");
    // The latest entry of the plan still can be undone; a Taken of another plan doesn't depend on it.
    const otherPlan = (await confirm(db.sam, confirmArgs(await occurrenceOn(db.sam, cycleId, d(0), plans.get(peptideB)))))!;
    expect(await undo(db.sam, second.id)).toMatchObject({ kind: "skipped" });
    // After that undo, the first is still refused (the plan moved on since it), the other plan's is not.
    expect(await undoState(db.sam, first.id)).toBe("AP033");
    expect(await undo(db.sam, otherPlan.id)).toMatchObject({ kind: "taken" });

    // A cycle edit since the entry.
    const edited = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
    const editedOccurrence = await occurrenceOn(db.sam, edited, d(0));
    const editedDose = (await confirm(db.sam, confirmArgs(editedOccurrence)))!;
    // The plan runs a day longer, from tomorrow (today's dose is already due).
    const cycle = (await getCycle(db.sam, edited))!;
    const revision = cycle.revisions[cycle.revisions.length - 1];
    const longer = plansArgument(revision.plans.map((p) => ({ ...p, effectiveFrom: d(1) }))) as { phases: { end_date: string }[] }[];
    longer[0].phases[0].end_date = d(21);
    expect(await sqlState(saveCycle(db.sam, { cycleId: edited, version: cycle.version, timeZone: NOON, plans: longer }), "edit")).toBe("ok");
    expect(await undoState(db.sam, editedDose.id)).toBe("AP033");

    // A later deduction from the same vial (two cycles' plans on one mixture).
    const one = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-2), d(20), "0.5", 2, "08:00")])] });
    const two = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-2), d(20), "0.5", 2, "08:00")])] });
    const [planOne, planTwo] = [(await planIds(db.sam, one)).get(peptideA)!, (await planIds(db.sam, two)).get(peptideA)!];
    const { vialId } = await trackedVial(db.sam, peptideA, [planOne, planTwo]);
    const fromOne = (await confirm(db.sam, await confirmArgsSeen(db.sam, await occurrenceOn(db.sam, one, d(0)))))!;
    const fromTwo = (await confirm(db.sam, await confirmArgsSeen(db.sam, await occurrenceOn(db.sam, two, d(0)))))!;
    expect(fromTwo.deduction).toMatchObject({ remaining_after_mg: "9.0" });
    expect(await undoState(db.sam, fromOne.id)).toBe("AP033");
    expect(await deductionsOf(vialId)).toHaveLength(2);
    // The later one can go, then the earlier one is free again.
    await undo(db.sam, fromTwo.id);
    expect(await undo(db.sam, fromOne.id)).toMatchObject({ kind: "taken" });
    expect(await deductionsOf(vialId)).toEqual([]);
  });

  it("serializes concurrent requests: one undo per entry, one resolution per dose", async () => {
    const cycleId = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
    const due = await occurrenceOn(db.sam, cycleId, d(0));
    const dose = (await confirm(db.sam, confirmArgs(due)))!;
    // A double tap on Undo: the same request twice at once.
    const key = randomUUID();
    const same = await Promise.all([undo(db.sam, dose.id, key), undo(db.sam, dose.id, key)]);
    expect(same[0]!.id).toBe(same[1]!.id);
    expect(same.map((v) => v!.replayed).sort()).toEqual([false, true]);
    // Two devices undoing at once: one wins, the other is told it's already undone.
    const again = (await confirm(db.sam, confirmArgs(due)))!;
    const racing = await Promise.all([undoState(db.sam, again.id), undoState(db.sam, again.id)]);
    expect(racing.sort()).toEqual(["AP034", "ok"]);
    expect(await voidRows(cycleId)).toHaveLength(2);

    // Taken and Skip for the same dose at once: exactly one resolution.
    const raced = await Promise.all([
      sqlState(db.sam.rpc("confirm_dose", confirmArgs(due)), "confirm"),
      sqlState(db.sam.rpc("skip_dose", skipArgs(due)), "skip"),
    ]);
    expect(raced.filter((s) => s === "ok")).toHaveLength(1);
    expect(raced.filter((s) => s !== "ok")[0]).toMatch(/^AP03[1]$|^AP018$/);
    expect((await doseRows(cycleId)).length + (await skipRows(cycleId)).length).toBe(1);
  });
});

describe("request keys: one namespace for Taken, Skip and Undo", () => {
  const skipState = (who: Client, o: Occurrence, key: string) => sqlState(who.rpc("skip_dose", skipArgs(o, { p_request_key: key })), "skip_dose");
  const confirmState = (who: Client, o: Occurrence, key: string) => sqlState(who.rpc("confirm_dose", confirmArgs(o, { p_request_key: key })), "confirm_dose");
  /** Everything recorded with `key`, in every table a dose write records into. */
  const recordedWith = async (key: string) => [
    ...(await ok(service().from("dose_records").select("id").eq("request_key", key), "doses")),
    ...(await ok(service().from("dose_skips").select("id").eq("request_key", key), "skips")),
    ...(await ok(service().from("dose_voids").select("id").eq("request_key", key), "voids")),
  ];

  it("refuses a key recorded by one write for every other write, of any kind or account", async () => {
    const cycleId = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-6), d(20), "0.4", 1, "08:00")])] });
    const occ = (await occurrencesOf(db.sam, cycleId)).filter((o) => o.localDate <= d(0));
    expect(occ).toHaveLength(7);
    const blairCycle = await createCycle(db.blair, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-2), d(20), "0.4", 1, "08:00")])] });
    const blairOcc = (await occurrencesOf(db.blair, blairCycle)).filter((o) => o.localDate <= d(0));

    // A Taken's key: not a skip's, not an undo's (not even of that dose), not another account's.
    const takenKey = randomUUID();
    const taken = (await confirm(db.sam, confirmArgs(occ[0], { p_request_key: takenKey })))!;
    expect(await skipState(db.sam, occ[1], takenKey)).toBe("22023");
    expect(await undoState(db.sam, taken.id, takenKey)).toBe("22023");
    expect(await confirmState(db.blair, blairOcc[0], takenKey)).toBe("22023");
    expect(await doseRows(cycleId)).toHaveLength(1);

    // A skip's key: not a Taken's, not an undo's.
    const skipKey = randomUUID();
    const skipped = (await skip(db.sam, skipArgs(occ[1], { p_request_key: skipKey })))!;
    expect(await confirmState(db.sam, occ[2], skipKey)).toBe("22023");
    expect(await undoState(db.sam, skipped.id, skipKey)).toBe("22023");
    expect(await skipState(db.blair, blairOcc[0], skipKey)).toBe("22023");
    expect(await skipRows(cycleId)).toHaveLength(1);

    // An undo's key: not a Taken's, not a skip's, not another undo's, not another account's.
    const undoKey = randomUUID();
    await undo(db.sam, skipped.id, undoKey);
    expect(await confirmState(db.sam, occ[2], undoKey)).toBe("22023");
    expect(await skipState(db.sam, occ[2], undoKey)).toBe("22023");
    expect(await skipState(db.sam, occ[1], undoKey)).toBe("22023");
    const blairDose = (await confirm(db.blair, confirmArgs(blairOcc[0])))!;
    expect(await undoState(db.blair, blairDose.id, undoKey)).toBe("22023");
    expect(await ok(service().from("dose_records").select("id").eq("cycle_id", blairCycle), "blair doses")).toHaveLength(1);

    // The undone skip's key stays claimed: its replay is AP034, any other write with it is refused.
    expect(await skipState(db.sam, occ[1], skipKey)).toBe("AP034");
    expect(await confirmState(db.sam, occ[1], skipKey)).toBe("22023");
    expect(await undoState(db.sam, taken.id, skipKey)).toBe("22023");

    // Nothing the refused writes asked for was recorded: one dose, no skip, one void.
    expect(await doseRows(cycleId)).toHaveLength(1);
    expect(await skipRows(cycleId)).toEqual([]);
    expect(await voidRows(cycleId)).toHaveLength(1);
    // The refusals were about the keys alone: the latest entry is undoable with a key of its own.
    const latest = (await confirm(db.sam, confirmArgs(occ[3])))!;
    expect(await undoState(db.sam, latest.id, takenKey)).toBe("22023");
    expect(await undo(db.sam, latest.id)).toMatchObject({ kind: "taken", entry_id: latest.id });
  });

  it("lets only the first of two writes racing with one key record, whatever their kinds", async () => {
    // Each write in its own cycle: they take different locks and really run at once.
    const fresh = async () => {
      const cycleId = await createCycle(db.sam, { timeZone: NOON, plans: [plan(peptideA, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
      return occurrenceOn(db.sam, cycleId, d(0));
    };
    const writes = {
      taken: async (key: string) => {
        const o = await fresh();
        return () => sqlState(db.sam.rpc("confirm_dose", confirmArgs(o, { p_request_key: key })), "confirm");
      },
      skipped: async (key: string) => {
        const o = await fresh();
        return () => sqlState(db.sam.rpc("skip_dose", skipArgs(o, { p_request_key: key })), "skip");
      },
      undo: async (key: string) => {
        const dose = (await confirm(db.sam, confirmArgs(await fresh())))!;
        return () => undoState(db.sam, dose.id, key);
      },
    };
    const pairs: [keyof typeof writes, keyof typeof writes][] = [
      ["taken", "skipped"],
      ["taken", "undo"],
      ["skipped", "undo"],
      ["taken", "taken"],
    ];
    for (const [first, second] of pairs) {
      const key = randomUUID();
      const calls = [await writes[first](key), await writes[second](key)];
      const states = await Promise.all(calls.map((call) => call()));
      expect(states.sort(), `${first} + ${second}`).toEqual(["22023", "ok"]);
      expect(await recordedWith(key), `${first} + ${second}`).toHaveLength(1);
    }
  });
});

describe("injection sites", () => {
  it("accepts the eight sites and Other, refuses anything else, and older records stay valid", async () => {
    const sites = ["Abdomen L", "Abdomen R", "Thigh L", "Thigh R", "Delt L", "Delt R", "Glute L", "Glute R", "Other", ""];
    const cycleId = await createCycle(db.sam, {
      timeZone: NOON,
      plans: [plan(peptideA, [interval(d(-sites.length + 1), d(20), "0.4", 1, "08:00")])],
    });
    const occurrences = (await occurrencesOf(db.sam, cycleId)).filter((o) => o.localDate <= d(0));
    expect(occurrences).toHaveLength(sites.length);
    expect(await sqlState(db.sam.rpc("confirm_dose", confirmArgs(occurrences[0], { p_site: "Shoulder" })), "unknown site")).toBe("22023");
    for (const [index, site] of sites.entries()) {
      expect(await confirm(db.sam, confirmArgs(occurrences[index], { p_site: site }), site)).toMatchObject({ site });
    }
    const recorded = await doseRows(cycleId);
    expect(recorded.map((r) => r.site).sort()).toEqual([...sites].sort());
    // The app reads them all back as confirmations with their sites.
    const read = await cycleConfirmations(db.sam, cycleId);
    expect(read.map((c) => c.site).sort()).toEqual([...sites].sort());
  });
});
