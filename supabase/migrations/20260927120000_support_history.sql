-- S17: R11 Me (grant, revoke and the grant history) and A8 Researcher support.
--
-- The grant rules themselves are S4's (20260926150000_support_grants.sql):
-- only the researcher grants or revokes, a grant is read-only, and every
-- researcher-owned table reads through can_read_researcher(), so revoking
-- denies the next read. This migration adds the three reads the screens need
-- that plain RLS cannot give, because profiles are readable only by their own
-- person:
--
--   * support_admins()            R11: who may be granted access (admins' names).
--   * support_grant_history()     R11: the caller's own grants, with the admin's name.
--   * admin_support_researchers() A8: every account's name, email and grant
--                                 state towards the calling admin.
--
-- Each is SECURITY DEFINER with an empty search_path, checks its caller
-- itself, and returns the minimum identity: an admin's name to researchers (no
-- email), and to an admin the name and email they already see when linking a
-- sale to an account (business_buyer_accounts). None of them reads a
-- researcher-owned record: A8's history reads those as the admin, under RLS,
-- and only while the grant is active. Results are ordered by id so the app
-- can page them by keyset past the API's 1,000-row cap.
--
-- A8's history shows peptide names through admin_library_peptides() (S4), which
-- every admin may call: that includes names of peptides later withdrawn
-- ("Not offered"), which the library policies hide from research screens. No
-- researcher-facing path changes, so researchers still never see withdrawn
-- peptides beyond those their own cycles and mixtures use.
--
-- Account data (Marco, 2026-09-26): accounts are soft deleted, and a closed
-- account's grants stop working. When account closure is designed, these
-- functions must leave closed accounts out (and can_read_researcher must deny
-- them); until then an account goes only with its profile.

-- ── R11: admins a researcher may grant access to ───────────────────────────
-- Every admin other than the caller (grant_support_access refuses the caller
-- and non-admins). Names only. For acknowledged researchers and admins, the
-- same people who may grant.
create function public.support_admins()
returns table (admin_id uuid, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_acknowledged_researcher() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select p.id, p.name from public.profiles p
    where p.role = 'admin' and p.id <> (select auth.uid())
    order by p.id;
end;
$$;

-- ── R11: the caller's own grant history ────────────────────────────────────
-- One row per grant the caller made (active and revoked), with the admin's
-- current name. Needs no acknowledgement, as revoking needs none: a person can
-- always see and end what they shared. still_admin is false once the grantee
-- stops being an admin (their grant then reads nothing; see
-- can_read_researcher), so the screen can say so.
create function public.support_grant_history()
returns table (grant_id uuid, admin_id uuid, admin_name text, still_admin boolean, granted_at timestamptz, revoked_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_research_access() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select g.id, g.admin_id, a.name, a.role = 'admin', g.granted_at, g.revoked_at
    from public.support_grants g
    join public.profiles a on a.id = g.admin_id
    where g.researcher_id = (select auth.uid())
    order by g.id;
end;
$$;

-- ── A8: accounts and their grant state towards the calling admin ───────────
-- Every researcher and admin account except the caller, with name and email,
-- granted_at of their active grant to the caller (null: none) and revoked_at
-- of their latest revoked grant to the caller (null: never revoked). Admins
-- only. p_researcher_id limits it to one account (A8 history's header and
-- denied state). Grant states only: it reads none of their records.
create function public.admin_support_researchers(p_researcher_id uuid default null)
returns table (profile_id uuid, name text, email text, granted_at timestamptz, revoked_at timestamptz)
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
      (select g.granted_at from public.support_grants g
        where g.researcher_id = p.id and g.admin_id = v_uid and g.revoked_at is null),
      (select max(g.revoked_at) from public.support_grants g
        where g.researcher_id = p.id and g.admin_id = v_uid and g.revoked_at is not null)
    from public.profiles p
    where p.role in ('researcher', 'admin')
      and p.id <> v_uid
      and (p_researcher_id is null or p.id = p_researcher_id)
    order by p.id;
end;
$$;

revoke all on function public.support_admins() from public, anon;
revoke all on function public.support_grant_history() from public, anon;
revoke all on function public.admin_support_researchers(uuid) from public, anon;
grant execute on function public.support_admins() to authenticated;
grant execute on function public.support_grant_history() to authenticated;
grant execute on function public.admin_support_researchers(uuid) to authenticated;
