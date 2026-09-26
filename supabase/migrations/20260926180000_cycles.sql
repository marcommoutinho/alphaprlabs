-- S9: researcher cycles (R2, R3, R4 data), with preserved plan revisions.
--
-- A cycle belongs to one researcher (every admin is also a researcher) and
-- holds peptide plans; each plan has dated phases in the cycle's named IANA
-- time zone (plan D4: stored, never silently replaced by the phone's zone).
--
-- Records:
--   cycles                  name, goal, optional baseline, and, when copied
--                           from a template, that template's id plus a
--                           SNAPSHOT of its name, guidance and version
--                           (updated_at) at copy time. Later admin edits to
--                           the template never change the cycle (handoff
--                           Business Rule 6); its plans were copied too.
--   cycle_plans             one row per peptide plan ever added. Its id is
--                           the engine's stable planId (a uuid: no ":").
--   cycle_revisions         the schedule as saved, numbered 1, 2, ... per
--                           cycle, each with the time zone it schedules in.
--                           Never edited or deleted: an edit adds the next
--                           revision; cycles.current_revision names the
--                           latest. created_at is when it took effect.
--   cycle_revision_plans    which plans a revision holds, in the builder's
--                           order, and effective_from: the first local date
--                           this revision schedules for that plan (null in
--                           revision 1 and for a plan it adds on creation).
--   cycle_revision_phases   a plan's dated phases in that revision. phase_id
--                           is the engine's stable phaseId (a uuid) and is
--                           KEPT across revisions for the same phase.
--
-- Key stability (S12 confirmations use the engine's occurrence keys,
-- planId:phaseId:index for every N days, planId:phaseId:YYYY-MM-DD for fixed
-- weekdays). An edit changes the schedule from a plan's effective_from date
-- on; before it, every phase is carried over unchanged with the same ids:
--   * a phase that ended before effective_from: identical;
--   * a phase running across it: same id, kind and start; only its end may
--     move (not before effective_from - 1) and, for an active phase, a dose
--     change from effective_from on may be added (dose_change_*). Its time
--     and schedule stay, so an every-N-days rhythm continues (Marco,
--     2026-09-26). The app turns a time, schedule or kind change into this
--     phase ending the day before plus a new phase (new id) from then;
--   * phases starting on or after effective_from, and new phases, are free,
--     but may not start before it.
-- So every occurrence before effective_from keeps its key and time, and
-- confirmations recorded against it stay attached. save_cycle() (next
-- migration) enforces all of this; the app (src/lib/cycles) chooses
-- effective_from so only doses still in the future change.
--
-- Access model (deny by default), per the S4 grant rules
-- (20260926150000_support_grants.sql):
--   * Reads: public.can_read_researcher(owner_id) on every table: the owner,
--     or an admin holding that owner's active support grant. The admin role
--     alone reads nothing; revoking denies the next read. owner_id is kept on
--     every table (composite foreign keys keep it equal to the cycle's).
--   * Writes: none through the API, for anyone (service_role included).
--     save_cycle() creates and edits, and applies
--     public.can_write_researcher(owner) itself: only the acknowledged owner,
--     never a grant.
--   * Peptides: a researcher may also read an entry that is no longer
--     offered when one of THEIR OWN cycles refers to it (policy below). The
--     S4 available-only rule is unchanged for everything else.
--   * Counts: admin_cycle_template_usage() and library_reference_counts()
--     now count cycles, admin-only and as numbers only.

-- ── Helpers ────────────────────────────────────────────────────────────────

-- True for a time zone name PostgreSQL knows (IANA names such as
-- "America/Toronto"), in the shape of a name: POSIX-style specifications
-- like "XYZ+3", which AT TIME ZONE would also accept, are refused.
create function public.is_time_zone(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_name is not null
    and char_length(p_name) <= 64
    and p_name ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'
    and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_name);
$$;

revoke all on function public.is_time_zone(text) from public, anon;
grant execute on function public.is_time_zone(text) to authenticated, service_role;

-- An active phase's dose changes: parallel arrays of local dates and doses
-- (mg), each date after the phase start and on or before its end, ascending
-- and distinct; each dose > 0 without trailing zeros. At most 100.
create function public.cycle_dose_changes_valid(p_from date[], p_mg numeric[], p_start date, p_end date)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_from is not null and p_mg is not null
    and cardinality(p_from) = cardinality(p_mg)
    and cardinality(p_from) <= 100
    and array_position(p_from, null) is null
    and array_position(p_mg, null) is null
    and not exists (select 1 from unnest(p_mg) m where m <= 0 or m <> trim_scale(m))
    and not exists (select 1 from unnest(p_from) f where f <= p_start or f > p_end)
    and p_from = array(select distinct f from unnest(p_from) f order by f);
$$;

revoke all on function public.cycle_dose_changes_valid(date[], numeric[], date, date) from public, anon;
grant execute on function public.cycle_dose_changes_valid(date[], numeric[], date, date) to authenticated, service_role;

-- ── Tables ─────────────────────────────────────────────────────────────────

create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (name = public.trim_whitespace(name) and char_length(name) between 1 and 120),
  -- R3 "Goal" (required): results are reviewed against it.
  goal text not null check (goal = public.trim_whitespace(goal) and char_length(goal) between 1 and 500),
  -- "Starting baseline · optional": '' when not supplied.
  baseline text not null default '' check (baseline = public.trim_whitespace(baseline) and char_length(baseline) <= 500),
  -- The template it was copied from, with a snapshot of the template as it
  -- was then (its guidance travels with the copy). '' / null when custom.
  template_id uuid references public.cycle_templates (id),
  template_name text not null default '',
  template_guidance text not null default '',
  template_updated_at timestamptz,
  current_revision integer not null default 1 check (current_revision >= 1),
  created_at timestamptz not null default now(),
  -- Moves when a save changes anything.
  updated_at timestamptz not null default now(),
  constraint cycles_template_snapshot check (
    (template_id is null and template_name = '' and template_guidance = '' and template_updated_at is null)
    or (template_id is not null and template_name <> '' and template_updated_at is not null)
  ),
  constraint cycles_owner unique (id, owner_id)
);

create index cycles_by_owner on public.cycles (owner_id, created_at, id);
create index cycles_by_template on public.cycles (template_id) where template_id is not null;

create table public.cycle_plans (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null,
  owner_id uuid not null,
  -- Fixed for the plan's life: a plan IS one peptide's timeline.
  peptide_id uuid not null references public.peptides (id),
  created_at timestamptz not null default now(),
  constraint cycle_plans_cycle foreign key (cycle_id, owner_id) references public.cycles (id, owner_id) on delete cascade,
  constraint cycle_plans_identity unique (id, cycle_id, peptide_id)
);

create index cycle_plans_by_cycle on public.cycle_plans (cycle_id);
create index cycle_plans_by_peptide on public.cycle_plans (peptide_id, owner_id);

create table public.cycle_revisions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null,
  owner_id uuid not null,
  number integer not null check (number >= 1),
  -- The IANA zone this revision schedules in (is_time_zone() checked on save).
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  created_at timestamptz not null default now(),
  constraint cycle_revisions_cycle foreign key (cycle_id, owner_id) references public.cycles (id, owner_id) on delete cascade,
  constraint cycle_revisions_number unique (cycle_id, number),
  constraint cycle_revisions_identity unique (id, cycle_id, owner_id)
);

create table public.cycle_revision_plans (
  revision_id uuid not null,
  plan_id uuid not null,
  cycle_id uuid not null,
  owner_id uuid not null,
  peptide_id uuid not null,
  position integer not null check (position between 0 and 19),
  effective_from date,
  primary key (revision_id, plan_id),
  constraint cycle_revision_plans_revision foreign key (revision_id, cycle_id, owner_id)
    references public.cycle_revisions (id, cycle_id, owner_id) on delete cascade,
  constraint cycle_revision_plans_plan foreign key (plan_id, cycle_id, peptide_id)
    references public.cycle_plans (id, cycle_id, peptide_id) on delete cascade,
  constraint cycle_revision_plans_position unique (revision_id, position),
  -- A peptide appears once per cycle revision.
  constraint cycle_revision_plans_peptide unique (revision_id, peptide_id),
  constraint cycle_revision_plans_identity unique (revision_id, plan_id, owner_id)
);

create index cycle_revision_plans_by_plan on public.cycle_revision_plans (plan_id);

create table public.cycle_revision_phases (
  revision_id uuid not null,
  phase_id uuid not null,
  plan_id uuid not null,
  owner_id uuid not null,
  kind text not null check (kind in ('active', 'break')),
  -- First and last local dates, inclusive (the engine's limits).
  start_date date not null check (start_date >= date '2000-01-01'),
  end_date date not null check (end_date <= date '2100-12-31'),
  -- Dose in mg, stored without trailing zeros.
  dose_mg numeric check (dose_mg > 0 and dose_mg = trim_scale(dose_mg)),
  -- One local time of day per phase, "HH:MM" (24-hour).
  local_time text check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  schedule_type text check (schedule_type in ('interval', 'weekdays')),
  every_days integer check (every_days between 1 and 365),
  -- 0 = Sunday ... 6 = Saturday.
  weekdays smallint[] check (weekdays is null or public.is_weekday_set(weekdays)),
  -- Dose changes within the phase (the engine's doseChanges): the dose from
  -- each date on. Only added by an edit, never before its effective date.
  dose_change_from date[] not null default '{}',
  dose_change_mg numeric[] not null default '{}',
  primary key (revision_id, phase_id),
  constraint cycle_revision_phases_plan foreign key (revision_id, plan_id, owner_id)
    references public.cycle_revision_plans (revision_id, plan_id, owner_id) on delete cascade,
  constraint cycle_revision_phases_dates check (end_date >= start_date and end_date - start_date < 3660),
  constraint cycle_revision_phases_shape check (
    (kind = 'break' and dose_mg is null and local_time is null and schedule_type is null
      and every_days is null and weekdays is null
      and cardinality(dose_change_from) = 0 and cardinality(dose_change_mg) = 0)
    or (kind = 'active' and dose_mg is not null and local_time is not null
      and public.cycle_dose_changes_valid(dose_change_from, dose_change_mg, start_date, end_date)
      and ((schedule_type = 'interval' and every_days is not null and weekdays is null)
        or (schedule_type = 'weekdays' and weekdays is not null and every_days is null)))
  ),
  constraint cycle_revision_phases_start unique (revision_id, plan_id, start_date)
);

-- ── Access ─────────────────────────────────────────────────────────────────

alter table public.cycles enable row level security;
alter table public.cycle_plans enable row level security;
alter table public.cycle_revisions enable row level security;
alter table public.cycle_revision_plans enable row level security;
alter table public.cycle_revision_phases enable row level security;

revoke all on table public.cycles, public.cycle_plans, public.cycle_revisions,
  public.cycle_revision_plans, public.cycle_revision_phases
  from public, anon, authenticated, service_role;
grant select on table public.cycles, public.cycle_plans, public.cycle_revisions,
  public.cycle_revision_plans, public.cycle_revision_phases
  to authenticated, service_role;

create policy cycles_select on public.cycles
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy cycle_plans_select on public.cycle_plans
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy cycle_revisions_select on public.cycle_revisions
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy cycle_revision_plans_select on public.cycle_revision_plans
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy cycle_revision_phases_select on public.cycle_revision_phases
  for select to authenticated using (public.can_read_researcher(owner_id));

-- The S4 peptides note: a researcher still sees an entry that is no longer
-- offered when one of their OWN cycles (any revision) refers to it. Nothing
-- wider: not other people's cycles, not through a support grant, not for
-- unacknowledged accounts. Permissive, so ORed with the available-only rule.
create policy peptides_research_select_own_cycles on public.peptides
  for select to authenticated
  using (
    (select public.is_acknowledged_researcher())
    and exists (
      select 1 from public.cycle_plans cp
      where cp.peptide_id = peptides.id and cp.owner_id = (select auth.uid())
    )
  );

-- ── A revision's schedule, for change detection ────────────────────────────
-- The zone, and the plans in order with their phases by start date,
-- including their ids. Two equal values schedule identically. Internal.
create function public.cycle_revision_content(p_revision_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'time_zone', r.time_zone,
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', rp.plan_id,
        'phases', coalesce((
          select jsonb_agg(to_jsonb(ph) - 'revision_id' - 'plan_id' - 'owner_id' order by ph.start_date)
          from public.cycle_revision_phases ph
          where ph.revision_id = r.id and ph.plan_id = rp.plan_id
        ), '[]'::jsonb)
      ) order by rp.position)
      from public.cycle_revision_plans rp
      where rp.revision_id = r.id
    ), '[]'::jsonb)
  )
  from public.cycle_revisions r
  where r.id = p_revision_id;
$$;

revoke all on function public.cycle_revision_content(uuid) from public, anon, authenticated;

-- ── Admin counts now include cycles (S4 and S8 contracts) ──────────────────
-- Same signatures, admin checks, one row per template / entry, and grants.
-- Numbers only: no researcher or cycle is identified.

-- A3 "N researcher cycle(s) were started from it": cycles copied from it.
create or replace function public.admin_cycle_template_usage()
returns table (template_id uuid, cycle_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select t.id, (select count(*) from public.cycles c where c.template_id = t.id)::bigint
    from public.cycle_templates t;
end;
$$;

revoke all on function public.admin_cycle_template_usage() from public, anon;
grant execute on function public.admin_cycle_template_usage() to authenticated;

-- A2 "referenced by N": distinct templates, and distinct researcher cycles
-- with a plan for the entry in any revision (their history keeps it).
create or replace function public.library_reference_counts()
returns table (peptide_id uuid, template_count bigint, cycle_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select p.id,
           (select count(distinct pl.template_id) from public.cycle_template_plans pl where pl.peptide_id = p.id)::bigint,
           (select count(distinct cp.cycle_id) from public.cycle_plans cp where cp.peptide_id = p.id)::bigint
    from public.peptides p;
end;
$$;

revoke all on function public.library_reference_counts() from public, anon;
grant execute on function public.library_reference_counts() to authenticated;
