// S4 access rules inside real RLS policies, row by row. A representative
// researcher-owned table is created INSIDE ONE TRANSACTION on a direct
// Postgres connection (psql, the local stack's DB_URL) with the policies every
// later researcher table uses:
//
//   select: can_read_researcher(owner)   insert/update/delete: can_write_researcher(owner)
//
// Each step runs as the `authenticated` role with that person's JWT claims,
// exactly as PostgREST does. The transaction always ends in ROLLBACK (and a
// dropped connection rolls back too), so the fixture table, its rows, the
// team share and the demotion made here never persist: nothing is added to
// the migrations. (S4's per-admin grant became S17's team share.)
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureAccount, localSupabase, uniqueEmail } from "../support/local-supabase";

const people = {
  alex: { email: uniqueEmail("s4-rls-alex"), name: "Alex Owner", role: "researcher" },
  blair: { email: uniqueEmail("s4-rls-blair"), name: "Blair Other", role: "researcher" },
  una: { email: uniqueEmail("s4-rls-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("s4-rls-grace"), name: "Grace Admin", role: "admin" },
  noah: { email: uniqueEmail("s4-rls-noah"), name: "Noah Admin", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
  }
});

/** Runs a script with psql; tab-separated `label\tvalue` rows come back as a map. */
function psql(sql: string): Map<string, string> {
  let out: string;
  try {
    out = execFileSync("psql", [localSupabase().dbUrl, "-X", "-q", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1"], {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const e = error as { code?: string; stderr?: string };
    if (e.code === "ENOENT") throw new Error("psql is required for the RLS fixture test (PostgreSQL client tools).");
    throw new Error(`psql failed: ${e.stderr ?? String(error)}`);
  }
  const rows = out.split("\n").filter(Boolean).map((line) => line.split("\t") as [string, string]);
  const labels = rows.map(([label]) => label);
  expect(new Set(labels).size, "labels are unique").toBe(labels.length);
  return new Map(rows.map(([label, value]) => [label, value ?? ""]));
}

const T = "public.s4_rls_fixture";

/** Act as `who` for the following statements (PostgREST's role and claims). */
const as = (who: Name | "anon") =>
  who === "anon"
    ? `set local role anon;\nset local "request.jwt.claims" to '{"role":"anon"}';\n`
    : `set local role authenticated;\nset local "request.jwt.claims" to '${JSON.stringify({ sub: id[who], role: "authenticated" })}';\n`;

/** The notes the current caller can see, comma-separated and sorted. */
const read = (label: string) => `select '${label}', coalesce(string_agg(note, ',' order by note), '') from ${T};\n`;

/** Runs a write; reports the affected row count, or the SQLSTATE it failed with. */
const write = (label: string, statement: string) => `do $$
declare n bigint;
begin
  ${statement};
  get diagnostics n = row_count;
  perform set_config('s4_fixture.result', n::text, true);
exception when others then
  perform set_config('s4_fixture.result', sqlstate, true);
end $$;
select '${label}', current_setting('s4_fixture.result');\n`;

const insertFor = (owner: Name, note: string) => `insert into ${T} (owner_id, note) values ('${id[owner]}', '${note}')`;
const updateOf = (owner: Name) => `update ${T} set body = 'changed' where owner_id = '${id[owner]}'`;
const deleteOf = (owner: Name) => `delete from ${T} where owner_id = '${id[owner]}'`;

describe("can_read_researcher / can_write_researcher inside RLS policies", () => {
  it("owners read and write their own rows; a team share lets current admins read only the sharing researcher's rows, never write; stopping denies at once", () => {
    const script =
      `begin;
create table ${T} (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles (id),
  note text not null,
  body text not null default ''
);
alter table ${T} enable row level security;
-- As every real table does: Supabase's default privileges grant anon (and
-- authenticated) everything on new public tables, so revoke them first.
revoke all on ${T} from public, anon, authenticated;
grant select, insert, update, delete on ${T} to authenticated;
create policy fixture_select on ${T} for select to authenticated using (public.can_read_researcher(owner_id));
create policy fixture_insert on ${T} for insert to authenticated with check (public.can_write_researcher(owner_id));
create policy fixture_update on ${T} for update to authenticated
  using (public.can_write_researcher(owner_id)) with check (public.can_write_researcher(owner_id));
create policy fixture_delete on ${T} for delete to authenticated using (public.can_write_researcher(owner_id));
insert into ${T} (owner_id, note) values
  ('${id.alex}', 'alex-1'), ('${id.alex}', 'alex-2'), ('${id.blair}', 'blair-1'),
  ('${id.una}', 'una-1'), ('${id.grace}', 'grace-1');
` +
      // Before any share: everyone sees only their own rows.
      as("alex") + read("alex before") +
      as("grace") + read("grace before") +
      as("noah") + read("noah before") +
      // Alex shares with the team.
      as("alex") + `select 'share', public.share_with_team() is not null;\n` +
      read("alex reads") +
      write("alex inserts own", insertFor("alex", "alex-3")) +
      write("alex inserts for blair", insertFor("blair", "forged")) +
      write("alex updates own", updateOf("alex")) + // alex-1, alex-2 and alex-3
      write("alex updates blair", updateOf("blair")) +
      write("alex deletes own", `delete from ${T} where note = 'alex-3'`) +
      write("alex deletes blair", deleteOf("blair")) +
      // Every admin reads Alex's rows (and their own), nobody else's, and writes none of Alex's.
      as("grace") + read("grace reads shared") +
      write("grace inserts for alex", insertFor("alex", "forged")) +
      write("grace updates alex", updateOf("alex")) +
      write("grace deletes alex", deleteOf("alex")) +
      write("grace updates own", updateOf("grace")) +
      as("noah") + read("noah reads shared") +
      write("noah updates alex", updateOf("alex")) +
      write("noah deletes alex", deleteOf("alex")) +
      // Another researcher sees and changes nothing of Alex's.
      as("blair") + read("blair reads") +
      write("blair updates alex", updateOf("alex")) +
      write("blair deletes alex", deleteOf("alex")) +
      write("blair inserts for alex", insertFor("alex", "forged")) +
      // Unacknowledged: reads own rows, cannot write them.
      as("una") + read("una reads") +
      write("una inserts own", insertFor("una", "una-2")) +
      write("una updates own", updateOf("una")) +
      // Anonymous callers have no access at all.
      as("anon") + write("anon reads", `perform count(*) from ${T}`) +
      // Noah stops being an admin: he reads nothing of Alex's on his very next query.
      `reset role;\nupdate public.profiles set role = 'researcher' where id = '${id.noah}';\n` +
      as("noah") + read("noah after demotion") +
      // Alex stops sharing: Grace is denied on her very next query.
      as("alex") + `select 'stop', public.stop_sharing_with_team();\n` +
      as("grace") + read("grace after stop") +
      write("grace updates alex after stop", updateOf("alex")) +
      // Alex's rows are intact, with only Alex's own change.
      as("alex") + `select 'alex rows', string_agg(note || ':' || body, ',' order by note) from ${T};\n` +
      `rollback;\n`;

    expect(Object.fromEntries(psql(script))).toEqual({
      "alex before": "alex-1,alex-2",
      "grace before": "grace-1",
      "noah before": "",
      share: "t",
      "alex reads": "alex-1,alex-2",
      "alex inserts own": "1",
      "alex inserts for blair": "42501",
      "alex updates own": "3",
      "alex updates blair": "0",
      "alex deletes own": "1",
      "alex deletes blair": "0",
      "grace reads shared": "alex-1,alex-2,grace-1",
      "grace inserts for alex": "42501",
      "grace updates alex": "0",
      "grace deletes alex": "0",
      "grace updates own": "1",
      "noah reads shared": "alex-1,alex-2",
      "noah updates alex": "0",
      "noah deletes alex": "0",
      "blair reads": "blair-1",
      "blair updates alex": "0",
      "blair deletes alex": "0",
      "blair inserts for alex": "42501",
      "una reads": "una-1",
      "una inserts own": "42501",
      "una updates own": "0",
      "anon reads": "42501",
      "noah after demotion": "",
      stop: "t",
      "grace after stop": "grace-1",
      "grace updates alex after stop": "0",
      "alex rows": "alex-1:changed,alex-2:changed",
    });
  });

  it("leaves nothing behind: the fixture table, the share and the demotion were rolled back", () => {
    const after = psql(
      `select 'table', coalesce(to_regclass('${T}')::text, 'none');\n` +
        `select 'shares', count(*) from public.support_shares where researcher_id = '${id.alex}';\n` +
        `select 'noah', role from public.profiles where id = '${id.noah}';\n`,
    );
    expect(Object.fromEntries(after)).toEqual({ table: "none", shares: "0", noah: "admin" });
  });
});
