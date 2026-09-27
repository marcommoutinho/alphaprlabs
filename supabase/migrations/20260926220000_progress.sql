-- S15: progress (R9). One daily check-in per researcher (every admin is also
-- a researcher) across all their active peptides, with one optional
-- goal-related measurement. A check-in needs no cycle (Marco, 2026-09-26: a
-- researcher between cycles, or with none, still checks in). The cycle goal
-- and starting baseline stay on the cycle (public.cycles,
-- 20260926180000_cycles.sql); the Progress screen shows check-ins on their
-- own, or beside a selected cycle's actual doses (dose_records), phases and
-- dates, and never attributes a result to a compound.
--
-- Records:
--   progress_check_ins   one row per researcher per Toronto day (unique): the
--                        overall feeling 1-5 (required), the unwanted effects
--                        picked from R9's fixed chips (none, some, or "None
--                        noticed" alone; no free text: the note covers it),
--                        an optional note, and an optional measurement: its
--                        name (R9's Sleep, Weight, Waist or Other), exact
--                        value, unit and measured_at (when that measurement
--                        was recorded; kept when an edit leaves it unchanged,
--                        the server's clock when it is new or changed).
--                        updated_at is when it was last saved ("saved
--                        HH:MM"); version is the stale-edit token.
--
-- Which day (Marco, 2026-09-26). A check-in's day is ALWAYS the
-- America/Toronto calendar day, by the server's clock: the app is strictly
-- local (the business zone, as business_latest_date() in
-- 20260926160100_business_inventory_writes.sql), so there is exactly one
-- check-in per researcher per day whatever zone their cycles use. The caller
-- sends the day its screen showed; if that is not today in Toronto (the page
-- was opened before midnight, or a past or future day was sent), nothing is
-- saved (AP023). Past days are not added or edited: gaps stay gaps. A
-- Toronto day is a calendar date, so a 23- or 25-hour day around a
-- daylight-saving change is still one day and one check-in.
--
-- save_check_in(p_day, p_version, p_feeling, p_effects, p_note,
--               p_measurement_name, p_measurement_value, p_measurement_unit)
--   * the caller: public.can_write_researcher(owner): the owner, with the
--     disclaimer acknowledged. A support grant never writes; the row is
--     always the caller's own.
--   * p_version: null for the day's first check-in, else the version the
--     screen showed. Editing replaces the day's row in place (version + 1).
--     A first save when the day already has one (another device saved it,
--     including a concurrent first save), or an edit from another version,
--     saves nothing (AP024).
--   * input (22023): feeling 1-5; effects from R9's chips, distinct, "None
--     noticed" only alone (stored in the chips' order); note up to 1,000
--     characters (trimmed); a measurement only when a value is given (its
--     name and unit are ignored otherwise): the name one of R9's, the value a
--     plain decimal from 0 to under 1,000,000 with at most 6 decimals (stored
--     without trailing zeros), the unit 1-20 characters (trimmed). Lengths
--     are char_length: characters (code points), as the app counts them
--     (src/lib/progress/rules.ts characters), never UTF-16 units.
--   Returns { id, day, version, saved_at } (saved_at = updated_at).
--
-- Refusal SQLSTATEs:
--   42501 not an acknowledged researcher        22023 invalid input
--   AP023 the day sent is not today in America/Toronto
--   AP024 the day's check-in changed since it was shown (stale version)
--
-- Lock order: save_check_in locks only the caller's own check-in row for the
-- day (for update; a concurrent first save waits on the unique key). It
-- reads no cycle and takes no lock in the global order of
-- 20260926200100_dose_confirmation.sql (cycle -> plans -> vial -> mixtures);
-- no other writer locks check-ins, so it closes no cycle. Its implicit
-- foreign-key lock (for key share) falls on the caller's profile, as every
-- researcher-owned insert's does.
--
-- Access (deny by default), per the S4 grant rules
-- (20260926150000_support_grants.sql):
--   * Reads: public.can_read_researcher(owner_id): the owner, or an admin
--     holding the owner's active support grant (S17's A8 history reads this
--     table). The admin role alone reads nothing; revoking denies the next
--     read.
--   * Writes: none through the API, for anyone (service_role included).
--     save_check_in() is the only write path; there is no delete (R9 has
--     none).
--
-- Account data (Marco, 2026-09-26): accounts are soft deleted, and closing one
-- must remove identifying details. Notes and measurement units are free text
-- a researcher may put identifying details in: when account closure is
-- designed, it must clear them here too. Until then rows go only with their
-- profile (on delete cascade).

-- ── Helpers ────────────────────────────────────────────────────────────────

-- R9's unwanted-effect chips, in the screen's order.
create function public.check_in_effect_list()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['None noticed', 'Injection-site redness', 'Mild headache', 'Nausea', 'Fatigue', 'Appetite change', 'Other']::text[];
$$;

revoke all on function public.check_in_effect_list() from public, anon;
grant execute on function public.check_in_effect_list() to authenticated, service_role;

-- A set of R9 chips: distinct, each one of the list, "None noticed" only alone.
create function public.check_in_effects_valid(p_effects text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_effects is not null
    and array_position(p_effects, null) is null
    and p_effects <@ public.check_in_effect_list()
    and cardinality(p_effects) = (select count(distinct e) from unnest(p_effects) e)
    and (not ('None noticed' = any (p_effects)) or cardinality(p_effects) = 1);
$$;

revoke all on function public.check_in_effects_valid(text[]) from public, anon;
grant execute on function public.check_in_effects_valid(text[]) to authenticated, service_role;

-- The check-in day of an instant: its America/Toronto calendar date (see the
-- header). The app computes the same (src/lib/progress/rules.ts checkInDay).
create function public.progress_day(p_at timestamptz)
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  select (p_at at time zone 'America/Toronto')::date;
$$;

revoke all on function public.progress_day(timestamptz) from public, anon, authenticated, service_role;

-- R9's measurement names.
create function public.is_measurement_name(p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_name in ('Sleep', 'Weight', 'Waist', 'Other');
$$;

revoke all on function public.is_measurement_name(text) from public, anon;
grant execute on function public.is_measurement_name(text) to authenticated, service_role;

-- ── Table ──────────────────────────────────────────────────────────────────

create table public.progress_check_ins (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- The America/Toronto calendar day it covers.
  day date not null,
  feeling smallint not null check (feeling between 1 and 5),
  effects text[] not null default '{}' check (public.check_in_effects_valid(effects)),
  note text not null default '' check (note = public.trim_whitespace(note) and char_length(note) <= 1000),
  measurement_name text check (public.is_measurement_name(measurement_name)),
  measurement_value numeric check (
    -- Stored without trailing zeros ("80.5", never "80.50"), at most 6 decimals.
    measurement_value >= 0 and measurement_value < 1000000
    and scale(measurement_value) = scale(trim_scale(measurement_value)) and scale(measurement_value) <= 6
  ),
  measurement_unit text check (
    measurement_unit = public.trim_whitespace(measurement_unit) and char_length(measurement_unit) between 1 and 20
  ),
  measured_at timestamptz,
  -- The concurrency token: + 1 on every successful edit.
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_check_ins_measurement check (
    (measurement_name is null and measurement_value is null and measurement_unit is null and measured_at is null)
    or (measurement_name is not null and measurement_value is not null and measurement_unit is not null and measured_at is not null)
  ),
  constraint progress_check_ins_saved check (updated_at >= created_at),
  -- One check-in per researcher per Toronto day (also the index for reads by day).
  constraint progress_check_ins_one_per_day unique (owner_id, day)
);

alter table public.progress_check_ins enable row level security;

revoke all on table public.progress_check_ins from public, anon, authenticated, service_role;
grant select on table public.progress_check_ins to authenticated, service_role;

create policy progress_check_ins_select on public.progress_check_ins
  for select to authenticated using (public.can_read_researcher(owner_id));

-- ── Writer ─────────────────────────────────────────────────────────────────

create function public.save_check_in(
  p_day date,
  p_version integer,
  p_feeling integer,
  p_effects text[],
  p_note text,
  p_measurement_name text default null,
  p_measurement_value numeric default null,
  p_measurement_unit text default null
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
  -- Today in the app's one zone (see the header).
  v_today date := public.progress_day(v_now);
  v_row public.progress_check_ins%rowtype;
  v_effects text[];
  v_note text := public.trim_whitespace(coalesce(p_note, ''));
  v_measured boolean := p_measurement_value is not null;
  v_name text;
  v_value numeric;
  v_unit text;
  v_measured_at timestamptz;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_day is distinct from v_today then
    raise exception 'the day sent is not today in America/Toronto' using errcode = 'AP023';
  end if;

  if p_feeling is null or p_feeling not between 1 and 5 then
    raise exception 'feeling must be 1 to 5' using errcode = '22023';
  end if;
  if not public.check_in_effects_valid(p_effects) then
    raise exception 'invalid unwanted effects' using errcode = '22023';
  end if;
  v_effects := array(
    select e from unnest(p_effects) e order by array_position(public.check_in_effect_list(), e)
  );
  if char_length(v_note) > 1000 then
    raise exception 'the note is too long' using errcode = '22023';
  end if;
  if v_measured then
    v_name := p_measurement_name;
    v_value := trim_scale(p_measurement_value);
    v_unit := public.trim_whitespace(p_measurement_unit);
    if not coalesce(public.is_measurement_name(v_name), false)
       or v_value < 0 or v_value >= 1000000 or scale(v_value) > 6
       or v_unit is null or char_length(v_unit) not between 1 and 20 then
      raise exception 'invalid measurement' using errcode = '22023';
    end if;
  end if;

  select ci.* into v_row
  from public.progress_check_ins ci
  where ci.owner_id = v_uid and ci.day = v_today
  for update;

  if p_version is null then
    if found then
      raise exception 'the day already has a check-in' using errcode = 'AP024';
    end if;
    insert into public.progress_check_ins as ci (
      owner_id, day, feeling, effects, note,
      measurement_name, measurement_value, measurement_unit, measured_at, created_at, updated_at
    )
    values (
      v_uid, v_today, p_feeling, v_effects, v_note,
      v_name, v_value, v_unit, case when v_measured then v_now end, v_now, v_now
    )
    on conflict (owner_id, day) do nothing
    returning ci.* into v_row;
    -- A concurrent first save for the same day won.
    if not found then
      raise exception 'the day already has a check-in' using errcode = 'AP024';
    end if;
  else
    if not found or v_row.version <> p_version then
      raise exception 'the check-in changed since it was shown' using errcode = 'AP024';
    end if;
    v_measured_at := case
      when not v_measured then null
      when v_row.measurement_name = v_name and v_row.measurement_value = v_value and v_row.measurement_unit = v_unit
        then v_row.measured_at
      else v_now
    end;
    update public.progress_check_ins ci
    set feeling = p_feeling,
        effects = v_effects,
        note = v_note,
        measurement_name = v_name,
        measurement_value = v_value,
        measurement_unit = v_unit,
        measured_at = v_measured_at,
        version = ci.version + 1,
        updated_at = greatest(v_now, ci.created_at)
    where ci.id = v_row.id
    returning ci.* into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'day', v_row.day,
    'version', v_row.version,
    'saved_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.save_check_in(date, integer, integer, text[], text, text, numeric, text) from public, anon;
grant execute on function public.save_check_in(date, integer, integer, text[], text, text, numeric, text) to authenticated;
