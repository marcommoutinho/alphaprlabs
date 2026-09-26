-- S9: creating and editing a cycle (R3), the only write path.
--
-- save_cycle() creates a cycle (p_cycle_id null) with revision 1, or edits
-- one: the name, goal and baseline change in place, and a changed schedule
-- (time zone or plans) is stored as the NEXT revision, leaving every earlier
-- revision as it was. A save that changes no schedule adds no revision.
--
-- The app validates first (src/lib/cycles: the R3 messages, the engine, and
-- the choice of each plan's effective date so only doses still in the future
-- change). This function re-checks every structural rule on its own:
--   * the caller: public.can_write_researcher(owner), i.e. the owner, with
--     the disclaimer acknowledged. A support grant never writes. Editing a
--     cycle the caller does not own returns null, like a missing cycle.
--   * name 1-120, goal 1-500, baseline <= 500 characters (trimmed), a time
--     zone PostgreSQL knows (is_time_zone), 1-20 plans, a peptide once per
--     revision, 1-100 phases per plan, dates 2000-01-01 to 2100-12-31, a
--     phase at most 3660 days, active phases with a dose > 0, one local time
--     and every 1-365 days or 1-7 weekdays, no overlapping phases, at least
--     one active phase per plan.
--   * new references: a plan added (on creation or by an edit) needs a
--     peptide that is still offered; a template being copied must exist and
--     offer every peptide it names. Existing plans keep their peptide even
--     after it is withdrawn.
--   * edits: p_revision must be the cycle's current revision (else AP010:
--     someone saved in between). Each plan carries effective_from, between
--     today and today + 2 in the new time zone, and the rules in the header
--     of 20260926180000_cycles.sql hold (else AP009): earlier phases carried
--     over with their ids, nothing new before effective_from, and a plan that
--     has started (a phase before today) is never dropped.
--
-- p_plans, in the builder's order:
--   [{ "plan_id": uuid | null,            -- null: a new plan
--      "peptide_id": uuid,
--      "effective_from": "YYYY-MM-DD" | null,   -- edits only
--      "phases": [
--        { "phase_id": uuid | null,       -- null: a new phase
--          "kind": "active", "start_date": "2026-10-01", "end_date": "2026-10-28",
--          "dose_mg": "0.4", "local_time": "08:00",
--          "schedule_type": "interval", "every_days": 5,
--          "dose_changes": [{ "from": "2026-10-15", "dose_mg": "0.5" }] },
--        { ..., "schedule_type": "weekdays", "weekdays": [1, 3, 5] },
--        { "phase_id": null, "kind": "break", "start_date": ..., "end_date": ... } ] }]
-- Decimals are strings with a dot. Returns the cycle id, or null (see above).
--
-- Refusal SQLSTATEs (see also 20260926170000_cycle_templates.sql):
--   42501 not an acknowledged researcher      22023 invalid cycle
--   AP003 unknown peptide     AP007 peptide no longer offered
--   AP008 unknown template    AP009 the edit would change the past
--   AP010 the cycle changed since it was opened (stale revision)

create function public.save_cycle(
  p_name text,
  p_goal text,
  p_baseline text,
  p_time_zone text,
  p_plans jsonb,
  p_template_id uuid default null,
  p_cycle_id uuid default null,
  p_revision integer default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := public.trim_whitespace(coalesce(p_name, ''));
  v_goal text := public.trim_whitespace(coalesce(p_goal, ''));
  v_baseline text := public.trim_whitespace(coalesce(p_baseline, ''));
  v_editing boolean := p_cycle_id is not null;
  v_cycle public.cycles%rowtype;
  v_cycle_id uuid;
  v_template public.cycle_templates%rowtype;
  v_prev_rev uuid;
  v_rev uuid;
  v_number integer := 1;
  v_today date;
  v_plan jsonb;
  v_phase jsonb;
  v_position integer := 0;
  v_plan_id uuid;
  v_peptide_id uuid;
  v_known_peptide uuid;
  v_available boolean;
  v_effective date;
  v_phase_id uuid;
  v_kind text;
  v_schedule text;
  v_dose text;
  v_changes jsonb;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_date constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_decimal constant text := '^[0-9]*\.?[0-9]+$';
  v_constraint text;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_name = '' or v_goal = '' then
    raise exception 'name and goal required' using errcode = '22023';
  end if;
  if not public.is_time_zone(p_time_zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  if p_plans is null or jsonb_typeof(p_plans) <> 'array'
     or jsonb_array_length(p_plans) not between 1 and 20 then
    raise exception 'a cycle needs 1 to 20 peptides' using errcode = '22023';
  end if;
  v_today := (now() at time zone p_time_zone)::date;

  if not v_editing then
    if p_revision is not null then
      raise exception 'a new cycle has no revision' using errcode = '22023';
    end if;
    if p_template_id is not null then
      select t.* into v_template from public.cycle_templates t where t.id = p_template_id for share;
      if not found then
        raise exception 'unknown template' using errcode = 'AP008';
      end if;
      if exists (
        select 1 from public.cycle_template_plans pl join public.peptides p on p.id = pl.peptide_id
        where pl.template_id = p_template_id and not p.available
      ) then
        raise exception 'template includes a peptide no longer offered' using errcode = 'AP007';
      end if;
    end if;
    insert into public.cycles (owner_id, name, goal, baseline, template_id, template_name, template_guidance, template_updated_at)
    values (v_uid, v_name, v_goal, v_baseline, v_template.id, coalesce(v_template.name, ''),
            coalesce(v_template.guidance, ''), v_template.updated_at)
    returning id into v_cycle_id;
  else
    select c.* into v_cycle from public.cycles c where c.id = p_cycle_id for update;
    if not found or not public.can_write_researcher(v_cycle.owner_id) then
      return null;
    end if;
    if p_template_id is not null then
      raise exception 'the template is fixed when a cycle is created' using errcode = '22023';
    end if;
    if p_revision is distinct from v_cycle.current_revision then
      raise exception 'the cycle changed since it was opened' using errcode = 'AP010';
    end if;
    v_cycle_id := v_cycle.id;
    v_number := v_cycle.current_revision + 1;
    select r.id into v_prev_rev from public.cycle_revisions r
    where r.cycle_id = v_cycle_id and r.number = v_cycle.current_revision;
    update public.cycles c
    set name = v_name, goal = v_goal, baseline = v_baseline,
        updated_at = case when (c.name, c.goal, c.baseline) is distinct from (v_name, v_goal, v_baseline)
                          then now() else c.updated_at end
    where c.id = v_cycle_id;
  end if;

  insert into public.cycle_revisions (cycle_id, owner_id, number, time_zone)
  values (v_cycle_id, v_uid, v_number, p_time_zone)
  returning id into v_rev;

  for v_plan in select e.value from jsonb_array_elements(p_plans) with ordinality e order by e.ordinality loop
    if jsonb_typeof(v_plan) <> 'object'
       or jsonb_typeof(v_plan -> 'phases') is distinct from 'array'
       or jsonb_array_length(v_plan -> 'phases') not between 1 and 100
       or coalesce(v_plan ->> 'peptide_id', '') !~* v_uuid
       or (jsonb_typeof(v_plan -> 'plan_id') <> 'null' and coalesce(v_plan ->> 'plan_id', '') !~* v_uuid)
       or (jsonb_typeof(v_plan -> 'effective_from') <> 'null' and coalesce(v_plan ->> 'effective_from', '') !~ v_date) then
      raise exception 'invalid peptide plan' using errcode = '22023';
    end if;
    v_peptide_id := (v_plan ->> 'peptide_id')::uuid;
    v_plan_id := (v_plan ->> 'plan_id')::uuid;
    v_effective := (v_plan ->> 'effective_from')::date;

    if v_editing <> (v_effective is not null) then
      raise exception 'effective_from is required for edits only' using errcode = '22023';
    end if;
    if v_editing and v_effective not between v_today and v_today + 2 then
      raise exception 'changes must start today or later' using errcode = 'AP009';
    end if;

    if v_plan_id is null then
      -- A new reference: the peptide must still be offered. A shared lock
      -- makes a concurrent withdrawal wait until this save commits.
      select p.available into v_available from public.peptides p where p.id = v_peptide_id for share;
      if not found then
        raise exception 'unknown peptide' using errcode = 'AP003';
      end if;
      if not v_available then
        raise exception 'peptide no longer offered' using errcode = 'AP007';
      end if;
      insert into public.cycle_plans (cycle_id, owner_id, peptide_id)
      values (v_cycle_id, v_uid, v_peptide_id)
      returning id into v_plan_id;
    else
      select rp.peptide_id into v_known_peptide from public.cycle_revision_plans rp
      where rp.revision_id = v_prev_rev and rp.plan_id = v_plan_id;
      if v_known_peptide is null or v_known_peptide <> v_peptide_id then
        raise exception 'unknown plan' using errcode = '22023';
      end if;
    end if;

    insert into public.cycle_revision_plans (revision_id, plan_id, cycle_id, owner_id, peptide_id, position, effective_from)
    values (v_rev, v_plan_id, v_cycle_id, v_uid, v_peptide_id, v_position, v_effective);
    v_position := v_position + 1;

    for v_phase in select e.value from jsonb_array_elements(v_plan -> 'phases') e loop
      if jsonb_typeof(v_phase) <> 'object'
         or (jsonb_typeof(v_phase -> 'phase_id') <> 'null' and coalesce(v_phase ->> 'phase_id', '') !~* v_uuid)
         or coalesce(v_phase ->> 'start_date', '') !~ v_date
         or coalesce(v_phase ->> 'end_date', '') !~ v_date then
        raise exception 'invalid phase' using errcode = '22023';
      end if;
      v_phase_id := (v_phase ->> 'phase_id')::uuid;
      if v_phase_id is null then
        v_phase_id := gen_random_uuid();
      elsif not exists (
        select 1 from public.cycle_revision_phases p
        where p.revision_id = v_prev_rev and p.plan_id = v_plan_id and p.phase_id = v_phase_id
      ) then
        -- Ids are the database's: a phase keeps its id within its own plan only.
        raise exception 'unknown phase' using errcode = '22023';
      end if;

      v_kind := v_phase ->> 'kind';
      if v_kind = 'break' then
        insert into public.cycle_revision_phases (revision_id, phase_id, plan_id, owner_id, kind, start_date, end_date)
        values (v_rev, v_phase_id, v_plan_id, v_uid, 'break',
                (v_phase ->> 'start_date')::date, (v_phase ->> 'end_date')::date);
        continue;
      end if;
      if v_kind is distinct from 'active' then
        raise exception 'invalid phase kind' using errcode = '22023';
      end if;

      v_dose := v_phase ->> 'dose_mg';
      v_schedule := v_phase ->> 'schedule_type';
      v_changes := coalesce(v_phase -> 'dose_changes', '[]'::jsonb);
      if jsonb_typeof(v_phase -> 'dose_mg') is distinct from 'string'
         or char_length(v_dose) > 30
         or v_dose !~ v_decimal
         or jsonb_typeof(v_phase -> 'local_time') is distinct from 'string'
         or v_schedule is null or v_schedule not in ('interval', 'weekdays')
         or (v_schedule = 'interval' and ((v_phase ->> 'every_days') !~ '^[0-9]{1,3}$'
              or jsonb_typeof(v_phase -> 'every_days') is distinct from 'number'))
         or (v_schedule = 'weekdays' and (jsonb_typeof(v_phase -> 'weekdays') is distinct from 'array'
              or exists (select 1 from jsonb_array_elements(v_phase -> 'weekdays') d
                         where jsonb_typeof(d) <> 'number' or d::text !~ '^[0-6]$')))
         or jsonb_typeof(v_changes) <> 'array'
         or exists (select 1 from jsonb_array_elements(v_changes) c
                    where jsonb_typeof(c) <> 'object'
                       or coalesce(c ->> 'from', '') !~ v_date
                       or jsonb_typeof(c -> 'dose_mg') is distinct from 'string'
                       or char_length(c ->> 'dose_mg') > 30
                       or (c ->> 'dose_mg') !~ v_decimal) then
        raise exception 'invalid active phase' using errcode = '22023';
      end if;

      insert into public.cycle_revision_phases (
        revision_id, phase_id, plan_id, owner_id, kind, start_date, end_date,
        dose_mg, local_time, schedule_type, every_days, weekdays, dose_change_from, dose_change_mg
      ) values (
        v_rev, v_phase_id, v_plan_id, v_uid, 'active',
        (v_phase ->> 'start_date')::date, (v_phase ->> 'end_date')::date,
        trim_scale(v_dose::numeric),
        v_phase ->> 'local_time',
        v_schedule,
        case when v_schedule = 'interval' then (v_phase ->> 'every_days')::integer end,
        case when v_schedule = 'weekdays' then
          array(select d::text::smallint from jsonb_array_elements(v_phase -> 'weekdays') d)
        end,
        array(select (c ->> 'from')::date from jsonb_array_elements(v_changes) with ordinality x(c, n) order by n),
        array(select trim_scale((c ->> 'dose_mg')::numeric) from jsonb_array_elements(v_changes) with ordinality x(c, n) order by n)
      );
    end loop;

    -- Phases in a plan must not overlap (dates are inclusive).
    if exists (
      select 1 from (
        select ph.start_date, lag(ph.end_date) over (order by ph.start_date) as previous_end
        from public.cycle_revision_phases ph
        where ph.revision_id = v_rev and ph.plan_id = v_plan_id
      ) x
      where x.previous_end >= x.start_date
    ) then
      raise exception 'phases overlap' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.cycle_revision_phases ph
      where ph.revision_id = v_rev and ph.plan_id = v_plan_id and ph.kind = 'active'
    ) then
      raise exception 'each peptide needs an active phase' using errcode = '22023';
    end if;

    if v_editing then
      -- Every phase that began before effective_from is carried over with its
      -- id, kind and start. One that ended before it is identical; one
      -- running across it keeps its time, schedule, dose and earlier dose
      -- changes, and ends no earlier than the day before effective_from.
      if exists (
        select 1
        from public.cycle_revision_phases p
        left join public.cycle_revision_phases n
          on n.revision_id = v_rev and n.plan_id = v_plan_id and n.phase_id = p.phase_id
        where p.revision_id = v_prev_rev and p.plan_id = v_plan_id and p.start_date < v_effective
          and (n.phase_id is null
            or n.kind <> p.kind
            or n.start_date <> p.start_date
            or (p.end_date < v_effective
                and (n.end_date, n.dose_mg, n.local_time, n.schedule_type, n.every_days, n.weekdays,
                     n.dose_change_from, n.dose_change_mg)
                    is distinct from
                    (p.end_date, p.dose_mg, p.local_time, p.schedule_type, p.every_days, p.weekdays,
                     p.dose_change_from, p.dose_change_mg))
            or (p.end_date >= v_effective
                and (n.end_date < v_effective - 1
                  or (n.dose_mg, n.local_time, n.schedule_type, n.every_days, n.weekdays)
                     is distinct from (p.dose_mg, p.local_time, p.schedule_type, p.every_days, p.weekdays)
                  or (select coalesce(jsonb_agg(jsonb_build_array(f, m) order by f), '[]'::jsonb)
                      from unnest(n.dose_change_from, n.dose_change_mg) x(f, m) where f < v_effective)
                     is distinct from
                     (select coalesce(jsonb_agg(jsonb_build_array(f, m) order by f), '[]'::jsonb)
                      from unnest(p.dose_change_from, p.dose_change_mg) x(f, m) where f < v_effective))))
      ) then
        raise exception 'the edit would change phases already under way' using errcode = 'AP009';
      end if;
      -- Anything else starts on or after effective_from.
      if exists (
        select 1 from public.cycle_revision_phases n
        where n.revision_id = v_rev and n.plan_id = v_plan_id and n.start_date < v_effective
          and not exists (
            select 1 from public.cycle_revision_phases p
            where p.revision_id = v_prev_rev and p.plan_id = v_plan_id
              and p.phase_id = n.phase_id and p.start_date < v_effective)
      ) then
        raise exception 'new phases start on or after the effective date' using errcode = 'AP009';
      end if;
    end if;
  end loop;

  if v_editing then
    -- A plan that has started is ended through its phases, never dropped.
    if exists (
      select 1
      from public.cycle_revision_plans rp
      join public.cycle_revision_phases p on p.revision_id = rp.revision_id and p.plan_id = rp.plan_id
      where rp.revision_id = v_prev_rev and p.start_date < v_today
        and not exists (select 1 from public.cycle_revision_plans n where n.revision_id = v_rev and n.plan_id = rp.plan_id)
    ) then
      raise exception 'a peptide that has started cannot be removed' using errcode = 'AP009';
    end if;

    if public.cycle_revision_content(v_rev) = public.cycle_revision_content(v_prev_rev) then
      -- Same schedule: keep the current revision.
      delete from public.cycle_revisions r where r.id = v_rev;
    else
      update public.cycles c set current_revision = v_number, updated_at = now() where c.id = v_cycle_id;
    end if;
  end if;
  return v_cycle_id;
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception 'invalid cycle: %', coalesce(nullif(v_constraint, ''), sqlerrm) using errcode = '22023';
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range
       or invalid_datetime_format or datetime_field_overflow or foreign_key_violation then
    raise exception 'invalid cycle: %', sqlerrm using errcode = '22023';
end;
$$;

revoke all on function public.save_cycle(text, text, text, text, jsonb, uuid, uuid, integer) from public, anon;
grant execute on function public.save_cycle(text, text, text, text, jsonb, uuid, uuid, integer) to authenticated;
