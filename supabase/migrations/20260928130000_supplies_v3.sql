-- V3 (design v3 "Progress and supplies"; tasks/research-app.md "Design v3
-- rebuild decisions", "Personal supplies decisions", "Supplements
-- decisions"): R7 Supplies · Vials and R13 Supplies · Supplements.
--
-- 1. Correcting a vial's remaining (R7: "Tap a vial to correct it or mark it
--    finished"). A personal vial's estimate stays the app's: its strength
--    minus the amounts of its rows in personal_vial_deductions, in the
--    vial's order (vial_sequence). A correction is one more row there, of
--    kind 'correction' (no dose), whose amount is what the estimate moves
--    by: remaining before minus the remaining the researcher set, so it is
--    negative when they found more than estimated. Keeping corrections in
--    the same ordered list means everything that reads the list agrees
--    without change:
--      * confirm_dose's "remaining before" (strength minus the sum, read
--        under the vial's row lock) counts every correction before it;
--      * undo_dose refuses (AP033) to undo a Taken once a later row of its
--        vial exists, by position: a correction made after a dose was
--        judged with that dose in place, exactly as a later dose was;
--      * dose_result() and dose_voids pick deductions by dose_id, which a
--        correction does not have.
--    correct_personal_vial(p_request_key, p_vial_id, p_seen_remaining_mg,
--    p_remaining_mg) records one. The acknowledged owner only
--    (can_write_researcher; a support grant never writes), tracking on
--    (AP016), an open vial (a finished one, or one that is not the caller's,
--    returns null). The new remaining is a plain decimal from 0 to the vial's
--    strength, at most 6 decimal places (22023 otherwise). The estimate the
--    screen showed must still be the vial's (AP035 when a dose or another
--    correction moved it meanwhile). Setting the remaining it already has
--    records nothing ("unchanged"). Idempotent: the request key is stored on
--    the row; the same key again returns it ("replayed") and writes nothing;
--    the key for another vial, another value or another account is 22023.
--    A transaction-scoped advisory lock on the key, taken first, makes a
--    concurrent retry wait and then replay.
--
-- 2. "mixed Sep 17" (R7's vial line). personal_vials.mixed_at is when the
--    vial was first linked to a saved mixture, set by a trigger whenever
--    mixture_id becomes non-null on a vial that has none yet, never cleared
--    (a vial whose mixture is later deleted was still mixed then). Earlier
--    vials that are, or were, in use (linked now, or with deductions) get
--    their created_at: the closest record there is.
--
-- 3. Adding a vial idempotently (R7's round +). add_personal_vial(
--    p_request_key, p_label, p_peptide_id, p_strength_mg, p_mixture_id) is
--    save_personal_vial() for a new vial (same checks and refusals: AP014,
--    AP015, AP016, 22023) with a request key stored on the vial: the same
--    key again returns that vial ("replayed") and adds nothing, so a retry
--    after a lost response never adds a second vial; the key with another
--    peptide or strength, or from another account, is 22023 (the label is
--    not compared: "Vial N" is numbered from the list, which then includes
--    the first vial).
--
-- 4. Supplement routines with a start and an optional end (R13's round +:
--    name, amount, unit, time, start, optional end). Until now a routine
--    started the day it was created and end_date was set only by "End
--    routine" (so "ended" meant end_date is not null). Now:
--      * start_date is chosen: today or later in America/Toronto (at most a
--        year ahead); definition_from starts there, so a routine with a later
--        start has no occurrence before it;
--      * end_date may be planned: the last day it runs, on or after the
--        start. It can be set, moved or cleared by an edit (never before
--        today: the past is not rewritten; use End);
--      * a routine is ENDED when its end_date is today or earlier (on that
--        day it still runs, as "last day": the existing rule for End), or
--        when it ends before it starts (End on a routine not started yet,
--        below). An ended routine can't be edited or ended again (AP027).
--        public.supplement_routine_ended() is the rule, and
--        src/lib/supplements/view.ts mirrors it;
--      * "End routine" sets end_date to today, or, for a routine whose start
--        is still ahead, to the day before its start (it never runs). The
--        dates check allows exactly that: end_date >= definition_from - 1.
--    Occurrences are unchanged (definition_from to end_date, so none when
--    end_date is before definition_from); take_supplement() and
--    due_supplement_occurrences() need no change.
--    Writers, now idempotent (the convention of save_cycle_with_mixtures:
--    p_request_key made once by the app and sent again on a retry, and
--    p_request_hash the app's SHA-256 (hex) of the submission; the first
--    write that commits with a key claims it in supplement_write_requests
--    with its result; the same key and hash again return that result
--    ("replayed") and write nothing; another hash, another kind of write or
--    another account is 22023; a refused write claims nothing):
--      save_supplement_routine(p_request_key, p_request_hash, p_id,
--        p_version, p_name, p_amount, p_unit, p_time, p_start_date,
--        p_end_date): p_id null creates (p_start_date null means today);
--        else edits from the version shown (AP025), from today on as before,
--        keeping its start (p_start_date null or the same day, else 22023).
--      end_supplement_routine(p_request_key, p_request_hash, p_id, p_version).
--    The earlier signatures stay (a page loaded before a deploy may still
--    call them) and now follow the same rules: save_supplement_routine(
--    p_id, p_version, p_name, p_amount, p_unit, p_time) creates starting
--    today with no planned end, and an edit keeps the routine's end;
--    end_supplement_routine(p_id, p_version) ends it as above.
--
-- Lock order: the global order of 20260926200100_dose_confirmation.sql,
--     cycle -> plans (by id) -> vial -> mixtures (by id),
-- gains one writer at the vial: correct_personal_vial locks the vial (for
-- update) and nothing else, so it serializes with confirm_dose and
-- undo_dose on that vial (both take its row lock) and never waits on a cycle
-- or plan. add_personal_vial takes its request key's advisory lock first,
-- then save_personal_vial's locks (the mixture). The supplement writers keep
-- their order (at most one routine row) after their request key's advisory
-- lock. Advisory locks are only ever taken first, each by its own writer.
--
-- Access (deny by default): nothing new is readable through the API but the
-- new columns of personal_vial_deductions and personal_vials, read as the
-- rest of those rows are (can_read_researcher). supplement_write_requests
-- has no API access at all. Nobody writes any of these through the API.
--
-- Refusal SQLSTATEs added (see 20260926200100_dose_confirmation.sql):
--   AP035 the vial's estimate changed since it was shown

-- ── 1. Corrections ─────────────────────────────────────────────────────────

alter table public.personal_vial_deductions
  add column kind text not null default 'dose' check (kind in ('dose', 'correction')),
  add column request_key uuid;

alter table public.personal_vial_deductions alter column dose_id drop not null;

alter table public.personal_vial_deductions
  drop constraint personal_vial_deductions_amount_mg_check,
  -- A dose deducts what was taken; a correction moves the estimate either way (never by 0).
  add constraint personal_vial_deductions_amount check (
    amount_mg = trim_scale(amount_mg) and (case when kind = 'dose' then amount_mg > 0 else amount_mg <> 0 end)
  ),
  -- A dose row has its dose; a correction has none, but its request key and a remaining that is not below 0.
  add constraint personal_vial_deductions_kind check (
    (kind = 'dose' and dose_id is not null and request_key is null)
    or (kind = 'correction' and dose_id is null and request_key is not null and remaining_after_mg >= 0)
  ),
  add constraint personal_vial_deductions_request unique (request_key);

-- A correction as correct_personal_vial() returns it. Internal.
create function public.vial_correction_result(p_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', x.id, 'vial_id', x.vial_id, 'remaining_before_mg', x.remaining_before_mg::text,
    'remaining_mg', x.remaining_after_mg::text, 'recorded_at', x.recorded_at,
    'replayed', p_replayed, 'unchanged', false)
  from public.personal_vial_deductions x
  where x.id = p_id;
$$;

revoke all on function public.vial_correction_result(uuid, boolean) from public, anon, authenticated;

create function public.correct_personal_vial(
  p_request_key uuid,
  p_vial_id uuid,
  p_seen_remaining_mg text,
  p_remaining_mg text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_new numeric := public.mixture_decimal(p_remaining_mg);
  -- What the screen showed may be below 0 (an estimate past the vial).
  v_seen numeric := case when coalesce(p_seen_remaining_mg, '') ~ '^-?[0-9]*\.?[0-9]+$' and char_length(p_seen_remaining_mg) <= 31
                         then p_seen_remaining_mg::numeric end;
  v_existing public.personal_vial_deductions%rowtype;
  v_vial public.personal_vials%rowtype;
  v_used numeric;
  v_before numeric;
  v_sequence integer;
  v_id uuid;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_request_key is null or p_vial_id is null or v_new is null or v_seen is null or scale(v_new) > 6 then
    raise exception 'invalid correction' using errcode = '22023';
  end if;

  -- A concurrent retry with this key waits here, then replays.
  perform pg_advisory_xact_lock(hashtextextended('personal_vial_correction:' || p_request_key::text, 0));
  select x.* into v_existing from public.personal_vial_deductions x where x.request_key = p_request_key;
  if found then
    if v_existing.owner_id <> v_uid or v_existing.vial_id <> p_vial_id or v_existing.remaining_after_mg <> v_new then
      raise exception 'request key already used' using errcode = '22023';
    end if;
    return public.vial_correction_result(v_existing.id, true);
  end if;

  if not coalesce((select s.tracking_enabled from public.personal_supply_settings s where s.owner_id = v_uid), false) then
    raise exception 'supply tracking is off' using errcode = 'AP016';
  end if;

  select pv.* into v_vial from public.personal_vials pv where pv.id = p_vial_id for update;
  if not found or not public.can_write_researcher(v_vial.owner_id) or v_vial.finished_at is not null then
    return null;
  end if;
  if v_new > v_vial.strength_mg then
    raise exception 'more than the vial holds' using errcode = '22023';
  end if;

  -- The estimate and the next position, both under the vial's lock (as confirm_dose reads them).
  select coalesce(sum(x.amount_mg), 0), coalesce(max(x.vial_sequence), 0) + 1 into v_used, v_sequence
  from public.personal_vial_deductions x where x.vial_id = v_vial.id;
  v_before := v_vial.strength_mg - v_used;
  if v_before <> v_seen then
    raise exception 'the vial''s estimate changed since it was shown' using errcode = 'AP035';
  end if;
  if v_before = v_new then
    return jsonb_build_object('id', null, 'vial_id', v_vial.id, 'remaining_before_mg', v_before::text,
      'remaining_mg', v_new::text, 'recorded_at', null, 'replayed', false, 'unchanged', true);
  end if;

  insert into public.personal_vial_deductions (
    owner_id, dose_id, vial_id, amount_mg, remaining_before_mg, remaining_after_mg, recorded_at, vial_sequence, kind, request_key
  ) values (
    v_uid, null, v_vial.id, trim_scale(v_before - v_new), v_before, v_new, clock_timestamp(), v_sequence, 'correction', p_request_key
  )
  returning id into v_id;
  return public.vial_correction_result(v_id, false);
exception
  when unique_violation then
    raise exception 'request key already used' using errcode = '22023';
end;
$$;

revoke all on function public.correct_personal_vial(uuid, uuid, text, text) from public, anon;
grant execute on function public.correct_personal_vial(uuid, uuid, text, text) to authenticated;

-- ── 2. When a vial was mixed ───────────────────────────────────────────────

alter table public.personal_vials add column mixed_at timestamptz;

update public.personal_vials pv
set mixed_at = pv.created_at
where pv.mixture_id is not null
   or exists (select 1 from public.personal_vial_deductions x where x.vial_id = pv.id);

create function public.personal_vial_mixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mixture_id is not null and new.mixed_at is null then
    new.mixed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.personal_vial_mixed() from public, anon, authenticated;

create trigger personal_vials_mixed
  before insert or update of mixture_id on public.personal_vials
  for each row execute function public.personal_vial_mixed();

-- ── 3. Adding a vial with a request key ────────────────────────────────────

alter table public.personal_vials
  add column request_key uuid,
  add constraint personal_vials_request unique (request_key);

create function public.add_personal_vial(
  p_request_key uuid,
  p_label text,
  p_peptide_id uuid,
  p_strength_mg text,
  p_mixture_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_vial public.personal_vials%rowtype;
  v_id uuid;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_request_key is null then
    raise exception 'invalid vial' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('personal_vial_add:' || p_request_key::text, 0));
  select pv.* into v_vial from public.personal_vials pv where pv.request_key = p_request_key;
  if found then
    if v_vial.owner_id <> v_uid or v_vial.peptide_id is distinct from p_peptide_id
       or v_vial.strength_mg is distinct from public.mixture_decimal(p_strength_mg) then
      raise exception 'request key already used' using errcode = '22023';
    end if;
    return jsonb_build_object('id', v_vial.id, 'label', v_vial.label, 'replayed', true);
  end if;

  v_id := public.save_personal_vial(p_label, p_peptide_id, p_strength_mg, p_mixture_id, null);
  update public.personal_vials pv set request_key = p_request_key where pv.id = v_id
  returning pv.* into v_vial;
  return jsonb_build_object('id', v_vial.id, 'label', v_vial.label, 'replayed', false);
exception
  when unique_violation then
    raise exception 'request key already used' using errcode = '22023';
end;
$$;

revoke all on function public.add_personal_vial(uuid, text, uuid, text, uuid) from public, anon;
grant execute on function public.add_personal_vial(uuid, text, uuid, text, uuid) to authenticated;

-- ── 4. Supplement routines: start, planned end, idempotent writes ─────────

alter table public.supplement_routines
  drop constraint supplement_routines_dates,
  add constraint supplement_routines_dates check (
    definition_from >= start_date and (end_date is null or end_date >= definition_from - 1)
  );

-- Ended (see the header): its last day is today or past, or it ends before it starts.
create function public.supplement_routine_ended(p_end_date date, p_definition_from date, p_today date)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_end_date is not null and (p_end_date <= p_today or p_end_date < p_definition_from);
$$;

revoke all on function public.supplement_routine_ended(date, date, date) from public, anon, authenticated;

-- Each keyed supplement write that committed (see the header). Internal.
create table public.supplement_write_requests (
  request_key uuid primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('save', 'end')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index supplement_write_requests_by_owner on public.supplement_write_requests (owner_id);

alter table public.supplement_write_requests enable row level security;
revoke all on table public.supplement_write_requests from public, anon, authenticated, service_role;

-- The routine save itself (checks as described in the header and in
-- 20260927100000_supplements.sql). Internal: the public writers check the
-- caller and the request key first.
create function public.supplement_routine_save(
  p_uid uuid,
  p_id uuid,
  p_version integer,
  p_name text,
  p_amount text,
  p_unit text,
  p_time text,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_today date := (v_now at time zone 'America/Toronto')::date;
  v_name text := public.trim_whitespace(coalesce(p_name, ''));
  v_unit text := public.trim_whitespace(coalesce(p_unit, ''));
  v_amount numeric := public.supplement_decimal(p_amount);
  v_start date;
  v_from date;
  v_row public.supplement_routines%rowtype;
begin
  if char_length(v_name) not between 1 and 80 or char_length(v_unit) not between 1 and 20
     or v_amount is null or not public.is_supplement_amount(v_amount)
     or coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or (p_id is not null and p_version is null) then
    raise exception 'invalid routine' using errcode = '22023';
  end if;

  if p_id is null then
    if not public.supplement_tracking_of(p_uid) then
      raise exception 'supplement tracking is off' using errcode = 'AP026';
    end if;
    v_start := coalesce(p_start_date, v_today);
    if v_start < v_today or v_start > v_today + 366 or (p_end_date is not null and p_end_date < v_start) then
      raise exception 'invalid routine dates' using errcode = '22023';
    end if;
    insert into public.supplement_routines as r (
      owner_id, name, amount, unit, time_of_day, start_date, definition_from, end_date, created_at, updated_at
    )
    values (p_uid, v_name, v_amount, v_unit, p_time, v_start, v_start, p_end_date, v_now, v_now)
    returning r.* into v_row;
    return jsonb_build_object('id', v_row.id, 'version', v_row.version);
  end if;

  select r.* into v_row from public.supplement_routines r where r.id = p_id for update;
  if not found or v_row.owner_id <> p_uid or not public.can_write_researcher(v_row.owner_id) then
    return null;
  end if;
  if not public.supplement_tracking_of(p_uid) then
    raise exception 'supplement tracking is off' using errcode = 'AP026';
  end if;
  if v_row.version <> p_version then
    raise exception 'the routine changed since it was shown' using errcode = 'AP025';
  end if;
  if public.supplement_routine_ended(v_row.end_date, v_row.definition_from, (v_now at time zone v_row.time_zone)::date) then
    raise exception 'the routine has ended' using errcode = 'AP027';
  end if;
  -- From today on (never back: the database's clock can step back around midnight).
  v_from := greatest((v_now at time zone v_row.time_zone)::date, v_row.definition_from);
  if (p_start_date is not null and p_start_date <> v_row.start_date)
     or (p_end_date is not null and p_end_date < v_from) then
    raise exception 'invalid routine dates' using errcode = '22023';
  end if;

  update public.supplement_routines r
  set name = v_name,
      amount = v_amount,
      unit = v_unit,
      time_of_day = p_time,
      definition_from = v_from,
      end_date = p_end_date,
      version = r.version + 1,
      schedule_version = r.schedule_version + 1,
      updated_at = greatest(v_now, r.created_at)
  where r.id = v_row.id
  returning r.* into v_row;
  return jsonb_build_object('id', v_row.id, 'version', v_row.version);
end;
$$;

revoke all on function public.supplement_routine_save(uuid, uuid, integer, text, text, text, text, date, date) from public, anon, authenticated;

-- "End routine" itself. Internal, as above.
create function public.supplement_routine_end(p_uid uuid, p_id uuid, p_version integer)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_today date;
  v_row public.supplement_routines%rowtype;
begin
  if p_id is null or p_version is null then
    raise exception 'invalid routine' using errcode = '22023';
  end if;
  select r.* into v_row from public.supplement_routines r where r.id = p_id for update;
  if not found or v_row.owner_id <> p_uid or not public.can_write_researcher(v_row.owner_id) then
    return null;
  end if;
  if not public.supplement_tracking_of(p_uid) then
    raise exception 'supplement tracking is off' using errcode = 'AP026';
  end if;
  if v_row.version <> p_version then
    raise exception 'the routine changed since it was shown' using errcode = 'AP025';
  end if;
  v_today := (v_now at time zone v_row.time_zone)::date;
  if public.supplement_routine_ended(v_row.end_date, v_row.definition_from, v_today) then
    raise exception 'the routine has ended' using errcode = 'AP027';
  end if;

  update public.supplement_routines r
  -- Today is its last day; a routine not started yet never runs.
  set end_date = case when v_today < r.definition_from then r.definition_from - 1 else v_today end,
      version = r.version + 1,
      schedule_version = r.schedule_version + 1,
      updated_at = greatest(v_now, r.created_at)
  where r.id = v_row.id
  returning r.* into v_row;
  return jsonb_build_object('id', v_row.id, 'version', v_row.version, 'end_date', v_row.end_date);
end;
$$;

revoke all on function public.supplement_routine_end(uuid, uuid, integer) from public, anon, authenticated;

-- A keyed write's claim (see the header): the recorded result when this key
-- already committed with this hash, null when it is unclaimed, 22023 when it
-- belongs to another write or account. Internal.
create function public.supplement_write_replay(p_uid uuid, p_request_key uuid, p_request_hash text, p_kind text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_claim public.supplement_write_requests%rowtype;
begin
  if p_request_key is null or coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid request key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('supplement_write:' || p_request_key::text, 0));
  select c.* into v_claim from public.supplement_write_requests c where c.request_key = p_request_key;
  if not found then
    return null;
  end if;
  if v_claim.owner_id <> p_uid or v_claim.kind <> p_kind or v_claim.request_hash <> p_request_hash then
    raise exception 'request key already used' using errcode = '22023';
  end if;
  return v_claim.result || jsonb_build_object('replayed', true);
end;
$$;

revoke all on function public.supplement_write_replay(uuid, uuid, text, text) from public, anon, authenticated;

create function public.save_supplement_routine(
  p_request_key uuid,
  p_request_hash text,
  p_id uuid,
  p_version integer,
  p_name text,
  p_amount text,
  p_unit text,
  p_time text,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_result := public.supplement_write_replay(v_uid, p_request_key, p_request_hash, 'save');
  if v_result is not null then
    return v_result;
  end if;
  v_result := public.supplement_routine_save(v_uid, p_id, p_version, p_name, p_amount, p_unit, p_time, p_start_date, p_end_date);
  if v_result is null then
    return null;
  end if;
  insert into public.supplement_write_requests (request_key, owner_id, kind, request_hash, result)
  values (p_request_key, v_uid, 'save', p_request_hash, v_result);
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.save_supplement_routine(uuid, text, uuid, integer, text, text, text, text, date, date) from public, anon;
grant execute on function public.save_supplement_routine(uuid, text, uuid, integer, text, text, text, text, date, date) to authenticated;

create function public.end_supplement_routine(p_request_key uuid, p_request_hash text, p_id uuid, p_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_result := public.supplement_write_replay(v_uid, p_request_key, p_request_hash, 'end');
  if v_result is not null then
    return v_result;
  end if;
  v_result := public.supplement_routine_end(v_uid, p_id, p_version);
  if v_result is null then
    return null;
  end if;
  insert into public.supplement_write_requests (request_key, owner_id, kind, request_hash, result)
  values (p_request_key, v_uid, 'end', p_request_hash, v_result);
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.end_supplement_routine(uuid, text, uuid, integer) from public, anon;
grant execute on function public.end_supplement_routine(uuid, text, uuid, integer) to authenticated;

-- The earlier signatures (same arguments, results, grants and refusals as
-- 20260927100000_supplements.sql), on the rules above.
create or replace function public.save_supplement_routine(
  p_id uuid,
  p_version integer,
  p_name text,
  p_amount text,
  p_unit text,
  p_time text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.supplement_routines%rowtype;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_id is not null then
    -- An edit keeps the routine's start and end (the input is checked first,
    -- and a routine that isn't the caller's is null, as before).
    select r.* into v_row from public.supplement_routines r where r.id = p_id;
    return public.supplement_routine_save(v_uid, p_id, p_version, p_name, p_amount, p_unit, p_time, null, v_row.end_date);
  end if;
  return public.supplement_routine_save(v_uid, null, null, p_name, p_amount, p_unit, p_time, null, null);
end;
$$;

create or replace function public.end_supplement_routine(p_id uuid, p_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public.supplement_routine_end(v_uid, p_id, p_version);
end;
$$;
