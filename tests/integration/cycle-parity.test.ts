// save_cycle()'s own schedule arithmetic matches the S7 engine's: the
// planned instants and occurrence keys cycle_phase_instants() gives for a phase (no
// confirmations) equal scheduleOccurrences(), across fixed weekdays and
// every N days, time changes, daylight-saving gaps and repeats (including
// 30-minute Lord Howe and midnight changes), and cycle_local_instant(E,
// 00:00) is the seam the app uses (seamOf). Runs read-only SQL as the
// database owner with psql, since both functions are internal.
import { execFileSync } from "node:child_process";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { seamOf } from "@/lib/cycles/schedule";
import { type ActivePhase, scheduleOccurrences, type Weekday } from "@/lib/schedule/engine";
import { localSupabase } from "../support/local-supabase";

/** Runs read-only SQL with psql as the database owner; `label\tvalue` rows come back as a map. */
function psql(sql: string): Record<string, string> {
  let out: string;
  try {
    out = execFileSync("psql", [localSupabase().dbUrl, "-X", "-q", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1"], {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const e = error as { code?: string; stderr?: string };
    if (e.code === "ENOENT") throw new Error("psql is required for this test (PostgreSQL client tools).");
    throw new Error(`psql failed: ${e.stderr ?? String(error)}`);
  }
  return Object.fromEntries(out.split("\n").filter(Boolean).map((line) => line.split("\t") as [string, string]));
}

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONES = ["America/New_York", "Europe/Lisbon", "Australia/Lord_Howe", "America/Santiago", "America/Havana", "Asia/Tokyo", "Asia/Kolkata", "UTC"];
// Around US, EU, Lord Howe, Chile and Cuba daylight-saving changes in 2026.
const STARTS = ["2026-03-04", "2026-03-25", "2026-04-01", "2026-09-02", "2026-09-30", "2026-10-21", "2026-10-29", "2026-03-06"];
const TIMES = ["00:00", "00:30", "01:30", "01:45", "02:15", "02:30", "08:00", "23:30"];

describe("the database's planned instants match the engine's", () => {
  it("for random phases with time changes, across daylight-saving changes", () => {
    const random = mulberry32(926);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const cases: { label: string; zone: string; phase: ActivePhase }[] = [];
    for (let n = 0; n < 60; n++) {
      const start = Temporal.PlainDate.from(pick(STARTS)).add({ days: int(0, 5) });
      const end = start.add({ days: int(3, 30) });
      const changes = Array.from({ length: int(0, 3) }, () => start.add({ days: int(1, end.since(start).days) }).toString());
      const froms = [...new Set(changes)].sort();
      const weekly = random() < 0.4;
      cases.push({
        label: `p${n}`,
        zone: pick(ZONES),
        phase: {
          id: "p",
          kind: "active",
          start: start.toString(),
          end: end.toString(),
          doseMg: "1",
          time: pick(TIMES),
          schedule: weekly ? { type: "weekdays", days: [...new Set([int(0, 6), int(0, 6)])].sort() as Weekday[] } : { type: "interval", everyDays: int(1, 4) },
          ...(froms.length ? { timeChanges: froms.map((from) => ({ from, time: pick(TIMES) })) } : {}),
        },
      });
    }
    const sql = cases
      .map(({ label, zone, phase }) => {
        const row = {
          kind: "active",
          start_date: phase.start,
          end_date: phase.end,
          dose_mg: 1,
          local_time: phase.time,
          schedule_type: phase.schedule.type,
          every_days: phase.schedule.type === "interval" ? phase.schedule.everyDays : null,
          weekdays: phase.schedule.type === "weekdays" ? phase.schedule.days : null,
          dose_change_from: [],
          dose_change_mg: [],
          time_change_from: (phase.timeChanges ?? []).map((c) => c.from),
          time_change_time: (phase.timeChanges ?? []).map((c) => c.time),
        };
        return `select ${quote(label)}, coalesce(string_agg(i.key || '@' || to_char(i.planned_at at time zone 'UTC', ${UTC}), ',' order by i.planned_at), '')
          from public.cycle_phase_instants(jsonb_populate_record(null::public.cycle_revision_phases, ${quote(JSON.stringify(row))}::jsonb),
               ${quote(zone)}, ${quote(phase.start)}, ${quote(phase.end)}) i;`;
      })
      .join("\n");
    const database = psql(sql);
    for (const { label, zone, phase } of cases) {
      const engine = scheduleOccurrences({ planId: "plan", timeZone: zone, phases: [phase] }).map((o) => `${o.key.split(":")[2]}@${o.scheduledAt}`);
      expect(database[label]?.split(",").filter(Boolean), `${label} ${zone} ${JSON.stringify(phase)}`).toEqual(engine);
    }
  });

  it("for the seam: the start of the effective date in the zone, midnight changes included", () => {
    const seams: [string, string][] = [
      ["America/Santiago", "2026-09-06"], // 24:00 -> 01:00: the day starts at 01:00.
      ["America/Santiago", "2026-04-05"],
      ["America/Havana", "2026-03-08"], // 00:00 -> 01:00.
      ["America/Havana", "2026-11-01"], // 01:00 -> 00:00: midnight repeats.
      ["Australia/Lord_Howe", "2026-10-04"],
      ["America/Los_Angeles", "2026-09-16"],
      ["Asia/Tokyo", "2026-09-16"],
    ];
    const database = psql(
      seams
        .map(([zone, date], n) => `select 's${n}', to_char(public.cycle_local_instant(${quote(date)}, '00:00', ${quote(zone)}) at time zone 'UTC', ${UTC});`)
        .join("\n"),
    );
    seams.forEach(([zone, date], n) => expect(database[`s${n}`], `${zone} ${date}`).toBe(seamOf(date, zone).toString()));
  });

  it("for a repeat or gap of any length: the earlier instant of a repeated time, a gap moved forward (Antarctica/Troll's two hours)", () => {
    // Troll: 01:00-03:00 is skipped on 2026-03-29 and repeated on 2026-10-25 (UTC+0 <-> UTC+2).
    const days: [string, string][] = [
      ["Antarctica/Troll", "2026-10-25"],
      ["Antarctica/Troll", "2026-03-29"],
      ["America/New_York", "2026-11-01"],
      ["America/New_York", "2026-03-08"],
      ["Australia/Lord_Howe", "2026-04-05"], // 30 minutes repeated.
      ["Australia/Lord_Howe", "2026-10-04"], // 30 minutes skipped.
      ["America/Havana", "2026-11-01"],
      ["Europe/Lisbon", "2026-10-25"],
    ];
    const times = Array.from({ length: 20 }, (_, n) => `${String(Math.floor(n / 4)).padStart(2, "0")}:${String((n % 4) * 15).padStart(2, "0")}`);
    const cases = days.flatMap(([zone, date]) => times.map((time) => ({ zone, date, time })));
    const database = psql(
      cases
        .map(
          ({ zone, date, time }, n) =>
            `select 'l${n}', to_char(public.cycle_local_instant(${quote(date)}, ${quote(time)}, ${quote(zone)}) at time zone 'UTC', ${UTC});
             select 'w${n}', to_char(public.cycle_wall_instant(${quote(`${date} ${time}`)}::timestamp, ${quote(zone)}) at time zone 'UTC', ${UTC});`,
        )
        .join("\n"),
    );
    cases.forEach(({ zone, date, time }, n) => {
      // Temporal's default ("compatible") disambiguation: the engine's rule (src/lib/schedule/zone.ts).
      const engine = Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone).toInstant().toString();
      expect(database[`l${n}`], `local ${zone} ${date} ${time}`).toBe(engine);
      expect(database[`w${n}`], `wall ${zone} ${date} ${time}`).toBe(engine);
    });
    expect(Temporal.PlainDateTime.from("2026-10-25T01:30").toZonedDateTime("Antarctica/Troll").toInstant().toString()).toBe("2026-10-24T23:30:00Z");

    // And a Troll phase's planned instants, daily at 01:30 and 02:30 across both changes.
    for (const [start, end] of [
      ["2026-10-23", "2026-10-27"],
      ["2026-03-27", "2026-03-31"],
    ]) {
      for (const time of ["01:30", "02:30"]) {
        const row = {
          kind: "active",
          start_date: start,
          end_date: end,
          dose_mg: 1,
          local_time: time,
          schedule_type: "interval",
          every_days: 1,
          weekdays: null,
          dose_change_from: [],
          dose_change_mg: [],
          time_change_from: [],
          time_change_time: [],
        };
        const got = psql(
          `select 'troll', string_agg(i.key || '@' || to_char(i.planned_at at time zone 'UTC', ${UTC}), ',' order by i.planned_at)
           from public.cycle_phase_instants(jsonb_populate_record(null::public.cycle_revision_phases, ${quote(JSON.stringify(row))}::jsonb),
                'Antarctica/Troll', ${quote(start)}, ${quote(end)}) i;`,
        );
        const phase: ActivePhase = { id: "p", kind: "active", start, end, doseMg: "1", time, schedule: { type: "interval", everyDays: 1 } };
        const engine = scheduleOccurrences({ planId: "plan", timeZone: "Antarctica/Troll", phases: [phase] }).map((o) => `${o.key.split(":")[2]}@${o.scheduledAt}`);
        expect(got.troll.split(","), `Troll ${start} ${time}`).toEqual(engine);
      }
    }
  });
});
