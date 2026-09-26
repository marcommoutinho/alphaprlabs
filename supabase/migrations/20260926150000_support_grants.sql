-- S4: support grants and the reusable ownership / grant access rules.
--
-- A researcher (every admin is also a researcher) may grant ONE NAMED ADMIN
-- read-only access to their full history, and revoke it at any time. Only the
-- researcher grants or revokes. The admin role alone never reads another
-- person's records: only an active grant does, and only while the grantee is
-- still an admin.
--
-- History: one row per grant. Revoking sets revoked_at on that row; the row is
-- kept, so the grant history (granted and revoked timestamps) is the table
-- itself. Granting again after a revoke adds a new row. Rows cannot be edited
-- other than that single revoke, and cannot be deleted through any API role
-- (they go only when an account is deleted).
--
-- Rules every later researcher-owned table uses (with owner = the column that
-- names the researcher, e.g. profile_id):
--
--   for select to authenticated using (public.can_read_researcher(owner))
--   for insert/update/delete: public.can_write_researcher(owner)
--
-- can_read_researcher: the caller owns the records, or holds an active grant
-- from their owner. can_write_researcher: the caller owns them and has
-- acknowledged the disclaimer. A grant is read-only: it never allows a write.

create table public.support_grants (
  id uuid primary key default gen_random_uuid(),
  -- The researcher whose history is shared (the only one who grants/revokes).
  researcher_id uuid not null references public.profiles (id) on delete cascade,
  -- The named admin allowed to read it.
  admin_id uuid not null references public.profiles (id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint support_grants_not_self check (researcher_id <> admin_id),
  constraint support_grants_revoked_after check (revoked_at is null or revoked_at >= granted_at)
);

-- At most one active grant per researcher and admin.
create unique index support_grants_one_active
  on public.support_grants (researcher_id, admin_id) where revoked_at is null;
create index support_grants_by_admin on public.support_grants (admin_id, researcher_id) where revoked_at is null;
create index support_grants_history on public.support_grants (researcher_id, granted_at);

alter table public.support_grants enable row level security;
revoke all on table public.support_grants from public, anon, authenticated, service_role;
grant select on table public.support_grants to authenticated, service_role;

-- Each side reads the grants it is party to (R11 history for the researcher,
-- A8 states for the admin). No direct writes: the functions below only.
create policy support_grants_select_party on public.support_grants
  for select to authenticated
  using (researcher_id = (select auth.uid()) or admin_id = (select auth.uid()));

-- History is append-only: the only change a row may ever take is its revoke.
create function public.support_grants_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.researcher_id is distinct from old.researcher_id
     or new.admin_id is distinct from old.admin_id
     or new.granted_at is distinct from old.granted_at
     or old.revoked_at is not null
     or new.revoked_at is null then
    raise exception 'support grant history cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.support_grants_guard() from public, anon, authenticated;

create trigger support_grants_guard
  before update on public.support_grants
  for each row execute function public.support_grants_guard();

-- ── Reusable access rules ──────────────────────────────────────────────────

-- True when the caller may READ records owned by p_owner: the caller is the
-- owner, or holds an active (unrevoked) grant from p_owner and is still an
-- admin. False for anonymous callers and for a null owner.
create function public.can_read_researcher(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_owner = (select auth.uid()), false)
    or exists (
      select 1
      from public.support_grants g
      join public.profiles a on a.id = g.admin_id and a.role = 'admin'
      where g.researcher_id = p_owner
        and g.admin_id = (select auth.uid())
        and g.revoked_at is null
    );
$$;

-- True when the caller may WRITE records owned by p_owner: only the owner,
-- with research access and the disclaimer acknowledged. Grants never apply.
create function public.can_write_researcher(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_owner = (select auth.uid()), false) and public.is_acknowledged_researcher();
$$;

revoke all on function public.can_read_researcher(uuid) from public, anon;
revoke all on function public.can_write_researcher(uuid) from public, anon;
grant execute on function public.can_read_researcher(uuid) to authenticated;
grant execute on function public.can_write_researcher(uuid) to authenticated;

-- ── Researcher or admin: grant a named admin read access to own history ─────
-- Returns the active grant's id (an existing active grant is returned as is),
-- or null when refused: the caller has not acknowledged the disclaimer, or
-- p_admin_id is not an admin, or is the caller.
create function public.grant_support_access(p_admin_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if not public.is_acknowledged_researcher() then
    return null;
  end if;
  if p_admin_id is null or p_admin_id = v_uid
     or not exists (select 1 from public.profiles p where p.id = p_admin_id and p.role = 'admin') then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('support_grant:' || v_uid::text || ':' || p_admin_id::text, 0));

  select g.id into v_id from public.support_grants g
  where g.researcher_id = v_uid and g.admin_id = p_admin_id and g.revoked_at is null;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.support_grants (researcher_id, admin_id)
  values (v_uid, p_admin_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- ── Researcher or admin: revoke the caller's own active grant to an admin ───
-- Takes effect at once: can_read_researcher() is false from the next
-- statement. Returns whether an active grant was revoked. Needs no
-- acknowledgement: revoking must always work for the caller's own grants.
create function public.revoke_support_access(p_admin_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_admin_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('support_grant:' || v_uid::text || ':' || p_admin_id::text, 0));

  update public.support_grants g
  set revoked_at = greatest(now(), g.granted_at)
  where g.researcher_id = v_uid and g.admin_id = p_admin_id and g.revoked_at is null;
  return found;
end;
$$;

revoke all on function public.grant_support_access(uuid) from public, anon;
revoke all on function public.revoke_support_access(uuid) from public, anon;
grant execute on function public.grant_support_access(uuid) to authenticated;
grant execute on function public.revoke_support_access(uuid) to authenticated;
