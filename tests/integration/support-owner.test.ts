// S17 support access at the database owner's level (psql), in the
// integration-exclusive project:
//   * one cycle with 450 revisions read whole by getCycle (the revision ids
//     go to the API in bounded chunks, never one over-long URL);
//   * the data migration from S4's per-admin grants to team shares, run
//     again (the statements read from the migration itself) against grants
//     seeded in a rolled-back transaction;
//   * the source guard for "researchers never learn which admin it is": the
//     functions a signed-in account may call that return a name or an email
//     are exactly the admin-only ones listed here (support-history.test.ts
//     proves each refuses researchers);
//   * A8's history reads past the API's 1,000-row cap: 1,050 cycles (each
//     with a revision, a plan and a phase), 1,050 mixtures (2,100 setups,
//     half deleted) and 1,050 vials, written directly (committed, for an
//     account unique to this run), read completely and in order by an admin
//     while the researcher shares; a row added or deleted between two pages
//     never makes an existing row repeat or go missing (offset paging would).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { getCycle } from "@/lib/cycles/service";
import { type ResearcherRecords, readResearcherRecords } from "@/lib/support/service";
import { type Client, createPeptide, tag } from "../support/cycles";
import { ensureAccount, ok, signedInClient, uniqueEmail } from "../support/local-supabase";
import { psql, quote } from "../support/psql";

const people = {
  alex: { email: uniqueEmail("s17o-alex"), name: "Alex Paging", role: "researcher" },
  grace: { email: uniqueEmail("s17o-grace"), name: "Grace Admin", role: "admin" },
  // For the data migration: a researcher per grant shape, and a former admin.
  ria: { email: uniqueEmail("s17o-ria"), name: "Ria Active", role: "researcher" },
  sam: { email: uniqueEmail("s17o-sam"), name: "Sam Revoked", role: "researcher" },
  tom: { email: uniqueEmail("s17o-tom"), name: "Tom Former", role: "researcher" },
  noah: { email: uniqueEmail("s17o-noah"), name: "Noah Admin", role: "admin" },
  fay: { email: uniqueEmail("s17o-fay"), name: "Fay Former Admin", role: "researcher" },
  // One cycle with hundreds of revisions.
  rex: { email: uniqueEmail("s17o-rex"), name: "Rex Revisions", role: "researcher" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const COUNT = 1050;
const peptide = { p: "", p2: "" };

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  peptide.p = await createPeptide(db.grace, `Support paging ${tag()}`);
  peptide.p2 = await createPeptide(db.grace, `Support paging 2 ${tag()}`);
  const alex = quote(id.alex);
  // Creation times repeat (seven values), so the order is the sort's, not the paging's.
  psql(`
    with c as (
      insert into public.cycles (owner_id, name, goal, created_at)
      select ${alex}, 'Paged ' || i, 'Paging', timestamptz '2026-01-01 12:00+00' + (i % 7) * interval '1 day'
      from generate_series(1, ${COUNT}) i
      returning id, owner_id
    ), p as (
      insert into public.cycle_plans (cycle_id, owner_id, peptide_id)
      select id, owner_id, ${quote(peptide.p)} from c
      returning id, cycle_id, owner_id, peptide_id
    ), r as (
      insert into public.cycle_revisions (cycle_id, owner_id, number, time_zone)
      select id, owner_id, 1, 'America/Toronto' from c
      returning id, cycle_id, owner_id
    ), rp as (
      insert into public.cycle_revision_plans (revision_id, plan_id, cycle_id, owner_id, peptide_id, position)
      select r.id, p.id, r.cycle_id, r.owner_id, p.peptide_id, 0 from r join p on p.cycle_id = r.cycle_id
      returning revision_id, plan_id, owner_id
    )
    insert into public.cycle_revision_phases (revision_id, phase_id, plan_id, owner_id, kind, start_date, end_date, dose_mg, local_time, schedule_type, every_days)
    select revision_id, gen_random_uuid(), plan_id, owner_id, 'active', '2026-01-01', '2026-01-10', 0.4, '08:00', 'interval', 1 from rp;

    with m as (
      insert into public.mixtures (owner_id, peptide_id, current_version, version, created_at, deleted_at)
      select ${alex}, ${quote(peptide.p)}, 2, 2, timestamptz '2026-01-01 12:00+00' + (i % 5) * interval '1 hour',
             case when i % 2 = 0 then timestamptz '2026-02-01 12:00+00' end
      from generate_series(1, ${COUNT}) i
      returning id, owner_id
    )
    insert into public.mixture_versions (mixture_id, owner_id, number, vial_mg, liquid_ml, syringe_units, line_spacing, created_at)
    select m.id, m.owner_id, n, 10, n, 100, 2, timestamptz '2026-01-01 12:00+00' + n * interval '1 day' from m cross join generate_series(1, 2) n;

    insert into public.personal_vials (owner_id, peptide_id, label, strength_mg, created_at, finished_at)
    select ${alex}, ${quote(peptide.p)}, 'V-' || i, 10, timestamptz '2026-01-01 12:00+00' + (i % 3) * interval '1 day',
           case when i % 4 = 0 then timestamptz '2026-03-01 12:00+00' end
    from generate_series(1, ${COUNT}) i;
  `);
  await ok(db.alex.rpc("share_with_team"), "share");
}, 120_000);

describe("one cycle with hundreds of revisions", () => {
  it("getCycle reads every revision, its plans and phases (revision ids are sent in bounded chunks)", async () => {
    const REVISIONS = 450;
    const rex = quote(id.rex);
    // 450 revisions of one cycle, each with its plan and a phase starting on a different day.
    const cycleId = psql(`
      with c as (
        insert into public.cycles (owner_id, name, goal, current_revision) values (${rex}, 'Many revisions', 'Revisions', ${REVISIONS})
        returning id, owner_id
      ), p as (
        insert into public.cycle_plans (cycle_id, owner_id, peptide_id) select id, owner_id, ${quote(peptide.p)} from c
        returning id, cycle_id, owner_id, peptide_id
      ), r as (
        insert into public.cycle_revisions (cycle_id, owner_id, number, time_zone)
        select id, owner_id, n, 'America/Toronto' from c cross join generate_series(1, ${REVISIONS}) n
        returning id, cycle_id, owner_id, number
      ), rp as (
        insert into public.cycle_revision_plans (revision_id, plan_id, cycle_id, owner_id, peptide_id, position)
        select r.id, p.id, r.cycle_id, r.owner_id, p.peptide_id, 0 from r join p on p.cycle_id = r.cycle_id
        returning revision_id, plan_id, owner_id
      ), ph as (
        insert into public.cycle_revision_phases (revision_id, phase_id, plan_id, owner_id, kind, start_date, end_date, dose_mg, local_time, schedule_type, every_days)
        select rp.revision_id, gen_random_uuid(), rp.plan_id, rp.owner_id, 'active', date '2026-01-01' + r.number, date '2026-01-01' + r.number + 9, 0.4, '08:00', 'interval', 1
        from rp join r on r.id = rp.revision_id
      )
      select 'id', id from c;
    `).id;
    await ok(db.rex.rpc("share_with_team"), "rex shares");
    for (const who of ["rex", "grace"] as const) {
      const cycle = await getCycle(db[who], cycleId);
      expect(cycle?.revisions.map((r) => r.number), who).toEqual(Array.from({ length: REVISIONS }, (_, i) => i + 1));
      expect(cycle!.revisions.every((r) => r.plans.length === 1 && r.plans[0].phases.length === 1), who).toBe(true);
      expect(cycle!.revisions.at(-1)!.plans[0].phases[0].start, who).toBe("2027-03-27");
    }
  }, 60_000);
});

describe("the data migration from per-admin grants", () => {
  it("turns active grants to current admins into one team share, and every other grant into history", () => {
    const migration = readFileSync("supabase/migrations/20260927120000_support_history.sql", "utf8");
    const from = migration.indexOf("-- ── Data migration from the per-admin grants");
    const to = migration.indexOf("-- S4's grants are an archive now");
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const statements = migration.slice(from, to);
    const at = (iso: string) => `timestamptz ${quote(iso)}`;
    // Run against a fresh grants table holding only the seeded grants, then roll back.
    const out = psql(`
      begin;
      alter table public.support_grants rename to support_grants_live;
      create table public.support_grants (like public.support_grants_live including all);
      insert into public.support_grants (researcher_id, admin_id, granted_at, revoked_at) values
        -- Ria: two active grants to current admins, and an older revoked one.
        (${quote(id.ria)}, ${quote(id.grace)}, ${at("2026-09-10T12:00:00Z")}, null),
        (${quote(id.ria)}, ${quote(id.noah)}, ${at("2026-09-05T12:00:00Z")}, null),
        (${quote(id.ria)}, ${quote(id.grace)}, ${at("2026-08-01T12:00:00Z")}, ${at("2026-08-02T12:00:00Z")}),
        -- Sam: only revoked grants.
        (${quote(id.sam)}, ${quote(id.noah)}, ${at("2026-07-01T12:00:00Z")}, ${at("2026-07-09T12:00:00Z")}),
        -- Tom: an active grant to someone no longer an admin (it read nothing).
        (${quote(id.tom)}, ${quote(id.fay)}, ${at("2026-06-01T12:00:00Z")}, null);
      ${statements}
      select 'shares', string_agg(
        case researcher_id when ${quote(id.ria)} then 'ria' when ${quote(id.sam)} then 'sam' else 'tom' end
          || ' ' || to_char(started_at at time zone 'UTC', 'MM-DD')
          || ' ' || coalesce(case when stopped_at >= now() - interval '1 minute' then 'now' else to_char(stopped_at at time zone 'UTC', 'MM-DD') end, 'active'),
        ', ' order by researcher_id = ${quote(id.tom)}, researcher_id = ${quote(id.sam)}, started_at)
      from public.support_shares where researcher_id in (${quote(id.ria)}, ${quote(id.sam)}, ${quote(id.tom)});
      rollback;
    `);
    expect(out.shares).toBe("ria 08-01 08-02, ria 09-05 active, sam 07-01 07-09, tom 06-01 now");
    // Nothing persisted.
    expect(psql(`select 'n', count(*) from public.support_shares where researcher_id in (${quote(id.ria)}, ${quote(id.sam)}, ${quote(id.tom)});`).n).toBe("0");
  });
});

describe("researcher-callable functions name no one", () => {
  it("only admin-only functions return a name or an email to a signed-in caller", () => {
    const out = psql(`
      select 'functions', string_agg(p.proname, ',' order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and pg_get_function_result(p.oid) ~* '(name|email)';
    `);
    // Each refuses a researcher (support-history.test.ts), except template_peptides, whose names are peptides'.
    expect(out.functions.split(",")).toEqual([
      "admin_business_seller_totals",
      "admin_business_stock",
      "admin_support_researchers",
      "business_buyer_accounts",
      "business_sellers",
      "resend_invitation",
      "template_peptides",
    ]);
  });
});

/** The ids A8 read, per collection (composite keys as "revision/plan"). */
function idsOf(records: ResearcherRecords) {
  const revisions = records.cycles.flatMap((c) => c.revisions);
  const plans = revisions.flatMap((r) => r.plans.map((p) => ({ revision: r.id, plan: p })));
  return {
    cycles: records.cycles.map((c) => c.id),
    revisions: revisions.map((r) => r.id),
    plans: plans.map(({ revision, plan }) => `${revision}/${plan.planId}`),
    phases: plans.flatMap(({ revision, plan }) => plan.phases.map((ph) => `${revision}/${ph.id}`)),
    mixtures: records.mixtures.map((m) => m.id),
    versions: records.mixtures.flatMap((m) => m.versions.map((v) => v.id)),
    vials: records.vials.map((v) => v.id),
  };
}
type Ids = ReturnType<typeof idsOf>;

/** The same collections as the database owner holds them now (current revisions only, as A8 shows). */
function ownerIds(): Ids {
  const alex = quote(id.alex);
  const out = psql(`
    select 'cycles', coalesce(string_agg(id::text, ',' order by created_at desc, id), '') from public.cycles where owner_id = ${alex};
    select 'revisions', coalesce(string_agg(r.id::text, ','), '') from public.cycle_revisions r join public.cycles c on c.id = r.cycle_id
      where r.owner_id = ${alex} and r.number <= c.current_revision;
    select 'plans', coalesce(string_agg(revision_id || '/' || plan_id, ','), '') from public.cycle_revision_plans where owner_id = ${alex};
    select 'phases', coalesce(string_agg(revision_id || '/' || phase_id, ','), '') from public.cycle_revision_phases where owner_id = ${alex};
    select 'mixtures', coalesce(string_agg(id::text, ',' order by created_at, id), '') from public.mixtures where owner_id = ${alex};
    select 'versions', coalesce(string_agg(id::text, ','), '') from public.mixture_versions where owner_id = ${alex};
    select 'vials', coalesce(string_agg(id::text, ',' order by created_at, id), '') from public.personal_vials where owner_id = ${alex};
  `);
  const list = (key: string) => (out[key] ? out[key].split(",") : []);
  return {
    cycles: list("cycles"),
    revisions: list("revisions"),
    plans: list("plans"),
    phases: list("phases"),
    mixtures: list("mixtures"),
    versions: list("versions"),
    vials: list("vials"),
  };
}

const sorted = (ids: readonly string[]) => [...ids].sort();

describe("A8 history past 1,000 rows", () => {
  it("reads every record once, in order, for the owner and an admin, whatever the page size", async () => {
    const expected = ownerIds();
    expect(expected.cycles).toHaveLength(COUNT);
    expect(expected.phases).toHaveLength(COUNT);
    expect(expected.versions).toHaveLength(2 * COUNT);
    for (const [who, pageSize] of [
      ["grace", undefined],
      ["grace", 333],
      // Above the API's cap: read as 1,000 a page, not mistaken for the last page.
      ["grace", 5000],
      ["alex", undefined],
    ] as const) {
      const got = idsOf(await readResearcherRecords(db[who], id.alex, { pageSize }));
      const label = `${who} by ${pageSize ?? 1000}`;
      // Newest cycle first; mixtures and vials oldest first, as the database orders them.
      expect(got.cycles, label).toEqual(expected.cycles);
      expect(got.mixtures, label).toEqual(expected.mixtures);
      expect(got.vials, label).toEqual(expected.vials);
      for (const key of ["revisions", "plans", "phases", "versions"] as const) expect(sorted(got[key]), `${label} ${key}`).toEqual(sorted(expected[key]));
    }
    const records = await readResearcherRecords(db.grace, id.alex);
    expect(records.mixtures.filter((m) => m.deletedAt !== null)).toHaveLength(COUNT / 2);
    expect(records.mixtures.every((m) => m.versions.map((v) => v.number).join() === "1,2")).toBe(true);
  }, 60_000);

  // Between the first and second page of each collection, as the owner: a
  // row keyed before everything read so far is added (insert), or the first
  // row read is deleted (delete). Offset paging would repeat one existing row
  // (insert) or skip one (delete); keyset paging does neither.
  const LOW = "00000000-0000-4000-8000-";
  const lowId = (n: number) => `${LOW}${String(n).padStart(12, "0")}`;
  const alex = () => quote(id.alex);
  const inserts: Record<string, () => string> = {
    cycles: () => `insert into public.cycles (id, owner_id, name, goal) values (${quote(lowId(1))}, ${alex()}, 'Added', 'Added');`,
    "cycle revisions": () => `insert into public.cycle_revisions (id, cycle_id, owner_id, number, time_zone)
      select ${quote(lowId(2))}, id, owner_id, 2, 'America/Toronto' from public.cycles where owner_id = ${alex()} and id <> ${quote(lowId(1))} order by id limit 1;`,
    "cycle plans": () => `with r as (select id, cycle_id, owner_id from public.cycle_revisions where owner_id = ${alex()} and number = 1 order by id limit 1),
      p as (insert into public.cycle_plans (cycle_id, owner_id, peptide_id) select cycle_id, owner_id, ${quote(peptide.p2)} from r returning id, cycle_id, owner_id, peptide_id)
      insert into public.cycle_revision_plans (revision_id, plan_id, cycle_id, owner_id, peptide_id, position) select r.id, p.id, p.cycle_id, p.owner_id, p.peptide_id, 1 from r, p;`,
    "cycle phases": () => `insert into public.cycle_revision_phases (revision_id, phase_id, plan_id, owner_id, kind, start_date, end_date)
      select revision_id, gen_random_uuid(), plan_id, owner_id, 'break', '2026-03-01', '2026-03-05'
      from public.cycle_revision_plans where owner_id = ${alex()} and position = 0 order by revision_id, plan_id limit 1;`,
    "saved mixtures": () => `insert into public.mixtures (id, owner_id, peptide_id) values (${quote(lowId(3))}, ${alex()}, ${quote(peptide.p)});`,
    "mixture setups": () => `insert into public.mixture_versions (id, mixture_id, owner_id, number, vial_mg, liquid_ml, syringe_units)
      select ${quote(lowId(4))}, id, owner_id, 3, 10, 3, 100 from public.mixtures where owner_id = ${alex()} and id <> ${quote(lowId(3))} order by id limit 1;`,
    "personal vials": () => `insert into public.personal_vials (id, owner_id, peptide_id, label, strength_mg) values (${quote(lowId(5))}, ${alex()}, ${quote(peptide.p)}, 'Added', 10);`,
  };
  const deletes: Record<string, () => string> = {
    cycles: () => `delete from public.cycles where id = (select id from public.cycles where owner_id = ${alex()} order by id limit 1);`,
    "cycle revisions": () => `delete from public.cycle_revisions where id = (select id from public.cycle_revisions where owner_id = ${alex()} order by id limit 1);`,
    "cycle plans": () => `delete from public.cycle_revision_plans where (revision_id, plan_id) = (select revision_id, plan_id from public.cycle_revision_plans where owner_id = ${alex()} order by revision_id, plan_id limit 1);`,
    "cycle phases": () => `delete from public.cycle_revision_phases where (revision_id, phase_id) = (select revision_id, phase_id from public.cycle_revision_phases where owner_id = ${alex()} order by revision_id, phase_id limit 1);`,
    "saved mixtures": () => `delete from public.mixtures where id = (select id from public.mixtures where owner_id = ${alex()} order by id limit 1);`,
    "mixture setups": () => `delete from public.mixture_versions where id = (select id from public.mixture_versions where owner_id = ${alex()} order by id limit 1);`,
    "personal vials": () => `delete from public.personal_vials where id = (select id from public.personal_vials where owner_id = ${alex()} order by id limit 1);`,
  };

  for (const [mode, writes] of [
    ["added", inserts],
    ["deleted", deletes],
  ] as const) {
    it(`never repeats or skips an existing record when one is ${mode} between pages`, async () => {
      const before = ownerIds();
      const touched = new Set<string>();
      const records = await readResearcherRecords(db.grace, id.alex, {
        afterPage: (what, page) => {
          const write = writes[what];
          if (!write || page !== 1) return;
          touched.add(what);
          psql(write());
        },
      });
      // Every paged collection was written to between its pages.
      expect(sorted([...touched])).toEqual(sorted(Object.keys(writes)));
      const after = ownerIds();
      const got = idsOf(records);
      for (const key of Object.keys(before) as (keyof Ids)[]) {
        const read = got[key];
        expect(new Set(read).size, `${mode}: no ${key} read twice`).toBe(read.length);
        // Every record that existed throughout the read was read.
        const throughout = before[key].filter((x) => after[key].includes(x));
        expect(throughout.filter((x) => !read.includes(x)), `${mode}: no ${key} skipped`).toEqual([]);
        // Anything else read existed before or after (an added or since-deleted record).
        expect(read.filter((x) => !before[key].includes(x) && !after[key].includes(x)), `${mode}: ${key} invented`).toEqual([]);
      }
    }, 60_000);
  }
});
