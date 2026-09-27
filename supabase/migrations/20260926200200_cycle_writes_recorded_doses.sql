-- S12: save_cycle() counts recorded doses. Same signature, arguments,
-- result, refusals and grants as 20260926180100_cycle_writes.sql (read its
-- header for the full contract); only the checks that decide what an edit
-- may change now use the plan's schedule WITH its recorded doses, exactly as
-- the app does (src/lib/cycles/revise.ts with confirmations):
--   * the effective date rule: the revision takes over a plan at the seam
--     (the start of effective_from in the new zone). None of the plan's
--     occurrences so far (across its revisions, every-N-days doses re-timed
--     from recorded actual times: cycle_plan_occurrences) at or after the
--     seam may be due or confirmed; and every occurrence the new revision
--     gets, with the recorded doses, must be ahead and unconfirmed unless it
--     is one the plan already had before the seam (same key).
--   * a plan that has started (any occurrence so far due or confirmed) is
--     never dropped.
-- A saved edit that adds a revision advances schedule_version on every plan
-- of the cycle, so queued reminders (S13) recheck their occurrences.
-- Confirmations (confirm_dose) lock the same cycle row, so an edit and a
-- confirmation of one cycle never interleave. An edit then locks all the
-- cycle's plans by id before updating any, as save_mixture does (lock order:
-- 20260926200100_dose_confirmation.sql).
--
-- Refusal SQLSTATEs as before:
--   42501 not an acknowledged researcher      22023 invalid cycle
--   AP003 unknown peptide     AP007 peptide no longer offered
--   AP008 unknown template    AP009 the edit would change the past
--   AP010 the cycle changed since it was opened (stale version)

create or replace function public.save_cycle(
  p_name text,
  p_goal text,
  p_baseline text,
  p_time_zone text,
  p_plans jsonb,
  p_template_id uuid default null,
  p_cycle_id uuid default null,
  p_version integer default null
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
  v_prev_zone text;
  v_rev uuid;
  v_seam timestamptz;
  v_conf jsonb;
  v_template_peptides uuid[] := '{}';
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
  v_times jsonb;
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
    if p_version is not null then
      raise exception 'a new cycle has no version' using errcode = '22023';
    end if;
    if p_template_id is not null then
      select t.* into v_template from public.cycle_templates t where t.id = p_template_id for share;
      if not found then
        raise exception 'unknown template' using errcode = 'AP008';
      end if;
      -- The copy may keep these even when no longer offered.
      v_template_peptides := array(
        select pl.peptide_id from public.cycle_template_plans pl where pl.template_id = p_template_id);
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
    -- Every plan of the cycle, by id, before any is updated: the order
    -- save_mixture locks plans in (20260926200100_dose_confirmation.sql).
    perform 1 from public.cycle_plans cp where cp.cycle_id = v_cycle.id order by cp.id for no key update;
    if p_template_id is not null then
      raise exception 'the template is fixed when a cycle is created' using errcode = '22023';
    end if;
    if p_version is distinct from v_cycle.version then
      raise exception 'the cycle changed since it was opened' using errcode = 'AP010';
    end if;
    v_cycle_id := v_cycle.id;
    v_number := v_cycle.current_revision + 1;
    select r.id, r.time_zone into v_prev_rev, v_prev_zone from public.cycle_revisions r
    where r.cycle_id = v_cycle_id and r.number = v_cycle.current_revision;
    update public.cycles c
    set name = v_name, goal = v_goal, baseline = v_baseline, version = c.version + 1,
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
      -- A new reference: the peptide must still be offered, unless it comes
      -- with the template being copied. A shared lock makes a concurrent
      -- withdrawal wait until this save commits.
      select p.available into v_available from public.peptides p where p.id = v_peptide_id for share;
      if not found then
        raise exception 'unknown peptide' using errcode = 'AP003';
      end if;
      if not v_available and not (v_peptide_id = any (v_template_peptides)) then
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
      v_times := coalesce(v_phase -> 'time_changes', '[]'::jsonb);
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
                       or (c ->> 'dose_mg') !~ v_decimal)
         or jsonb_typeof(v_times) <> 'array'
         or exists (select 1 from jsonb_array_elements(v_times) c
                    where jsonb_typeof(c) <> 'object'
                       or coalesce(c ->> 'from', '') !~ v_date
                       or jsonb_typeof(c -> 'local_time') is distinct from 'string') then
        raise exception 'invalid active phase' using errcode = '22023';
      end if;

      insert into public.cycle_revision_phases (
        revision_id, phase_id, plan_id, owner_id, kind, start_date, end_date,
        dose_mg, local_time, schedule_type, every_days, weekdays, dose_change_from, dose_change_mg,
        time_change_from, time_change_time
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
        array(select trim_scale((c ->> 'dose_mg')::numeric) from jsonb_array_elements(v_changes) with ordinality x(c, n) order by n),
        array(select (c ->> 'from')::date from jsonb_array_elements(v_times) with ordinality x(c, n) order by n),
        array(select c ->> 'local_time' from jsonb_array_elements(v_times) with ordinality x(c, n) order by n)
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
      -- running across it keeps its schedule, dose, time and earlier dose and
      -- time changes, and ends no earlier than the day before effective_from.
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
                     n.dose_change_from, n.dose_change_mg, n.time_change_from, n.time_change_time)
                    is distinct from
                    (p.end_date, p.dose_mg, p.local_time, p.schedule_type, p.every_days, p.weekdays,
                     p.dose_change_from, p.dose_change_mg, p.time_change_from, p.time_change_time))
            or (p.end_date >= v_effective
                and (n.end_date < v_effective - 1
                  or (n.dose_mg, n.local_time, n.schedule_type, n.every_days, n.weekdays)
                     is distinct from (p.dose_mg, p.local_time, p.schedule_type, p.every_days, p.weekdays)
                  or (select coalesce(jsonb_agg(jsonb_build_array(f, m) order by f), '[]'::jsonb)
                      from unnest(n.dose_change_from, n.dose_change_mg) x(f, m) where f < v_effective)
                     is distinct from
                     (select coalesce(jsonb_agg(jsonb_build_array(f, m) order by f), '[]'::jsonb)
                      from unnest(p.dose_change_from, p.dose_change_mg) x(f, m) where f < v_effective)
                  or (select coalesce(jsonb_agg(jsonb_build_array(f, t) order by f), '[]'::jsonb)
                      from unnest(n.time_change_from, n.time_change_time) x(f, t) where f < v_effective)
                     is distinct from
                     (select coalesce(jsonb_agg(jsonb_build_array(f, t) order by f), '[]'::jsonb)
                      from unnest(p.time_change_from, p.time_change_time) x(f, t) where f < v_effective))))
      ) then
        raise exception 'the edit would change phases already under way' using errcode = 'AP009';
      end if;
      -- The effective date rule (src/lib/cycles/revise.ts, with recorded
      -- doses): the revision takes over at the seam, the start of
      -- effective_from in the new zone. The plan's occurrences so far from
      -- the seam on are replaced, so none may be due or confirmed; and every
      -- occurrence the new revision gets must be ahead and unconfirmed,
      -- unless the plan already had it before the seam (same key). Every-N-
      -- days doses count from recorded actual times (cycle_plan_occurrences).
      v_seam := public.cycle_local_instant(v_effective, '00:00', p_time_zone);
      v_conf := public.dose_confirmations(v_plan_id);
      if exists (
        with so_far as (select o.* from public.cycle_plan_occurrences(v_plan_id, v_conf) o)
        select 1 from so_far h
        where h.scheduled_at >= v_seam and (h.actual_at is not null or h.scheduled_at <= now())
        union all
        select 1 from public.cycle_revision_plan_occurrences(v_rev, v_plan_id, v_conf) n
        where (n.actual_at is not null or n.scheduled_at <= now())
          and not exists (select 1 from so_far h where h.occurrence_key = n.occurrence_key and h.scheduled_at < v_seam)
      ) then
        raise exception 'a dose of this peptide is already due on the effective date' using errcode = 'AP009';
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
    -- A plan that has started (a dose due or recorded) is ended through its
    -- phases, never dropped.
    if exists (
      select 1
      from public.cycle_revision_plans rp
      cross join lateral public.cycle_plan_occurrences(rp.plan_id) o
      where rp.revision_id = v_prev_rev
        and not exists (select 1 from public.cycle_revision_plans n where n.revision_id = v_rev and n.plan_id = rp.plan_id)
        and (o.actual_at is not null or o.scheduled_at <= now())
    ) then
      raise exception 'a peptide that has started cannot be removed' using errcode = 'AP009';
    end if;

    if public.cycle_revision_content(v_rev) = public.cycle_revision_content(v_prev_rev) then
      -- Same schedule: keep the current revision.
      delete from public.cycle_revisions r where r.id = v_rev;
    else
      update public.cycles c set current_revision = v_number, updated_at = now() where c.id = v_cycle_id;
      update public.cycle_plans cp set schedule_version = cp.schedule_version + 1 where cp.cycle_id = v_cycle_id;
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
