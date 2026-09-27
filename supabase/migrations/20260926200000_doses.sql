-- S12: recorded doses (R1 Today, R5 confirmation) and the database's own copy
-- of the S7 schedule, so the confirmation and cycle-edit functions judge
-- occurrences from the stored plan and the recorded doses, never from times a
-- client sends.
--
-- Records:
--   dose_records              one actual administration per occurrence:
--                             owner, cycle, plan, peptide, phase and the
--                             engine's occurrence key (planId:phaseId:
--                             index|date); the scheduled time and planned dose
--                             as the server computed them at confirmation;
--                             actual_at, and recorded_at (the server's clock,
--                             never before actual_at); the exact amount,
--                             optional site and notes; the plan's saved-
--                             mixture setup at the ACTUAL time (Marco,
--                             2026-09-26); and the client's unique request
--                             key, so a retry returns the recorded dose.
--                             Append-only (handoff Business Rule 9).
--   personal_vial_deductions  the estimate a recorded dose took from the open
--                             personal vial of that mixture, only while supply
--                             tracking is on, with the estimate before and
--                             after. Below zero, the dose is still recorded
--                             and stock_discrepancy is true. At most one per
--                             dose.
--   cycle_plans.schedule_version  + 1 whenever the plan's schedule may have
--                             changed: a recorded dose of the plan (it can
--                             move later every-N-days doses) or a saved edit
--                             of its cycle that added a revision.
--
-- For S13 (the reminder dispatcher), before sending a reminder or follow-up
-- for an occurrence, recheck:
--   1. no dose_records row exists for (plan_id, occurrence_key): a recorded
--      dose stops every reminder for it;
--   2. cycle_plans.schedule_version still equals the version the reminder
--      was queued with; if not, recompute the occurrence with
--      public.cycle_plan_occurrences(plan_id) (below; service role) and
--      requeue or drop it: an edit or an earlier dose may have moved or
--      removed it, or changed its planned dose;
--   3. the payload's mg and syringe units are computed at send time from the
--      current occurrence and the plan's current mixture, and the tap opens
--      /app/today?dose=<occurrence key>, which shows the current details
--      and refuses a confirmation made from details that changed (AP020).
-- The app badge counts doses awaiting confirmation (src/lib/doses/today.ts).
--
-- The schedule functions below port src/lib/schedule/engine.ts and
-- src/lib/cycles/schedule.ts step for step and must agree with them
-- (tests/integration/dose-parity.test.ts). Internal (and the service role).
--
-- Access (deny by default), per the S4 grant rules:
--   * Reads: public.can_read_researcher(owner_id): the owner, or an admin
--     holding the owner's active support grant.
--   * Writes: none through the API. public.confirm_dose() (next migration)
--     records a dose and its deduction for the acknowledged owner only.

-- ── Shared keys for composite references ────────────────────────────────────

alter table public.cycle_plans
  add constraint cycle_plans_cycle_owner_peptide unique (id, cycle_id, owner_id, peptide_id),
  add column schedule_version integer not null default 1 check (schedule_version >= 1);

alter table public.mixture_versions
  add constraint mixture_versions_owner unique (id, owner_id);

-- ── Tables ─────────────────────────────────────────────────────────────────

-- R5's injection sites; '' when not given.
create function public.is_dose_site(p_site text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_site in ('', 'Abdomen L', 'Abdomen R', 'Thigh L', 'Thigh R', 'Other');
$$;

revoke all on function public.is_dose_site(text) from public, anon;
grant execute on function public.is_dose_site(text) to authenticated, service_role;

create table public.dose_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  cycle_id uuid not null,
  plan_id uuid not null,
  peptide_id uuid not null,
  phase_id uuid not null,
  occurrence_key text not null,
  -- The occurrence as the server scheduled it when the dose was confirmed.
  scheduled_at timestamptz not null,
  planned_mg numeric not null check (planned_mg > 0 and planned_mg = trim_scale(planned_mg)),
  actual_at timestamptz not null,
  recorded_at timestamptz not null,
  amount_mg numeric not null check (amount_mg > 0 and amount_mg <= 100000 and amount_mg = trim_scale(amount_mg)),
  site text not null default '' check (public.is_dose_site(site)),
  notes text not null default '' check (notes = public.trim_whitespace(notes) and char_length(notes) <= 1000),
  -- The plan's saved-mixture setup at actual_at; null when it had none then.
  mixture_version_id uuid,
  request_key uuid not null,
  constraint dose_records_times check (actual_at <= recorded_at),
  constraint dose_records_key_shape check (
    occurrence_key ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}:([0-9]{1,6}|[0-9]{4}-[0-9]{2}-[0-9]{2})$'
    and split_part(occurrence_key, ':', 1) = plan_id::text
    and split_part(occurrence_key, ':', 2) = phase_id::text
  ),
  constraint dose_records_plan foreign key (plan_id, cycle_id, owner_id, peptide_id)
    references public.cycle_plans (id, cycle_id, owner_id, peptide_id) on delete cascade,
  constraint dose_records_mixture foreign key (mixture_version_id, owner_id)
    references public.mixture_versions (id, owner_id),
  -- One recorded dose per occurrence; one per confirmation request.
  constraint dose_records_occurrence unique (plan_id, occurrence_key),
  constraint dose_records_request unique (request_key),
  constraint dose_records_owner unique (id, owner_id)
);

create index dose_records_by_owner on public.dose_records (owner_id, recorded_at);
create index dose_records_by_cycle on public.dose_records (cycle_id);

create table public.personal_vial_deductions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  dose_id uuid not null,
  vial_id uuid not null,
  amount_mg numeric not null check (amount_mg > 0 and amount_mg = trim_scale(amount_mg)),
  -- The vial's estimated contents before and after this dose (may go below 0).
  remaining_before_mg numeric not null,
  remaining_after_mg numeric not null,
  stock_discrepancy boolean generated always as (remaining_after_mg < 0) stored,
  recorded_at timestamptz not null,
  constraint personal_vial_deductions_math check (remaining_after_mg = remaining_before_mg - amount_mg),
  constraint personal_vial_deductions_dose foreign key (dose_id, owner_id)
    references public.dose_records (id, owner_id) on delete cascade,
  constraint personal_vial_deductions_vial foreign key (vial_id, owner_id)
    references public.personal_vials (id, owner_id) on delete cascade,
  constraint personal_vial_deductions_one unique (dose_id)
);

create index personal_vial_deductions_by_vial on public.personal_vial_deductions (vial_id);
create index personal_vial_deductions_by_owner on public.personal_vial_deductions (owner_id);

alter table public.dose_records enable row level security;
alter table public.personal_vial_deductions enable row level security;

revoke all on table public.dose_records, public.personal_vial_deductions
  from public, anon, authenticated, service_role;
grant select on table public.dose_records, public.personal_vial_deductions to authenticated, service_role;

create policy dose_records_select on public.dose_records
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy personal_vial_deductions_select on public.personal_vial_deductions
  for select to authenticated using (public.can_read_researcher(owner_id));

-- ── The schedule, as the engine computes it ────────────────────────────────

-- One occurrence of a plan (engine Occurrence): its key, phase, scheduled
-- instant (the recorded snapshot once confirmed), zone, local date, planned
-- dose, and actual time when a dose was recorded.
create type public.cycle_occurrence as (
  occurrence_key text,
  phase_id uuid,
  scheduled_at timestamptz,
  time_zone text,
  local_date date,
  dose_mg numeric,
  actual_at timestamptz
);

-- The instant of a wall-clock date-time (seconds included) in a zone, by the
-- engine's rule, as cycle_local_instant(): a time in a spring-forward gap
-- moves forward by the gap; a repeated time uses the earlier instant.
create function public.cycle_wall_instant(p_wall timestamp, p_time_zone text)
returns timestamptz
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
           when ((x.at - interval '1 hour') at time zone p_time_zone) = p_wall then x.at - interval '1 hour'
           when ((x.at - interval '30 minutes') at time zone p_time_zone) = p_wall then x.at - interval '30 minutes'
           else x.at
         end
  from (select p_wall at time zone p_time_zone as at) x;
$$;

-- Every N days: the intended wall-clock time N days after an anchor, at the
-- latest time change dated after the anchor's date and on or before the new
-- date, if any (the engine's nextWall).
create function public.cycle_interval_next_wall(p_phase public.cycle_revision_phases, p_anchor timestamp)
returns timestamp
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    (select n.next::date + x.t::time
     from unnest(p_phase.time_change_from, p_phase.time_change_time) x(f, t)
     where x.f > p_anchor::date and x.f <= n.next::date
     order by x.f desc
     limit 1),
    n.next)
  from (select p_anchor + make_interval(days => p_phase.every_days) as next) n;
$$;

-- An every-N-days phase's occurrences (the engine's intervalDrafts, step for
-- step). Confirmations replay in recording order (equal instants together):
-- at each recording, occurrences already due and the one confirmed freeze at
-- their time; later ones re-anchor on actual times, never earlier than a
-- newer confirmed dose. Unconfirmed ones past the phase end are dropped.
-- p_confirmations: [{key, actual_at, recorded_at, scheduled_at?}]; keys
-- p_prefix || index apply. A confirmed one keeps its recorded scheduled_at.
create function public.cycle_interval_slots(
  p_phase public.cycle_revision_phases,
  p_time_zone text,
  p_prefix text,
  p_confirmations jsonb
)
returns table (occurrence_key text, scheduled_at timestamptz, actual_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_limit constant integer := 20000;
  v_start timestamp;
  v_end date := p_phase.end_date;
  -- This phase's confirmations, by recording instant, then index.
  c_idx integer[];
  c_actual timestamptz[];
  c_rec timestamptz[];
  c_sched timestamptz[];
  n integer;
  -- By index + 1: frozen slots, and the applied confirmation's position in c_*.
  fz boolean[] := '{}';
  fz_at timestamptz[] := '{}';
  fz_wall timestamp[] := '{}';
  ap integer[] := '{}';
  v_lowest integer := 0;
  v_max_applied integer := -1;
  lb_at timestamptz; -- latestBelow
  lb_wall timestamp;
  ref_at timestamptz;
  ref_wall timestamp;
  lat_at timestamptz;
  lat_wall timestamp;
  s_at timestamptz;
  s_wall timestamp;
  v_frozen boolean;
  v_outside boolean;
  v_at timestamptz;
  g_start integer;
  g_end integer;
  v_max_target integer;
  v_target integer;
  tf_idx integer[];
  tf_at timestamptz[];
  tf_wall timestamp[];
  acc integer[];
  i integer;
  j integer;
  k integer;
  p integer;
  v_last_fixed integer;
begin
  if p_phase.kind is distinct from 'active' or p_phase.schedule_type is distinct from 'interval' then
    return;
  end if;
  v_start := p_phase.start_date + p_phase.local_time::time;

  select array_agg(x.idx order by x.rec, x.idx), array_agg(x.actual order by x.rec, x.idx),
         array_agg(x.rec order by x.rec, x.idx), array_agg(x.sched order by x.rec, x.idx)
  into c_idx, c_actual, c_rec, c_sched
  from (
    select case when substr(c.key, char_length(p_prefix) + 1) ~ '^(0|[1-9][0-9]{0,5})$'
                then substr(c.key, char_length(p_prefix) + 1)::integer end as idx,
           c.actual_at as actual, c.recorded_at as rec, c.scheduled_at as sched
    from jsonb_to_recordset(coalesce(p_confirmations, '[]'::jsonb))
      as c(key text, actual_at timestamptz, recorded_at timestamptz, scheduled_at timestamptz)
    where starts_with(c.key, p_prefix)
  ) x
  where x.idx is not null and x.idx < c_limit;
  n := coalesce(array_length(c_idx, 1), 0);

  i := 1;
  while i <= n loop
    g_start := i;
    v_at := c_rec[i];
    while i <= n and c_rec[i] = v_at loop
      i := i + 1;
    end loop;
    g_end := i - 1;
    v_max_target := (select max(c_idx[q]) from generate_series(g_start, g_end) q);
    tf_idx := '{}';
    tf_at := '{}';
    tf_wall := '{}';
    acc := '{}';
    -- Confirming an occurrence already frozen (an old open dose) keeps its time.
    for p in g_start .. g_end loop
      if c_idx[p] < v_lowest then
        acc := acc || p;
      end if;
    end loop;

    -- The current schedule from v_lowest upward.
    lat_at := lb_at;
    lat_wall := lb_wall;
    ref_at := null;
    ref_wall := null;
    if v_lowest > 0 then
      p := ap[v_lowest];
      if p is not null then
        ref_at := c_actual[p];
        ref_wall := c_actual[p] at time zone p_time_zone;
      else
        ref_at := fz_at[v_lowest];
        ref_wall := fz_wall[v_lowest];
      end if;
    end if;
    k := v_lowest;
    loop
      if k >= c_limit then
        raise exception 'phase % has too many occurrences', p_phase.phase_id using errcode = '22023';
      end if;
      v_frozen := coalesce(fz[k + 1], false);
      if v_frozen then
        s_at := fz_at[k + 1];
        s_wall := fz_wall[k + 1];
      else
        s_wall := case when ref_at is null then v_start
                       else public.cycle_interval_next_wall(p_phase, case when lat_at > ref_at then lat_wall else ref_wall end) end;
        s_at := public.cycle_wall_instant(s_wall, p_time_zone);
      end if;
      v_target := null;
      for p in g_start .. g_end loop
        if c_idx[p] = k then
          v_target := p;
        end if;
      end loop;
      v_outside := not v_frozen and s_wall::date > v_end;
      -- Already due when this was recorded, or being confirmed now: keep its time.
      if not v_frozen and not v_outside and (v_target is not null or s_at <= v_at) then
        tf_idx := tf_idx || k;
        tf_at := tf_at || s_at;
        tf_wall := tf_wall || s_wall;
      end if;
      -- A confirmation past the phase matches nothing.
      if v_target is not null and not v_outside then
        acc := acc || v_target;
      end if;
      exit when not v_frozen and k > v_max_applied and (v_outside or (k >= v_max_target and s_at > v_at));
      p := ap[k + 1];
      if p is not null then
        ref_at := c_actual[p];
        ref_wall := c_actual[p] at time zone p_time_zone;
        if lat_at is null or not (lat_at > ref_at) then
          lat_at := ref_at;
          lat_wall := ref_wall;
        end if;
      else
        ref_at := s_at;
        ref_wall := s_wall;
      end if;
      k := k + 1;
    end loop;

    for j in 1 .. coalesce(array_length(tf_idx, 1), 0) loop
      fz[tf_idx[j] + 1] := true;
      fz_at[tf_idx[j] + 1] := tf_at[j];
      fz_wall[tf_idx[j] + 1] := tf_wall[j];
    end loop;
    foreach p in array acc loop
      ap[c_idx[p] + 1] := p;
      v_max_applied := greatest(v_max_applied, c_idx[p]);
      if c_idx[p] < v_lowest and (lb_at is null or not (lb_at > c_actual[p])) then
        lb_at := c_actual[p];
        lb_wall := c_actual[p] at time zone p_time_zone;
      end if;
    end loop;
    while coalesce(fz[v_lowest + 1], false) loop
      p := ap[v_lowest + 1];
      if p is not null and (lb_at is null or not (lb_at > c_actual[p])) then
        lb_at := c_actual[p];
        lb_wall := c_actual[p] at time zone p_time_zone;
      end if;
      v_lowest := v_lowest + 1;
    end loop;
  end loop;

  -- The frozen history, then the live rhythm to the phase end.
  v_last_fixed := greatest(-1, v_max_applied, coalesce(array_upper(fz, 1) - 1, -1));
  for k in 0 .. v_lowest - 1 loop
    p := ap[k + 1];
    occurrence_key := p_prefix || k;
    scheduled_at := coalesce(case when p is not null then c_sched[p] end, fz_at[k + 1]);
    actual_at := case when p is not null then c_actual[p] end;
    return next;
  end loop;

  lat_at := lb_at;
  lat_wall := lb_wall;
  ref_at := null;
  ref_wall := null;
  if v_lowest > 0 then
    p := ap[v_lowest];
    if p is not null then
      ref_at := c_actual[p];
      ref_wall := c_actual[p] at time zone p_time_zone;
    else
      ref_at := fz_at[v_lowest];
      ref_wall := fz_wall[v_lowest];
    end if;
  end if;
  k := v_lowest;
  loop
    if k >= c_limit then
      raise exception 'phase % has too many occurrences', p_phase.phase_id using errcode = '22023';
    end if;
    v_frozen := coalesce(fz[k + 1], false);
    if v_frozen then
      s_at := fz_at[k + 1];
      s_wall := fz_wall[k + 1];
    else
      s_wall := case when ref_at is null then v_start
                     else public.cycle_interval_next_wall(p_phase, case when lat_at > ref_at then lat_wall else ref_wall end) end;
      s_at := public.cycle_wall_instant(s_wall, p_time_zone);
    end if;
    p := ap[k + 1];
    -- Frozen and confirmed doses are always kept; a live dose past the end is
    -- dropped, and once past every frozen or confirmed index, so is the rest.
    if v_frozen or p is not null or s_wall::date <= v_end then
      occurrence_key := p_prefix || k;
      scheduled_at := coalesce(case when p is not null then c_sched[p] end, s_at);
      actual_at := case when p is not null then c_actual[p] end;
      return next;
    elsif k > v_last_fixed then
      exit;
    end if;
    if p is not null then
      ref_at := c_actual[p];
      ref_wall := c_actual[p] at time zone p_time_zone;
      if lat_at is null or not (lat_at > ref_at) then
        lat_at := ref_at;
        lat_wall := ref_wall;
      end if;
    else
      ref_at := s_at;
      ref_wall := s_wall;
    end if;
    k := k + 1;
  end loop;
end;
$$;

-- One phase's occurrences (the engine's drafts): every N days above, fixed
-- weekdays on each selected weekday at the time in effect that date
-- (cycle_phase_instants). A confirmed occurrence keeps the scheduled time
-- recorded with it. The dose is the one in effect on the local date.
create function public.cycle_phase_occurrences(
  p_phase public.cycle_revision_phases,
  p_time_zone text,
  p_plan_id uuid,
  p_confirmations jsonb
)
returns setof public.cycle_occurrence
language sql
stable
set search_path = ''
as $$
  with prefix as (
    select p_plan_id::text || ':' || p_phase.phase_id::text || ':' as value
  ),
  slots as (
    select s.occurrence_key, s.scheduled_at, s.actual_at
    from prefix, public.cycle_interval_slots(p_phase, p_time_zone, prefix.value, p_confirmations) s
    where p_phase.kind = 'active' and p_phase.schedule_type = 'interval'
    union all
    select prefix.value || i.key, coalesce(c.scheduled_at, i.planned_at), c.actual_at
    from prefix
    cross join public.cycle_phase_instants(p_phase, p_time_zone, p_phase.start_date, p_phase.end_date) i
    left join jsonb_to_recordset(coalesce(p_confirmations, '[]'::jsonb))
      as c(key text, actual_at timestamptz, recorded_at timestamptz, scheduled_at timestamptz)
      on c.key = prefix.value || i.key
    where p_phase.kind = 'active' and p_phase.schedule_type = 'weekdays'
  )
  select s.occurrence_key, p_phase.phase_id, s.scheduled_at, p_time_zone, d.local_date,
         coalesce((select x.m from unnest(p_phase.dose_change_from, p_phase.dose_change_mg) x(f, m)
                   where x.f <= d.local_date order by x.f desc limit 1), p_phase.dose_mg),
         s.actual_at
  from slots s
  cross join lateral (select (s.scheduled_at at time zone p_time_zone)::date as local_date) d;
$$;

-- One revision's occurrences for one plan (the engine on that revision's
-- plan, in its zone), unsorted.
create function public.cycle_revision_plan_occurrences(p_revision_id uuid, p_plan_id uuid, p_confirmations jsonb)
returns setof public.cycle_occurrence
language sql
stable
set search_path = ''
as $$
  select o.*
  from public.cycle_revisions r
  join public.cycle_revision_phases ph on ph.revision_id = r.id and ph.plan_id = p_plan_id
  cross join lateral public.cycle_phase_occurrences(ph, r.time_zone, p_plan_id, p_confirmations) o
  where r.id = p_revision_id;
$$;

-- A plan's recorded doses as the engine's confirmations.
create function public.dose_confirmations(p_plan_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', d.occurrence_key, 'actual_at', d.actual_at,
           'recorded_at', d.recorded_at, 'scheduled_at', d.scheduled_at) order by d.recorded_at, d.occurrence_key),
         '[]'::jsonb)
  from public.dose_records d
  where d.plan_id = p_plan_id;
$$;

-- A plan's occurrences across its cycle's revisions up to the current one
-- (src/lib/cycles/schedule.ts planOccurrences): revision 1 schedules the plan
-- whole; each later revision takes over at its seam (the start of the plan's
-- effective_from in that revision's zone): occurrences before the seam keep
-- their earlier version, every other key is the new revision's. A revision
-- that drops the plan keeps its occurrences before that revision's creation.
-- p_confirmations: the plan's recorded doses when null. Sorted by time, key.
-- Definer: only service_role may call it, and the helpers stay internal.
create function public.cycle_plan_occurrences(p_plan_id uuid, p_confirmations jsonb default null)
returns setof public.cycle_occurrence
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conf jsonb := coalesce(p_confirmations, public.dose_confirmations(p_plan_id));
  v_cycle uuid;
  v_current integer;
  v_seen boolean := false;
  v_in_previous boolean := false;
  v_so_far public.cycle_occurrence[] := '{}';
  v_fresh public.cycle_occurrence[];
  v_seam timestamptz;
  r record;
begin
  select cp.cycle_id, c.current_revision into v_cycle, v_current
  from public.cycle_plans cp join public.cycles c on c.id = cp.cycle_id
  where cp.id = p_plan_id;
  if v_cycle is null then
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

revoke all on function public.cycle_wall_instant(timestamp, text) from public, anon, authenticated;
revoke all on function public.cycle_interval_next_wall(public.cycle_revision_phases, timestamp) from public, anon, authenticated;
revoke all on function public.cycle_interval_slots(public.cycle_revision_phases, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cycle_phase_occurrences(public.cycle_revision_phases, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cycle_revision_plan_occurrences(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dose_confirmations(uuid) from public, anon, authenticated;
revoke all on function public.cycle_plan_occurrences(uuid, jsonb) from public, anon, authenticated;
-- S13's dispatcher (server-only, secret key) rechecks occurrences with this.
grant execute on function public.cycle_plan_occurrences(uuid, jsonb) to service_role;
