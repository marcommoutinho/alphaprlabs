// S15 progress check-ins, as the database owner (psql). Only today's
// check-in can be saved through the API, so a month of past days is written
// here directly (committed: the researcher is unique to this run) to prove
// the reads are complete a page at a time (keyset by day) for the owner and
// a granted admin, and to build the 14-day history from them. The table's
// own checks are then tried in one transaction that is rolled back.
// Runs in the integration-exclusive project.
import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/cycles/rules";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { countCheckIns, listCheckIns } from "@/lib/progress/service";
import { progressView, progressWindow } from "@/lib/progress/view";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { d, NOON } from "../support/noon";
import { ensureAccount, ok, signedInClient, uniqueEmail } from "../support/local-supabase";
import { psql, quote } from "../support/psql";

const people = {
  alex: { email: uniqueEmail("s15o-alex"), name: "Alex Month", role: "researcher" },
  grace: { email: uniqueEmail("s15o-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("s15o-noah"), name: "Noah Not Granted", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const DAYS = 30;
/** d(-30) … d(-1): every day of the last month but today. */
const days = Array.from({ length: DAYS }, (_, i) => d(i - DAYS));

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  const peptide = await createPeptide(db.grace, `Month A ${tag()}`);
  await createCycle(db.alex, { name: "Month", timeZone: NOON, plans: [plan(peptide, [interval(d(-40), d(10), "0.4", 2, "08:00")])] });
  await ok(db.alex.rpc("grant_support_access", { p_admin_id: id.grace }), "grant grace");
  const values = days
    .map((day, i) => {
      const measured = i % 3 === 0 ? `'Weight', ${80 + i / 10}, 'kg', now()` : "null, null, null, null";
      return `(${quote(id.alex)}, ${quote(day)}, ${quote(NOON)}, ${(i % 5) + 1}, '{}', ${quote(`Day ${i}`)}, ${measured})`;
    })
    .join(",\n");
  psql(`insert into public.progress_check_ins
    (owner_id, day, time_zone, feeling, effects, note, measurement_name, measurement_value, measurement_unit, measured_at)
    values ${values};`);
});

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
    expect((await listCheckIns(db.grace, id.alex, { from: d(-13), to: d(0) }, 4)).map((c) => c.day)).toEqual(days.slice(-13));
    expect(await listCheckIns(db.noah, id.alex, {}, 4)).toEqual([]);
  });

  it("builds the last 14 days from them, today still open", async () => {
    const now = new Date();
    const cycles = await listCycles(db.alex, id.alex);
    const window = progressWindow(cycles[0], now);
    expect(window).toEqual({ from: d(-13), to: d(0), timeZone: NOON });
    const view = progressView({
      cycles,
      selectedId: null,
      checkIns: await listCheckIns(db.alex, id.alex, window, 5),
      total: await countCheckIns(db.alex, id.alex),
      confirmations: new Map(),
      peptides: new Map((await listCyclePeptides(db.alex)).map((p) => [p.id, p])),
      now,
    });
    if (view.kind !== "ready") throw new Error(view.kind);
    expect(view.rows.map((r) => r.day)).toEqual(Array.from({ length: 14 }, (_, i) => d(-i)));
    expect(view.rows.filter((r) => r.feeling !== null)).toHaveLength(13);
    expect(view.rows[0]).toMatchObject({ label: "Today", feeling: null });
    expect(view.rows[1]).toMatchObject({ day: d(-1), note: "Day 29", feelLabel: "5/5" });
    expect([view.form.day, view.form.start, view.sparse]).toEqual([d(0), null, ""]);
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

describe("the table's own checks", () => {
  it("refuse a second row for a day, bad feelings and chips, and half a measurement", () => {
    const row = (day: string, fields: string, values: string) =>
      `insert into public.progress_check_ins (owner_id, day, time_zone, feeling${fields}) values (${quote(id.alex)}, ${quote(day)}, ${quote(NOON)}${values})`;
    const script =
      "begin;\n" +
      attempt("control", row(d(-60), "", ", 3")) +
      attempt("same day", row(days[0], "", ", 3")) +
      attempt("feeling 0", row(d(-61), "", ", 0")) +
      attempt("feeling 6", row(d(-61), "", ", 6")) +
      attempt("unknown chip", row(d(-61), ", effects", ", 3, '{Dizzy}'")) +
      attempt("none noticed and more", row(d(-61), ", effects", ", 3, '{\"None noticed\",Nausea}'")) +
      attempt("untrimmed note", row(d(-61), ", note", ", 3, ' x'")) +
      attempt("half a measurement", row(d(-61), ", measurement_name, measurement_value", ", 3, 'Weight', 80")) +
      attempt(
        "trailing zeros",
        row(d(-61), ", measurement_name, measurement_value, measurement_unit, measured_at", ", 3, 'Weight', 80.50, 'kg', now()"),
      ) +
      attempt("unknown owner", `insert into public.progress_check_ins (owner_id, day, time_zone, feeling) values (gen_random_uuid(), ${quote(addDays(d(0), -62))}, 'UTC', 3)`) +
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
