-- S8: cycle templates (A3), maintained by admins.
--
-- A template is a starting point researchers copy (S9). Its peptide plans hold
-- phases in RELATIVE days: offset_days is 0-based from the researcher's start
-- date (A3 "Starts on day" 1 = offset 0), length_days counts days. S9 turns
-- each phase into absolute dates from the researcher's chosen start date and
-- stores the result in a researcher-owned revision, so later template edits
-- never change a cycle already created from it (handoff Business Rule 6; plan
-- "Routine implementation rules").
--
-- Access model (deny by default):
--   * Reads: admins, and researchers (or admins) who have acknowledged the
--     disclaimer, may read every template, plan and phase. Templates are
--     supplied library content, not anyone's private record, and researchers
--     must read them to browse (S10 R6) and copy them (S9). A template that
--     includes a withdrawn peptide stays readable (R6 shows it with a warning
--     and blocks "Use as starting point"); the peptide row itself stays
--     hidden from researchers by the peptides policy, so its name is not
--     revealed. Unacknowledged researchers read nothing; anonymous callers
--     have no privilege at all.
--   * No direct writes through the API, for anyone. Admins create and edit
--     through save_cycle_template(), which checks is_admin() itself, and
--     replaces the template's plans and phases in one transaction. There is
--     no delete (the design has none).
--   * Validation (A3, in the app: src/lib/templates/rules.ts): a name, at
--     least one peptide, every peptide available, each phase with a start day
--     >= 1 and a length >= 1 ending by day 3660, active phases with a dose
--     > 0, one local time and every 1-365 days or at least one weekday, no
--     overlapping phases within a peptide, and at least one active phase per
--     peptide. The function enforces all of it again.
--   * Unavailable peptides: a peptide turned "Not offered" cannot be saved
--     into a template. Existing templates keep referring to it (nothing is
--     rewritten when the library changes), but, as designed, the admin must
--     remove it before that template can be saved again
--     ("Remove peptides that are no longer offered before saving.").
--   * A peptide appears at most once per template (its phases already allow
--     any number of active phases and breaks).
--
-- Refusal SQLSTATEs (see also 20260926160000_business_inventory.sql):
--   42501 not an admin        22023 invalid template
--   AP003 unknown peptide     AP007 peptide no longer offered

-- True for a canonical weekday set: 1-7 distinct days 0 (Sunday) to 6
-- (Saturday), ascending. Canonical so an unchanged template compares equal.
create function public.is_weekday_set(p_days smallint[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_days is not null
    and cardinality(p_days) between 1 and 7
    and array_position(p_days, null) is null
    and p_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    and p_days = array(select distinct d from unnest(p_days) d order by d);
$$;

revoke all on function public.is_weekday_set(smallint[]) from public, anon;
grant execute on function public.is_weekday_set(smallint[]) to authenticated, service_role;

create table public.cycle_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = public.trim_whitespace(name) and char_length(name) between 1 and 120),
  -- "Guidance shown with the template · optional": '' when not supplied.
  guidance text not null default '' check (guidance = public.trim_whitespace(guidance) and char_length(guidance) <= 4000),
  created_at timestamptz not null default now(),
  -- Moves only when the template's content actually changes.
  updated_at timestamptz not null default now()
);

create index cycle_templates_list_order on public.cycle_templates (created_at, id);

-- One peptide per plan, in the editor's order.
create table public.cycle_template_plans (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.cycle_templates (id) on delete cascade,
  peptide_id uuid not null references public.peptides (id),
  position integer not null check (position >= 0),
  constraint cycle_template_plans_position unique (template_id, position),
  constraint cycle_template_plans_peptide unique (template_id, peptide_id)
);

create index cycle_template_plans_peptide_idx on public.cycle_template_plans (peptide_id);

-- A phase in relative days. Breaks carry no dose or schedule.
create table public.cycle_template_phases (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.cycle_template_plans (id) on delete cascade,
  kind text not null check (kind in ('active', 'break')),
  offset_days integer not null check (offset_days >= 0),
  length_days integer not null check (length_days >= 1),
  -- Dose in mg, stored without trailing zeros.
  dose_mg numeric check (dose_mg > 0 and dose_mg = trim_scale(dose_mg)),
  -- One local time of day per phase, "HH:MM" (24-hour).
  local_time text check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  schedule_type text check (schedule_type in ('interval', 'weekdays')),
  every_days integer check (every_days between 1 and 365),
  -- 0 = Sunday ... 6 = Saturday (the handoff's data model).
  weekdays smallint[] check (weekdays is null or public.is_weekday_set(weekdays)),
  -- Ends by day 3660 (about ten years, the schedule engine's longest phase).
  constraint cycle_template_phases_span check (offset_days + length_days <= 3660),
  constraint cycle_template_phases_shape check (
    (kind = 'break' and dose_mg is null and local_time is null and schedule_type is null
      and every_days is null and weekdays is null)
    or (kind = 'active' and dose_mg is not null and local_time is not null and (
      (schedule_type = 'interval' and every_days is not null and weekdays is null)
      or (schedule_type = 'weekdays' and weekdays is not null and every_days is null)))
  ),
  constraint cycle_template_phases_start unique (plan_id, offset_days)
);

alter table public.cycle_templates enable row level security;
alter table public.cycle_template_plans enable row level security;
alter table public.cycle_template_phases enable row level security;

revoke all on table public.cycle_templates, public.cycle_template_plans, public.cycle_template_phases
  from public, anon, authenticated, service_role;
grant select on table public.cycle_templates, public.cycle_template_plans, public.cycle_template_phases
  to authenticated, service_role;

create policy cycle_templates_select on public.cycle_templates
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_acknowledged_researcher()));

create policy cycle_template_plans_select on public.cycle_template_plans
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_acknowledged_researcher()));

create policy cycle_template_phases_select on public.cycle_template_phases
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_acknowledged_researcher()));

-- ── A template's content, for change detection ─────────────────────────────
-- Name, guidance, and the plans in order with their phases by start day,
-- without row ids. Two saves with the same content give equal values.
-- Internal: not callable through the API.
create function public.cycle_template_content(p_template_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', t.name,
    'guidance', t.guidance,
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'peptide_id', pl.peptide_id,
        'phases', coalesce((
          select jsonb_agg(to_jsonb(ph) - 'id' - 'plan_id' order by ph.offset_days)
          from public.cycle_template_phases ph
          where ph.plan_id = pl.id
        ), '[]'::jsonb)
      ) order by pl.position)
      from public.cycle_template_plans pl
      where pl.template_id = t.id
    ), '[]'::jsonb)
  )
  from public.cycle_templates t
  where t.id = p_template_id;
$$;

revoke all on function public.cycle_template_content(uuid) from public, anon, authenticated;

-- ── Admin: create or edit a template ───────────────────────────────────────
-- p_id null (the default) creates a template; otherwise replaces that
-- template's name, guidance, plans and phases. Returns the template id, or
-- null when p_id names no template. updated_at moves only when the content
-- actually changed. Concurrent saves of one template run one after the other
-- (the row is locked first), so a template is always exactly one save's
-- content, never a mix.
--
-- p_plans, in the editor's order:
--   [{ "peptide_id": uuid,
--      "phases": [
--        { "kind": "active", "offset_days": 0, "length_days": 28,
--          "dose_mg": "0.4", "local_time": "08:00",
--          "schedule_type": "interval", "every_days": 5 },
--        { "kind": "active", ..., "schedule_type": "weekdays", "weekdays": [1, 3, 5] },
--        { "kind": "break", "offset_days": 28, "length_days": 7 } ] }]
-- dose_mg is a decimal string (dot as the decimal point); weekdays are sorted
-- and distinct. Fields a phase's kind or schedule does not use are ignored.
-- Refusals: see the header. Nothing is stored when any part is refused.
create function public.save_cycle_template(
  p_name text,
  p_guidance text,
  p_plans jsonb,
  p_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := public.trim_whitespace(coalesce(p_name, ''));
  v_guidance text := public.trim_whitespace(coalesce(p_guidance, ''));
  v_id uuid;
  v_before jsonb;
  v_plan jsonb;
  v_phase jsonb;
  v_position integer := 0;
  v_plan_id uuid;
  v_peptide_id uuid;
  v_available boolean;
  v_kind text;
  v_schedule text;
  v_dose text;
  v_constraint text;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'name required' using errcode = '22023';
  end if;
  if p_plans is null or jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) = 0 then
    raise exception 'a template needs at least one peptide' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.cycle_templates (name, guidance)
    values (v_name, v_guidance)
    returning id into v_id;
  else
    select t.id into v_id from public.cycle_templates t where t.id = p_id for update;
    if v_id is null then
      return null;
    end if;
    v_before := public.cycle_template_content(v_id);
    update public.cycle_templates t set name = v_name, guidance = v_guidance where t.id = v_id;
    delete from public.cycle_template_plans pl where pl.template_id = v_id;
  end if;

  for v_plan in select e.value from jsonb_array_elements(p_plans) with ordinality e order by e.ordinality loop
    if jsonb_typeof(v_plan) <> 'object'
       or jsonb_typeof(v_plan -> 'phases') is distinct from 'array'
       or coalesce(v_plan ->> 'peptide_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid peptide plan' using errcode = '22023';
    end if;
    v_peptide_id := (v_plan ->> 'peptide_id')::uuid;

    -- Shared lock: a concurrent withdrawal waits until this save commits.
    select p.available into v_available from public.peptides p where p.id = v_peptide_id for share;
    if not found then
      raise exception 'unknown peptide' using errcode = 'AP003';
    end if;
    if not v_available then
      raise exception 'peptide no longer offered' using errcode = 'AP007';
    end if;

    insert into public.cycle_template_plans (template_id, peptide_id, position)
    values (v_id, v_peptide_id, v_position)
    returning id into v_plan_id;
    v_position := v_position + 1;

    for v_phase in select e.value from jsonb_array_elements(v_plan -> 'phases') e loop
      if jsonb_typeof(v_phase) <> 'object'
         or jsonb_typeof(v_phase -> 'offset_days') is distinct from 'number'
         or jsonb_typeof(v_phase -> 'length_days') is distinct from 'number'
         or (v_phase ->> 'offset_days') !~ '^[0-9]{1,5}$'
         or (v_phase ->> 'length_days') !~ '^[0-9]{1,5}$' then
        raise exception 'invalid phase days' using errcode = '22023';
      end if;
      v_kind := v_phase ->> 'kind';
      if v_kind = 'break' then
        insert into public.cycle_template_phases (plan_id, kind, offset_days, length_days)
        values (v_plan_id, 'break', (v_phase ->> 'offset_days')::integer, (v_phase ->> 'length_days')::integer);
        continue;
      end if;
      if v_kind is distinct from 'active' then
        raise exception 'invalid phase kind' using errcode = '22023';
      end if;

      -- A plain positive decimal (no NaN, Infinity, exponent or sign).
      v_dose := v_phase ->> 'dose_mg';
      v_schedule := v_phase ->> 'schedule_type';
      if jsonb_typeof(v_phase -> 'dose_mg') is distinct from 'string'
         or char_length(v_dose) > 30
         or v_dose !~ '^[0-9]*\.?[0-9]+$'
         or jsonb_typeof(v_phase -> 'local_time') is distinct from 'string'
         or (v_schedule = 'interval' and ((v_phase ->> 'every_days') !~ '^[0-9]{1,3}$'
              or jsonb_typeof(v_phase -> 'every_days') is distinct from 'number'))
         or (v_schedule = 'weekdays' and (jsonb_typeof(v_phase -> 'weekdays') is distinct from 'array'
              or exists (select 1 from jsonb_array_elements(v_phase -> 'weekdays') d
                         where jsonb_typeof(d) <> 'number' or d::text !~ '^[0-6]$')))
         or v_schedule is null or v_schedule not in ('interval', 'weekdays') then
        raise exception 'invalid active phase' using errcode = '22023';
      end if;

      insert into public.cycle_template_phases (
        plan_id, kind, offset_days, length_days, dose_mg, local_time, schedule_type, every_days, weekdays
      ) values (
        v_plan_id,
        'active',
        (v_phase ->> 'offset_days')::integer,
        (v_phase ->> 'length_days')::integer,
        trim_scale(v_dose::numeric),
        v_phase ->> 'local_time',
        v_schedule,
        case when v_schedule = 'interval' then (v_phase ->> 'every_days')::integer end,
        case when v_schedule = 'weekdays' then
          array(select d::text::smallint from jsonb_array_elements(v_phase -> 'weekdays') d)
        end
      );
    end loop;

    -- Phases in a peptide must not overlap.
    if exists (
      select 1
      from (
        select ph.offset_days,
               lag(ph.offset_days + ph.length_days) over (order by ph.offset_days) as previous_end
        from public.cycle_template_phases ph
        where ph.plan_id = v_plan_id
      ) x
      where x.previous_end > x.offset_days
    ) then
      raise exception 'phases overlap' using errcode = '22023';
    end if;
    -- Each peptide needs at least one active phase.
    if not exists (
      select 1 from public.cycle_template_phases ph where ph.plan_id = v_plan_id and ph.kind = 'active'
    ) then
      raise exception 'each peptide needs an active phase' using errcode = '22023';
    end if;
  end loop;

  if p_id is not null and v_before is distinct from public.cycle_template_content(v_id) then
    update public.cycle_templates t set updated_at = now() where t.id = v_id;
  end if;
  return v_id;
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'cycle_template_plans_peptide' then
      raise exception 'a peptide can appear once per template' using errcode = '22023';
    elsif v_constraint = 'cycle_template_phases_start' then
      raise exception 'phases overlap' using errcode = '22023';
    end if;
    raise;
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid template: %', sqlerrm using errcode = '22023';
end;
$$;

revoke all on function public.save_cycle_template(text, text, jsonb, uuid) from public, anon;
grant execute on function public.save_cycle_template(text, text, jsonb, uuid) to authenticated;

-- ── Admin: how many researcher cycles were started from each template ──────
-- A3 lists "N researcher cycle(s) were started from it — they won't change."
-- Counts only: no researcher or cycle is identified.
--
-- Contract for S9: researcher cycles do not exist yet, so every count is 0.
-- The slice that adds cycles (S9) CREATE OR REPLACEs this function, keeping
-- its signature, admin check, one row per template and its grants, to count
-- the cycles created from each template.
create function public.admin_cycle_template_usage()
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
    select t.id, 0::bigint
    from public.cycle_templates t;
end;
$$;

revoke all on function public.admin_cycle_template_usage() from public, anon;
grant execute on function public.admin_cycle_template_usage() to authenticated;

-- ── Library reference counts now count templates (S4 contract) ─────────────
-- Same signature, admin check, one row per entry and grants as S4's
-- placeholder. template_count: distinct templates whose plans name the entry.
-- cycle_count stays 0 until S9 replaces this function again for cycles.
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
           0::bigint
    from public.peptides p;
end;
$$;
