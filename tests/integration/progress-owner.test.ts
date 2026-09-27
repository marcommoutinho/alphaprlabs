// S15 progress check-ins, as the database owner (psql). Only today's
// check-in can be saved through the API, so a month of past days is written
// here directly (committed: the researcher is unique to this run) to prove
// the reads are complete a page at a time (keyset by day) for the owner and
// a granted admin, and to build the 14-day history from them. The table's
// own checks and the database's check-in day (America/Toronto, around
// midnight and daylight-saving changes) are then tried in transactions that
// are rolled back. Runs in the integration-exclusive project.
import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/cycles/rules";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { checkInDay } from "@/lib/progress/rules";
import { countCheckIns, listCheckIns } from "@/lib/progress/service";
import { progressView, progressWindow } from "@/lib/progress/view";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { ensureAccount, ok, signedInClient, uniqueEmail } from "../support/local-supabase";
import { psql, quote } from "../support/psql";

const people = {
  alex: { email: uniqueEmail("s15o-alex"), name: "Alex Month", role: "researcher" },
  grace: { email: uniqueEmail("s15o-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("s15o-noah"), name: "Noah Admin", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const DAYS = 30;
/** Today in Toronto (the run avoids its midnight; see beforeAll). */
let today = "";
/** today - 30 … today - 1: every day of the last month but today. */
let days: string[] = [];

beforeAll(async () => {
  while (checkInDay(new Date()) !== checkInDay(new Date(Date.now() + 60_000))) await new Promise((r) => setTimeout(r, 5_000));
  today = checkInDay(new Date());
  days = Array.from({ length: DAYS }, (_, i) => addDays(today, i - DAYS));
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  const peptide = await createPeptide(db.grace, `Month A ${tag()}`);
  await createCycle(db.alex, {
    name: "Month",
    timeZone: "America/Toronto",
    plans: [plan(peptide, [interval(addDays(today, -40), addDays(today, 10), "0.4", 2, "08:00")])],
  });
  await ok(db.alex.rpc("share_with_team"), "share with the team");
  const values = days
    .map((day, i) => {
      const measured = i % 3 === 0 ? `'Weight', ${80 + i / 10}, 'kg', now()` : "null, null, null, null";
      return `(${quote(id.alex)}, ${quote(day)}, ${(i % 5) + 1}, '{}', ${quote(`Day ${i}`)}, ${measured})`;
    })
    .join(",\n");
  psql(`insert into public.progress_check_ins
    (owner_id, day, feeling, effects, note, measurement_name, measurement_value, measurement_unit, measured_at)
    values ${values};`);
}, 120_000);

describe("check-in reads are complete, a page at a time", () => {
  it("reads every day in order for the owner and a granted admin, and nothing for anyone else", async () => {
    for (const [who, pageSize] of [
      ["alex", 7],
      ["alex", 30],
      ["grace", 4],
    ] as const) {
      const all = await listCheckIns(db[who], id.alex, {}, pageSize);
      expect(all.map((c) => c.day), `${who} by ${pageSize}`).toEqual(days);
    }
    const all = await listCheckIns(db.alex, id.alex);
    expect(all[3]).toMatchObject({ feeling: 4, note: "Day 3", measurement: { name: "Weight", value: "80.3", unit: "kg" } });
    expect(all[1].measurement).toBeNull();
    expect(await countCheckIns(db.alex, id.alex)).toBe(DAYS);
    expect((await listCheckIns(db.grace, id.alex, { from: addDays(today, -13), to: today }, 4)).map((c) => c.day)).toEqual(days.slice(-13));
    // Every admin reads while Alex shares with the team.
    expect(await listCheckIns(db.noah, id.alex, {}, 4)).toHaveLength(DAYS);
  });

  it("builds the last 14 days from them, today still open", async () => {
    const now = new Date();
    const window = progressWindow(now);
    expect(window).toEqual({ from: addDays(today, -13), to: today });
    const view = progressView({
      cycles: await listCycles(db.alex, id.alex),
      selectedId: null,
      checkIns: await listCheckIns(db.alex, id.alex, window, 5),
      total: await countCheckIns(db.alex, id.alex),
      confirmations: new Map(),
      peptides: new Map((await listCyclePeptides(db.alex)).map((p) => [p.id, p])),
      now,
    });
    expect(view.cycle?.name).toBe("Month");
    expect(view.rows.map((r) => r.day)).toEqual(Array.from({ length: 14 }, (_, i) => addDays(today, -i)));
    expect(view.rows.filter((r) => r.feeling !== null)).toHaveLength(13);
    expect(view.rows[0]).toMatchObject({ label: "Today", feeling: null });
    expect(view.rows[1]).toMatchObject({ day: addDays(today, -1), note: "Day 29", feelLabel: "5/5" });
    expect([view.form.day, view.form.start, view.sparse]).toEqual([today, null, ""]);
  });
});

/** Runs a statement; reports the SQLSTATE it failed with, or the affected row count. */
const attempt = (label: string, statement: string) => `do $$
declare n bigint;
begin
  ${statement};
  get diagnostics n = row_count;
  perform set_config('s15_owner.result', n::text, true);
exception when others then
  perform set_config('s15_owner.result', sqlstate, true);
end $$;
select ${quote(label)}, current_setting('s15_owner.result');\n`;

describe("the database's check-in day", () => {
  it("is the Toronto calendar date, turning at Toronto's midnight across daylight-saving changes, as the app computes it", () => {
    const instants = [
      // Midnight in EDT (04:00Z) and EST (05:00Z).
      "2026-09-27T03:59:59.999999Z",
      "2026-09-27T04:00:00Z",
      "2027-01-15T04:59:59Z",
      "2027-01-15T05:00:00Z",
      // Fall back, Sun Nov 1, 2026: a 25-hour day; 01:30 happens twice.
      "2026-11-01T03:59:59Z",
      "2026-11-01T04:00:00Z",
      "2026-11-01T05:30:00Z",
      "2026-11-01T06:30:00Z",
      "2026-11-02T04:59:59Z",
      "2026-11-02T05:00:00Z",
      // Spring forward, Sun Mar 8, 2026: a 23-hour day.
      "2026-03-08T04:59:59Z",
      "2026-03-08T05:00:00Z",
      "2026-03-09T03:59:59Z",
      "2026-03-09T04:00:00Z",
    ];
    const script = instants.map((at) => `select ${quote(at)}, public.progress_day(${quote(at)}::timestamptz)::text;`).join("\n");
    expect(psql(script)).toEqual(Object.fromEntries(instants.map((at) => [at, checkInDay(at)])));
    expect(checkInDay("2026-11-01T05:30:00Z")).toBe("2026-11-01");
    expect(checkInDay("2026-11-02T04:59:59Z")).toBe("2026-11-01");
    expect(checkInDay("2026-03-09T03:59:59Z")).toBe("2026-03-08");
  });

  it("refuses a second row for a day, bad feelings and chips, and half a measurement", () => {
    const row = (day: string, fields: string, values: string) =>
      `insert into public.progress_check_ins (owner_id, day, feeling${fields}) values (${quote(id.alex)}, ${quote(day)}${values})`;
    const script =
      "begin;\n" +
      attempt("control", row(addDays(today, -60), "", ", 3")) +
      attempt("same day", row(days[0], "", ", 3")) +
      attempt("feeling 0", row(addDays(today, -61), "", ", 0")) +
      attempt("feeling 6", row(addDays(today, -61), "", ", 6")) +
      attempt("unknown chip", row(addDays(today, -61), ", effects", ", 3, '{Dizzy}'")) +
      attempt("none noticed and more", row(addDays(today, -61), ", effects", ", 3, '{\"None noticed\",Nausea}'")) +
      attempt("untrimmed note", row(addDays(today, -61), ", note", ", 3, ' x'")) +
      attempt("half a measurement", row(addDays(today, -61), ", measurement_name, measurement_value", ", 3, 'Weight', 80")) +
      attempt(
        "trailing zeros",
        row(addDays(today, -61), ", measurement_name, measurement_value, measurement_unit, measured_at", ", 3, 'Weight', 80.50, 'kg', now()"),
      ) +
      attempt("unknown owner", `insert into public.progress_check_ins (owner_id, day, feeling) values (gen_random_uuid(), ${quote(addDays(today, -62))}, 3)`) +
      "rollback;\n";
    expect(psql(script)).toEqual({
      control: "1",
      "same day": "23505",
      "feeling 0": "23514",
      "feeling 6": "23514",
      "unknown chip": "23514",
      "none noticed and more": "23514",
      "untrimmed note": "23514",
      "half a measurement": "23514",
      "trailing zeros": "23514",
      "unknown owner": "23503",
    });
  });
});
