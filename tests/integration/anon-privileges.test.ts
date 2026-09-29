// Deny by default for signed-out callers: no table, view or foreign table in
// the public schema may be read or written by `anon`. Supabase's default
// privileges grant anon (and authenticated) everything on each new public
// table, so every migration revokes them explicitly; a migration that forgets
// its revoke fails here. Read-only owner SQL through psql (the catalog), plus
// one rolled-back table that shows the check catches a missing revoke. Runs
// in the integration-exclusive project (vitest.config.mts).
import { describe, expect, it } from "vitest";
import { psql } from "../support/psql";

/** Public relations `anon` holds SELECT, INSERT, UPDATE or DELETE on, as "name:privileges". */
const ANON_ACCESS = `
  select 'open', coalesce(string_agg(c.relname || ':' || concat_ws('',
           case when has_table_privilege('anon', c.oid, 'SELECT') then 'r' end,
           case when has_table_privilege('anon', c.oid, 'INSERT') then 'a' end,
           case when has_table_privilege('anon', c.oid, 'UPDATE') then 'w' end,
           case when has_table_privilege('anon', c.oid, 'DELETE') then 'd' end), ',' order by c.relname), '')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
         or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'));
`;

describe("anon has no table privileges in public", () => {
  it("no public table, view or foreign table is readable or writable by a signed-out caller", () => {
    const out = psql(`${ANON_ACCESS}\nselect 'checked', count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f');`);
    expect(Number(out.checked)).toBeGreaterThan(20);
    expect(out.open).toBe("");
  });

  it("catches a new table that forgets its revoke (rolled back)", () => {
    // The grant stands for whatever leaves a table open to anon: a hosted project's default privileges, or
    // a grant nobody revoked. (The local image's default privileges for postgres already leave anon without
    // select, insert, update and delete on a new public table, so it is granted here explicitly.)
    const out = psql(`
      begin;
      create table public.anon_guard_forgot (id bigint primary key);
      grant select, insert, update, delete on public.anon_guard_forgot to anon;
      create table public.anon_guard_revoked (id bigint primary key);
      grant select, insert, update, delete on public.anon_guard_revoked to anon;
      revoke all on public.anon_guard_revoked from public, anon;
      ${ANON_ACCESS}
      rollback;
    `);
    expect(out.open).toBe("anon_guard_forgot:rawd");
  });
});
