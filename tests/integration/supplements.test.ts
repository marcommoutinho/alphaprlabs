// S16 supplements (R10) against the real local Supabase, through PostgREST as
// each signed-in person, exactly as the app reads and writes: the owner reads
// and writes (only through the functions); a granted admin reads and never
// writes; a revoked or non-granted admin, another researcher, an
// unacknowledged account and anonymous callers get nothing. Taken is
// idempotent by request key (a retry or a double tap records one), derives
// its occurrence on the server and refuses what Today refuses for doses;
// stale edits are refused; an edit or End never rewrites what was taken; and
// nothing here ever touches peptide stock, vials, mixtures or recorded doses.
// Days are America/Toronto days by the database's clock; times are compared
// with the database's own timestamps (its clock can step back under load).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/cycles/rules";
import { checkInDay } from "@/lib/progress/rules";
import { occurrenceOn } from "@/lib/supplements/schedule";
import type { ValidRoutine } from "@/lib/supplements/rules";
import { getSupplementTracking, listDueSupplements, listRoutines, listTaken, saveRoutine as saveKeyedRoutine, takeSupplement } from "@/lib/supplements/service";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { confirmArgsSeen, d, NOON, occurrenceOn as doseOn } from "../support/doses";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

/** The service's keyed save with a fresh request each time (20260928130000_supplies_v3.sql), dates left as they are. */
const saveRoutine = (client: Client, routine: Omit<ValidRoutine, "startDate" | "endDate"> & Partial<Pick<ValidRoutine, "startDate" | "endDate">>) =>
  saveKeyedRoutine(client, { startDate: null, endDate: null, ...routine }, { key: randomUUID(), hash: randomUUID().replaceAll("-", "").padEnd(64, "0") });


const people = {
  alex: { email: uniqueEmail("s16-alex"), name: "Alex Supplements", role: "researcher" },
  blair: { email: uniqueEmail("s16-blair"), name: "Blair Other", role: "researcher" },
  cara: { email: uniqueEmail("s16-cara"), name: "Cara Taps", role: "researcher" },
  dev: { email: uniqueEmail("s16-dev"), name: "Dev Edits", role: "researcher" },
  eve: { email: uniqueEmail("s16-eve"), name: "Eve Stock", role: "researcher" },
  una: { email: uniqueEmail("s16-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("s16-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("s16-noah"), name: "Noah Admin", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const TORONTO = "America/Toronto";
/** Today in Toronto, as the server will judge it (see beforeAll). */
let today = "";

const NULL_ID = null as unknown as string;
const NULL_VERSION = null as unknown as number;

const routineArgs = (overrides: Record<string, unknown> = {}) => ({
  p_id: NULL_ID,
  p_version: NULL_VERSION,
  p_name: "Vitamin D3",
  p_amount: "2000",
  p_unit: "IU",
  // Midnight: today's occurrence is always past, so "now" is a valid actual time.
  p_time: "00:00",
  ...overrides,
});

async function create(who: Name, overrides: Record<string, unknown> = {}): Promise<string> {
  const json = (await ok(db[who].rpc("save_supplement_routine", routineArgs(overrides)), "create routine")) as unknown as { id: string };
  return json.id;
}

/** The occurrence the app computes for a routine at `time` on `date`. */
const scheduled = (routineId: string, date: string, time = "00:00") =>
  occurrenceOn({ id: routineId, time, timeZone: TORONTO, definitionFrom: date, endDate: null }, date)!.scheduledAt;

const takeArgs = (routineId: string, date: string, overrides: Record<string, unknown> = {}) => ({
  p_request_key: randomUUID(),
  p_occurrence_key: `${routineId}:${date}`,
  p_seen_scheduled_at: scheduled(routineId, date),
  p_seen_name: "Vitamin D3",
  p_seen_amount: "2000",
  p_seen_unit: "IU",
  ...overrides,
});

const takenRows = (routineId: string) =>
  ok(
    serviceClient()
      .from("supplement_taken")
      .select("id, occurrence_key, local_date, scheduled_at, name, amount::text, unit, actual_at, recorded_at, request_key")
      .eq("routine_id", routineId)
      .order("local_date"),
    "taken rows",
  );

const routineRow = (routineId: string) =>
  ok(
    serviceClient()
      .from("supplement_routines")
      .select("name, amount::text, unit, time_of_day, time_zone, start_date, definition_from, end_date, version, schedule_version, created_at, updated_at")
      .eq("id", routineId)
      .single(),
    "routine row",
  );

beforeAll(async () => {
  // Not within a minute of Toronto's midnight, so the day stays put for the run.
  while (checkInDay(new Date()) !== checkInDay(new Date(Date.now() + 60_000))) await new Promise((r) => setTimeout(r, 5_000));
  today = checkInDay(new Date());
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
    if (key !== "una") await ok(db[key].rpc("set_supplement_tracking", { p_enabled: true }), `${key} tracking on`);
  }
}, 120_000);

describe("routines are the owner's; a grant reads, never writes", () => {
  it("isolates everyone else, lets a granted admin read only, and denies again on revoke", async () => {
    const routineId = await create("alex");
    const taken = await ok(db.alex.rpc("take_supplement", takeArgs(routineId, today)), "alex takes");
    expect(taken).toMatchObject({ occurrence_key: `${routineId}:${today}`, replayed: false });
    await ok(db.alex.rpc("share_with_team"), "share with the team");

    const [routine] = await listRoutines(db.alex, id.alex);
    expect(routine).toMatchObject({ id: routineId, name: "Vitamin D3", amount: "2000", unit: "IU", time: "00:00", timeZone: TORONTO, startDate: today, endDate: null, version: 1 });
    const records = await listTaken(db.alex, id.alex);
    expect(records.map((t) => t.occurrenceKey)).toEqual([`${routineId}:${today}`]);
    expect(await getSupplementTracking(db.alex, id.alex)).toBe(true);

    // Nobody writes the tables directly, not even the owner or the service role.
    for (const table of ["supplement_routines", "supplement_taken", "supplement_settings"] as const) {
      expect(await sqlState(db.alex.from(table).delete().eq("owner_id", id.alex), `owner deletes ${table}`), table).toBe("42501");
      expect(await sqlState(db.alex.from(table).update({ owner_id: id.alex } as never).eq("owner_id", id.alex), `owner updates ${table}`), table).toBe("42501");
      expect(await sqlState(serviceClient().from(table).delete().eq("owner_id", id.alex), `service deletes ${table}`), table).toBe("42501");
    }
    expect(await sqlState(db.alex.from("supplement_routines").insert({ owner_id: id.alex, name: "X", amount: 1, unit: "mg", time_of_day: "08:00", start_date: today } as never), "owner inserts")).toBe("42501");

    // The granted admin reads everything of Alex's ...
    expect(await listRoutines(db.grace, id.alex)).toEqual([routine]);
    expect(await listTaken(db.grace, id.alex)).toEqual(records);
    expect(await getSupplementTracking(db.grace, id.alex)).toBe(true);
    // ... and changes nothing: Alex's routine is not hers to edit, end or take.
    expect(await ok(db.grace.rpc("save_supplement_routine", routineArgs({ p_id: routineId, p_version: 1, p_name: "Changed" })), "grace edits")).toBeNull();
    expect(await ok(db.grace.rpc("end_supplement_routine", { p_id: routineId, p_version: 1 }), "grace ends")).toBeNull();
    expect(await ok(db.grace.rpc("take_supplement", takeArgs(routineId, addDays(today, -1))), "grace takes")).toBeNull();

    // Another researcher reads nothing; every admin reads while Alex shares; neither writes.
    expect(await listRoutines(db.blair, id.alex)).toEqual([]);
    expect(await listTaken(db.blair, id.alex)).toEqual([]);
    expect(await getSupplementTracking(db.blair, id.alex)).toBe(false);
    expect(await listRoutines(db.noah, id.alex)).toEqual([routine]);
    for (const who of ["blair", "noah"] as const) {
      expect(await ok(db[who].rpc("end_supplement_routine", { p_id: routineId, p_version: 1 }), `${who} ends`)).toBeNull();
    }

    // Unacknowledged: reads nothing of Alex's, writes nothing at all.
    expect(await listRoutines(db.una, id.alex)).toEqual([]);
    expect(await sqlState(db.una.rpc("set_supplement_tracking", { p_enabled: true }), "una tracking")).toBe("42501");
    expect(await sqlState(db.una.rpc("save_supplement_routine", routineArgs()), "una creates")).toBe("42501");
    expect(await sqlState(db.una.rpc("end_supplement_routine", { p_id: routineId, p_version: 1 }), "una ends")).toBe("42501");
    expect(await sqlState(db.una.rpc("take_supplement", takeArgs(routineId, today)), "una takes")).toBe("42501");

    // Anonymous: no rows and no functions.
    const anon = anonClient();
    for (const table of ["supplement_routines", "supplement_taken", "supplement_settings"] as const) {
      const { data } = await anon.from(table).select("owner_id").eq("owner_id", id.alex);
      expect(data ?? [], table).toEqual([]);
    }
    expect(await sqlState(anon.rpc("save_supplement_routine", routineArgs()), "anon creates")).not.toBe("ok");
    expect(await sqlState(anon.rpc("take_supplement", takeArgs(routineId, today)), "anon takes")).not.toBe("ok");
    // S13's hook is the service role's only.
    const window = { p_from: new Date(Date.now() - 3_600_000).toISOString(), p_to: new Date().toISOString() };
    expect(await sqlState(anon.rpc("due_supplement_occurrences", window), "anon due")).not.toBe("ok");
    expect(await sqlState(db.alex.rpc("due_supplement_occurrences", window), "alex due")).not.toBe("ok");

    // Nothing changed Alex's records.
    expect(await listRoutines(db.alex, id.alex)).toEqual([routine]);
    expect(await listTaken(db.alex, id.alex)).toEqual(records);

    // Revoked: denied on the next read.
    await ok(db.alex.rpc("stop_sharing_with_team"), "stop sharing");
    expect(await listRoutines(db.grace, id.alex)).toEqual([]);
    expect(await listTaken(db.grace, id.alex)).toEqual([]);
  });
});

describe("Taken", () => {
  it("records one per request and per occurrence, however it is retried", async () => {
    const routineId = await create("cara");
    const args = takeArgs(routineId, today);
    // A double tap (the same request twice at once), then a retry.
    const [first, second] = await Promise.all([
      ok(db.cara.rpc("take_supplement", args), "tap 1"),
      ok(db.cara.rpc("take_supplement", args), "tap 2"),
    ]);
    const third = (await ok(db.cara.rpc("take_supplement", args), "retry")) as Record<string, unknown>;
    const results = [first, second, third] as Record<string, unknown>[];
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true, true]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const rows = await takenRows(routineId);
    expect(rows).toHaveLength(1);
    // Now, by the database's clock: actual and recorded are the same instant.
    expect(rows[0]).toMatchObject({ local_date: today, name: "Vitamin D3", amount: "2000", unit: "IU", request_key: args.p_request_key });
    expect(Date.parse(rows[0].actual_at)).toBe(Date.parse(rows[0].recorded_at));
    expect(Date.parse(rows[0].scheduled_at)).toBe(Date.parse(scheduled(routineId, today)));

    // Another request for the same occurrence: already taken.
    expect(await sqlState(db.cara.rpc("take_supplement", takeArgs(routineId, today)), "again")).toBe("AP018");
    // The same request key for another occurrence or by another account: refused.
    expect(await sqlState(db.cara.rpc("take_supplement", { ...args, p_occurrence_key: `${routineId}:${addDays(today, -1)}` }), "key reused")).toBe("22023");
    const blairRoutine = await create("blair");
    expect(await sqlState(db.blair.rpc("take_supplement", takeArgs(blairRoutine, today, { p_request_key: args.p_request_key })), "key stolen")).toBe("22023");
    expect(await takenRows(routineId)).toEqual(rows);
  });

  it("serializes two different requests for one occurrence: one records, the other is refused", async () => {
    const routineId = await create("cara", { p_name: "Zinc" });
    const [a, b] = await Promise.all([
      sqlState(db.cara.rpc("take_supplement", takeArgs(routineId, today, { p_seen_name: "Zinc" })), "a"),
      sqlState(db.cara.rpc("take_supplement", takeArgs(routineId, today, { p_seen_name: "Zinc" })), "b"),
    ]);
    expect([a, b].sort()).toEqual(["AP018", "ok"]);
    expect(await takenRows(routineId)).toHaveLength(1);
  });

  it("refuses what Today refuses, deriving the occurrence on the server", async () => {
    const routineId = await create("dev", { p_name: "Magnesium", p_amount: "1.5", p_unit: "capsules" });
    const at = (date: string, overrides: Record<string, unknown> = {}) =>
      takeArgs(routineId, date, { p_seen_name: "Magnesium", p_seen_amount: "1.5", p_seen_unit: "capsules", ...overrides });
    const refused = async (args: Record<string, unknown>, what: string) => sqlState(db.dev.rpc("take_supplement", args as never), what);

    expect(await refused(at(addDays(today, -1)), "before its start")).toBe("AP017");
    expect(await refused(at(addDays(today, 1)), "tomorrow")).toBe("AP019");
    expect(await refused(at(today, { p_seen_scheduled_at: scheduled(routineId, today, "08:00") }), "other time")).toBe("AP020");
    expect(await refused(at(today, { p_seen_amount: "2" }), "other amount")).toBe("AP020");
    expect(await refused(at(today, { p_seen_name: "Magnesium citrate" }), "other name")).toBe("AP020");
    expect(await refused(at(today, { p_seen_unit: "mg" }), "other unit")).toBe("AP020");
    expect(await refused(at(today, { p_actual_at: new Date(Date.now() + 120_000).toISOString() }), "future")).toBe("AP021");
    const midnight = Date.parse(scheduled(routineId, today));
    expect(await refused(at(today, { p_actual_at: new Date(midnight - 86_400_000 - 60_000).toISOString() }), "over a day early")).toBe("AP022");
    for (const key of [`${routineId}:${today.replace(/-\d\d$/, "-32")}`, `${routineId}:2026-02-30`, `${routineId}:0`, routineId, `${routineId.toUpperCase()}:${today}`]) {
      expect(await refused(at(today, { p_occurrence_key: key }), key), key).toBe("22023");
    }
    expect(await ok(db.dev.rpc("take_supplement", at(today, { p_occurrence_key: `${randomUUID()}:${today}` })), "unknown routine")).toBeNull();
    expect(await takenRows(routineId)).toEqual([]);

    // Up to a day before the planned time is fine (logged late or early).
    const actual = new Date(midnight - 86_400_000 + 60_000).toISOString();
    const result = await takeSupplement(db.dev, {
      requestKey: randomUUID(),
      occurrenceKey: `${routineId}:${today}`,
      seenScheduledAt: scheduled(routineId, today),
      seenName: "Magnesium",
      seenAmount: "1.5",
      seenUnit: "capsules",
      actualAt: actual,
    });
    expect(result).toMatchObject({ kind: "taken", name: "Magnesium", replayed: false });
    const [row] = await takenRows(routineId);
    expect(Date.parse(row.actual_at)).toBe(Date.parse(actual));
    expect(Date.parse(row.actual_at)).toBeLessThanOrEqual(Date.parse(row.recorded_at));

    // Tracking off refuses (and keeps everything); on again, it works again.
    await ok(db.dev.rpc("set_supplement_tracking", { p_enabled: false }), "off");
    expect(await sqlState(db.dev.rpc("save_supplement_routine", routineArgs()), "create while off")).toBe("AP026");
    expect(await sqlState(db.dev.rpc("end_supplement_routine", { p_id: routineId, p_version: 1 }), "end while off")).toBe("AP026");
    const other = await ok(serviceClient().from("supplement_routines").select("id").eq("owner_id", id.dev), "dev routines");
    expect(other).toHaveLength(1);
    await ok(db.dev.rpc("set_supplement_tracking", { p_enabled: true }), "on");
  });
});

describe("edits and End", () => {
  it("refuse a stale version, never rewrite what was taken, and move S13's schedule_version", async () => {
    const routineId = await create("dev", { p_name: "Vitamin C", p_amount: "500", p_unit: "mg" });
    const created = await routineRow(routineId);
    expect(created).toMatchObject({ start_date: today, definition_from: today, end_date: null, version: 1, schedule_version: 1, time_zone: TORONTO });
    await ok(db.dev.rpc("take_supplement", takeArgs(routineId, today, { p_seen_name: "Vitamin C", p_seen_amount: "500", p_seen_unit: "mg" })), "take");
    const before = await takenRows(routineId);

    const edit = await saveRoutine(db.dev, { id: routineId, version: 1, name: "Vitamin C (buffered)", amount: "1000.50", unit: "mg", time: "07:15" });
    expect(edit).toEqual({ kind: "saved", id: routineId, version: 2, replayed: false });
    expect(await routineRow(routineId)).toMatchObject({ name: "Vitamin C (buffered)", amount: "1000.5", time_of_day: "07:15", version: 2, schedule_version: 2 });
    // The Taken record keeps the routine as it was.
    expect(await takenRows(routineId)).toEqual(before);
    expect(before[0]).toMatchObject({ name: "Vitamin C", amount: "500", unit: "mg" });

    // Another device still showing version 1.
    expect(await saveRoutine(db.dev, { id: routineId, version: 1, name: "Stale", amount: "1", unit: "mg", time: "08:00" })).toEqual({ kind: "changed" });
    expect(await sqlState(db.dev.rpc("end_supplement_routine", { p_id: routineId, p_version: 1 }), "stale end")).toBe("AP025");

    const ended = (await ok(db.dev.rpc("end_supplement_routine", { p_id: routineId, p_version: 2 }), "end")) as Record<string, unknown>;
    expect(ended).toMatchObject({ id: routineId, version: 3, end_date: today });
    expect(await routineRow(routineId)).toMatchObject({ end_date: today, version: 3, schedule_version: 3 });
    expect(await saveRoutine(db.dev, { id: routineId, version: 3, name: "Again", amount: "1", unit: "mg", time: "08:00" })).toEqual({ kind: "ended" });
    expect(await sqlState(db.dev.rpc("end_supplement_routine", { p_id: routineId, p_version: 3 }), "end twice")).toBe("AP027");
    expect(await takenRows(routineId)).toEqual(before);
    // Its dates end today: tomorrow is no longer one of its occurrences.
    expect(await sqlState(db.dev.rpc("take_supplement", takeArgs(routineId, addDays(today, 1), { p_seen_name: "Vitamin C (buffered)", p_seen_amount: "1000.5" })), "after end")).toBe("AP017");
    const row = (await routineRow(routineId)) as unknown as { updated_at: string; created_at: string };
    expect(Date.parse(row.updated_at)).toBeGreaterThanOrEqual(Date.parse(row.created_at));
  });

  it("refuses a Taken from a screen showing the old name after a rename on another device", async () => {
    const routineId = await create("dev", { p_name: "Fish oil" });
    // The phone shows "Fish oil"; another device renames it (nothing else changes).
    const shown = takeArgs(routineId, today, { p_seen_name: "Fish oil" });
    expect(await saveRoutine(db.dev, { id: routineId, version: 1, name: "Omega-3 fish oil", amount: "2000", unit: "IU", time: "00:00" })).toMatchObject({ kind: "saved" });
    expect(await sqlState(db.dev.rpc("take_supplement", shown), "old name")).toBe("AP020");
    expect(await takenRows(routineId)).toEqual([]);
    // The refreshed screen shows the new name, and records it.
    await ok(db.dev.rpc("take_supplement", takeArgs(routineId, today, { p_seen_name: "Omega-3 fish oil" })), "new name");
    expect((await takenRows(routineId)).map((t) => t.name)).toEqual(["Omega-3 fish oil"]);
  });

  it("checks the input as the app does: exact amounts, lengths in characters, a real time", async () => {
    const bad = async (overrides: Record<string, unknown>) => sqlState(db.dev.rpc("save_supplement_routine", routineArgs(overrides)), JSON.stringify(overrides));
    for (const overrides of [
      { p_amount: "1,5" },
      { p_amount: "0" },
      { p_amount: "1000000" },
      { p_amount: "0.0000001" },
      { p_amount: "1e3" },
      { p_name: " " },
      { p_name: "\u{1F48A}".repeat(81) },
      { p_unit: "" },
      { p_unit: "\u{1F48A}".repeat(21) },
      { p_time: "24:00" },
      { p_time: "8:00" },
      { p_id: randomUUID() },
    ]) {
      expect(await bad(overrides), JSON.stringify(overrides)).toBe("22023");
    }
    const emojiName = "\u{1F48A}".repeat(80);
    const routineId = await create("dev", { p_name: `  ${emojiName}\t`, p_unit: "\u{1F48A}".repeat(20), p_amount: "000.500" });
    expect(await routineRow(routineId)).toMatchObject({ name: emojiName, amount: "0.5" });
    // Someone else's routine, or none: nothing to edit.
    expect(await ok(db.dev.rpc("save_supplement_routine", routineArgs({ p_id: randomUUID(), p_version: 1 })), "missing")).toBeNull();
  });
});

describe("supplements never touch peptide stock", () => {
  it("leaves doses, vials, deductions and mixtures exactly as they were", async () => {
    // Eve tracks a vial of a mixture her cycle uses, and has recorded a dose.
    const grace = db.grace;
    const peptide = await createPeptide(grace, `Supplements A ${tag()}`);
    const cycleId = await createCycle(db.eve, { timeZone: NOON, plans: [plan(peptide, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
    const planId = (await ok(db.eve.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan"))[0].id;
    await ok(db.eve.rpc("set_supply_tracking", { p_enabled: true }), "supplies on");
    const mixtureId = (await ok(
      db.eve.rpc("save_mixture", { p_peptide_id: peptide, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] }),
      "mixture",
    ))!;
    await ok(db.eve.rpc("save_personal_vial", { p_label: "E-1", p_peptide_id: peptide, p_strength_mg: "10", p_mixture_id: mixtureId }), "vial");
    await ok(db.eve.rpc("confirm_dose", (await confirmArgsSeen(db.eve, await doseOn(db.eve, cycleId, d(0)))) as never), "dose");

    const snapshot = async () => {
      const service = serviceClient();
      const [doses, vials, deductions, mixtures, versions] = await Promise.all([
        ok(service.from("dose_records").select("*").eq("owner_id", id.eve).order("id"), "doses"),
        ok(service.from("personal_vials").select("*").eq("owner_id", id.eve).order("id"), "vials"),
        ok(service.from("personal_vial_deductions").select("*").eq("owner_id", id.eve).order("id"), "deductions"),
        ok(service.from("mixtures").select("*").eq("owner_id", id.eve).order("id"), "mixtures"),
        ok(service.from("mixture_versions").select("*").eq("owner_id", id.eve).order("id"), "versions"),
      ]);
      return { doses, vials, deductions, mixtures, versions };
    };
    const before = await snapshot();
    expect(before.deductions).toHaveLength(1);

    // A supplement in mg, taken, edited and ended.
    const routineId = await create("eve", { p_name: "Creatine", p_amount: "5", p_unit: "mg" });
    await ok(db.eve.rpc("take_supplement", takeArgs(routineId, today, { p_seen_name: "Creatine", p_seen_amount: "5", p_seen_unit: "mg" })), "take");
    await saveRoutine(db.eve, { id: routineId, version: 1, name: "Creatine", amount: "3", unit: "g", time: "09:00" });
    await ok(db.eve.rpc("end_supplement_routine", { p_id: routineId, p_version: 2 }), "end");
    await ok(db.eve.rpc("set_supplement_tracking", { p_enabled: false }), "off");

    expect(await snapshot()).toEqual(before);
  });
});

describe("S13's hook", () => {
  it("lists each untaken occurrence due in a window, with its schedule_version, while tracking is on", async () => {
    const routineId = await create("blair", { p_name: "Omega-3", p_amount: "1", p_unit: "capsule", p_time: "00:00" });
    const service = serviceClient();
    const from = scheduled(routineId, today);
    const window = { p_from: new Date(Date.parse(from) - 60_000).toISOString(), p_to: new Date(Date.parse(from) + 60_000).toISOString() };
    const due = async () => (await listDueSupplements(service, window.p_from, window.p_to)).filter((o) => o.routineId === routineId);

    expect(await due()).toEqual([
      {
        ownerId: id.blair,
        routineId,
        occurrenceKey: `${routineId}:${today}`,
        localDate: today,
        scheduledAt: expect.any(String),
        scheduleVersion: 1,
        name: "Omega-3",
        amount: "1",
        unit: "capsule",
      },
    ]);
    expect(Date.parse((await due())[0].scheduledAt)).toBe(Date.parse(from));

    // Tracking off: not due; on again: due.
    await ok(db.blair.rpc("set_supplement_tracking", { p_enabled: false }), "off");
    expect(await due()).toEqual([]);
    await ok(db.blair.rpc("set_supplement_tracking", { p_enabled: true }), "on");
    expect(await due()).toHaveLength(1);
    // Taken: not due any more.
    await ok(db.blair.rpc("take_supplement", takeArgs(routineId, today, { p_seen_name: "Omega-3", p_seen_amount: "1", p_seen_unit: "capsule" })), "take");
    expect(await due()).toEqual([]);

    // Windows are bounded.
    const now = Date.now();
    expect(await sqlState(service.rpc("due_supplement_occurrences", { p_from: new Date(now).toISOString(), p_to: new Date(now - 1).toISOString() }), "backwards")).toBe("22023");
    expect(await sqlState(service.rpc("due_supplement_occurrences", { p_from: new Date(now).toISOString(), p_to: new Date(now + 9 * 86_400_000).toISOString() }), "too long")).toBe("22023");
    // Pages are 1 to 1,000 rows, and a cursor has both parts.
    const day = { p_from: new Date(now).toISOString(), p_to: new Date(now + 86_400_000).toISOString() };
    for (const bad of [{ p_limit: 1001 }, { p_limit: 0 }, { p_after_at: day.p_from }, { p_after_routine: routineId }]) {
      expect(await sqlState(service.rpc("due_supplement_occurrences", { ...day, ...bad }), JSON.stringify(bad)), JSON.stringify(bad)).toBe("22023");
    }
  });
});
