// S16 supplements, as the database owner (psql). Routines are only created
// today through the API, so older ones are written here directly
// (committed: the researchers are unique to this run):
//   * a routine running for three years with 1,100 Taken records proves the
//     reads are complete past the API's 1,000-row cap, a page at a time
//     (keyset by id), for the owner and a granted admin;
//   * a routine started yesterday, missed, then edited today proves an edit
//     applies from today: yesterday is no longer recordable, and today uses
//     the new values, for Taken and for S13's due list;
//   * 1,050 routines due on one day prove S13's due list is read completely
//     by cursor, a Taken recorded between pages dropping only that
//     occurrence.
// The tables' own checks, and the database's occurrences against the app's
// across America/Toronto's daylight-saving changes, are tried in
// transactions that are rolled back. Runs in the integration-exclusive
// project.
import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/cycles/rules";
import { checkInDay } from "@/lib/progress/rules";
import { occurrenceOn, supplementKey } from "@/lib/supplements/schedule";
import { type DueSupplement, listDueSupplements, listRoutines, listTaken, saveRoutine } from "@/lib/supplements/service";
import { supplementsView } from "@/lib/supplements/view";
import type { Client } from "../support/cycles";
import { ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import { micros, psql, quote, sqlMicros } from "../support/psql";

/** The instant of a Toronto wall-clock time, as the app computes it. */
const at = (date: string, time: string) => occurrenceOn({ id: "x", time, timeZone: TORONTO, definitionFrom: date, endDate: null }, date)!.scheduledAt;

const people = {
  alex: { email: uniqueEmail("s16o-alex"), name: "Alex Years", role: "researcher" },
  grace: { email: uniqueEmail("s16o-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("s16o-noah"), name: "Noah Not Granted", role: "admin" },
  mia: { email: uniqueEmail("s16o-mia"), name: "Mia Missed Monday", role: "researcher" },
  pat: { email: uniqueEmail("s16o-pat"), name: "Pat Many", role: "researcher" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const TAKEN = 1100;
const TORONTO = "America/Toronto";
let today = "";
let routineId = "";

beforeAll(async () => {
  while (checkInDay(new Date()) !== checkInDay(new Date(Date.now() + 60_000))) await new Promise((r) => setTimeout(r, 5_000));
  today = checkInDay(new Date());
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  await ok(db.alex.rpc("set_supplement_tracking", { p_enabled: true }), "tracking on");
  await ok(db.alex.rpc("grant_support_access", { p_admin_id: id.grace }), "grant grace");
  const start = addDays(today, -TAKEN);
  routineId = psql(`insert into public.supplement_routines (owner_id, name, amount, unit, time_of_day, start_date, definition_from)
    values (${quote(id.alex)}, 'Vitamin D3', 2000, 'IU', '08:00', ${quote(start)}, ${quote(start)}) returning 'id', id;`).id;
  // Every day from the start to yesterday, taken at 08:05 local.
  psql(`insert into public.supplement_taken
      (owner_id, routine_id, occurrence_key, local_date, scheduled_at, name, amount, unit, actual_at, recorded_at, request_key)
    select ${quote(id.alex)}, ${quote(routineId)}, ${quote(routineId)} || ':' || to_char(g::date, 'YYYY-MM-DD'), g::date,
           public.cycle_local_instant(g::date, '08:00', '${TORONTO}'), 'Vitamin D3', 2000, 'IU',
           public.cycle_local_instant(g::date, '08:05', '${TORONTO}'), public.cycle_local_instant(g::date, '08:06', '${TORONTO}'),
           gen_random_uuid()
    from generate_series(${quote(start)}::date, ${quote(addDays(today, -1))}::date, interval '1 day') g;`);
}, 120_000);

describe("reads are complete past the API's row cap", () => {
  it("reads all 1,100 Taken records for the owner and a granted admin, and none for anyone else", async () => {
    const mine = await listTaken(db.alex, id.alex);
    expect(mine).toHaveLength(TAKEN);
    expect(new Set(mine.map((t) => t.id)).size).toBe(TAKEN);
    // Oldest first, each the app's occurrence for its day.
    expect(mine[0].localDate).toBe(addDays(today, -TAKEN));
    expect(mine.at(-1)!.localDate).toBe(addDays(today, -1));
    const routine = { id: routineId, time: "08:00", timeZone: TORONTO, definitionFrom: addDays(today, -TAKEN), endDate: null };
    for (const t of [mine[0], mine[500], mine.at(-1)!]) {
      expect(t.occurrenceKey).toBe(supplementKey(routineId, t.localDate));
      expect(micros(t.scheduledAt)).toBe(micros(occurrenceOn(routine, t.localDate)!.scheduledAt));
    }
    expect((await listTaken(db.grace, id.alex, {}, 250)).map((t) => t.id)).toEqual(mine.map((t) => t.id));
    expect((await listTaken(db.alex, id.alex, { from: addDays(today, -3) }, 2)).map((t) => t.localDate)).toEqual([-3, -2, -1].map((n) => addDays(today, n)));
    expect(await listTaken(db.noah, id.alex, {}, 250)).toEqual([]);

    // R10 counts the last two weeks and lists the whole history.
    const [card] = supplementsView({ tracking: true, routines: await listRoutines(db.alex, id.alex, 1), taken: mine, guidance: [], now: new Date() }).routines;
    expect(card.recent).toBe("13 recorded in the last 2 weeks");
    expect(card.history).toHaveLength(TAKEN);
  });
});

/** Runs `sql` in a transaction that is rolled back; returns its label/value rows. */
const rolledBack = (sql: string) => psql(`begin;\n${sql}\nrollback;`);

/** 'ok' or the SQLSTATE of one statement, tried in a savepoint. */
const attempt = (label: string, statement: string) => `
do $$ begin
  begin
    ${statement};
    insert into pg_temp.results values ('${label}', 'ok');
  exception when others then
    insert into pg_temp.results values ('${label}', sqlstate);
  end;
end $$;`;

describe("the tables' own checks", () => {
  it("refuse what the functions never write", () => {
    const routine = (overrides: Record<string, string>) => {
      const values = {
        name: "'X'",
        amount: "1",
        unit: "'mg'",
        time_of_day: "'08:00'",
        time_zone: `'${TORONTO}'`,
        start_date: `'${today}'`,
        definition_from: `'${today}'`,
        end_date: "null",
        ...overrides,
      };
      return `insert into public.supplement_routines (owner_id, name, amount, unit, time_of_day, time_zone, start_date, definition_from, end_date)
        values (${quote(id.alex)}, ${values.name}, ${values.amount}, ${values.unit}, ${values.time_of_day}, ${values.time_zone},
                ${values.start_date}, ${values.definition_from}, ${values.end_date})`;
    };
    const taken = (overrides: Record<string, string>) => {
      const values = {
        key: quote(`${routineId}:${today}`),
        local_date: `'${today}'`,
        amount: "2000",
        actual: "now()",
        recorded: "now()",
        ...overrides,
      };
      return `insert into public.supplement_taken
          (owner_id, routine_id, occurrence_key, local_date, scheduled_at, name, amount, unit, actual_at, recorded_at, request_key)
        values (${quote(id.alex)}, ${quote(routineId)}, ${values.key}, ${values.local_date}, now(), 'Vitamin D3', ${values.amount}, 'IU',
                ${values.actual}, ${values.recorded}, gen_random_uuid())`;
    };
    const cases: Record<string, string> = {
      routine_ok: routine({}),
      trailing_zeros: routine({ amount: "2.50" }),
      zero: routine({ amount: "0" }),
      too_large: routine({ amount: "1000000" }),
      too_precise: routine({ amount: "0.0000001" }),
      untrimmed: routine({ name: "' X'" }),
      long_unit: routine({ unit: `'${"u".repeat(21)}'` }),
      bad_time: routine({ time_of_day: "'24:00'" }),
      other_zone: routine({ time_zone: "'UTC'" }),
      end_before_start: routine({ end_date: `'${addDays(today, -1)}'` }),
      definition_before_start: routine({ definition_from: `'${addDays(today, -1)}'` }),
      end_before_definition: routine({ start_date: `'${addDays(today, -2)}'`, end_date: `'${addDays(today, -1)}'` }),
      taken_ok: taken({}),
      key_mismatch: taken({ key: quote(`${routineId}:${addDays(today, -1)}`) }),
      recorded_before_actual: taken({ actual: "now()", recorded: "now() - interval '1 minute'" }),
      duplicate_day: taken({ key: quote(`${routineId}:${addDays(today, -1)}`), local_date: `'${addDays(today, -1)}'` }),
    };
    const results = rolledBack(`create temp table results (label text, state text) on commit drop;
      ${Object.entries(cases)
        .map(([label, statement]) => attempt(label, statement))
        .join("\n")}
      select label, state from pg_temp.results;`);
    expect(results).toEqual({
      routine_ok: "ok",
      trailing_zeros: "23514",
      zero: "23514",
      too_large: "23514",
      too_precise: "23514",
      untrimmed: "23514",
      long_unit: "23514",
      bad_time: "23514",
      other_zone: "23514",
      end_before_start: "23514",
      definition_before_start: "23514",
      end_before_definition: "23514",
      taken_ok: "ok",
      key_mismatch: "23514",
      recorded_before_actual: "23514",
      duplicate_day: "23505",
    });
  });
});

describe("the database's occurrences match the app's", () => {
  it("keeps the wall-clock time across Toronto's daylight-saving changes (S13's due list)", () => {
    // Routines at a gap time and a repeated time, running from before the changes.
    const cases = [
      { time: "02:30", dates: ["2026-03-07", "2026-03-08", "2026-03-09", "2027-03-14"] },
      { time: "01:30", dates: ["2026-10-31", "2026-11-01", "2026-11-02"] },
      { time: "08:00", dates: ["2026-03-08", "2026-11-01"] },
    ];
    const sql = cases
      .map(({ time }) => `insert into public.supplement_routines (id, owner_id, name, amount, unit, time_of_day, start_date, definition_from)
          values (gen_random_uuid(), ${quote(id.alex)}, ${quote(`At ${time}`)}, 1, 'mg', '${time}', '2026-01-01', '2026-01-01');`)
      .join("\n");
    const rows = rolledBack(`${sql}
      select r.time_of_day || ' ' || o.local_date, ${sqlMicros("o.scheduled_at")}
      from (values ${cases.flatMap((c) => c.dates.map((date) => `('${date}')`)).join(", ")}) as v(d)
      cross join public.supplement_routines r
      cross join lateral public.due_supplement_occurrences(
        public.cycle_local_instant(d::date, '00:00', '${TORONTO}'),
        public.cycle_local_instant(d::date + 1, '00:00', '${TORONTO}')) o
      where r.owner_id = ${quote(id.alex)} and r.start_date = '2026-01-01' and o.routine_id = r.id;`);
    for (const { time, dates } of cases) {
      for (const date of dates) {
        const app = occurrenceOn({ id: "x", time, timeZone: TORONTO, definitionFrom: "2026-01-01", endDate: null }, date)!;
        expect(rows[`${time} ${date}`], `${time} ${date}`).toBe(micros(app.scheduledAt));
      }
    }
  });
});

describe("an edit applies from today", () => {
  it("leaves a day missed before the edit unrecordable, and today uses the new values", async () => {
    await ok(db.mia.rpc("set_supplement_tracking", { p_enabled: true }), "mia tracking on");
    const yesterday = addDays(today, -1);
    // Started yesterday ("Monday") at 08:00 with 2000 IU; yesterday was missed.
    const mondayId = psql(`insert into public.supplement_routines (owner_id, name, amount, unit, time_of_day, start_date, definition_from)
      values (${quote(id.mia)}, 'Vitamin D3', 2000, 'IU', '08:00', ${quote(yesterday)}, ${quote(yesterday)}) returning 'id', id;`).id;
    const take = (date: string, seen: { name: string; time: string; amount: string; unit: string }) =>
      sqlState(
        db.mia.rpc("take_supplement", {
          p_request_key: crypto.randomUUID(),
          p_occurrence_key: `${mondayId}:${date}`,
          p_seen_scheduled_at: at(date, seen.time),
          p_seen_name: seen.name,
          p_seen_amount: seen.amount,
          p_seen_unit: seen.unit,
        }),
        `take ${date}`,
      );
    const old = { name: "Vitamin D3", time: "08:00", amount: "2000", unit: "IU" };
    const edited = { name: "Magnesium", time: "09:00", amount: "2", unit: "capsules" };
    const dueOn = async (date: string) =>
      (await listDueSupplements(serviceClient(), at(date, "00:00"), at(addDays(date, 1), "00:00"))).filter((o) => o.routineId === mondayId);

    // Before the edit, yesterday is still its occurrence (S13 would remind about it).
    expect((await dueOn(yesterday)).map((o) => [o.occurrenceKey, micros(o.scheduledAt)])).toEqual([
      [`${mondayId}:${yesterday}`, micros(at(yesterday, "08:00"))],
    ]);

    // "Tuesday": edited to 09:00, 2 capsules of magnesium.
    expect(await saveRoutine(db.mia, { id: mondayId, version: 1, ...edited })).toMatchObject({ kind: "saved", version: 2 });
    const row = await ok(serviceClient().from("supplement_routines").select("start_date, definition_from").eq("id", mondayId).single(), "row");
    expect(row).toEqual({ start_date: yesterday, definition_from: today });

    // Yesterday is no longer recordable, with the old values or the new ones.
    expect(await take(yesterday, old)).toBe("AP017");
    expect(await take(yesterday, edited)).toBe("AP017");
    expect(await dueOn(yesterday)).toEqual([]);
    // Today uses the new values: the old ones are refused as changed, the new ones recorded.
    expect(await take(today, old)).toBe("AP020");
    const [due] = await dueOn(today);
    expect(due).toMatchObject({ occurrenceKey: `${mondayId}:${today}`, name: "Magnesium", amount: "2", unit: "capsules", scheduleVersion: 2 });
    expect(micros(due.scheduledAt)).toBe(micros(at(today, "09:00")));
    expect(await take(today, edited)).toBe("ok");
    const taken = await listTaken(db.mia, id.mia);
    expect(taken.map((t) => [t.localDate, t.name, t.amount, t.unit])).toEqual([[today, "Magnesium", "2", "capsules"]]);
    expect(micros(taken[0].scheduledAt)).toBe(micros(at(today, "09:00")));
  });
});

describe("S13's due list is read completely by cursor", () => {
  it("pages 1,050 due occurrences without skipping or repeating one, while a Taken lands between pages", async () => {
    const ROUTINES = 1050;
    await ok(db.pat.rpc("set_supplement_tracking", { p_enabled: true }), "pat tracking on");
    // Two days ahead, at 00:05 onwards; routines share times in pairs (the cursor's tie-break is the routine id).
    const day = addDays(today, 2);
    psql(`insert into public.supplement_routines (owner_id, name, amount, unit, time_of_day, start_date, definition_from)
      select ${quote(id.pat)}, 'Routine ' || i, 1, 'mg', to_char(time '00:05' + ((i % 700) * interval '1 minute'), 'HH24:MI'), ${quote(today)}, ${quote(today)}
      from generate_series(1, ${ROUTINES}) i;`);
    const from = at(day, "00:00");
    const to = at(addDays(day, 1), "00:00");
    const service = serviceClient();
    const mine = (rows: DueSupplement[]) => rows.filter((o) => o.ownerId === id.pat);
    const order = (a: DueSupplement, b: DueSupplement) =>
      Number(BigInt(micros(a.scheduledAt)) - BigInt(micros(b.scheduledAt))) || (a.routineId < b.routineId ? -1 : a.routineId > b.routineId ? 1 : 0);

    // All of them, over the API's 1,000-row cap, in cursor order.
    const everything = await listDueSupplements(service, from, to);
    const all = mine(everything);
    expect(all).toHaveLength(ROUTINES);
    expect(everything.length).toBeGreaterThan(1000);
    expect([...everything].sort(order)).toEqual(everything);

    // Read again 400 at a time; after the first page, record a Taken for one
    // already read (pat's first) and one not yet read (pat's last).
    const [first, last] = [all[0], all[all.length - 1]];
    const record = (o: DueSupplement) => `insert into public.supplement_taken
        (owner_id, routine_id, occurrence_key, local_date, scheduled_at, name, amount, unit, actual_at, recorded_at, request_key)
      values (${quote(id.pat)}, ${quote(o.routineId)}, ${quote(o.occurrenceKey)}, ${quote(o.localDate)}, ${quote(o.scheduledAt)},
              ${quote(o.name)}, ${o.amount}, ${quote(o.unit)}, now(), now(), gen_random_uuid());`;
    let pages = 0;
    const paged = await listDueSupplements(service, from, to, {
      pageSize: 400,
      afterPage: (page) => {
        pages = page;
        if (page === 1) psql(record(first) + record(last));
      },
    });
    // At least three pages: the hook ran after each full one.
    expect(pages).toBeGreaterThanOrEqual(2);
    const read = mine(paged);
    // Nothing repeated; the first (read before its Taken) is there; only the last is dropped.
    expect(new Set(read.map((o) => o.occurrenceKey)).size).toBe(read.length);
    expect(read.map((o) => o.occurrenceKey)).toEqual(all.slice(0, -1).map((o) => o.occurrenceKey));
    // Afterwards, both are gone from the list.
    expect(mine(await listDueSupplements(service, from, to)).map((o) => o.occurrenceKey)).toEqual(all.slice(1, -1).map((o) => o.occurrenceKey));

    // Keep later runs' due lists small.
    await ok(db.pat.rpc("set_supplement_tracking", { p_enabled: false }), "pat tracking off");
  });
});
