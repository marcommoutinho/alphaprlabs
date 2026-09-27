// Recorded-dose reads are complete past the API's 1,000-row cap, a page at a
// time by id (keyset), in recording order (recorded_at to the microsecond,
// then id), for the owner and a granted admin, by owner and by cycle.
// 1,105 doses are written directly as the database owner (psql; committed,
// for an account unique to this run), with recording times that run against
// the ids and repeat, so the order is the sort's and not the paging's.
// Runs in the integration-exclusive project.
import { beforeAll, describe, expect, it } from "vitest";
import { cycleConfirmations, listDoseRecords } from "@/lib/doses/service";
import { type Client, createCycle, createPeptide, day, interval, plan, tag } from "../support/cycles";
import { ensureAccount, ok, signedInClient, uniqueEmail } from "../support/local-supabase";
import { psql, quote } from "../support/psql";

const people = {
  alex: { email: uniqueEmail("dpage-alex"), name: "Alex Paging", role: "researcher" },
  grace: { email: uniqueEmail("dpage-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("dpage-noah"), name: "Noah Not Granted", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const COUNT = 1105;
let cycleId = "";
/** The ids in recording order, as the database orders them. */
let expected: string[] = [];

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  const peptide = await createPeptide(db.grace, `Paging A ${tag()}`);
  cycleId = await createCycle(db.alex, { plans: [plan(peptide, [interval(day(-2000), day(10), "0.4", 1, "08:00")])] });
  await ok(db.alex.rpc("grant_support_access", { p_admin_id: id.grace }), "grant grace");
  // Recorded times fall as i rises, three doses share each, and some differ only in microseconds.
  const out = psql(`
    insert into public.dose_records
      (owner_id, cycle_id, plan_id, peptide_id, phase_id, occurrence_key, scheduled_at, planned_mg,
       actual_at, recorded_at, amount_mg, request_key)
    select p.owner_id, p.cycle_id, p.id, p.peptide_id, ph.phase_id, p.id || ':' || ph.phase_id || ':' || i,
           t, 0.4, t, t, 0.4, gen_random_uuid()
    from public.cycle_plans p
    join public.cycle_revision_phases ph on ph.plan_id = p.id
    cross join generate_series(0, ${COUNT - 1}) i
    cross join lateral (select timestamptz '2026-01-01 12:00:00+00' - (i / 3) * interval '1 hour'
                               + (i % 2) * interval '1 microsecond' as t) x
    where p.cycle_id = ${quote(cycleId)};
    select 'ids', string_agg(id::text, ',' order by recorded_at, id) from public.dose_records where cycle_id = ${quote(cycleId)};
  `);
  expected = out.ids.split(",");
  expect(expected).toHaveLength(COUNT);
}, 120_000);

describe("recorded doses past 1,000 rows", () => {
  it("reads every dose once, in recording order, whatever the page size", async () => {
    for (const [who, pageSize] of [
      ["alex", undefined],
      ["alex", 100],
      ["alex", 999],
      // Above the API's cap: read as 1,000 a page, not mistaken for the last page.
      ["alex", 5000],
      ["grace", 250],
    ] as const) {
      const records = await listDoseRecords(db[who], id.alex, pageSize);
      expect(records.map((r) => r.id), `${who} by ${pageSize ?? 1000}`).toEqual(expected);
    }
    const [first] = await listDoseRecords(db.alex, id.alex);
    expect(first).toMatchObject({ cycleId, plannedMg: "0.4", amountMg: "0.4" });
    expect(await listDoseRecords(db.noah, id.alex)).toEqual([]);
  });

  it("reads a cycle's confirmations completely too", async () => {
    const confirmations = await cycleConfirmations(db.alex, cycleId);
    expect(confirmations).toHaveLength(COUNT);
    expect(new Set(confirmations.map((c) => c.key)).size).toBe(COUNT);
    expect((await cycleConfirmations(db.grace, cycleId, 300)).map((c) => c.key)).toEqual(confirmations.map((c) => c.key));
  });
});
