-- S12: confirming a dose (R1 "Taken", R5 "Mark Taken"), the only write path
-- for recorded doses (tables in 20260926200000_doses.sql).
--
-- confirm_dose() records one administration for the caller's own plan, in one
-- transaction with its optional personal-vial deduction and the plan's
-- schedule_version bump (S13 rechecks queued reminders against both):
--   * the caller: public.can_write_researcher(owner): the owner, with the
--     disclaimer acknowledged. A support grant never writes. A plan that is
--     not the caller's (or does not exist) returns null, like a missing one.
--   * the occurrence: its key must be an occurrence of the plan in the
--     CURRENT schedule, recomputed here from the stored revisions and the
--     plan's recorded doses (cycle_plan_occurrences), never from times the
--     client sends (else AP017); not yet confirmed (else AP018); and dated
--     today or earlier in its zone (a later day's dose can't be confirmed
--     yet: AP019).
--   * stale screens and notifications: the caller passes the scheduled time
--     and planned dose it showed; if either differs from the current
--     occurrence (the plan was edited, or an earlier dose moved it), nothing
--     is recorded (AP020) and the app shows the current details.
--   * the actual time: now when not given; never after the server's clock
--     (AP021); not more than a day before the planned time (AP022, a typo
--     guard). recorded_at is the server's clock.
--   * the amount: a plain positive decimal up to 100,000 mg (22023); site one
--     of R5's (is_dose_site) and notes up to 1,000 characters (22023).
--   * the mixture snapshot: the plan's saved-mixture setup at the ACTUAL
--     time (plan_mixture_version_at; Marco, 2026-09-26).
--   * the deduction: only while supply tracking is on, from the open vial of
--     the snapshot's mixture, the full amount taken. An estimate below zero
--     is recorded with stock_discrepancy = true; it never blocks the dose.
--   * idempotency: p_request_key is unique per confirmation request. The
--     same key again (a retry, a double tap) returns the recorded result
--     with "replayed": true and records nothing more. Confirmations of one
--     cycle, and its edits (save_cycle), are serialized by the cycle row.
--
-- Returns the recorded dose as JSON (amounts as exact decimal strings):
--   { id, cycle_id, plan_id, occurrence_key, scheduled_at, planned_mg,
--     actual_at, recorded_at, amount_mg, site, notes, mixture_version_id,
--     replayed, deduction: null | { vial_id, vial_label, amount_mg,
--     remaining_before_mg, remaining_after_mg, stock_discrepancy } }
--
-- Refusal SQLSTATEs (see also 20260926190100_mixture_writes.sql):
--   42501 not an acknowledged researcher      22023 invalid input, or a
--   request key reused for another occurrence
--   AP017 not an occurrence of the current schedule
--   AP018 already confirmed           AP019 not due yet (a later day)
--   AP020 the occurrence changed since it was shown
--   AP021 actual time in the future   AP022 actual time over a day early

-- The recorded dose as confirm_dose() returns it. Internal.
create function public.dose_result(p_dose_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id, 'cycle_id', d.cycle_id, 'plan_id', d.plan_id, 'occurrence_key', d.occurrence_key,
    'scheduled_at', d.scheduled_at, 'planned_mg', d.planned_mg::text,
    'actual_at', d.actual_at, 'recorded_at', d.recorded_at, 'amount_mg', d.amount_mg::text,
    'site', d.site, 'notes', d.notes, 'mixture_version_id', d.mixture_version_id,
    'replayed', p_replayed,
    'deduction', (
      select jsonb_build_object(
        'vial_id', x.vial_id, 'vial_label', v.label, 'amount_mg', x.amount_mg::text,
        'remaining_before_mg', x.remaining_before_mg::text, 'remaining_after_mg', x.remaining_after_mg::text,
        'stock_discrepancy', x.stock_discrepancy)
      from public.personal_vial_deductions x
      join public.personal_vials v on v.id = x.vial_id
      where x.dose_id = d.id))
  from public.dose_records d
  where d.id = p_dose_id;
$$;

revoke all on function public.dose_result(uuid, boolean) from public, anon, authenticated;

create function public.confirm_dose(
  p_request_key uuid,
  p_occurrence_key text,
  p_seen_scheduled_at timestamptz,
  p_seen_dose_mg text,
  p_amount_mg text,
  p_actual_at timestamptz default null,
  p_site text default '',
  p_notes text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_plan public.cycle_plans%rowtype;
  v_existing public.dose_records%rowtype;
  v_occurrence public.cycle_occurrence;
  v_amount numeric := public.mixture_decimal(p_amount_mg);
  v_seen_dose numeric := public.mixture_decimal(p_seen_dose_mg);
  v_site text := coalesce(p_site, '');
  v_notes text := public.trim_whitespace(coalesce(p_notes, ''));
  v_now timestamptz;
  v_actual timestamptz;
  v_version uuid;
  v_vial public.personal_vials%rowtype;
  v_used numeric;
  v_dose_id uuid;
  v_key constant text := '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):'
                         '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):'
                         '(0|[1-9][0-9]{0,5}|[0-9]{4}-[0-9]{2}-[0-9]{2})$';
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_request_key is null or coalesce(p_occurrence_key, '') !~ v_key then
    raise exception 'invalid occurrence' using errcode = '22023';
  end if;

  select cp.* into v_plan from public.cycle_plans cp where cp.id = split_part(p_occurrence_key, ':', 1)::uuid;
  if not found or not public.can_write_researcher(v_plan.owner_id) then
    return null;
  end if;
  -- One confirmation or edit of this cycle at a time (save_cycle locks it too).
  perform 1 from public.cycles c where c.id = v_plan.cycle_id for update;

  -- A retry of a recorded request returns what was recorded.
  select d.* into v_existing from public.dose_records d where d.request_key = p_request_key;
  if found then
    if v_existing.owner_id <> v_uid or v_existing.occurrence_key <> p_occurrence_key then
      raise exception 'request key already used' using errcode = '22023';
    end if;
    return public.dose_result(v_existing.id, true);
  end if;
  if exists (select 1 from public.dose_records d where d.plan_id = v_plan.id and d.occurrence_key = p_occurrence_key) then
    raise exception 'already confirmed' using errcode = 'AP018';
  end if;

  if v_amount is null or v_amount <= 0 or v_amount > 100000
     or not public.is_dose_site(v_site) or char_length(v_notes) > 1000
     or p_seen_scheduled_at is null or v_seen_dose is null then
    raise exception 'invalid confirmation' using errcode = '22023';
  end if;

  select o.* into v_occurrence
  from public.cycle_plan_occurrences(v_plan.id) o
  where o.occurrence_key = p_occurrence_key;
  if not found then
    raise exception 'not an occurrence of the current schedule' using errcode = 'AP017';
  end if;
  if v_occurrence.actual_at is not null then
    raise exception 'already confirmed' using errcode = 'AP018';
  end if;

  v_now := clock_timestamp();
  if v_occurrence.local_date > (v_now at time zone v_occurrence.time_zone)::date then
    raise exception 'not due yet' using errcode = 'AP019';
  end if;
  if v_occurrence.scheduled_at <> p_seen_scheduled_at or v_occurrence.dose_mg <> v_seen_dose then
    raise exception 'the occurrence changed since it was shown' using errcode = 'AP020';
  end if;
  v_actual := coalesce(p_actual_at, v_now);
  if v_actual > v_now then
    raise exception 'the actual time is in the future' using errcode = 'AP021';
  end if;
  if v_actual < v_occurrence.scheduled_at - interval '1 day' then
    raise exception 'the actual time is more than a day before the planned time' using errcode = 'AP022';
  end if;

  v_version := public.plan_mixture_version_at(v_plan.id, v_actual);
  insert into public.dose_records (
    owner_id, cycle_id, plan_id, peptide_id, phase_id, occurrence_key, scheduled_at, planned_mg,
    actual_at, recorded_at, amount_mg, site, notes, mixture_version_id, request_key
  ) values (
    v_uid, v_plan.cycle_id, v_plan.id, v_plan.peptide_id, v_occurrence.phase_id, p_occurrence_key,
    v_occurrence.scheduled_at, v_occurrence.dose_mg, v_actual, v_now, v_amount, v_site, v_notes,
    v_version, p_request_key
  )
  returning id into v_dose_id;

  -- The estimated deduction from the open vial of that mixture, while tracking is on.
  if v_version is not null
     and coalesce((select s.tracking_enabled from public.personal_supply_settings s where s.owner_id = v_uid), false) then
    select pv.* into v_vial
    from public.personal_vials pv
    where pv.owner_id = v_uid and pv.finished_at is null
      and pv.mixture_id = (select mv.mixture_id from public.mixture_versions mv where mv.id = v_version)
    for update;
    if found then
      select coalesce(sum(x.amount_mg), 0) into v_used from public.personal_vial_deductions x where x.vial_id = v_vial.id;
      insert into public.personal_vial_deductions (
        owner_id, dose_id, vial_id, amount_mg, remaining_before_mg, remaining_after_mg, recorded_at
      ) values (
        v_uid, v_dose_id, v_vial.id, v_amount, v_vial.strength_mg - v_used, v_vial.strength_mg - v_used - v_amount, v_now
      );
    end if;
  end if;

  -- Later every-N-days doses may have moved: queued reminders must recheck.
  update public.cycle_plans cp set schedule_version = cp.schedule_version + 1 where cp.id = v_plan.id;
  return public.dose_result(v_dose_id, false);
exception
  when unique_violation then
    -- Only a request key another account already used can get here.
    raise exception 'request key already used' using errcode = '22023';
end;
$$;

revoke all on function public.confirm_dose(uuid, text, timestamptz, text, text, timestamptz, text, text) from public, anon;
grant execute on function public.confirm_dose(uuid, text, timestamptz, text, text, timestamptz, text, text) to authenticated;
