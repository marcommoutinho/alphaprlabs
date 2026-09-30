-- Research terms (Marco, 2026-09-30): the final terms replace the placeholder
-- disclaimer, and "acknowledged" now means "agreed to the CURRENT version".
--
-- 1. The database knows the current version: public.current_terms_version()
--    returns it as a constant ('2026-09-30', the app's ACKNOWLEDGEMENT_VERSION
--    in src/lib/auth/paths.ts; an integration test keeps the two equal).
--    A constant in a function rather than a settings row: the version only
--    changes with new wording, which ships with the app anyway, so a new
--    terms version is one small forward migration that replaces this
--    function, and nothing can drift at runtime. The profiles columns are
--    unchanged: acknowledgement_version and acknowledged_at still hold the
--    version last agreed to and when (the pair check still applies).
--
-- 2. is_acknowledged_researcher() (every database gate on the terms goes
--    through it: can_write_researcher() and so every research write and RLS
--    write policy, the acknowledged-only reads of templates and the library,
--    save_push_subscription, the support-sharing writers) now requires the
--    stored version to be the current one. An agreement to an earlier
--    version ("2026-09-placeholder", everyone in production today) no longer
--    passes, so nobody writes research records until they agree again. What
--    never needed the terms still doesn't: turning a device off, stopping
--    sharing, and the admin back office (is_admin()), which the terms never
--    gated.
--
-- 2b. can_read_researcher(owner), the read rule of every researcher-owned
--    table (cycles and their revisions, plans and phases; dose records,
--    skips, voids and deductions; mixtures and their versions, plan
--    mixtures, personal vials and supply settings; progress check-ins;
--    supplement settings, routines and Taken records): the OWNER branch now
--    also needs the current terms (is_acknowledged_researcher()), so an
--    account on an earlier version reads none of its research records, even
--    directly through the API, until it agrees again. The admin branch is
--    unchanged: a current admin reads the history of a researcher who shares
--    with the team whatever either one's terms version. Sharing is its own
--    consent, given and stopped by the researcher, so a researcher on an
--    earlier version who is still sharing stays readable by the team, and an
--    admin on an earlier version can still support them. Every other read of
--    one's own data was checked: the research SECURITY DEFINER functions
--    callable by the API either write (gated by can_write_researcher()) or
--    are admin-only; the peptide reads (library, "in your cycle") already
--    need is_acknowledged_researcher(). Left open on purpose, since they are
--    account state rather than research records and the terms screen itself
--    needs them: the own profile (the session's role and terms version), the
--    own account preferences (the appearance, read before the terms screen
--    paints), the own sharing history (stopping sharing must always work)
--    and the own push subscriptions (turning a device off must always work).
--
-- 2c. Reminders pause for an owner on an earlier version and resume once they
--    agree, with their push subscriptions left in place:
--    due_supplement_occurrences() (the supplement reminder feed, read by
--    listDueSupplements()) leaves their routines out, and
--    cycle_plan_occurrences() (the dose reminder schedule and its send-time
--    recheck) returns nothing for their plans, so a queued reminder is
--    dropped at the recheck. Every writer that calls cycle_plan_occurrences()
--    already refuses such an owner first (can_write_researcher()). The
--    dispatcher (S13) adds one recheck to both lists: the owner still
--    agreed_to_current_terms() (service role).
--
-- 3. record_acknowledgement(p_version) accepts only the current version
--    (22023 otherwise, nothing written) and, as before, records it on the
--    caller's own profile, researchers and admins, with the server's time.
--    It already accepted a new agreement from someone who had agreed before
--    (an unconditional update), which is how agreeing again stores the new
--    version and time. It returns false, as before, for anyone else.
--
-- Grants are unchanged (CREATE OR REPLACE keeps them; restated below).

-- ── The current research terms version ─────────────────────────────────────
create function public.current_terms_version()
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select '2026-09-30'::text;
$$;

revoke all on function public.current_terms_version() from public, anon;
grant execute on function public.current_terms_version() to authenticated;

-- True when p_profile has agreed to the current research terms. For the
-- reminder feeds and the dispatcher's rechecks (service role; internal).
create function public.agreed_to_current_terms(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile
      and p.acknowledged_at is not null
      and p.acknowledgement_version = public.current_terms_version()
  );
$$;

revoke all on function public.agreed_to_current_terms(uuid) from public, anon, authenticated;
grant execute on function public.agreed_to_current_terms(uuid) to service_role;

-- True when the caller may write research records: a researcher or admin who
-- has agreed to the CURRENT research terms (the app's gate,
-- src/lib/auth/session.ts, checks the same version).
create or replace function public.is_acknowledged_researcher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('researcher', 'admin')
      and p.acknowledged_at is not null
      and p.acknowledgement_version = public.current_terms_version()
  );
$$;

revoke all on function public.is_acknowledged_researcher() from public, anon;
grant execute on function public.is_acknowledged_researcher() to authenticated;

-- ── Researcher or admin: agree to the current research terms ───────────────
-- Only for the caller's own profile; the time is the server's. Agreeing again
-- (after the terms changed) replaces the version and the time.
-- Refusals: 22023 not the current terms version.
create or replace function public.record_acknowledgement(p_version text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_version is distinct from public.current_terms_version() then
    raise exception 'not the current terms version' using errcode = '22023';
  end if;
  update public.profiles p
  set acknowledgement_version = p_version, acknowledged_at = now()
  where p.id = (select auth.uid()) and p.role in ('researcher', 'admin');
  return found;
end;
$$;

revoke all on function public.record_acknowledgement(text) from public, anon;
grant execute on function public.record_acknowledgement(text) to authenticated;

-- ── The read rule every researcher-owned table uses ─────────────────────────
-- True when the caller may READ records owned by p_owner: the caller is the
-- owner and has agreed to the current research terms, or is a current admin
-- other than the owner while p_owner shares with the team (either one's terms
-- version aside: sharing is the researcher's own consent). False for
-- anonymous callers and for a null owner.
create or replace function public.can_read_researcher(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce(p_owner = (select auth.uid()), false) and public.is_acknowledged_researcher())
    or (
      p_owner is not null
      and p_owner <> (select auth.uid())
      and exists (select 1 from public.profiles a where a.id = (select auth.uid()) and a.role = 'admin')
      and exists (select 1 from public.support_shares s where s.researcher_id = p_owner and s.stopped_at is null)
    );
$$;

revoke all on function public.can_read_researcher(uuid) from public, anon;
grant execute on function public.can_read_researcher(uuid) to authenticated;

-- ── Dose reminders: a plan's occurrences (unchanged but for the terms) ──────
-- As in 20260926200000_doses.sql (revision 1 schedules the plan whole; each
-- later revision takes over at its seam), now empty for a plan whose owner
-- has not agreed to the current research terms.
create or replace function public.cycle_plan_occurrences(p_plan_id uuid, p_confirmations jsonb default null)
returns setof public.cycle_occurrence
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conf jsonb := coalesce(p_confirmations, public.dose_confirmations(p_plan_id));
  v_cycle uuid;
  v_owner uuid;
  v_current integer;
  v_seen boolean := false;
  v_in_previous boolean := false;
  v_so_far public.cycle_occurrence[] := '{}';
  v_fresh public.cycle_occurrence[];
  v_seam timestamptz;
  r record;
begin
  select cp.cycle_id, c.current_revision, c.owner_id into v_cycle, v_current, v_owner
  from public.cycle_plans cp join public.cycles c on c.id = cp.cycle_id
  where cp.id = p_plan_id;
  -- Nothing for an owner who has not agreed to the current research terms
  -- (their reminders pause until they agree; every writer that calls this
  -- already refuses them).
  if v_cycle is null or not public.agreed_to_current_terms(v_owner) then
    return;
  end if;

  for r in
    select rv.id, rv.time_zone, rv.created_at, rp.plan_id is not null as has_plan, rp.effective_from
    from public.cycle_revisions rv
    left join public.cycle_revision_plans rp on rp.revision_id = rv.id and rp.plan_id = p_plan_id
    where rv.cycle_id = v_cycle and rv.number <= v_current
    order by rv.number
  loop
    if not r.has_plan then
      if v_in_previous then
        v_so_far := array(select o from unnest(v_so_far) o where o.scheduled_at < r.created_at);
      end if;
      v_in_previous := false;
      continue;
    end if;
    v_fresh := array(select o from public.cycle_revision_plan_occurrences(r.id, p_plan_id, v_conf) o);
    if not v_seen or r.effective_from is null then
      v_so_far := v_fresh;
    else
      v_seam := public.cycle_local_instant(r.effective_from, '00:00', r.time_zone);
      v_so_far := array(
        select o from unnest(v_so_far) o where o.scheduled_at < v_seam
        union all
        select f from unnest(v_fresh) f
        where not exists (
          select 1 from unnest(v_so_far) o where o.scheduled_at < v_seam and o.occurrence_key = f.occurrence_key));
    end if;
    v_seen := true;
    v_in_previous := true;
  end loop;

  return query select o.* from unnest(v_so_far) o order by o.scheduled_at, o.occurrence_key;
end;
$$;

revoke all on function public.cycle_plan_occurrences(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cycle_plan_occurrences(uuid, jsonb) to service_role;

-- ── Supplement reminders: the due feed (unchanged but for the terms) ────────
-- As in 20260927100000_supplements.sql, leaving out routines whose owner has
-- not agreed to the current research terms.
create or replace function public.due_supplement_occurrences(
  p_from timestamptz,
  p_to timestamptz,
  p_after_at timestamptz default null,
  p_after_routine uuid default null,
  p_limit integer default 1000
)
returns table (
  owner_id uuid,
  routine_id uuid,
  occurrence_key text,
  local_date date,
  scheduled_at timestamptz,
  schedule_version integer,
  name text,
  amount text,
  unit text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > interval '8 days'
     or (p_after_at is null) <> (p_after_routine is null)
     or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid window or cursor' using errcode = '22023';
  end if;
  return query
  select r.owner_id, r.id, r.id::text || ':' || to_char(o.local_date, 'YYYY-MM-DD'), o.local_date, o.scheduled_at,
         r.schedule_version, r.name, r.amount::text, r.unit
  from public.supplement_routines r
  join public.supplement_settings s on s.owner_id = r.owner_id and s.tracking_enabled
  cross join lateral (
    select g::date as local_date,
           public.cycle_local_instant(g::date, r.time_of_day, r.time_zone) as scheduled_at
    from generate_series(
      greatest(r.definition_from, (p_from at time zone r.time_zone)::date - 1),
      least(coalesce(r.end_date, 'infinity'::date), (p_to at time zone r.time_zone)::date + 1),
      interval '1 day') g
  ) o
  where o.scheduled_at >= p_from and o.scheduled_at < p_to
    -- Owners who have agreed to the current research terms only.
    and public.agreed_to_current_terms(r.owner_id)
    and (p_after_at is null or (o.scheduled_at, r.id) > (p_after_at, p_after_routine))
    and not exists (
      select 1 from public.supplement_taken t
      where t.routine_id = r.id and t.occurrence_key = r.id::text || ':' || to_char(o.local_date, 'YYYY-MM-DD'))
  order by o.scheduled_at, r.id
  limit p_limit;
end;
$$;

revoke all on function public.due_supplement_occurrences(timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.due_supplement_occurrences(timestamptz, timestamptz, timestamptz, uuid, integer) to service_role;
