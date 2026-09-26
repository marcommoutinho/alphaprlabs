-- Templates that name a withdrawn peptide stay editable (Marco, 2026-09-26,
-- tasks/research-app.md "Template and cycle decisions").
--
-- S8 (20260926170000_cycle_templates.sql, in production) refused to save a
-- template naming any peptide that is no longer offered, so the admin had
-- to remove it first. Now such a template can be edited and saved with the
-- peptide still in it (the editor keeps its warning); a peptide that is no
-- longer offered still cannot be ADDED to a template. Researchers copying it
-- get the peptide too (save_cycle(), 20260926180100_cycle_writes.sql).
--
-- save_cycle_template() is replaced with the same signature, grants and
-- behaviour except that one rule: a peptide that is no longer offered is
-- accepted when the template being edited already names it, and refused
-- (AP007) otherwise. Everything else is as in S8.

create or replace function public.save_cycle_template(
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
  -- The peptides the stored template names (none for a new template).
  v_kept uuid[] := '{}';
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
    v_kept := array(select pl.peptide_id from public.cycle_template_plans pl where pl.template_id = v_id);
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
    -- Kept when the template already names it; never newly added.
    if not v_available and not (v_peptide_id = any (v_kept)) then
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
