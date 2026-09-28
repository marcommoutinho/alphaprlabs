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
--    stay put, and cycle_plan_occurrences() is unchanged.
--    The same checks as a confirmation decide what may be skipped: an
--    occurrence of the current schedule (AP017), dated today or earlier in
--    its zone (AP019), as the screen showed it (AP020).
--    A skip is settled history, exactly like a confirmation, for everything
--    that decides what a cycle edit may change (save_cycle, replaced below,
--    and src/lib/cycles/revise.ts): a skipped occurrence is never replaced,
--    removed or retargeted by an edit (a later-today dose skipped this
--    morning pushes the effective date to tomorrow), and a plan with a skip
--    has started, so it is ended through its phases, never dropped.
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
--            (its "remaining before" counted this dose). "Later" is the
--            deduction's position on its vial (vial_sequence, below),
--            assigned under the vial's row lock, never its timestamp: a
--            confirmation takes its time before it waits for the vial, so
--            two confirmations sharing a vial can commit in the opposite
--            order to their times;
--      AP034 already undone (another undo request), and also a replay of
--            the ORIGINAL Taken or Skip request after its undo (the same
--            request key never records again).
--    Each entry now stores schedule_version_after: the plan's
--    schedule_version once it was recorded. Doses recorded before this
--    migration have none and are never undoable (they are hours old).
--
-- Idempotency: every write has a request key, and confirm_dose, skip_dose
-- and undo_dose share ONE namespace of keys (dose_request_keys, below: each
-- key is claimed once, by the first write that records with it, and is
-- never released, not even when the entry is undone). The same write with
-- its key again returns what it recorded ("replayed": true); the same key
-- for any other write (another occurrence or entry, another kind of write,
-- or another account) is 22023 — also when two writes race with one key:
-- the second waits on the claim and is refused once the first commits.
--
-- Lock order: the global order of 20260926200100_dose_confirmation.sql,
--     cycle -> plans (by id) -> vial -> mixtures (by id),
-- gains two writers, both following it:
--   * skip_dose: the cycle (for update), then the plan (for no key update).
--   * undo_dose: the cycle (for update), then the plan (for no key update),
--     then, for a Taken with a deduction, that deduction's vial (for update:
--     serializes it with confirm_dose's deductions from it).
--   So a Taken, a skip, an undo and a cycle edit of one cycle never
--   interleave, and each judges the plan as the others left it. Taken
--   doses of different cycles that share a vial serialize on the vial row
--   (confirm_dose assigns vial_sequence under it; undo_dose checks it under
--   it). save_cycle's locks are unchanged (it now also reads dose_skips,
--   written only under the cycle lock it holds). Implicit
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

-- Each deduction's position on its vial: 1, 2, 3 … in the order the vial's
-- deductions were made, assigned by confirm_dose under the vial's row lock
-- (so it is the order each "remaining before" was computed in; timestamps
-- are taken before that lock and can disagree). undo_dose removes only the
-- last one, so a position is only ever reused after its deduction is gone.
-- Existing deductions are numbered by recorded_at, then id.
alter table public.personal_vial_deductions add column vial_sequence integer;
update public.personal_vial_deductions x
set vial_sequence = n.position
from (
  select d.id, row_number() over (partition by d.vial_id order by d.recorded_at, d.id) as position
  from public.personal_vial_deductions d
) n
where n.id = x.id;
alter table public.personal_vial_deductions
  alter column vial_sequence set not null,
  add constraint personal_vial_deductions_sequence check (vial_sequence >= 1),
  add constraint personal_vial_deductions_position unique (vial_id, vial_sequence);

-- The one namespace of dose write request keys (confirm_dose, skip_dose,
-- undo_dose; see "Idempotency" above). A key is claimed by the write that
-- records with it and kept for good. Internal: no API access at all.
create table public.dose_request_keys (
  request_key uuid primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('taken', 'skipped', 'undo')),
  claimed_at timestamptz not null default now()
);

create index dose_request_keys_by_owner on public.dose_request_keys (owner_id);

alter table public.dose_request_keys enable row level security;
revoke all on table public.dose_request_keys from public, anon, authenticated, service_role;

-- Every key already recorded (only Taken doses exist before this migration).
insert into public.dose_request_keys (request_key, owner_id, kind, claimed_at)
select d.request_key, d.owner_id, 'taken', d.recorded_at from public.dose_records d;

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
--   22023 the request key is already claimed by another write (a skip,
--         an undo, another dose or account: dose_request_keys);
-- and each deduction gets its vial_sequence under the vial's lock.

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
  v_sequence integer;
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
  -- Claimed by any other write (one namespace: dose_request_keys).
  if exists (select 1 from public.dose_request_keys k where k.request_key = p_request_key) then
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

  -- The key, for this write only (a racing write with it waits here, then
  -- fails the claim: 22023).
  insert into public.dose_request_keys (request_key, owner_id, kind) values (p_request_key, v_uid, 'taken');

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

  -- The estimated deduction from that open vial (locked above), next in
  -- the vial's order: its position and "remaining before" are both read
  -- under the lock, so they agree (undo_dose relies on it).
  if v_vial_id is not null then
    select pv.* into v_vial from public.personal_vials pv where pv.id = v_vial_id;
    if found then
      select coalesce(sum(x.amount_mg), 0), coalesce(max(x.vial_sequence), 0) + 1 into v_used, v_sequence
      from public.personal_vial_deductions x where x.vial_id = v_vial.id;
      insert into public.personal_vial_deductions (
        owner_id, dose_id, vial_id, amount_mg, remaining_before_mg, remaining_after_mg, recorded_at, vial_sequence
      ) values (
        v_uid, v_dose_id, v_vial.id, v_amount, v_vial.strength_mg - v_used, v_vial.strength_mg - v_used - v_amount, v_now, v_sequence
      );
    end if;
  end if;

  return public.dose_result(v_dose_id, false);
exception
  when unique_violation then
    -- Only a request key claimed meanwhile by another write can get here.
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
-- request key claimed by another write (dose_request_keys); AP017 not an occurrence of the
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
  if exists (select 1 from public.dose_request_keys k where k.request_key = p_request_key) then
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

  insert into public.dose_request_keys (request_key, owner_id, kind) values (p_request_key, v_uid, 'skipped');

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
-- request key claimed by another write (another undo, a Taken or a skip:
-- dose_request_keys); AP032 too late; AP033 later records depend on it
-- (including a later deduction from its vial, by vial_sequence); AP034
-- already undone.

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
    if exists (select 1 from public.dose_request_keys k where k.request_key = p_request_key) then
      raise exception 'request key already used' using errcode = '22023';
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
      -- The vial next in the global order: serializes this with its
      -- deductions. Any deduction after this one on the vial (by position,
      -- assigned under this lock; never by time) counted this dose.
      perform 1 from public.personal_vials pv where pv.id = v_deduction.vial_id for update;
      if exists (
        select 1 from public.personal_vial_deductions x
        where x.vial_id = v_deduction.vial_id and x.vial_sequence > v_deduction.vial_sequence
      ) then
        raise exception 'later records depend on this entry' using errcode = 'AP033';
      end if;
    end if;
  end if;

  insert into public.dose_request_keys (request_key, owner_id, kind) values (p_request_key, v_uid, 'undo');

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
    -- Only a request key claimed meanwhile by another write can get here.
    raise exception 'request key already used' using errcode = '22023';
end;
$$;

revoke all on function public.undo_dose(uuid, uuid) from public, anon;
grant execute on function public.undo_dose(uuid, uuid) to authenticated;

-- ── save_cycle: skips are settled history ──────────────────────────────────
-- Same signature, arguments, result, locks, refusals and grants as
-- 20260926200200_cycle_writes_recorded_doses.sql (read its header). The
-- checks that decide what an edit may change now treat a skipped
-- occurrence (dose_skips) exactly as a confirmed one, as
-- src/lib/cycles/revise.ts does with skipped confirmations:
--   * the effective date rule: none of the plan's occurrences so far at or
--     after the seam may be due, confirmed or skipped; and every occurrence
--     the new revision gets must be ahead, unconfirmed and not skipped,
--     unless the plan already had it before the seam (same key). So an edit
--     never removes a skipped occurrence nor gives its key a new dose or
--     time (the skip would then describe a dose that was never offered).
--   * a plan with a skip has started: it is never dropped (AP009).
-- A skip is written only under the cycle's row lock, which save_cycle holds
-- for the whole edit, so the skips it reads cannot change under it.

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
      -- A skipped occurrence (dose_skips, by key) is settled exactly like a
      -- confirmed one (V1).
      v_seam := public.cycle_local_instant(v_effective, '00:00', p_time_zone);
      v_conf := public.dose_confirmations(v_plan_id);
      if exists (
        with so_far as (select o.* from public.cycle_plan_occurrences(v_plan_id, v_conf) o),
             skipped as (select s.occurrence_key from public.dose_skips s where s.plan_id = v_plan_id)
        select 1 from so_far h
        where h.scheduled_at >= v_seam
          and (h.actual_at is not null or h.scheduled_at <= now()
               or h.occurrence_key in (select k.occurrence_key from skipped k))
        union all
        select 1 from public.cycle_revision_plan_occurrences(v_rev, v_plan_id, v_conf) n
        where (n.actual_at is not null or n.scheduled_at <= now()
               or n.occurrence_key in (select k.occurrence_key from skipped k))
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
    -- A plan that has started (a dose due, recorded or skipped) is ended
    -- through its phases, never dropped.
    if exists (
      select 1
      from public.cycle_revision_plans rp
      cross join lateral public.cycle_plan_occurrences(rp.plan_id) o
      where rp.revision_id = v_prev_rev
        and not exists (select 1 from public.cycle_revision_plans n where n.revision_id = v_rev and n.plan_id = rp.plan_id)
        and (o.actual_at is not null or o.scheduled_at <= now()
             or exists (select 1 from public.dose_skips s where s.plan_id = rp.plan_id and s.occurrence_key = o.occurrence_key))
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
