// V3 (20260928130000_supplies_v3.sql) against the real local Supabase,
// through PostgREST as each signed-in person, exactly as the app writes:
// R7's "Correct remaining" (correct_personal_vial: the owner only, tracking
// on, an open vial, from the estimate shown, idempotent by request key, a
// row in the vial's ordered list that later doses count and that blocks
// undoing an earlier dose), R7's round + (add_personal_vial, idempotent),
// when a vial was mixed (personal_vials.mixed_at), and R13's keyed routine
// writers with a start and an optional end (save_supplement_routine,
// end_supplement_routine: replays, other hashes and the ended rule).
// Cycles use a fixed-offset zone where it is about 12:00 now (tests/support/noon).
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/cycles/rules";
import { listPersonalVials } from "@/lib/mixtures/service";
import { checkInDay } from "@/lib/progress/rules";
import { endRoutine, listRoutines, saveRoutine, takeSupplement } from "@/lib/supplements/service";
import { routineEnded } from "@/lib/supplements/view";
import { addPersonalVial, correctPersonalVial, listDeductions } from "@/lib/supplies/service";
import { vialEstimate } from "@/lib/supplies/estimate";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { confirmArgsSeen, d, NOON, occurrenceOn } from "../support/doses";
import { ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const people = {
  alex: { email: uniqueEmail("v3-alex"), name: "Alex Corrects", role: "researcher" },
  blair: { email: uniqueEmail("v3-blair"), name: "Blair Other", role: "researcher" },
  rae: { email: uniqueEmail("v3-rae"), name: "Rae Routines", role: "researcher" },
  grace: { email: uniqueEmail("v3-grace"), name: "Grace Granted", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
let peptideA = "";
/** Today in Toronto, as the server judges routines (see beforeAll). */
let today = "";

const hash = (value: unknown = randomUUID()) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const request = (value?: unknown) => ({ key: randomUUID(), hash: hash(value) });

/** Tracking on, a cycle (0.4 mg every 2 days at 08:00 from 4 days ago), a 10 mg mixture for it and an open vial. */
async function tracked(who: Name) {
  const cycleId = await createCycle(db[who], { timeZone: NOON, plans: [plan(peptideA, [interval(d(-4), d(20), "0.4", 2, "08:00")])] });
  const planId = (await ok(db[who].from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan"))[0].id;
  await ok(db[who].rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
  const mixtureId = (await ok(
    db[who].rpc("save_mixture", { p_peptide_id: peptideA, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] }),
    "mixture",
  ))!;
  const vialId = (await ok(db[who].rpc("save_personal_vial", { p_label: `C-${tag()}`, p_peptide_id: peptideA, p_strength_mg: "10", p_mixture_id: mixtureId }), "vial"))!;
  return { cycleId, mixtureId, vialId };
}

type Dose = { id: string; deduction: null | { remaining_before_mg: string; remaining_after_mg: string } };
const confirmOn = async (who: Name, cycleId: string, date: string) =>
  (await ok(db[who].rpc("confirm_dose", (await confirmArgsSeen(db[who], await occurrenceOn(db[who], cycleId, date))) as never), `confirm ${date}`)) as unknown as Dose;

const correctionArgs = (vialId: string, seen: string, remaining: string, key = randomUUID()) => ({
  p_request_key: key,
  p_vial_id: vialId,
  p_seen_remaining_mg: seen,
  p_remaining_mg: remaining,
});
const rowsOf = (vialId: string) =>
  ok(
    serviceClient()
      .from("personal_vial_deductions")
      .select("kind, dose_id, amount_mg::text, remaining_before_mg::text, remaining_after_mg::text, vial_sequence, request_key")
      .eq("vial_id", vialId)
      .order("vial_sequence"),
    "deductions",
  );

beforeAll(async () => {
  // Not within a minute of Toronto's midnight, so the day stays put for the run.
  while (checkInDay(new Date()) !== checkInDay(new Date(Date.now() + 60_000))) await new Promise((r) => setTimeout(r, 5_000));
  today = checkInDay(new Date());
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  peptideA = await createPeptide(db.grace, `V3 A ${tag()}`);
  await ok(db.rae.rpc("set_supplement_tracking", { p_enabled: true }), "rae's supplement tracking");
}, 120_000);

describe("R7 correct remaining", () => {
  it("sets the estimate from the one shown, once per request key, as a row later doses count", async () => {
    const alex = await tracked("alex");
    const first = await confirmOn("alex", alex.cycleId, d(-4));
    expect(first.deduction).toMatchObject({ remaining_after_mg: "9.6" });

    const key = randomUUID();
    expect(await correctPersonalVial(db.alex, { requestKey: key, vialId: alex.vialId, seenRemainingMg: "9.6", remainingMg: "5" })).toEqual({ kind: "corrected", remainingMg: "5" });
    // The same request again (a retry after a lost answer): the recorded correction, nothing new.
    const replay = (await ok(db.alex.rpc("correct_personal_vial", correctionArgs(alex.vialId, "9.6", "5", key)), "replay")) as unknown as Record<string, unknown>;
    expect(replay).toMatchObject({ vial_id: alex.vialId, remaining_before_mg: "9.6", remaining_mg: "5", replayed: true, unchanged: false });
    // The key with another value, or on another vial, is refused.
    expect(await sqlState(db.alex.rpc("correct_personal_vial", correctionArgs(alex.vialId, "9.6", "4", key)), "key reused")).toBe("22023");
    // A screen still showing 9.6 is refused: the estimate moved.
    expect(await correctPersonalVial(db.alex, { requestKey: randomUUID(), vialId: alex.vialId, seenRemainingMg: "9.6", remainingMg: "6" })).toEqual({ kind: "changed" });
    expect(await sqlState(db.alex.rpc("correct_personal_vial", correctionArgs(alex.vialId, "9.6", "6")), "stale")).toBe("AP035");
    // The same amount again records nothing.
    expect(await correctPersonalVial(db.alex, { requestKey: randomUUID(), vialId: alex.vialId, seenRemainingMg: "5", remainingMg: "5.000" })).toEqual({ kind: "unchanged", remainingMg: "5" });
    // What the database refuses: more than the vial holds, below 0, too precise, not a number.
    for (const bad of ["10.5", "-1", "0.0000001", "five", ""]) {
      expect(await sqlState(db.alex.rpc("correct_personal_vial", correctionArgs(alex.vialId, "5", bad)), bad)).toBe("22023");
    }

    // The next dose counts the correction: 5 before, 4.6 after.
    const second = await confirmOn("alex", alex.cycleId, d(-2));
    // (confirm_dose keeps the difference's scale: 10 - 5.0.)
    expect([Number(second.deduction!.remaining_before_mg), second.deduction!.remaining_after_mg]).toEqual([5, "4.6"]);
    // Found more than estimated: a negative row moves it up.
    expect(await correctPersonalVial(db.alex, { requestKey: randomUUID(), vialId: alex.vialId, seenRemainingMg: "4.6", remainingMg: "5.6" })).toMatchObject({ kind: "corrected", remainingMg: "5.6" });
    const rows = await rowsOf(alex.vialId);
    expect(rows.map((r) => [r.kind, r.dose_id === null, r.amount_mg, r.remaining_before_mg, r.remaining_after_mg, r.vial_sequence])).toEqual([
      ["dose", false, "0.4", "10", "9.6", 1],
      ["correction", true, "4.6", "9.6", "5", 2],
      ["dose", false, "0.4", "5.0", "4.6", 3],
      ["correction", true, "-1", "4.6", "5.6", 4],
    ]);
    expect(rows[1].request_key).toBe(key);

    // The screen reads them in the vial's order; the estimate agrees.
    const read = (await listDeductions(db.alex, id.alex)).filter((x) => x.vialId === alex.vialId);
    expect(read.map((x) => [x.kind, x.doseId === null, x.sequence])).toEqual([
      ["dose", false, 1],
      ["correction", true, 2],
      ["dose", false, 3],
      ["correction", true, 4],
    ]);
    expect(vialEstimate("10", read)).toMatchObject({ remainingMg: "5.6", uses: 2, state: "in-use" });

    // Undo: the latest dose was judged before the last correction, so it can no longer be undone; nor can the first.
    expect(await sqlState(db.alex.rpc("undo_dose", { p_request_key: randomUUID(), p_entry_id: second.id }), "undo second")).toBe("AP033");
    expect(await sqlState(db.alex.rpc("undo_dose", { p_request_key: randomUUID(), p_entry_id: first.id }), "undo first")).toBe("AP033");
  });

  it("is the owner's alone, needs tracking on and an open vial", async () => {
    const blair = await tracked("blair");
    const correct = (who: Name, vialId: string) =>
      correctPersonalVial(db[who], { requestKey: randomUUID(), vialId, seenRemainingMg: "10", remainingMg: "8" });
    await ok(db.blair.rpc("share_with_team"), "share with the team");
    // A granted admin reads the vial, never writes it; another researcher gets nothing.
    expect((await listPersonalVials(db.grace, id.blair)).map((v) => v.id)).toContain(blair.vialId);
    await ok(db.grace.rpc("set_supply_tracking", { p_enabled: true }), "grace's own tracking");
    expect(await correct("grace", blair.vialId)).toEqual({ kind: "not_found" });
    expect(await correct("alex", blair.vialId)).toEqual({ kind: "not_found" });
    expect(await rowsOf(blair.vialId)).toEqual([]);

    await ok(db.blair.rpc("set_supply_tracking", { p_enabled: false }), "tracking off");
    expect(await correct("blair", blair.vialId)).toEqual({ kind: "tracking_off" });
    expect(await sqlState(db.blair.rpc("correct_personal_vial", correctionArgs(blair.vialId, "10", "8")), "off")).toBe("AP016");
    await ok(db.blair.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");

    await ok(db.blair.rpc("finish_personal_vial", { p_vial_id: blair.vialId }), "finish");
    expect(await correct("blair", blair.vialId)).toEqual({ kind: "not_found" });
    await ok(db.blair.rpc("reopen_personal_vial", { p_vial_id: blair.vialId }), "reopen");
    expect(await correct("blair", blair.vialId)).toEqual({ kind: "corrected", remainingMg: "8" });
    // Nobody writes the rows directly.
    expect(await sqlState(db.blair.from("personal_vial_deductions").delete().eq("vial_id", blair.vialId), "delete")).toBe("42501");
  });
});

describe("R7 add vial and when a vial was mixed", () => {
  it("adds one vial per request key, whatever the retries, and refuses the key for another vial", async () => {
    await ok(db.alex.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
    const key = randomUUID();
    const vial = { requestKey: key, label: `N-${tag()}`, peptideId: peptideA, strengthMg: "5", mixtureId: null };
    const added = await addPersonalVial(db.alex, vial);
    expect(added).toMatchObject({ kind: "added", label: vial.label, replayed: false });
    // A retry (even with the next "Vial N" label) returns the same vial.
    expect(await addPersonalVial(db.alex, { ...vial, label: "Vial 9" })).toEqual({ ...added, replayed: true });
    expect((await listPersonalVials(db.alex, id.alex)).filter((v) => v.label === vial.label)).toHaveLength(1);
    expect(await addPersonalVial(db.alex, { ...vial, strengthMg: "6" })).toEqual({ kind: "invalid" });
    expect(await addPersonalVial(db.blair, vial)).toEqual({ kind: "invalid" });
    // It keeps save_personal_vial's rules.
    await ok(db.blair.rpc("set_supply_tracking", { p_enabled: false }), "blair's tracking off");
    expect(await addPersonalVial(db.blair, { ...vial, requestKey: randomUUID() })).toEqual({ kind: "tracking_off" });
    await ok(db.blair.rpc("set_supply_tracking", { p_enabled: true }), "blair's tracking on");
  });

  it("stamps mixed_at when a vial is first linked to a mixture, and never clears it", async () => {
    const unlinked = (await addPersonalVial(db.alex, { requestKey: randomUUID(), label: `M-${tag()}`, peptideId: peptideA, strengthMg: "10", mixtureId: null })) as { id: string };
    const mixedAt = async () => (await listPersonalVials(db.alex, id.alex)).find((v) => v.id === unlinked.id)!.mixedAt;
    expect(await mixedAt()).toBeNull();
    const mixtureId = (await ok(
      db.alex.rpc("save_mixture", { p_peptide_id: peptideA, p_vial_mg: "10", p_liquid_ml: "1", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [] }),
      "mixture",
    ))!;
    const label = (await listPersonalVials(db.alex, id.alex)).find((v) => v.id === unlinked.id)!.label;
    await ok(db.alex.rpc("save_personal_vial", { p_label: label, p_peptide_id: peptideA, p_strength_mg: "10", p_mixture_id: mixtureId, p_vial_id: unlinked.id }), "link");
    const stamped = await mixedAt();
    expect(stamped).not.toBeNull();
    expect(Math.abs(Date.parse(stamped!) - Date.now())).toBeLessThan(5 * 60_000);
    // Deleting the mixture unlinks the vial; it was still mixed then.
    await ok(db.alex.rpc("delete_mixture", { p_mixture_id: mixtureId, p_version: 1 }), "delete mixture");
    expect((await listPersonalVials(db.alex, id.alex)).find((v) => v.id === unlinked.id)).toMatchObject({ mixtureId: null, mixedAt: stamped });
    // A vial added already linked is mixed from the start.
    const other = (await ok(
      db.alex.rpc("save_mixture", { p_peptide_id: peptideA, p_vial_mg: "10", p_liquid_ml: "1", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [] }),
      "mixture",
    ))!;
    const linked = (await addPersonalVial(db.alex, { requestKey: randomUUID(), label: `L-${tag()}`, peptideId: peptideA, strengthMg: "10", mixtureId: other })) as { id: string };
    expect((await listPersonalVials(db.alex, id.alex)).find((v) => v.id === linked.id)!.mixedAt).not.toBeNull();
  });
});

describe("R13 routines with a start and an optional end, written once per request", () => {
  const routine = (overrides: Partial<Parameters<typeof saveRoutine>[1]> = {}) => ({
    id: null,
    version: null,
    name: "Vitamin D3",
    amount: "2000",
    unit: "IU",
    time: "00:00",
    startDate: null,
    endDate: null,
    ...overrides,
  });
  const routineOf = async (routineId: string) => (await listRoutines(db.rae, id.rae)).find((r) => r.id === routineId)!;

  it("creates from today or a later start, replays the same request and refuses the key for anything else", async () => {
    const req = request("create");
    const created = await saveRoutine(db.rae, routine({ endDate: addDays(today, 30) }), req);
    expect(created).toMatchObject({ kind: "saved", version: 1, replayed: false });
    const createdId = (created as { id: string }).id;
    // A retry returns the same routine and adds nothing.
    expect(await saveRoutine(db.rae, routine({ endDate: addDays(today, 30) }), req)).toEqual({ ...created, replayed: true });
    expect((await listRoutines(db.rae, id.rae)).filter((r) => r.id === createdId)).toHaveLength(1);
    expect(await routineOf(createdId)).toMatchObject({ startDate: today, definitionFrom: today, endDate: addDays(today, 30) });
    // The key with another submission, another kind of write or from another account is refused.
    expect(await saveRoutine(db.rae, routine({ name: "Other" }), { key: req.key, hash: hash("other") })).toEqual({ kind: "invalid" });
    expect(await endRoutine(db.rae, createdId, 1, req)).toEqual({ kind: "invalid" });
    await ok(db.blair.rpc("set_supplement_tracking", { p_enabled: true }), "blair's tracking");
    expect(await saveRoutine(db.blair, routine(), req)).toEqual({ kind: "invalid" });

    // A later start: no occurrence before it; it isn't ended.
    const later = await saveRoutine(db.rae, routine({ name: "Creatine", startDate: addDays(today, 3) }), request());
    const laterRoutine = await routineOf((later as { id: string }).id);
    expect(laterRoutine).toMatchObject({ startDate: addDays(today, 3), definitionFrom: addDays(today, 3), endDate: null });
    expect(routineEnded(laterRoutine, today)).toBe(false);
    const takeToday = await takeSupplement(db.rae, {
      requestKey: randomUUID(),
      occurrenceKey: `${laterRoutine.id}:${today}`,
      seenScheduledAt: new Date().toISOString(),
      seenName: "Creatine",
      seenAmount: "2000",
      seenUnit: "IU",
      actualAt: null,
    });
    expect(takeToday.kind).not.toBe("taken");

    // Dates the database refuses: a start in the past or over a year ahead, an end before the start.
    for (const bad of [
      { startDate: addDays(today, -1) },
      { startDate: addDays(today, 367) },
      { startDate: addDays(today, 5), endDate: addDays(today, 4) },
      { endDate: addDays(today, -1) },
    ]) {
      expect(await saveRoutine(db.rae, routine(bad), request(bad)), JSON.stringify(bad)).toEqual({ kind: "invalid" });
    }
  });

  it("edits keep the start, move or clear the planned end (never into the past), and End ends it", async () => {
    const created = (await saveRoutine(db.rae, routine({ name: "Zinc", endDate: addDays(today, 10) }), request())) as { id: string; version: number };
    const edit = (overrides: Record<string, unknown>, version: number) => routine({ id: created.id, version, name: "Zinc", ...overrides });
    // Moving the start is refused; so is an end before today.
    expect(await saveRoutine(db.rae, edit({ startDate: addDays(today, 1) }, 1), request())).toEqual({ kind: "invalid" });
    expect(await saveRoutine(db.rae, edit({ endDate: addDays(today, -1) }, 1), request())).toEqual({ kind: "invalid" });
    const req = request("edit");
    const moved = await saveRoutine(db.rae, edit({ endDate: addDays(today, 20) }, 1), req);
    expect(moved).toMatchObject({ kind: "saved", version: 2, replayed: false });
    // The retry replays; the stale version from another device is refused.
    expect(await saveRoutine(db.rae, edit({ endDate: addDays(today, 20) }, 1), req)).toMatchObject({ kind: "saved", version: 2, replayed: true });
    expect(await saveRoutine(db.rae, edit({ endDate: null }, 1), request())).toEqual({ kind: "changed" });
    expect(await routineOf(created.id)).toMatchObject({ startDate: today, endDate: addDays(today, 20), version: 2 });
    expect((await saveRoutine(db.rae, edit({ endDate: null }, 2), request())) as unknown).toMatchObject({ kind: "saved", version: 3 });
    expect((await routineOf(created.id)).endDate).toBeNull();

    // End: today is its last day, and it's ended (no more edits or ends).
    const endReq = request("end");
    expect(await endRoutine(db.rae, created.id, 3, endReq)).toEqual({ kind: "done", endDate: today, replayed: false });
    expect(await endRoutine(db.rae, created.id, 3, endReq)).toEqual({ kind: "done", endDate: today, replayed: true });
    const ended = await routineOf(created.id);
    expect(routineEnded(ended, today)).toBe(true);
    expect(await endRoutine(db.rae, created.id, 4, request())).toEqual({ kind: "ended" });
    expect(await saveRoutine(db.rae, edit({}, 4), request())).toEqual({ kind: "ended" });
  });

  it("ends a routine not started yet before its start: it never runs", async () => {
    const created = (await saveRoutine(db.rae, routine({ name: "Iron", startDate: addDays(today, 5) }), request())) as { id: string };
    expect(await endRoutine(db.rae, created.id, 1, request())).toEqual({ kind: "done", endDate: addDays(today, 4), replayed: false });
    const ended = await routineOf(created.id);
    expect(ended).toMatchObject({ startDate: addDays(today, 5), endDate: addDays(today, 4) });
    expect(routineEnded(ended, today)).toBe(true);
    // Nobody else's writes reach it; a granted admin never writes.
    await ok(db.rae.rpc("share_with_team"), "share");
    expect(await saveRoutine(db.grace, routine({ id: created.id, version: 2 }), request())).toEqual({ kind: "not_found" });
  });

  it("keeps the earlier signatures working on the same rules", async () => {
    const json = (await ok(
      db.rae.rpc("save_supplement_routine", { p_id: null as unknown as string, p_version: null as unknown as number, p_name: "Old", p_amount: "1", p_unit: "cap", p_time: "07:00" }),
      "old create",
    )) as unknown as { id: string; version: number };
    expect(await routineOf(json.id)).toMatchObject({ startDate: today, endDate: null });
    await saveRoutine(db.rae, routine({ id: json.id, version: 1, name: "Old", amount: "1", unit: "cap", time: "07:00", endDate: addDays(today, 9) }), request());
    // An old-signature edit keeps the planned end.
    await ok(db.rae.rpc("save_supplement_routine", { p_id: json.id, p_version: 2, p_name: "Old 2", p_amount: "1", p_unit: "cap", p_time: "07:00" }), "old edit");
    expect(await routineOf(json.id)).toMatchObject({ name: "Old 2", endDate: addDays(today, 9), version: 3 });
    expect(await ok(db.rae.rpc("end_supplement_routine", { p_id: json.id, p_version: 3 }), "old end")).toMatchObject({ end_date: today });
  });
});
