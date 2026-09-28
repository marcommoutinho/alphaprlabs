-- V1 (design v3 "Today"; tasks/research-app.md "Design v3 rebuild
-- decisions"): skipping a dose, undoing a Taken or a skip right after it,
-- and the eight injection sites.
--
-- 1. Sites. R2's grid: Abdomen L/R, Thigh L/R, Delt L/R, Glute L/R. "Other"
--    stays valid (doses recorded with it keep it; the app no longer offers
--    it), and '' is still "not given". is_dose_site() is widened in place, so
--    every recorded dose stays valid (the old list is a subset).
--
-- 2. Skip ("Skip" in R2, "Mark skipped" in R2b and on the laptop's overdue
--    row). dose_skips holds one skip per occurrence, recorded by
--    skip_dose(). A skipped dose is no longer open: not overdue, not in the
--    badge, never reminded, and it counts as skipped, not missed. It cannot
--    then be confirmed (confirm_dose refuses it, AP031) and a confirmed dose
--    cannot be skipped (AP018): one resolution per occurrence. A skip is not
--    a confirmation: it never enters dose_confirmations(), so every-N-days
--    doses after it keep counting from its PLANNED time (the engine's rule
--    for a dose that was not taken, handoff Business Rule 1), fixed weekdays
--    stay put, and cycle_plan_occurrences() and save_cycle() are unchanged.
--    The same checks as a confirmation decide what may be skipped: an
--    occurrence of the current schedule (AP017), dated today or earlier in
--    its zone (AP019), as the screen showed it (AP020).
--
-- 3. Undo (the toast's "Undo" after Taken or Skip). Recorded doses stay
--    append-only in spirit (handoff Business Rule 11): undo_dose() is a
--    retraction with an audit trail, allowed only right after the entry and
--    only while nothing recorded since depends on it. It moves the entry
--    (and a Taken's personal-vial deduction) into dose_voids as they were,
--    then removes them from dose_records / personal_vial_deductions /
--    dose_skips, so every reader sees exactly what it saw before the entry:
--    the dose is open again (overdue and in the badge if its time has come),
--    the vial estimate is back, and every-N-days doses re-anchor as before
--    (the schedule is a function of the recorded doses). Refused when:
--      AP032 more than 60 seconds have passed since the entry was recorded
--            (the toast shows for 4 s; the margin covers a slow network);
--      AP033 something recorded since depends on it: the plan's
--            schedule_version moved on since the entry (another dose or skip
--            of the plan, or a saved cycle edit, was judged with this entry
--            in place), or a later deduction from the same personal vial
--            (its "remaining before" counted this dose);
--      AP034 already undone (another undo request), and also a replay of
--            the ORIGINAL Taken or Skip request after its undo (the same
--            request key never records again).
--    Each entry now stores schedule_version_after: the plan's
--    schedule_version once it was recorded. Doses recorded before this
--    migration have none and are never undoable (they are hours old).
--
-- Idempotency: every write has a request key. skip_dose returns the
-- recorded skip for its key again ("replayed": true); undo_dose returns the
-- recorded void for its key again. A key used for another occurrence or
-- entry, or by another account, is 22023.
--
-- Lock order: the global order of 20260926200100_dose_confirmation.sql,
--     cycle -> plans (by id) -> vial -> mixtures (by id),
-- gains two writers, both following it:
--   * skip_dose: the cycle (for update), then the plan (for no key update).
--   * undo_dose: the cycle (for update), then the plan (for no key update),
--     then, for a Taken with a deduction, that deduction's vial (for update:
--     serializes it with confirm_dose's deductions from it).
--   So a Taken, a skip, an undo and a cycle edit of one cycle never
--   interleave, and each judges the plan as the others left it. Implicit
--   foreign-key locks (a skip's or void's plan, for key share) fall on the
--   plan already held.
--
-- For S13 (the reminder dispatcher; header of 20260926200000_doses.sql):
-- before sending, also recheck that no dose_skips row exists for (plan_id,
-- occurrence_key): a skip stops every reminder for it. Skips and undos both
-- advance cycle_plans.schedule_version, so queued reminders recheck.
--
-- Access (deny by default): dose_skips and dose_voids are readable as
-- dose_records are (can_read_researcher: the owner, or an admin while the
-- owner shares with the team); nobody writes them through the API.
--
-- Refusal SQLSTATEs added (see 20260926200100_dose_confirmation.sql):
--   AP031 the dose was skipped          AP032 too late to undo
--   AP033 later records depend on it    AP034 already undone

-- ── 1. Eight injection sites ────────────────────────────────────────────────

create or replace function public.is_dose_site(p_site text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_site in ('', 'Abdomen L', 'Abdomen R', 'Thigh L', 'Thigh R', 'Delt L', 'Delt R', 'Glute L', 'Glute R', 'Other');
$$;

-- ── Tables ─────────────────────────────────────────────────────────────────

-- The plan's schedule_version once this dose was recorded (undo_dose's
-- dependency check); null on doses recorded before this migration.
alter table public.dose_records
  add column schedule_version_after integer check (schedule_version_after >= 1);

create table public.dose_skips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  cycle_id uuid not null,
  plan_id uuid not null,
  peptide_id uuid not null,
  phase_id uuid not null,
  occurrence_key text not null,
  -- The occurrence as the server scheduled it when it was skipped.
  scheduled_at timestamptz not null,
  planned_mg numeric not null check (planned_mg > 0 and planned_mg = trim_scale(planned_mg)),
  recorded_at timestamptz not null,
  request_key uuid not null,
  schedule_version_after integer not null check (schedule_version_after >= 1),
  constraint dose_skips_key_shape check (
    occurrence_key ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}:([0-9]{1,6}|[0-9]{4}-[0-9]{2}-[0-9]{2})$'
    and split_part(occurrence_key, ':', 1) = plan_id::text
    and split_part(occurrence_key, ':', 2) = phase_id::text
  ),
  constraint dose_skips_plan foreign key (plan_id, cycle_id, owner_id, peptide_id)
    references public.cycle_plans (id, cycle_id, owner_id, peptide_id) on delete cascade,
  constraint dose_skips_occurrence unique (plan_id, occurrence_key),
  constraint dose_skips_request unique (request_key)
);

create index dose_skips_by_owner on public.dose_skips (owner_id, recorded_at);
create index dose_skips_by_cycle on public.dose_skips (cycle_id);

-- The audit trail of undone entries: the dose or skip, and a Taken's
-- deduction, exactly as they were recorded (to_jsonb of the rows).
create table public.dose_voids (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  kind text not null check (kind in ('taken', 'skipped')),
  entry_id uuid not null,
  -- The original Taken or Skip request: replaying it after the undo is refused.
  entry_request_key uuid not null,
  cycle_id uuid not null,
  plan_id uuid not null,
  peptide_id uuid not null,
  occurrence_key text not null,
  entry jsonb not null check (jsonb_typeof(entry) = 'object'),
  deduction jsonb check (deduction is null or jsonb_typeof(deduction) = 'object'),
  request_key uuid not null,
  voided_at timestamptz not null,
  constraint dose_voids_deduction check (kind = 'taken' or deduction is null),
  constraint dose_voids_plan foreign key (plan_id, cycle_id, owner_id, peptide_id)
    references public.cycle_plans (id, cycle_id, owner_id, peptide_id) on delete cascade,
  constraint dose_voids_entry unique (entry_id),
  constraint dose_voids_entry_request unique (entry_request_key),
  constraint dose_voids_request unique (request_key)
);

create index dose_voids_by_owner on public.dose_voids (owner_id, voided_at);
create index dose_voids_by_plan on public.dose_voids (plan_id);

alter table public.dose_skips enable row level security;
alter table public.dose_voids enable row level security;

revoke all on table public.dose_skips, public.dose_voids from public, anon, authenticated, service_role;
grant select on table public.dose_skips, public.dose_voids to authenticated, service_role;

create policy dose_skips_select on public.dose_skips
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy dose_voids_select on public.dose_voids
  for select to authenticated using (public.can_read_researcher(owner_id));

-- ── Results ────────────────────────────────────────────────────────────────

-- A recorded skip as skip_dose() returns it. Internal.
create function public.dose_skip_result(p_skip_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'cycle_id', s.cycle_id, 'plan_id', s.plan_id, 'occurrence_key', s.occurrence_key,
    'scheduled_at', s.scheduled_at, 'planned_mg', s.planned_mg::text, 'recorded_at', s.recorded_at,
    'replayed', p_replayed)
  from public.dose_skips s
  where s.id = p_skip_id;
$$;

-- An undo as undo_dose() returns it. Internal.
create function public.dose_void_result(p_void_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id, 'kind', v.kind, 'entry_id', v.entry_id, 'cycle_id', v.cycle_id, 'plan_id', v.plan_id,
    'occurrence_key', v.occurrence_key, 'voided_at', v.voided_at, 'replayed', p_replayed,
    'deduction', case when v.deduction is null then null else jsonb_build_object(
      'vial_id', v.deduction ->> 'vial_id',
      'vial_label', (select pv.label from public.personal_vials pv where pv.id = (v.deduction ->> 'vial_id')::uuid),
      'amount_mg', v.deduction ->> 'amount_mg') end)
  from public.dose_voids v
  where v.id = p_void_id;
$$;

revoke all on function public.dose_skip_result(uuid, boolean) from public, anon, authenticated;
revoke all on function public.dose_void_result(uuid, boolean) from public, anon, authenticated;

-- ── confirm_dose: refuses skipped and undone; records schedule_version_after ─
-- Same signature, arguments, result, locks and refusals as
-- 20260926200100_dose_confirmation.sql (read its header), plus:
--   AP031 the occurrence was skipped;
--   AP034 this request was recorded and then undone (a late retry of an
--         undone Taken never records it again);
--   22023 the request key is a skip's.

create or replace function public.confirm_dose(
  p_request_key uuid,
  p_occurrence_key text,
  p_seen_scheduled_at timestamptz,
  p_seen_dose_mg text,
  p_seen_mixture_version_id uuid,
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
  v_void public.dose_voids%rowtype;
  v_occurrence public.cycle_occurrence;
  v_amount numeric := public.mixture_decimal(p_amount_mg);
  v_seen_dose numeric := public.mixture_decimal(p_seen_dose_mg);
  v_site text := coalesce(p_site, '');
  v_notes text := public.trim_whitespace(coalesce(p_notes, ''));
  v_now timestamptz;
  v_actual timestamptz;
  v_version uuid;
  v_mixture uuid;
  v_vial public.personal_vials%rowtype;
  v_vial_id uuid;
  v_tracking boolean;
  v_attempt integer;
  v_used numeric;
  v_dose_id uuid;
  v_after integer;
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
  -- Locks in the documented order: the cycle (save_cycle, skip_dose and
  -- undo_dose lock it too), then the plan (save_mixture locks the plans it links).
  perform 1 from public.cycles c where c.id = v_plan.cycle_id for update;
  perform 1 from public.cycle_plans cp where cp.id = v_plan.id for no key update;

  -- A retry of a recorded request returns what was recorded.
  select d.* into v_existing from public.dose_records d where d.request_key = p_request_key;
  if found then
    if v_existing.owner_id <> v_uid or v_existing.occurrence_key <> p_occurrence_key then
      raise exception 'request key already used' using errcode = '22023';
    end if;
    return public.dose_result(v_existing.id, true);
  end if;
  -- A retry of a request that was recorded and then undone records nothing.
  select v.* into v_void from public.dose_voids v where v.entry_request_key = p_request_key;
  if found then
    if v_void.owner_id <> v_uid or v_void.occurrence_key <> p_occurrence_key or v_void.kind <> 'taken' then
      raise exception 'request key already used' using errcode = '22023';
    end if;
    raise exception 'this entry was undone' using errcode = 'AP034';
  end if;
  if exists (select 1 from public.dose_skips s where s.request_key = p_request_key) then
    raise exception 'request key already used' using errcode = '22023';
  end if;
  if exists (select 1 from public.dose_records d where d.plan_id = v_plan.id and d.occurrence_key = p_occurrence_key) then
    raise exception 'already confirmed' using errcode = 'AP018';
  end if;
  if exists (select 1 from public.dose_skips s where s.plan_id = v_plan.id and s.occurrence_key = p_occurrence_key) then
    raise exception 'the dose was skipped' using errcode = 'AP031';
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

  -- The mixture in effect at the actual time and, while tracking is on, its
  -- open vial (see 20260926200100_dose_confirmation.sql).
  v_tracking := coalesce((select s.tracking_enabled from public.personal_supply_settings s where s.owner_id = v_uid), false);
  for v_attempt in 1..5 loop
    begin
      v_version := public.plan_mixture_version_at(v_plan.id, v_actual);
      v_mixture := (select mv.mixture_id from public.mixture_versions mv where mv.id = v_version);
      v_vial_id := public.open_vial_of(v_uid, v_mixture, v_tracking);
      perform 1 from public.personal_vials pv where pv.id = v_vial_id for update;
      perform 1 from public.mixtures m where m.id = v_mixture for share;
      v_version := public.plan_mixture_version_at(v_plan.id, v_actual);
      if (select mv.mixture_id from public.mixture_versions mv where mv.id = v_version) is distinct from v_mixture
         or public.open_vial_of(v_uid, v_mixture, v_tracking) is distinct from v_vial_id then
        raise exception 'the mixture or vial moved; resolve again' using errcode = 'AP099';
      end if;
      exit;
    exception
      when sqlstate 'AP099' then
        if v_attempt = 5 then
          raise exception 'the mixture or vial kept changing' using errcode = '40001';
        end if;
    end;
  end loop;
  -- The syringe units shown must be the ones for this setup.
  if v_version is distinct from p_seen_mixture_version_id then
    raise exception 'the mixture changed since it was shown' using errcode = 'AP020';
  end if;

  -- Later every-N-days doses may have moved: queued reminders must recheck.
  update public.cycle_plans cp set schedule_version = cp.schedule_version + 1
  where cp.id = v_plan.id
  returning cp.schedule_version into v_after;

  insert into public.dose_records (
    owner_id, cycle_id, plan_id, peptide_id, phase_id, occurrence_key, scheduled_at, planned_mg,
    actual_at, recorded_at, amount_mg, site, notes, mixture_version_id, request_key, schedule_version_after
  ) values (
    v_uid, v_plan.cycle_id, v_plan.id, v_plan.peptide_id, v_occurrence.phase_id, p_occurrence_key,
    v_occurrence.scheduled_at, v_occurrence.dose_mg, v_actual, v_now, v_amount, v_site, v_notes,
    v_version, p_request_key, v_after
  )
  returning id into v_dose_id;

  -- The estimated deduction from that open vial (locked above).
  if v_vial_id is not null then
    select pv.* into v_vial from public.personal_vials pv where pv.id = v_vial_id;
    if found then
      select coalesce(sum(x.amount_mg), 0) into v_used from public.personal_vial_deductions x where x.vial_id = v_vial.id;
      insert into public.personal_vial_deductions (
        owner_id, dose_id, vial_id, amount_mg, remaining_before_mg, remaining_after_mg, recorded_at
      ) values (
        v_uid, v_dose_id, v_vial.id, v_amount, v_vial.strength_mg - v_used, v_vial.strength_mg - v_used - v_amount, v_now
      );
    end if;
  end if;

  return public.dose_result(v_dose_id, false);
exception
  when unique_violation then
    -- Only a request key another account already used can get here.
    raise exception 'request key already used' using errcode = '22023';
end;
$$;

revoke all on function public.confirm_dose(uuid, text, timestamptz, text, uuid, text, timestamptz, text, text) from public, anon;
grant execute on function public.confirm_dose(uuid, text, timestamptz, text, uuid, text, timestamptz, text, text) to authenticated;

-- ── skip_dose ──────────────────────────────────────────────────────────────
-- Records that the caller skipped one occurrence of their own plan. The
-- caller passes the scheduled time and planned dose it showed (AP020 when
-- either changed). Returns the skip as JSON:
--   { id, cycle_id, plan_id, occurrence_key, scheduled_at, planned_mg,
--     recorded_at, replayed }
-- A plan that is not the caller's (or does not exist) returns null.
-- Refusals: 42501 not an acknowledged researcher; 22023 invalid input or a
-- request key used for something else; AP017 not an occurrence of the
-- current schedule; AP018 already confirmed; AP019 a later day; AP020
-- changed since shown; AP031 already skipped (another request); AP034 this
-- request was recorded and then undone.

create function public.skip_dose(
  p_request_key uuid,
  p_occurrence_key text,
  p_seen_scheduled_at timestamptz,
  p_seen_dose_mg text
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
  v_existing public.dose_skips%rowtype;
  v_void public.dose_voids%rowtype;
  v_occurrence public.cycle_occurrence;
  v_seen_dose numeric := public.mixture_decimal(p_seen_dose_mg);
  v_now timestamptz;
  v_after integer;
  v_skip_id uuid;
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
  perform 1 from public.cycles c where c.id = v_plan.cycle_id for update;
  perform 1 from public.cycle_plans cp where cp.id = v_plan.id for no key update;

  select s.* into v_existing from public.dose_skips s where s.request_key = p_request_key;
  if found then
    if v_existing.owner_id <> v_uid or v_existing.occurrence_key <> p_occurrence_key then
      raise exception 'request key already used' using errcode = '22023';
    end if;
    return public.dose_skip_result(v_existing.id, true);
  end if;
  select v.* into v_void from public.dose_voids v where v.entry_request_key = p_request_key;
  if found then
    if v_void.owner_id <> v_uid or v_void.occurrence_key <> p_occurrence_key or v_void.kind <> 'skipped' then
      raise exception 'request key already used' using errcode = '22023';
    end if;
    raise exception 'this entry was undone' using errcode = 'AP034';
  end if;
  if exists (select 1 from public.dose_records d where d.request_key = p_request_key) then
    raise exception 'request key already used' using errcode = '22023';
  end if;
  if exists (select 1 from public.dose_records d where d.plan_id = v_plan.id and d.occurrence_key = p_occurrence_key) then
    raise exception 'already confirmed' using errcode = 'AP018';
  end if;
  if exists (select 1 from public.dose_skips s where s.plan_id = v_plan.id and s.occurrence_key = p_occurrence_key) then
    raise exception 'already skipped' using errcode = 'AP031';
  end if;
  if p_seen_scheduled_at is null or v_seen_dose is null then
    raise exception 'invalid skip' using errcode = '22023';
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

  -- A skip stops the occurrence's reminders: queued ones must recheck.
  update public.cycle_plans cp set schedule_version = cp.schedule_version + 1
  where cp.id = v_plan.id
  returning cp.schedule_version into v_after;

  insert into public.dose_skips (
    owner_id, cycle_id, plan_id, peptide_id, phase_id, occurrence_key, scheduled_at, planned_mg,
    recorded_at, request_key, schedule_version_after
  ) values (
    v_uid, v_plan.cycle_id, v_plan.id, v_plan.peptide_id, v_occurrence.phase_id, p_occurrence_key,
    v_occurrence.scheduled_at, v_occurrence.dose_mg, v_now, p_request_key, v_after
  )
  returning id into v_skip_id;

  return public.dose_skip_result(v_skip_id, false);
exception
  when unique_violation then
    raise exception 'request key already used' using errcode = '22023';
end;
$$;

revoke all on function public.skip_dose(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.skip_dose(uuid, text, timestamptz, text) to authenticated;

-- ── undo_dose ──────────────────────────────────────────────────────────────
-- Undoes the caller's own recorded dose or skip (p_entry_id: its id), within
-- 60 seconds of recording it and only while nothing since depends on it
-- (see the header). p_request_key identifies this undo: the same key again
-- returns the recorded undo. Returns JSON:
--   { id, kind: 'taken' | 'skipped', entry_id, cycle_id, plan_id,
--     occurrence_key, voided_at, replayed,
--     deduction: null | { vial_id, vial_label, amount_mg } (restored) }
-- An entry that is not the caller's, or does not exist, returns null.
-- Refusals: 42501 not an acknowledged researcher; 22023 invalid input or a
-- request key used for another entry; AP032 too late; AP033 later records
-- depend on it; AP034 already undone.

create function public.undo_dose(p_request_key uuid, p_entry_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_window constant interval := interval '60 seconds';
  v_uid uuid := (select auth.uid());
  v_void public.dose_voids%rowtype;
  v_dose public.dose_records%rowtype;
  v_skip public.dose_skips%rowtype;
  v_deduction public.personal_vial_deductions%rowtype;
  v_kind text;
  v_owner uuid;
  v_cycle uuid;
  v_plan uuid;
  v_peptide uuid;
  v_key text;
  v_recorded timestamptz;
  v_after integer;
  v_entry_request uuid;
  v_entry jsonb;
  v_current integer;
  v_now timestamptz;
  v_void_id uuid;
  v_attempt integer;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_request_key is null or p_entry_id is null then
    raise exception 'invalid undo' using errcode = '22023';
  end if;

  -- Twice at most: a plain read finds the entry's cycle and plan, the locks
  -- are taken in the global order, and the entry is read again under them
  -- (a concurrent undo may have removed it meanwhile).
  for v_attempt in 1..2 loop
    -- A retry of an undo already made returns it.
    select v.* into v_void from public.dose_voids v where v.request_key = p_request_key;
    if found then
      if v_void.owner_id <> v_uid or v_void.entry_id <> p_entry_id then
        raise exception 'request key already used' using errcode = '22023';
      end if;
      return public.dose_void_result(v_void.id, true);
    end if;
    if exists (select 1 from public.dose_voids v where v.entry_id = p_entry_id and v.owner_id = v_uid) then
      raise exception 'already undone' using errcode = 'AP034';
    end if;

    v_kind := null;
    select d.* into v_dose from public.dose_records d where d.id = p_entry_id;
    if found then
      v_kind := 'taken';
      v_owner := v_dose.owner_id; v_cycle := v_dose.cycle_id; v_plan := v_dose.plan_id; v_peptide := v_dose.peptide_id;
      v_key := v_dose.occurrence_key; v_recorded := v_dose.recorded_at; v_after := v_dose.schedule_version_after;
      v_entry_request := v_dose.request_key; v_entry := to_jsonb(v_dose);
    else
      select s.* into v_skip from public.dose_skips s where s.id = p_entry_id;
      if found then
        v_kind := 'skipped';
        v_owner := v_skip.owner_id; v_cycle := v_skip.cycle_id; v_plan := v_skip.plan_id; v_peptide := v_skip.peptide_id;
        v_key := v_skip.occurrence_key; v_recorded := v_skip.recorded_at; v_after := v_skip.schedule_version_after;
        v_entry_request := v_skip.request_key; v_entry := to_jsonb(v_skip);
      end if;
    end if;
    if v_kind is null or not public.can_write_researcher(v_owner) then
      return null;
    end if;

    if v_attempt = 1 then
      perform 1 from public.cycles c where c.id = v_cycle for update;
      perform 1 from public.cycle_plans cp where cp.id = v_plan for no key update;
      continue;
    end if;
    exit;
  end loop;

  v_now := clock_timestamp();
  if v_now > v_recorded + c_window then
    raise exception 'too late to undo' using errcode = 'AP032';
  end if;
  -- Anything recorded for this plan since (a dose, a skip, an undo, a cycle
  -- edit) advanced schedule_version: it was judged with this entry in place.
  select cp.schedule_version into v_current from public.cycle_plans cp where cp.id = v_plan;
  if v_after is null or v_current is distinct from v_after then
    raise exception 'later records depend on this entry' using errcode = 'AP033';
  end if;

  if v_kind = 'taken' then
    select x.* into v_deduction from public.personal_vial_deductions x where x.dose_id = v_dose.id;
    if found then
      -- The vial next in the global order: serializes this with its deductions.
      perform 1 from public.personal_vials pv where pv.id = v_deduction.vial_id for update;
      if exists (
        select 1 from public.personal_vial_deductions x
        where x.vial_id = v_deduction.vial_id and x.id <> v_deduction.id and x.recorded_at >= v_deduction.recorded_at
      ) then
        raise exception 'later records depend on this entry' using errcode = 'AP033';
      end if;
    end if;
  end if;

  insert into public.dose_voids (
    owner_id, kind, entry_id, entry_request_key, cycle_id, plan_id, peptide_id, occurrence_key,
    entry, deduction, request_key, voided_at
  ) values (
    v_owner, v_kind, p_entry_id, v_entry_request, v_cycle, v_plan, v_peptide, v_key,
    v_entry, case when v_deduction.id is null then null else to_jsonb(v_deduction) end, p_request_key, v_now
  )
  returning id into v_void_id;

  if v_kind = 'taken' then
    delete from public.personal_vial_deductions x where x.dose_id = p_entry_id;
    delete from public.dose_records d where d.id = p_entry_id;
  else
    delete from public.dose_skips s where s.id = p_entry_id;
  end if;

  -- The occurrence is open again, and every-N-days doses re-anchor: queued
  -- reminders recheck.
  update public.cycle_plans cp set schedule_version = cp.schedule_version + 1 where cp.id = v_plan;
  return public.dose_void_result(v_void_id, false);
exception
  when unique_violation then
    -- Only a request key another account already used can get here.
    raise exception 'request key already used' using errcode = '22023';
end;
$$;

revoke all on function public.undo_dose(uuid, uuid) from public, anon;
grant execute on function public.undo_dose(uuid, uuid) to authenticated;
