// Recorded-dose reads are complete past the API's 1,000-row cap, a page at a
// time by id (keyset), in recording order (recorded_at to the microsecond,
// then id), for the owner and a granted admin, by owner and by cycle.
// 1,105 doses are written directly as the database owner (psql; committed,
// for an account unique to this run), with recording times that run against
// the ids and repeat, so the order is the sort's and not the paging's. A
// dose recorded between two pages, sorting before the page boundary, never
// makes an existing dose repeat or go missing (offset paging would repeat
// one: every later row shifts back by one).
// Runs in the integration-exclusive project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { cycleConfirmations, listDoseRecords } from "@/lib/doses/service";
import { type Client, createCycle, createPeptide, day, interval, plan, tag } from "../support/cycles";
import { ensureAccount, ok, signedInClient, uniqueEmail } from "../support/local-supabase";
import { psql, quote } from "../support/psql";

const people = {
  alex: { email: uniqueEmail("dpage-alex"), name: "Alex Paging", role: "researcher" },
  grace: { email: uniqueEmail("dpage-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("dpage-noah"), name: "Noah Admin", role: "admin" },
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
  await ok(db.alex.rpc("share_with_team"), "share with the team");
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
      const records = await listDoseRecords(db[who], id.alex, { pageSize });
      expect(records.map((r) => r.id), `${who} by ${pageSize ?? 1000}`).toEqual(expected);
    }
    const [first] = await listDoseRecords(db.alex, id.alex);
    expect(first).toMatchObject({ cycleId, plannedMg: "0.4", amountMg: "0.4" });
    // Every admin reads while Alex shares with the team.
    expect((await listDoseRecords(db.noah, id.alex, { pageSize: 400 })).map((r) => r.id)).toEqual(expected);
  });

  it("reads a cycle's confirmations completely too", async () => {
    const confirmations = await cycleConfirmations(db.alex, cycleId);
    expect(confirmations).toHaveLength(COUNT);
    expect(new Set(confirmations.map((c) => c.key)).size).toBe(COUNT);
    expect((await cycleConfirmations(db.grace, cycleId, { pageSize: 300 })).map((c) => c.key)).toEqual(confirmations.map((c) => c.key));
  });

  // Last: it adds doses, which the tests above don't expect.
  it("never skips or repeats an existing dose when one is recorded between pages", async () => {
    const insertBefore = (n: number) => {
      // Before every existing row in both orders: the lowest ids, and the earliest recording time.
      const doseId = `00000000-${randomUUID().slice(9)}`;
      psql(`
        insert into public.dose_records
          (id, owner_id, cycle_id, plan_id, peptide_id, phase_id, occurrence_key, scheduled_at, planned_mg,
           actual_at, recorded_at, amount_mg, request_key)
        select ${quote(doseId)}, p.owner_id, p.cycle_id, p.id, p.peptide_id, ph.phase_id,
               p.id || ':' || ph.phase_id || ':' || ${900000 + n},
               t, 0.4, t, t, 0.4, gen_random_uuid()
        from public.cycle_plans p
        join public.cycle_revision_phases ph on ph.plan_id = p.id
        cross join (select timestamptz '2000-01-01 00:00:00+00' as t) x
        where p.cycle_id = ${quote(cycleId)};`);
      return doseId;
    };
    const before = psql(`select 'ids', string_agg(id::text, ',') from public.dose_records where cycle_id = ${quote(cycleId)};`).ids.split(",");
    const added: string[] = [];
    const read = async (paged: (options: { pageSize: number; afterPage: () => void }) => Promise<string[]>) => {
      const ids = await paged({ pageSize: 100, afterPage: () => void added.push(insertBefore(added.length)) });
      expect(added.length, "a dose was recorded between each pair of pages").toBeGreaterThanOrEqual(11);
      expect(new Set(ids).size, "no dose read twice").toBe(ids.length);
      expect(before.filter((doseId) => !ids.includes(doseId)), "no existing dose skipped").toEqual([]);
      // Anything else read is a dose recorded meanwhile.
      expect(ids.filter((doseId) => !before.includes(doseId) && !added.includes(doseId))).toEqual([]);
    };
    await read(async (options) => (await listDoseRecords(db.alex, id.alex, options)).map((r) => r.id));
    await read(async (options) => (await listDoseRecords(db.grace, id.alex, options)).map((r) => r.id));
  });
});
