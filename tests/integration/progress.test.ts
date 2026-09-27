// S15 progress check-ins (R9) against the real local Supabase, through
// PostgREST as each signed-in person, exactly as the app reads and writes:
// the owner reads and writes (only through save_check_in); a granted admin
// reads and never writes; a revoked or non-granted admin, another
// researcher, an unacknowledged account and anonymous callers get nothing.
// One check-in per researcher per America/Toronto day (by the server's
// clock), with or without cycles in any zone, replaced in place by an edit
// carrying the version shown; a stale version or a second first save is
// refused. Times are compared with the database's own timestamps (its clock
// can step back under load). Lengths are characters, as the app counts them.
import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/cycles/rules";
import { checkInDay, type ValidCheckIn, validateCheckIn } from "@/lib/progress/rules";
import { countCheckIns, listCheckIns, saveCheckIn } from "@/lib/progress/service";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { d, NOON } from "../support/noon";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const people = {
  alex: { email: uniqueEmail("s15-alex"), name: "Alex Progress", role: "researcher" },
  blair: { email: uniqueEmail("s15-blair"), name: "Blair Other", role: "researcher" },
  cara: { email: uniqueEmail("s15-cara"), name: "Cara Concurrent", role: "researcher" },
  dev: { email: uniqueEmail("s15-dev"), name: "Dev Zones", role: "researcher" },
  eve: { email: uniqueEmail("s15-eve"), name: "Eve No Cycle", role: "researcher" },
  una: { email: uniqueEmail("s15-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("s15-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("s15-noah"), name: "Noah Not Granted", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
let peptideA = "";
/** Today in Toronto, as the server will judge it (see beforeAll). */
let today = "";

const cycleIn = (who: Name, timeZone = NOON) =>
  createCycle(db[who], { timeZone, plans: [plan(peptideA, [interval(d(-4), d(20), "0.4", 2, "08:00")])] });

const checkIn = (overrides: Partial<ValidCheckIn> = {}): ValidCheckIn => ({
  day: today,
  version: null,
  feeling: 4,
  effects: ["Mild headache"],
  note: "Slept better.",
  measurement: null,
  ...overrides,
});

/** save_check_in's raw arguments (to try what the app never sends). */
const rawArgs = (overrides: Record<string, unknown> = {}) => ({
  p_day: today,
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
      .select("id, day, feeling, effects, note, measurement_name, measurement_value::text, measurement_unit, measured_at, version, created_at, updated_at")
      .eq("owner_id", ownerId)
      .order("day"),
    "check-in rows",
  );

beforeAll(async () => {
  // Not within a minute of Toronto's midnight, so the day stays put for the run.
  while (checkInDay(new Date()) !== checkInDay(new Date(Date.now() + 60_000))) await new Promise((r) => setTimeout(r, 5_000));
  today = checkInDay(new Date());
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  peptideA = await createPeptide(db.grace, `Progress A ${tag()}`);
}, 120_000);

describe("check-ins are the owner's; a grant reads, never writes", () => {
  it("isolates everyone else, lets a granted admin read only, and denies again on revoke", async () => {
    await cycleIn("alex");
    const saved = await saveCheckIn(db.alex, checkIn());
    expect(saved).toMatchObject({ kind: "saved", day: today, version: 1 });
    await ok(db.alex.rpc("grant_support_access", { p_admin_id: id.grace }), "grant grace");

    // The owner reads it, and writes only through save_check_in.
    const [mine] = await listCheckIns(db.alex, id.alex);
    expect(mine).toMatchObject({ day: today, feeling: 4, effects: ["Mild headache"], note: "Slept better.", measurement: null, version: 1 });
    expect(await countCheckIns(db.alex, id.alex)).toBe(1);
    const table = "progress_check_ins";
    expect(await sqlState(db.alex.from(table).update({ feeling: 1 } as never).eq("owner_id", id.alex), "owner updates")).toBe("42501");
    expect(await sqlState(db.alex.from(table).delete().eq("owner_id", id.alex), "owner deletes")).toBe("42501");
    expect(await sqlState(db.alex.from(table).insert({ owner_id: id.alex, day: addDays(today, -1), feeling: 3 } as never), "owner inserts")).toBe("42501");
    // Not even the service role writes it directly.
    expect(await sqlState(serviceClient().from(table).delete().eq("owner_id", id.alex), "service deletes")).toBe("42501");

    // The granted admin reads Alex's check-ins ...
    expect(await listCheckIns(db.grace, id.alex)).toEqual([mine]);
    expect(await countCheckIns(db.grace, id.alex)).toBe(1);
    // ... and changes none of them: her save is her own check-in, and the table refuses her.
    expect(await saveCheckIn(db.grace, checkIn({ feeling: 1 }))).toMatchObject({ kind: "saved", version: 1 });
    expect(await sqlState(db.grace.from(table).update({ feeling: 1 } as never).eq("owner_id", id.alex), "grace updates")).toBe("42501");
    expect(await sqlState(db.grace.from(table).delete().eq("owner_id", id.alex), "grace deletes")).toBe("42501");
    expect((await rowsOf(id.grace)).map((r) => r.feeling)).toEqual([1]);

    // Another researcher and a non-granted admin: nothing.
    for (const who of ["blair", "noah"] as const) {
      expect(await listCheckIns(db[who], id.alex), who).toEqual([]);
      expect(await countCheckIns(db[who], id.alex), who).toBe(0);
    }

    // Unacknowledged: reads nothing of Alex's, writes nothing at all.
    expect(await listCheckIns(db.una, id.alex)).toEqual([]);
    expect(await sqlState(db.una.rpc("save_check_in", rawArgs()), "una saves")).toBe("42501");
    expect(await rowsOf(id.una)).toEqual([]);

    // Anonymous: no rows and no function.
    const anon = anonClient();
    const { data } = await anon.from(table).select("id").eq("owner_id", id.alex);
    expect(data ?? []).toEqual([]);
    expect(await sqlState(anon.rpc("save_check_in", rawArgs()), "anon saves")).not.toBe("ok");

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
    const first = await saveCheckIn(db.blair, checkIn({ measurement: { name: "Weight", value: "82.40", unit: "kg" } }));
    if (first.kind !== "saved") throw new Error(first.kind);
    const [row1] = await rowsOf(id.blair);
    // Exact numeric, stored without trailing zeros; measured when saved (the database's clock).
    expect(row1).toMatchObject({ id: first.id, day: today, feeling: 4, measurement_name: "Weight", measurement_value: "82.4", measurement_unit: "kg", version: 1 });
    expect(Date.parse(row1.measured_at!)).toBe(Date.parse(first.savedAt));
    expect(Date.parse(row1.updated_at)).toBe(Date.parse(first.savedAt));

    // Another device's first save for the same day: refused, nothing changes.
    expect(await saveCheckIn(db.blair, checkIn({ feeling: 1 }))).toEqual({ kind: "changed" });
    expect(await rowsOf(id.blair)).toEqual([row1]);

    // An edit from version 1 replaces it in place; the unchanged measurement keeps its time.
    const edit = await saveCheckIn(
      db.blair,
      checkIn({ version: 1, feeling: 2, effects: ["None noticed"], note: "", measurement: { name: "Weight", value: "82.4", unit: "kg" } }),
    );
    expect(edit).toMatchObject({ kind: "saved", id: first.id, day: today, version: 2 });
    const [row2] = await rowsOf(id.blair);
    expect(row2).toMatchObject({ id: first.id, feeling: 2, effects: ["None noticed"], note: "", version: 2, measured_at: row1.measured_at });
    expect(Date.parse(row2.updated_at)).toBeGreaterThanOrEqual(Date.parse(row2.created_at));

    // A stale screen (still on version 1) saves nothing.
    expect(await saveCheckIn(db.blair, checkIn({ version: 1, feeling: 5 }))).toEqual({ kind: "changed" });
    expect(await rowsOf(id.blair)).toEqual([row2]);

    // A changed measurement is measured again; clearing it removes it.
    const edit3 = await saveCheckIn(db.blair, checkIn({ version: 2, measurement: { name: "Sleep", value: "6.5", unit: "h" } }));
    if (edit3.kind !== "saved") throw new Error(edit3.kind);
    const [row3] = await rowsOf(id.blair);
    expect(row3).toMatchObject({ measurement_name: "Sleep", measurement_value: "6.5", measurement_unit: "h", version: 3 });
    expect(Date.parse(row3.measured_at!)).toBe(Date.parse(edit3.savedAt));
    expect(await saveCheckIn(db.blair, checkIn({ version: 3, measurement: null }))).toMatchObject({ kind: "saved", version: 4 });
    expect((await rowsOf(id.blair))[0]).toMatchObject({ measurement_name: null, measurement_value: null, measurement_unit: null, measured_at: null, version: 4 });
  });

  it("lets exactly one of concurrent saves from the same version through", async () => {
    const firsts = await Promise.all([1, 2, 3].map((feeling) => saveCheckIn(db.cara, checkIn({ feeling }))));
    expect(firsts.filter((r) => r.kind === "saved")).toHaveLength(1);
    expect(firsts.filter((r) => r.kind === "changed")).toHaveLength(2);
    const edits = await Promise.all([4, 5].map((feeling) => saveCheckIn(db.cara, checkIn({ version: 1, feeling }))));
    expect(edits.map((r) => r.kind).sort()).toEqual(["changed", "saved"]);
    const rows = await rowsOf(id.cara);
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(2);
    expect([4, 5]).toContain(rows[0].feeling);
  });
});

describe("the day is today in Toronto, by the server's clock, whatever the cycles' zones", () => {
  it("keeps one row per Toronto day for a researcher with cycles in far-apart zones", async () => {
    // Cycles where the local date is today, yesterday or tomorrow relative to Toronto's (Kiritimati is UTC+14, Pago Pago UTC-11).
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Tokyo", NOON]) await cycleIn("dev", zone);
    const other = new Set([checkInDay(new Date(), "Pacific/Kiritimati"), checkInDay(new Date(), "Pacific/Pago_Pago"), d(0)]);
    other.delete(today);
    // Another zone's date (a day either side of Toronto's), or any day but today: refused.
    for (const day of [...other, addDays(today, -1), addDays(today, 1), addDays(today, -5)]) {
      expect(await saveCheckIn(db.dev, checkIn({ day })), day).toEqual({ kind: "new_day" });
    }
    const saved = await saveCheckIn(db.dev, checkIn({ feeling: 2 }));
    if (saved.kind !== "saved") throw new Error(saved.kind);
    // The day is the Toronto date of the server's own save time.
    expect(saved.day).toBe(checkInDay(saved.savedAt));
    // A second first save that day is refused, whichever cycle's screen it comes from.
    expect(await saveCheckIn(db.dev, checkIn({ feeling: 5 }))).toEqual({ kind: "changed" });
    const rows = await rowsOf(id.dev);
    expect(rows.map((r) => [r.day, r.feeling])).toEqual([[today, 2]]);
    // Reading a range of days.
    expect((await listCheckIns(db.dev, id.dev, { from: today })).map((c) => c.day)).toEqual([today]);
    expect(await listCheckIns(db.dev, id.dev, { to: addDays(today, -1) })).toEqual([]);
  });

  it("needs no cycle", async () => {
    expect(await saveCheckIn(db.eve, checkIn({ feeling: 3, note: "Between cycles." }))).toMatchObject({ kind: "saved", day: today, version: 1 });
    expect((await listCheckIns(db.eve, id.eve)).map((c) => [c.day, c.note])).toEqual([[today, "Between cycles."]]);
  });

  it("re-checks every input in the database, counting characters as the app does", async () => {
    const measured = (value: unknown, overrides: Record<string, unknown> = {}) =>
      rawArgs({ p_measurement_name: "Weight", p_measurement_value: value, p_measurement_unit: "kg", ...overrides });
    const grin = "\u{1F600}";
    const clef = "\u{1D11E}";
    for (const [label, args] of [
      ["feeling 0", rawArgs({ p_feeling: 0 })],
      ["feeling 6", rawArgs({ p_feeling: 6 })],
      ["unknown chip", rawArgs({ p_effects: ["Dizzy"] })],
      ["repeated chip", rawArgs({ p_effects: ["Nausea", "Nausea"] })],
      ["none noticed and more", rawArgs({ p_effects: ["None noticed", "Nausea"] })],
      ["long note", rawArgs({ p_note: "x".repeat(1001) })],
      ["1,001 emoji", rawArgs({ p_note: grin.repeat(1001) })],
      ["negative value", measured("-1")],
      ["huge value", measured("1000000")],
      ["too precise", measured("0.1234567")],
      ["unknown measurement", measured("5", { p_measurement_name: "Mood" })],
      ["no unit", measured("5", { p_measurement_unit: "  " })],
      ["long unit", measured("5", { p_measurement_unit: "x".repeat(21) })],
      ["21 astral characters", measured("5", { p_measurement_unit: clef.repeat(21) })],
    ] as const) {
      // The app refuses the same input first.
      const raw = args as Record<string, unknown>;
      const asForm = {
        day: today,
        version: null,
        feeling: raw.p_feeling,
        effects: raw.p_effects,
        note: raw.p_note,
        measurementName: raw.p_measurement_name ?? "Weight",
        measurementValue: raw.p_measurement_value ?? "",
        measurementUnit: raw.p_measurement_unit ?? "",
      };
      expect(validateCheckIn(asForm).ok, `app: ${label}`).toBe(false);
      expect(await sqlState(db.dev.rpc("save_check_in", args as never), label), label).toBe("22023");
    }
    // The limits in characters: what the app accepts, the database stores unchanged.
    const valid = validateCheckIn({
      day: today,
      version: 1,
      feeling: 4,
      effects: [],
      note: `  ${grin.repeat(1000)}  `,
      measurementName: "Other",
      measurementValue: "1",
      measurementUnit: clef.repeat(20),
    });
    if (!valid.ok) throw new Error(valid.error);
    expect(await saveCheckIn(db.dev, valid.value)).toMatchObject({ kind: "saved", version: 2 });
    const [row] = await rowsOf(id.dev);
    expect([row.note, row.measurement_unit]).toEqual([grin.repeat(1000), clef.repeat(20)]);
  });
});
