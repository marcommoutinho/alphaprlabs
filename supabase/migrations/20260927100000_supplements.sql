-- S16: supplements (R10). Optional supplement routines, each one amount at
-- one time a day, with Taken records. They reuse the schedule and
-- confirmation concepts of S7/S12 (occurrence keys derived on the server,
-- idempotent request keys, the same time rules) with their own free-text
-- units, and never touch peptide stock: no syringe units, mixtures, personal
-- vials, deductions or dose_records (plan: "They never use the peptide
-- syringe calculator or deduct peptide stock").
--
-- Records:
--   supplement_settings   R10 "Track supplements", per researcher (off until
--                         turned on). Off hides the routines on R10 and Today,
--                         and nothing can be created, edited, ended or taken
--                         (AP026); every routine and Taken record is kept.
--   supplement_routines   the prototype's Routine { name, amount, unit, time,
--                         start, end? }: an exact amount (numeric, > 0 and
--                         < 1,000,000, at most 6 decimals, no trailing zeros),
--                         a free-text unit (1-20 characters: "IU", "mg"), a
--                         daily "HH:MM" in its zone, always America/Toronto
--                         (the app is strictly local; Marco, 2026-09-26).
--                         start_date: the Toronto day it was created; end_date:
--                         the day "End routine" was used (that day still
--                         counts); definition_from: the day the current name,
--                         amount, unit and time took effect (the create day,
--                         then the day of the latest edit). version is the
--                         stale-edit token; schedule_version is S13's (below).
--                         Never deleted: ending keeps it and its history.
--   supplement_taken      the prototype's SuppTaken { key, time }: one per
--                         occurrence, with the occurrence as the server
--                         scheduled it, snapshots of the routine's name, amount
--                         and unit (an edit never rewrites what was recorded),
--                         actual_at, recorded_at (the server's clock) and the
--                         client's request key. Append-only.
--
-- Occurrences (the same rule in src/lib/supplements/schedule.ts): one per
-- local date from definition_from to end_date (open-ended when null), keyed
-- "<routine id>:<YYYY-MM-DD>", at the routine's time on that date in its
-- zone, resolved as cycles resolve theirs (cycle_local_instant: a time in a
-- spring-forward gap moves forward by the gap; a repeated time uses the
-- earlier instant).
--
-- Edits (Marco, 2026-09-27: "edits apply from now on, including today's
-- untaken occurrence") replace the definition in place and set
-- definition_from to the day of the edit: today's untaken occurrence and every
-- later one use the new name, amount, unit and time. Days before it are no
-- longer occurrences: a day missed before the edit stays unmarked (AP017; the
-- screens list today only, so no revision history is kept). Taken records
-- keep their own snapshot; a day already taken stays taken.
--
-- For S13 (the reminder dispatcher, built last): reminders come from
-- public.due_supplement_occurrences(p_from, p_to, p_after_at, p_after_routine,
-- p_limit) (service role only): untaken occurrences under each routine's
-- current definition scheduled in [p_from, p_to) (at most 8 days), owner's
-- tracking on, with schedule_version, ordered by the unique (scheduled_at,
-- routine_id), at most p_limit rows (1 to 1,000, the API's cap). S13 MUST
-- page by cursor: pass the last row's (scheduled_at, routine_id) as
-- (p_after_at, p_after_routine) until a page is shorter than p_limit
-- (listDueSupplements in src/lib/supplements/service.ts does). A Taken
-- recorded between pages only drops that occurrence. A reminder tap opens
-- Today, which lists today only (Marco, 2026-09-27): a late tap across
-- midnight needs S13's own deep link; take_supplement accepts any day from
-- definition_from up to today. Before sending a reminder or follow-up, recheck:
--   1. no supplement_taken row exists for (routine_id, occurrence_key);
--   2. supplement_routines.schedule_version still equals the version the
--      reminder was queued with (it moves on every saved edit and on End);
--      if not, call due_supplement_occurrences again and requeue or drop;
--   3. the owner's supplement_settings.tracking_enabled is still true.
-- Taking a supplement does not move schedule_version: the Taken row itself
-- stops that occurrence's reminders, and no other occurrence moves. The app
-- badge (unconfirmed doses from running cycles) does not count supplements.
--
-- Writers (security definer, empty search_path). The caller is always
-- public.can_write_researcher(owner): the owner, with the disclaimer
-- acknowledged; a support grant never writes. A routine that is not the
-- caller's (or does not exist) returns null, like a missing one.
--   set_supplement_tracking(p_enabled)          R10's toggle.
--   save_supplement_routine(p_id, p_version, p_name, p_amount, p_unit, p_time)
--     p_id null creates (start_date today in Toronto; tracking on, AP026);
--     else edits in place from the version shown (AP025 otherwise), not once
--     ended (AP027). Input (22023): name 1-80 characters and unit 1-20
--     (trimmed; char_length: code points, as the app counts them), amount a
--     plain decimal text > 0 and < 1,000,000 with at most 6 decimals, time
--     "HH:MM". Returns { id, version }.
--   end_supplement_routine(p_id, p_version)     "End routine": end_date =
--     today in its zone; tracking on, the version shown (AP025), not already
--     ended (AP027). Returns { id, version, end_date }.
--   take_supplement(p_request_key, p_occurrence_key, p_seen_scheduled_at,
--                   p_seen_name, p_seen_amount, p_seen_unit, p_actual_at)
--     R1/R10 "Taken": the occurrence is re-derived here from the stored
--     routine, never from times the client sends. The same request key
--     again (a retry, a double tap) returns the recorded result with
--     "replayed": true and records nothing more; a key already used for
--     another occurrence or account is refused (22023). Then, as
--     confirm_dose: the date must be an occurrence under the current
--     definition (definition_from to end_date; AP017), not taken yet
--     (AP018), today or earlier in its zone (AP019); the scheduled time,
--     name, amount and unit shown must be the current ones (AP020); the actual
--     time (now when null) never after the server's clock (AP021) nor more
--     than a day before the planned time (AP022). Tracking on (AP026).
--     Returns { id, routine_id, occurrence_key, scheduled_at, actual_at,
--     recorded_at, name, amount, unit, replayed }.
--
-- Refusal SQLSTATEs (AP017-AP022 as in 20260926200100_dose_confirmation.sql):
--   42501 not an acknowledged researcher     22023 invalid input, key reused
--   AP017 not an occurrence of the routine's current definition
--   AP018 already taken
--   AP019 not due yet (a later day)          AP020 changed since it was shown
--   AP021 actual time in the future          AP022 actual time over a day early
--   AP025 the routine changed since it was shown (stale version)
--   AP026 supplement tracking is off         AP027 the routine has ended
--
-- Lock order: every supplement writer locks at most one routine row for
-- update (edits, End and Taken records are serialized: a double tap with two
-- request keys records one and refuses the other with AP018) or, for
-- set_supplement_tracking, the caller's settings row (others read it plainly:
-- a toggle racing a write counts as after it). None takes a lock in the
-- global order of 20260926200100_dose_confirmation.sql and no peptide writer
-- locks these rows, so no cycle can form. Implicit foreign-key locks fall on
-- the caller's profile and on a routine already held for update.
--
-- Access (deny by default), per the S4 grant rules
-- (20260926150000_support_grants.sql):
--   * Reads: public.can_read_researcher(owner_id): the owner, or an admin
--     holding the owner's active support grant (S17's A8 history). The admin
--     role alone reads nothing; revoking denies the next read.
--   * Writes: none through the API (service_role included); only the above.
--
-- Account data: names and units are free text; any account-closure design
-- must clear them too. Until then rows go with their profile (cascade).

-- ── Tables ─────────────────────────────────────────────────────────────────

create table public.supplement_settings (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  tracking_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- A supplement amount: > 0, < 1,000,000, at most 6 decimals, no trailing zeros.
create function public.is_supplement_amount(p_amount numeric)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_amount > 0 and p_amount < 1000000
    and scale(p_amount) = scale(trim_scale(p_amount)) and scale(p_amount) <= 6;
$$;

revoke all on function public.is_supplement_amount(numeric) from public, anon;
grant execute on function public.is_supplement_amount(numeric) to authenticated, service_role;

create table public.supplement_routines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (name = public.trim_whitespace(name) and char_length(name) between 1 and 80),
  amount numeric not null check (public.is_supplement_amount(amount)),
  unit text not null check (unit = public.trim_whitespace(unit) and char_length(unit) between 1 and 20),
  -- "HH:MM", 24-hour, in time_zone.
  time_of_day text not null check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- The app is strictly local (see the header).
  time_zone text not null default 'America/Toronto' check (time_zone = 'America/Toronto'),
  start_date date not null,
  -- When the current definition took effect (see the header).
  definition_from date not null,
  end_date date,
  -- The concurrency token: + 1 on every successful edit and on End.
  version integer not null default 1 check (version >= 1),
  -- S13's recheck token: + 1 whenever the occurrences may have changed (see the header).
  schedule_version integer not null default 1 check (schedule_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplement_routines_dates check (
    definition_from >= start_date and (end_date is null or end_date >= definition_from)
  ),
  constraint supplement_routines_saved check (updated_at >= created_at),
  constraint supplement_routines_owner unique (id, owner_id)
);

create index supplement_routines_by_owner on public.supplement_routines (owner_id, id);

create table public.supplement_taken (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  routine_id uuid not null,
  occurrence_key text not null,
  local_date date not null,
  -- The occurrence as the server scheduled it when it was taken.
  scheduled_at timestamptz not null,
  -- The routine as it was then.
  name text not null check (char_length(name) between 1 and 80),
  amount numeric not null check (public.is_supplement_amount(amount)),
  unit text not null check (char_length(unit) between 1 and 20),
  actual_at timestamptz not null,
  recorded_at timestamptz not null,
  request_key uuid not null,
  constraint supplement_taken_times check (actual_at <= recorded_at),
  constraint supplement_taken_key check (occurrence_key = routine_id::text || ':' || to_char(local_date, 'YYYY-MM-DD')),
  constraint supplement_taken_routine foreign key (routine_id, owner_id)
    references public.supplement_routines (id, owner_id) on delete cascade,
  -- One Taken per occurrence; one per request.
  constraint supplement_taken_occurrence unique (routine_id, occurrence_key),
  constraint supplement_taken_request unique (request_key)
);

create index supplement_taken_by_owner on public.supplement_taken (owner_id, id);

alter table public.supplement_settings enable row level security;
alter table public.supplement_routines enable row level security;
alter table public.supplement_taken enable row level security;

revoke all on table public.supplement_settings, public.supplement_routines, public.supplement_taken
  from public, anon, authenticated, service_role;
grant select on table public.supplement_settings, public.supplement_routines, public.supplement_taken
  to authenticated, service_role;

create policy supplement_settings_select on public.supplement_settings
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy supplement_routines_select on public.supplement_routines
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy supplement_taken_select on public.supplement_taken
  for select to authenticated using (public.can_read_researcher(owner_id));

-- ── Helpers ────────────────────────────────────────────────────────────────

-- The owner's supplement tracking (false until turned on). Internal.
create function public.supplement_tracking_of(p_owner uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.tracking_enabled from public.supplement_settings s where s.owner_id = p_owner), false);
$$;

revoke all on function public.supplement_tracking_of(uuid) from public, anon, authenticated;

-- A decimal argument as an exact numeric, or null when it is not a plain
-- decimal of at most 30 characters (the app sends "2000", "0.5"). Internal.
create function public.supplement_decimal(p_text text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_text ~ '^[0-9]*\.?[0-9]+$' and char_length(p_text) <= 30
              then trim_scale(p_text::numeric) end;
$$;

revoke all on function public.supplement_decimal(text) from public, anon, authenticated;

-- ── Writers ────────────────────────────────────────────────────────────────

create function public.set_supplement_tracking(p_enabled boolean)
returns boolean
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
  if p_enabled is null then
    raise exception 'invalid setting' using errcode = '22023';
  end if;
  insert into public.supplement_settings (owner_id, tracking_enabled, updated_at)
  values (v_uid, p_enabled, now())
  on conflict (owner_id) do update
    set tracking_enabled = excluded.tracking_enabled,
        updated_at = case when supplement_settings.tracking_enabled = excluded.tracking_enabled
                          then supplement_settings.updated_at else excluded.updated_at end;
  return p_enabled;
end;
$$;

revoke all on function public.set_supplement_tracking(boolean) from public, anon;
grant execute on function public.set_supplement_tracking(boolean) to authenticated;

create function public.save_supplement_routine(
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
  v_now timestamptz := now();
  v_name text := public.trim_whitespace(coalesce(p_name, ''));
  v_unit text := public.trim_whitespace(coalesce(p_unit, ''));
  v_amount numeric := public.supplement_decimal(p_amount);
  v_row public.supplement_routines%rowtype;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 or char_length(v_unit) not between 1 and 20
     or v_amount is null or not public.is_supplement_amount(v_amount)
     or coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or (p_id is not null and p_version is null) then
    raise exception 'invalid routine' using errcode = '22023';
  end if;

  if p_id is null then
    if not public.supplement_tracking_of(v_uid) then
      raise exception 'supplement tracking is off' using errcode = 'AP026';
    end if;
    insert into public.supplement_routines as r (
      owner_id, name, amount, unit, time_of_day, start_date, definition_from, created_at, updated_at
    )
    values (
      v_uid, v_name, v_amount, v_unit, p_time, (v_now at time zone 'America/Toronto')::date,
      (v_now at time zone 'America/Toronto')::date, v_now, v_now
    )
    returning r.* into v_row;
    return jsonb_build_object('id', v_row.id, 'version', v_row.version);
  end if;

  select r.* into v_row from public.supplement_routines r where r.id = p_id for update;
  if not found or not public.can_write_researcher(v_row.owner_id) then
    return null;
  end if;
  if not public.supplement_tracking_of(v_uid) then
    raise exception 'supplement tracking is off' using errcode = 'AP026';
  end if;
  if v_row.version <> p_version then
    raise exception 'the routine changed since it was shown' using errcode = 'AP025';
  end if;
  if v_row.end_date is not null then
    raise exception 'the routine has ended' using errcode = 'AP027';
  end if;

  update public.supplement_routines r
  set name = v_name,
      amount = v_amount,
      unit = v_unit,
      time_of_day = p_time,
      -- From today on (never back: the database's clock can step back around midnight).
      definition_from = greatest((v_now at time zone r.time_zone)::date, r.definition_from),
      version = r.version + 1,
      schedule_version = r.schedule_version + 1,
      updated_at = greatest(v_now, r.created_at)
  where r.id = v_row.id
  returning r.* into v_row;
  return jsonb_build_object('id', v_row.id, 'version', v_row.version);
end;
$$;

revoke all on function public.save_supplement_routine(uuid, integer, text, text, text, text) from public, anon;
grant execute on function public.save_supplement_routine(uuid, integer, text, text, text, text) to authenticated;

create function public.end_supplement_routine(p_id uuid, p_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_row public.supplement_routines%rowtype;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_id is null or p_version is null then
    raise exception 'invalid routine' using errcode = '22023';
  end if;
  select r.* into v_row from public.supplement_routines r where r.id = p_id for update;
  if not found or not public.can_write_researcher(v_row.owner_id) then
    return null;
  end if;
  if not public.supplement_tracking_of(v_uid) then
    raise exception 'supplement tracking is off' using errcode = 'AP026';
  end if;
  if v_row.version <> p_version then
    raise exception 'the routine changed since it was shown' using errcode = 'AP025';
  end if;
  if v_row.end_date is not null then
    raise exception 'the routine has ended' using errcode = 'AP027';
  end if;

  update public.supplement_routines r
  -- Never before its start (the database's clock can step back around midnight).
  set end_date = greatest((v_now at time zone r.time_zone)::date, r.definition_from),
      version = r.version + 1,
      schedule_version = r.schedule_version + 1,
      updated_at = greatest(v_now, r.created_at)
  where r.id = v_row.id
  returning r.* into v_row;
  return jsonb_build_object('id', v_row.id, 'version', v_row.version, 'end_date', v_row.end_date);
end;
$$;

revoke all on function public.end_supplement_routine(uuid, integer) from public, anon;
grant execute on function public.end_supplement_routine(uuid, integer) to authenticated;

-- A Taken record as take_supplement() returns it. Internal.
create function public.supplement_taken_result(p_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'routine_id', t.routine_id, 'occurrence_key', t.occurrence_key,
    'scheduled_at', t.scheduled_at, 'actual_at', t.actual_at, 'recorded_at', t.recorded_at,
    'name', t.name, 'amount', t.amount::text, 'unit', t.unit, 'replayed', p_replayed)
  from public.supplement_taken t
  where t.id = p_id;
$$;

revoke all on function public.supplement_taken_result(uuid, boolean) from public, anon, authenticated;

create function public.take_supplement(
  p_request_key uuid,
  p_occurrence_key text,
  p_seen_scheduled_at timestamptz,
  p_seen_name text,
  p_seen_amount text,
  p_seen_unit text,
  p_actual_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_routine public.supplement_routines%rowtype;
  v_existing public.supplement_taken%rowtype;
  v_date date;
  v_scheduled timestamptz;
  v_now timestamptz;
  v_actual timestamptz;
  v_id uuid;
  v_key constant text := '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9]{4}-[0-9]{2}-[0-9]{2})$';
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_request_key is null or coalesce(p_occurrence_key, '') !~ v_key then
    raise exception 'invalid occurrence' using errcode = '22023';
  end if;
  begin
    v_date := to_date(split_part(p_occurrence_key, ':', 2), 'YYYY-MM-DD');
  exception when others then
    raise exception 'invalid occurrence' using errcode = '22023';
  end;
  -- to_date is lenient ("2026-02-30" reads as March 2): the key must be the date written back.
  if to_char(v_date, 'YYYY-MM-DD') <> split_part(p_occurrence_key, ':', 2) then
    raise exception 'invalid occurrence' using errcode = '22023';
  end if;

  select r.* into v_routine from public.supplement_routines r
  where r.id = split_part(p_occurrence_key, ':', 1)::uuid
  for update;
  if not found or not public.can_write_researcher(v_routine.owner_id) then
    return null;
  end if;

  -- A retry of a recorded request returns what was recorded.
  select t.* into v_existing from public.supplement_taken t where t.request_key = p_request_key;
  if found then
    if v_existing.owner_id <> v_uid or v_existing.occurrence_key <> p_occurrence_key then
      raise exception 'request key already used' using errcode = '22023';
    end if;
    return public.supplement_taken_result(v_existing.id, true);
  end if;

  if not public.supplement_tracking_of(v_uid) then
    raise exception 'supplement tracking is off' using errcode = 'AP026';
  end if;
  if v_date < v_routine.definition_from or (v_routine.end_date is not null and v_date > v_routine.end_date) then
    raise exception 'not an occurrence of the routine''s current definition' using errcode = 'AP017';
  end if;
  if exists (select 1 from public.supplement_taken t where t.routine_id = v_routine.id and t.occurrence_key = p_occurrence_key) then
    raise exception 'already taken' using errcode = 'AP018';
  end if;
  if p_seen_scheduled_at is null or p_seen_name is null or p_seen_amount is null or p_seen_unit is null then
    raise exception 'invalid confirmation' using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  if v_date > (v_now at time zone v_routine.time_zone)::date then
    raise exception 'not due yet' using errcode = 'AP019';
  end if;
  v_scheduled := public.cycle_local_instant(v_date, v_routine.time_of_day, v_routine.time_zone);
  if v_scheduled <> p_seen_scheduled_at
     or p_seen_name <> v_routine.name
     or public.supplement_decimal(p_seen_amount) is distinct from v_routine.amount
     or p_seen_unit <> v_routine.unit then
    raise exception 'the occurrence changed since it was shown' using errcode = 'AP020';
  end if;
  v_actual := coalesce(p_actual_at, v_now);
  if v_actual > v_now then
    raise exception 'the actual time is in the future' using errcode = 'AP021';
  end if;
  if v_actual < v_scheduled - interval '1 day' then
    raise exception 'the actual time is more than a day before the planned time' using errcode = 'AP022';
  end if;

  insert into public.supplement_taken (
    owner_id, routine_id, occurrence_key, local_date, scheduled_at, name, amount, unit,
    actual_at, recorded_at, request_key
  ) values (
    v_uid, v_routine.id, p_occurrence_key, v_date, v_scheduled, v_routine.name, v_routine.amount, v_routine.unit,
    v_actual, v_now, p_request_key
  )
  returning id into v_id;
  return public.supplement_taken_result(v_id, false);
exception
  when unique_violation then
    -- Only a request key another account already used can get here.
    raise exception 'request key already used' using errcode = '22023';
end;
$$;

revoke all on function public.take_supplement(uuid, text, timestamptz, text, text, text, timestamptz) from public, anon;
grant execute on function public.take_supplement(uuid, text, timestamptz, text, text, text, timestamptz) to authenticated;

-- ── S13's hook ─────────────────────────────────────────────────────────────

-- A page of the occurrences due in [p_from, p_to) (at most 8 days) of
-- routines whose owner has tracking on, under each routine's current
-- definition, not yet taken, after the cursor (p_after_at, p_after_routine;
-- both null for the first page), at most p_limit (1-1,000), ordered by
-- (scheduled_at, routine_id). See the header for the paging contract.
-- Service role only; it reads across owners (security definer for the
-- internal cycle_local_instant).
create function public.due_supplement_occurrences(
  p_from timestamptz,
  p_to timestamptz,
  p_after_at timestamptz default null,
  p_after_routine uuid default null,
  p_limit integer default 1000
)
returns table (
  owner_id uuid,
  routine_id uuid,
  occurrence_key text,
  local_date date,
  scheduled_at timestamptz,
  schedule_version integer,
  name text,
  amount text,
  unit text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > interval '8 days'
     or (p_after_at is null) <> (p_after_routine is null)
     or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid window or cursor' using errcode = '22023';
  end if;
  return query
  select r.owner_id, r.id, r.id::text || ':' || to_char(o.local_date, 'YYYY-MM-DD'), o.local_date, o.scheduled_at,
         r.schedule_version, r.name, r.amount::text, r.unit
  from public.supplement_routines r
  join public.supplement_settings s on s.owner_id = r.owner_id and s.tracking_enabled
  cross join lateral (
    select g::date as local_date,
           public.cycle_local_instant(g::date, r.time_of_day, r.time_zone) as scheduled_at
    from generate_series(
      greatest(r.definition_from, (p_from at time zone r.time_zone)::date - 1),
      least(coalesce(r.end_date, 'infinity'::date), (p_to at time zone r.time_zone)::date + 1),
      interval '1 day') g
  ) o
  where o.scheduled_at >= p_from and o.scheduled_at < p_to
    and (p_after_at is null or (o.scheduled_at, r.id) > (p_after_at, p_after_routine))
    and not exists (
      select 1 from public.supplement_taken t
      where t.routine_id = r.id and t.occurrence_key = r.id::text || ':' || to_char(o.local_date, 'YYYY-MM-DD'))
  order by o.scheduled_at, r.id
  limit p_limit;
end;
$$;

revoke all on function public.due_supplement_occurrences(timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.due_supplement_occurrences(timestamptz, timestamptz, timestamptz, uuid, integer) to service_role;
