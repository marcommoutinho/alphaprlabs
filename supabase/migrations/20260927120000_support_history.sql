-- S17: support access becomes a team share (Marco, 2026-09-27, "Support
-- access decisions" in tasks/research-app.md), plus the reads R11 Me and A8
-- Researcher support need.
--
-- A researcher shares their full history, read-only, with "the Alpha PR Labs
-- team": every CURRENT admin, including admins added later, in one step.
-- There is no choosing an individual admin. Stopping sharing applies to all
-- admins at once. S4's per-admin grants (20260926150000_support_grants.sql)
-- are replaced:
--
--   * support_shares: one row per share, (researcher_id, started_at,
--     stopped_at). At most one active share per researcher; stopping sets
--     stopped_at and keeps the row, so the table is the history R11 shows.
--     Nobody writes it through the API; only the two functions below do.
--   * share_with_team() / stop_sharing_with_team(): the researcher's own
--     share, idempotent and serialized per researcher.
--   * can_read_researcher(owner) (replaced): the owner, or a caller who is a
--     current admin, is not the owner, and reads while the owner has an active
--     share. Every researcher-owned table's SELECT policy calls it, so
--     stopping (or losing the admin role) denies the very next read.
--     can_write_researcher is unchanged: owner only, and a share never writes.
--   * An admin is a researcher too: an admin who shares is the owner of that
--     history; the OTHER admins read it.
--
-- Data migration from S4's support_grants (the table stays as a frozen
-- archive, readable by nothing but the secret key):
--   * A researcher with an active grant to someone who is still an admin gets
--     one active team share, started at the earliest such grant.
--   * Every other grant becomes a stopped share in the history: a revoked
--     grant keeps its granted and revoked times; an active grant to someone no
--     longer an admin (it read nothing) is recorded as stopped at this
--     migration, so it does not turn into a share with the whole team.
--   * The per-admin writers grant_support_access(uuid) and
--     revoke_support_access(uuid) are dropped: nothing can create a per-admin
--     grant any more, and nothing reads one.
--
-- Account data (Marco, 2026-09-26): accounts are soft deleted, and a closed
-- account's shares must stop working. When account closure is designed, it
-- must stop the account's share (and these reads must leave it out).

-- ── Shares ─────────────────────────────────────────────────────────────────
create table public.support_shares (
  id uuid primary key default gen_random_uuid(),
  -- The researcher (or admin, admins are researchers) whose history is shared.
  researcher_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  constraint support_shares_stopped_after check (stopped_at is null or stopped_at >= started_at)
);

-- At most one active share per researcher.
create unique index support_shares_one_active on public.support_shares (researcher_id) where stopped_at is null;
create index support_shares_history on public.support_shares (researcher_id, started_at);

alter table public.support_shares enable row level security;
revoke all on table public.support_shares from public, anon, authenticated, service_role;
grant select on table public.support_shares to authenticated, service_role;

-- The owner reads their own history (R11); admins read the active shares.
-- No direct writes for anyone: the functions below only.
create policy support_shares_select_own on public.support_shares
  for select to authenticated
  using (researcher_id = (select auth.uid()));
create policy support_shares_select_active_admin on public.support_shares
  for select to authenticated
  using (stopped_at is null and (select public.is_admin()));

-- The history is append-only: the only change a row may ever take is its stop.
create function public.support_shares_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.researcher_id is distinct from old.researcher_id
     or new.started_at is distinct from old.started_at
     or old.stopped_at is not null
     or new.stopped_at is null then
    raise exception 'support share history cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.support_shares_guard() from public, anon, authenticated;

create trigger support_shares_guard
  before update on public.support_shares
  for each row execute function public.support_shares_guard();

-- ── Data migration from the per-admin grants ───────────────────────────────
insert into public.support_shares (researcher_id, started_at)
select g.researcher_id, min(g.granted_at)
from public.support_grants g
join public.profiles a on a.id = g.admin_id and a.role = 'admin'
where g.revoked_at is null
group by g.researcher_id;

insert into public.support_shares (researcher_id, started_at, stopped_at)
select g.researcher_id, g.granted_at, coalesce(g.revoked_at, greatest(now(), g.granted_at))
from public.support_grants g
where g.revoked_at is not null
   or not exists (select 1 from public.profiles a where a.id = g.admin_id and a.role = 'admin');

-- S4's grants are an archive now: no API role reads or writes them.
drop policy support_grants_select_party on public.support_grants;
revoke all on table public.support_grants from authenticated;
drop function public.grant_support_access(uuid);
drop function public.revoke_support_access(uuid);

-- ── The read rule every researcher-owned table uses ─────────────────────────
-- True when the caller may READ records owned by p_owner: the caller is the
-- owner, or is a current admin other than the owner while p_owner shares with
-- the team. False for anonymous callers and for a null owner.
create or replace function public.can_read_researcher(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_owner = (select auth.uid()), false)
    or (
      p_owner is not null
      and p_owner <> (select auth.uid())
      and exists (select 1 from public.profiles a where a.id = (select auth.uid()) and a.role = 'admin')
      and exists (select 1 from public.support_shares s where s.researcher_id = p_owner and s.stopped_at is null)
    );
$$;

revoke all on function public.can_read_researcher(uuid) from public, anon;
grant execute on function public.can_read_researcher(uuid) to authenticated;

-- ── Researcher or admin: share the caller's own history with the team ───────
-- Returns the active share's id (an existing active share is returned as
-- is). Needs the disclaimer acknowledged (42501 otherwise), like every
-- research write. Serialized per researcher, so concurrent taps make one.
create function public.share_with_team()
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
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('support_share:' || v_uid::text, 0));

  select s.id into v_id from public.support_shares s
  where s.researcher_id = v_uid and s.stopped_at is null;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.support_shares (researcher_id) values (v_uid) returning id into v_id;
  return v_id;
end;
$$;

-- ── Researcher or admin: stop sharing the caller's own history ─────────────
-- Takes effect at once: can_read_researcher() is false for every admin from
-- the next statement. Returns whether an active share was stopped. Needs no
-- acknowledgement: a person can always stop sharing what they shared.
create function public.stop_sharing_with_team()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.has_research_access() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('support_share:' || v_uid::text, 0));

  update public.support_shares s
  set stopped_at = greatest(now(), s.started_at)
  where s.researcher_id = v_uid and s.stopped_at is null;
  return found;
end;
$$;

revoke all on function public.share_with_team() from public, anon;
revoke all on function public.stop_sharing_with_team() from public, anon;
grant execute on function public.share_with_team() to authenticated;
grant execute on function public.stop_sharing_with_team() to authenticated;

-- ── A8: researchers and their share state, for admins ──────────────────────
-- Without p_researcher_id: the researchers (and admins) other than the caller
-- who share now, with name, email and shared_since. With p_researcher_id: that
-- one account whatever its state (A8 history's header and denied state), with
-- shared_since (null: not sharing) and stopped_at of its latest stopped share
-- (null: never stopped). Admins only; names, emails and share times only: it
-- reads none of their records. Ordered by id for keyset paging.
create function public.admin_support_researchers(p_researcher_id uuid default null)
returns table (profile_id uuid, name text, email text, shared_since timestamptz, stopped_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select
      p.id,
      p.name,
      p.email,
      active.started_at,
      (select max(s.stopped_at) from public.support_shares s where s.researcher_id = p.id and s.stopped_at is not null)
    from public.profiles p
    left join public.support_shares active on active.researcher_id = p.id and active.stopped_at is null
    where p.role in ('researcher', 'admin')
      and p.id <> v_uid
      and (case when p_researcher_id is null then active.id is not null else p.id = p_researcher_id end)
    order by p.id;
end;
$$;

revoke all on function public.admin_support_researchers(uuid) from public, anon;
grant execute on function public.admin_support_researchers(uuid) to authenticated;
