// S15 progress check-ins (R9) against the real local Supabase, through
// PostgREST as each signed-in person, exactly as the app reads and writes:
// the owner reads and writes (only through save_check_in); a granted admin
// reads and never writes; a revoked or non-granted admin, another
// researcher, an unacknowledged account and anonymous callers get nothing.
// One check-in per researcher per local day (the cycle's zone, by the
// server's clock), replaced in place by an edit carrying the version shown;
// a stale version or a second first save is refused. Times are compared with
// the database's own timestamps (its clock can step back under load).
// Cycles use a fixed-offset zone where it is about 12:00 now (tests/support/noon).
import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/cycles/rules";
import type { ValidCheckIn } from "@/lib/progress/rules";
import { checkInDay } from "@/lib/progress/rules";
import { countCheckIns, listCheckIns, saveCheckIn } from "@/lib/progress/service";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { d, NOON } from "../support/noon";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const people = {
  alex: { email: uniqueEmail("s15-alex"), name: "Alex Progress", role: "researcher" },
  blair: { email: uniqueEmail("s15-blair"), name: "Blair Other", role: "researcher" },
  cara: { email: uniqueEmail("s15-cara"), name: "Cara Concurrent", role: "researcher" },
  dev: { email: uniqueEmail("s15-dev"), name: "Dev Zones", role: "researcher" },
  una: { email: uniqueEmail("s15-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("s15-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("s15-noah"), name: "Noah Not Granted", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
let peptideA = "";

const cycleIn = (who: Name, timeZone = NOON) =>
  createCycle(db[who], { timeZone, plans: [plan(peptideA, [interval(d(-4), d(20), "0.4", 2, "08:00")])] });

const checkIn = (cycleId: string, overrides: Partial<ValidCheckIn> = {}): ValidCheckIn => ({
  cycleId,
  day: d(0),
  version: null,
  feeling: 4,
  effects: ["Mild headache"],
  note: "Slept better.",
  measurement: null,
  ...overrides,
});

/** save_check_in's raw arguments (to try what the app never sends). */
const rawArgs = (cycleId: string, overrides: Record<string, unknown> = {}) => ({
  p_cycle_id: cycleId,
  p_day: d(0),
  p_version: null as unknown as number,
  p_feeling: 3,
  p_effects: [] as string[],
  p_note: "",
  ...overrides,
});

const rowsOf = (ownerId: string) =>
  ok(
    serviceClient()
      .from("progress_check_ins")
      .select("id, day, time_zone, feeling, effects, note, measurement_name, measurement_value::text, measurement_unit, measured_at, version, created_at, updated_at")
      .eq("owner_id", ownerId)
      .order("day"),
    "check-in rows",
  );

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  peptideA = await createPeptide(db.grace, `Progress A ${tag()}`);
});

describe("check-ins are the owner's; a grant reads, never writes", () => {
  it("isolates everyone else, lets a granted admin read only, and denies again on revoke", async () => {
    const cycleId = await cycleIn("alex");
    const saved = await saveCheckIn(db.alex, checkIn(cycleId));
    expect(saved).toMatchObject({ kind: "saved", day: d(0), version: 1 });
    await ok(db.alex.rpc("grant_support_access", { p_admin_id: id.grace }), "grant grace");

    // The owner reads it, and writes only through save_check_in.
    const [mine] = await listCheckIns(db.alex, id.alex);
    expect(mine).toMatchObject({ day: d(0), timeZone: NOON, feeling: 4, effects: ["Mild headache"], note: "Slept better.", measurement: null, version: 1 });
    expect(await countCheckIns(db.alex, id.alex)).toBe(1);
    const table = "progress_check_ins";
    expect(await sqlState(db.alex.from(table).update({ feeling: 1 } as never).eq("owner_id", id.alex), "owner updates")).toBe("42501");
    expect(await sqlState(db.alex.from(table).delete().eq("owner_id", id.alex), "owner deletes")).toBe("42501");
    expect(await sqlState(db.alex.from(table).insert({ owner_id: id.alex, day: d(-1), time_zone: NOON, feeling: 3 } as never), "owner inserts")).toBe("42501");
    // Not even the service role writes it directly.
    expect(await sqlState(serviceClient().from(table).delete().eq("owner_id", id.alex), "service deletes")).toBe("42501");

    // The granted admin reads Alex's check-ins ...
    expect(await listCheckIns(db.grace, id.alex)).toEqual([mine]);
    expect(await countCheckIns(db.grace, id.alex)).toBe(1);
    // ... and changes none of them: Alex's cycle isn't hers, and the table refuses her.
    expect(await saveCheckIn(db.grace, checkIn(cycleId, { version: 1, feeling: 1 }))).toEqual({ kind: "not_found" });
    expect(await sqlState(db.grace.from(table).update({ feeling: 1 } as never).eq("owner_id", id.alex), "grace updates")).toBe("42501");
    expect(await sqlState(db.grace.from(table).delete().eq("owner_id", id.alex), "grace deletes")).toBe("42501");

    // Another researcher and a non-granted admin: nothing, and no writes through Alex's cycle.
    for (const who of ["blair", "noah"] as const) {
      expect(await listCheckIns(db[who], id.alex), who).toEqual([]);
      expect(await countCheckIns(db[who], id.alex), who).toBe(0);
      expect(await saveCheckIn(db[who], checkIn(cycleId, { version: 1 })), who).toEqual({ kind: "not_found" });
    }

    // Unacknowledged: reads nothing of Alex's, writes nothing at all.
    expect(await listCheckIns(db.una, id.alex)).toEqual([]);
    expect(await sqlState(db.una.rpc("save_check_in", rawArgs(cycleId)), "una saves")).toBe("42501");

    // Anonymous: no rows and no function.
    const anon = anonClient();
    const { data } = await anon.from(table).select("id").eq("owner_id", id.alex);
    expect(data ?? []).toEqual([]);
    expect(await sqlState(anon.rpc("save_check_in", rawArgs(cycleId)), "anon saves")).not.toBe("ok");

    // Nothing changed Alex's check-in.
    expect(await listCheckIns(db.alex, id.alex)).toEqual([mine]);

    // Revoked: denied on the next read.
    await ok(db.alex.rpc("revoke_support_access", { p_admin_id: id.grace }), "revoke grace");
    expect(await listCheckIns(db.grace, id.alex)).toEqual([]);
    expect(await countCheckIns(db.grace, id.alex)).toBe(0);
  });
});

describe("one check-in per researcher per day, edited in place", () => {
  it("refuses a second first save and a stale version, and replaces the row on an edit", async () => {
    const cycleId = await cycleIn("blair");
    const first = await saveCheckIn(db.blair, checkIn(cycleId, { measurement: { name: "Weight", value: "82.40", unit: "kg" } }));
    if (first.kind !== "saved") throw new Error(first.kind);
    const [row1] = await rowsOf(id.blair);
    // Exact numeric, stored without trailing zeros; measured when saved (the database's clock).
    expect(row1).toMatchObject({ id: first.id, day: d(0), feeling: 4, measurement_name: "Weight", measurement_value: "82.4", measurement_unit: "kg", version: 1 });
    expect(Date.parse(row1.measured_at!)).toBe(Date.parse(first.savedAt));
    expect(Date.parse(row1.updated_at)).toBe(Date.parse(first.savedAt));

    // Another device's first save for the same day: refused, nothing changes.
    expect(await saveCheckIn(db.blair, checkIn(cycleId, { feeling: 1 }))).toEqual({ kind: "changed" });
    // A second cycle in the same zone is the same day: still one check-in.
    const other = await cycleIn("blair");
    expect(await saveCheckIn(db.blair, checkIn(other, { feeling: 1 }))).toEqual({ kind: "changed" });
    expect(await rowsOf(id.blair)).toEqual([row1]);

    // An edit from version 1 replaces it in place; the unchanged measurement keeps its time.
    const edit = await saveCheckIn(
      db.blair,
      checkIn(cycleId, { version: 1, feeling: 2, effects: ["None noticed"], note: "", measurement: { name: "Weight", value: "82.4", unit: "kg" } }),
    );
    expect(edit).toMatchObject({ kind: "saved", id: first.id, day: d(0), version: 2 });
    const [row2] = await rowsOf(id.blair);
    expect(row2).toMatchObject({ id: first.id, feeling: 2, effects: ["None noticed"], note: "", version: 2, measured_at: row1.measured_at });
    expect(Date.parse(row2.updated_at)).toBeGreaterThanOrEqual(Date.parse(row2.created_at));

    // A stale screen (still on version 1) saves nothing.
    expect(await saveCheckIn(db.blair, checkIn(cycleId, { version: 1, feeling: 5 }))).toEqual({ kind: "changed" });
    expect(await rowsOf(id.blair)).toEqual([row2]);

    // A changed measurement is measured again; clearing it removes it.
    const edit3 = await saveCheckIn(db.blair, checkIn(cycleId, { version: 2, measurement: { name: "Sleep", value: "6.5", unit: "h" } }));
    if (edit3.kind !== "saved") throw new Error(edit3.kind);
    const [row3] = await rowsOf(id.blair);
    expect(row3).toMatchObject({ measurement_name: "Sleep", measurement_value: "6.5", measurement_unit: "h", version: 3 });
    expect(Date.parse(row3.measured_at!)).toBe(Date.parse(edit3.savedAt));
    expect(await saveCheckIn(db.blair, checkIn(cycleId, { version: 3, measurement: null }))).toMatchObject({ kind: "saved", version: 4 });
    expect((await rowsOf(id.blair))[0]).toMatchObject({ measurement_name: null, measurement_value: null, measurement_unit: null, measured_at: null, version: 4 });
  });

  it("lets exactly one of two concurrent saves from the same version through", async () => {
    const cycleId = await cycleIn("cara");
    const firsts = await Promise.all([1, 2, 3].map((feeling) => saveCheckIn(db.cara, checkIn(cycleId, { feeling }))));
    expect(firsts.filter((r) => r.kind === "saved")).toHaveLength(1);
    expect(firsts.filter((r) => r.kind === "changed")).toHaveLength(2);
    const edits = await Promise.all([4, 5].map((feeling) => saveCheckIn(db.cara, checkIn(cycleId, { version: 1, feeling }))));
    expect(edits.map((r) => r.kind).sort()).toEqual(["changed", "saved"]);
    const rows = await rowsOf(id.cara);
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(2);
    expect([4, 5]).toContain(rows[0].feeling);
  });
});

/**
 * Two fixed-offset zones whose dates differ right now, each at least an hour
 * from its midnight (the offsets span 26 hours, so such a pair always exists).
 */
function zonesOnTwoDays(now = Date.now()) {
  const zones = Array.from({ length: 27 }, (_, i) => {
    const offset = i - 12;
    const local = new Date(now + offset * 3_600_000);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    const zone = offset === 0 ? "Etc/GMT" : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
    return { zone, day: local.toISOString().slice(0, 10), margin: Math.min(minutes, 1440 - minutes) };
  });
  let best: { a: (typeof zones)[number]; b: (typeof zones)[number]; margin: number } | null = null;
  for (const a of zones)
    for (const b of zones) {
      if (a.day >= b.day) continue;
      const margin = Math.min(a.margin, b.margin);
      if (!best || margin > best.margin) best = { a, b, margin };
    }
  if (!best || best.margin < 60) throw new Error("No zone pair an hour from midnight");
  return best;
}

describe("the day is today in the cycle's zone, by the server's clock", () => {
  it("dates each check-in in its cycle's zone, and refuses any other day", async () => {
    const { a, b } = zonesOnTwoDays();
    const [cycleA, cycleB] = [await cycleIn("dev", a.zone), await cycleIn("dev", b.zone)];

    // A past or future day, or a day from a page opened before midnight: refused.
    for (const day of [addDays(a.day, -1), addDays(a.day, 1), addDays(a.day, -5)]) {
      expect(await saveCheckIn(db.dev, checkIn(cycleA, { day })), day).toEqual({ kind: "new_day" });
    }
    expect(await saveCheckIn(db.dev, checkIn(cycleA, { day: b.day }))).toEqual({ kind: "new_day" });

    const savedA = await saveCheckIn(db.dev, checkIn(cycleA, { day: a.day, feeling: 2 }));
    const savedB = await saveCheckIn(db.dev, checkIn(cycleB, { day: b.day, feeling: 5 }));
    if (savedA.kind !== "saved" || savedB.kind !== "saved") throw new Error(`${savedA.kind} ${savedB.kind}`);
    // The day is the date of the server's own save time in each zone.
    expect(savedA.day).toBe(checkInDay(savedA.savedAt, a.zone));
    expect(savedB.day).toBe(checkInDay(savedB.savedAt, b.zone));
    const rows = await rowsOf(id.dev);
    expect(rows.map((r) => [r.day, r.time_zone, r.feeling])).toEqual([
      [a.day, a.zone, 2],
      [b.day, b.zone, 5],
    ]);
    // Reading a range of days.
    expect((await listCheckIns(db.dev, id.dev, { from: b.day })).map((c) => c.day)).toEqual([b.day]);
    expect((await listCheckIns(db.dev, id.dev, { to: a.day })).map((c) => c.day)).toEqual([a.day]);
  });

  it("re-checks every input in the database", async () => {
    const cycleId = await cycleIn("dev");
    const measured = (value: unknown, overrides: Record<string, unknown> = {}) =>
      rawArgs(cycleId, { p_measurement_name: "Weight", p_measurement_value: value, p_measurement_unit: "kg", ...overrides });
    for (const [label, args] of [
      ["feeling 0", rawArgs(cycleId, { p_feeling: 0 })],
      ["feeling 6", rawArgs(cycleId, { p_feeling: 6 })],
      ["unknown chip", rawArgs(cycleId, { p_effects: ["Dizzy"] })],
      ["repeated chip", rawArgs(cycleId, { p_effects: ["Nausea", "Nausea"] })],
      ["none noticed and more", rawArgs(cycleId, { p_effects: ["None noticed", "Nausea"] })],
      ["long note", rawArgs(cycleId, { p_note: "x".repeat(1001) })],
      ["negative value", measured("-1")],
      ["huge value", measured("1000000")],
      ["too precise", measured("0.1234567")],
      ["unknown measurement", measured("5", { p_measurement_name: "Mood" })],
      ["no unit", measured("5", { p_measurement_unit: "  " })],
      ["long unit", measured("5", { p_measurement_unit: "x".repeat(21) })],
    ] as const) {
      expect(await sqlState(db.dev.rpc("save_check_in", args as never), label), label).toBe("22023");
    }
    // Not the caller's cycle, or none: null.
    expect(await ok(db.dev.rpc("save_check_in", rawArgs("00000000-0000-4000-8000-000000000000")), "no cycle")).toBeNull();
  });
});
