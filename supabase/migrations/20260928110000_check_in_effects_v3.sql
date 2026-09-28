-- V1 (design v3 R6 "Anything unwanted?"): the check-in's unwanted effects
-- become the v3 chips, with a free-text "Other".
--
--   v3 chips, in the sheet's order:
--     None, Site redness, Nausea, Headache, Fatigue, Poor sleep,
--     Water retention, Other (+ its text).
--   "None" is picked alone. "Other" needs its text: effects_other, trimmed,
--   1 to 100 characters (char_length: code points, as the app counts them,
--   src/lib/progress/rules.ts characters); text without "Other" is refused,
--   and so is "Other" without text.
--
-- The earlier chips (20260926220000_progress.sql check_in_effect_list():
-- None noticed, Injection-site redness, Mild headache, Nausea, Fatigue,
-- Appetite change, Other) stay valid for check-ins already stored, which
-- keep their values exactly (production has none; nothing is rewritten).
-- save_check_in only writes the v3 chips from now on. The app shows stored
-- labels under their v3 names where one corresponds (None noticed -> None,
-- Injection-site redness -> Site redness, Mild headache -> Headache;
-- src/lib/progress/rules.ts effectLabel), so old and new check-ins read the
-- same in Progress and in the admin's read-only history.
--
-- A stored check-in's effects are valid when they are EITHER an earlier set
-- (check_in_effects_valid, unchanged, with no Other text: the old "Other"
-- had none) OR a v3 set with its Other text as above. The column check that
-- used check_in_effects_valid alone is replaced by one over both columns;
-- every existing row satisfies it (its effects_other is the default '').
--
-- save_check_in gains p_effects_other (the last argument, default null =
-- no text). Same checks, locks, refusals, result and grants as before
-- (read 20260926220000_progress.sql); the effects rule is now:
--   22023 effects not a v3 set: unknown or repeated chip, "None" with
--         anything else, "Other" without text, text without "Other", or
--         text over 100 characters.
-- The old eight-argument function is dropped (one signature, so PostgREST
-- never has to choose between overloads).

-- ── Vocabulary ─────────────────────────────────────────────────────────────

-- R6's unwanted-effect chips (design v3), in the sheet's order.
create function public.check_in_effect_list_v3()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['None', 'Site redness', 'Nausea', 'Headache', 'Fatigue', 'Poor sleep', 'Water retention', 'Other']::text[];
$$;

revoke all on function public.check_in_effect_list_v3() from public, anon;
grant execute on function public.check_in_effect_list_v3() to authenticated, service_role;

-- A v3 set of chips with its Other text (already trimmed by the caller):
-- distinct, each one of the list, "None" only alone, "Other" exactly when
-- there is text, the text at most 100 characters.
create function public.check_in_effects_v3_valid(p_effects text[], p_other text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_effects is not null
    and p_other is not null
    and array_position(p_effects, null) is null
    and p_effects <@ public.check_in_effect_list_v3()
    and cardinality(p_effects) = (select count(distinct e) from unnest(p_effects) e)
    and (not ('None' = any (p_effects)) or cardinality(p_effects) = 1)
    and ('Other' = any (p_effects)) = (p_other <> '')
    and char_length(p_other) <= 100;
$$;

revoke all on function public.check_in_effects_v3_valid(text[], text) from public, anon;
grant execute on function public.check_in_effects_v3_valid(text[], text) to authenticated, service_role;

-- ── Table ──────────────────────────────────────────────────────────────────

alter table public.progress_check_ins
  add column effects_other text not null default ''
    constraint progress_check_ins_effects_other check (effects_other = public.trim_whitespace(effects_other));

alter table public.progress_check_ins
  drop constraint progress_check_ins_effects_check,
  add constraint progress_check_ins_effects check (
    (public.check_in_effects_valid(effects) and effects_other = '')
    or public.check_in_effects_v3_valid(effects, effects_other)
  );

-- ── Writer ─────────────────────────────────────────────────────────────────

drop function public.save_check_in(date, integer, integer, text[], text, text, numeric, text);

create function public.save_check_in(
  p_day date,
  p_version integer,
  p_feeling integer,
  p_effects text[],
  p_note text,
  p_measurement_name text default null,
  p_measurement_value numeric default null,
  p_measurement_unit text default null,
  p_effects_other text default null
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
  -- Today in the app's one zone (20260926220000_progress.sql header).
  v_today date := public.progress_day(v_now);
  v_row public.progress_check_ins%rowtype;
  v_effects text[];
  v_other text := public.trim_whitespace(coalesce(p_effects_other, ''));
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
  if not public.check_in_effects_v3_valid(p_effects, v_other) then
    raise exception 'invalid unwanted effects' using errcode = '22023';
  end if;
  v_effects := array(
    select e from unnest(p_effects) e order by array_position(public.check_in_effect_list_v3(), e)
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
      owner_id, day, feeling, effects, effects_other, note,
      measurement_name, measurement_value, measurement_unit, measured_at, created_at, updated_at
    )
    values (
      v_uid, v_today, p_feeling, v_effects, v_other, v_note,
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
        effects_other = v_other,
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

revoke all on function public.save_check_in(date, integer, integer, text[], text, text, numeric, text, text) from public, anon;
grant execute on function public.save_check_in(date, integer, integer, text[], text, text, numeric, text, text) to authenticated;
