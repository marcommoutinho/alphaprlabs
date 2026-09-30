-- S13 review (2026-09-30): one rule for a repeated wall-clock time, however
-- long the repeat.
--
-- The engine (src/lib/schedule/zone.ts, Temporal's "compatible"
-- disambiguation) takes the EARLIER instant of a repeated local time, and
-- moves a time in a spring-forward gap forward by the gap. The database's two
-- resolvers, cycle_local_instant (20260926180000_cycles.sql) and
-- cycle_wall_instant (20260926200000_doses.sql), matched it only for repeats
-- of 60 or 30 minutes: AT TIME ZONE takes the LATER instant, and they stepped
-- back only by 1 hour or 30 minutes. Antarctica/Troll repeats 2 hours
-- (01:00-03:00 on the last Sunday of October), so a 01:30 dose was planned
-- two hours after the app's time for it. The reminder planner (through
-- cycle_plan_occurrences) and the dispatcher's recheck (the engine) must use
-- the same instant in every zone.
--
-- The rule now: of the offsets in effect up to a day before (1 day, 12, 3
-- and 1 hours, 30 minutes back), the earliest instant whose wall clock in the
-- zone is the requested one; when there is none (a spring-forward gap), AT
-- TIME ZONE's instant, which moves forward by the gap. That covers any repeat
-- shorter than a day, and gives the same instant as before for every zone
-- whose repeats are 30 or 60 minutes (every zone the app's tests cover), so
-- nothing already scheduled or recorded moves, except in zones with longer
-- repeats, where the database now agrees with the app (which is what those
-- callers were written to do: confirm_dose, skip_dose and the cycle writers
-- compare with the engine, tests/integration/cycle-parity.test.ts).
-- Recorded history is not recomputed: recorded doses keep the scheduled
-- time stored with them.
--
-- cycle_local_instant now delegates to cycle_wall_instant: one rule. Both
-- keep their signatures, volatility and (internal) grants.

create or replace function public.cycle_wall_instant(p_wall timestamp, p_time_zone text)
returns timestamptz
language sql
stable
parallel safe
set search_path = ''
as $$
  select coalesce(
    (select min(c.at)
     from (values (interval '1 day'), (interval '12 hours'), (interval '3 hours'), (interval '1 hour'), (interval '30 minutes')) b(back)
     -- The wall time read with the offset in effect `back` earlier.
     cross join lateral (
       select (p_wall - (((x.at - b.back) at time zone p_time_zone) - ((x.at - b.back) at time zone 'UTC'))) at time zone 'UTC' as at
     ) c
     where (c.at at time zone p_time_zone) = p_wall and c.at <= x.at),
    x.at)
  from (select p_wall at time zone p_time_zone as at) x;
$$;

create or replace function public.cycle_local_instant(p_date date, p_time text, p_time_zone text)
returns timestamptz
language sql
stable
parallel safe
set search_path = ''
as $$
  select public.cycle_wall_instant(p_date + p_time::time, p_time_zone);
$$;

revoke all on function public.cycle_wall_instant(timestamp, text) from public, anon, authenticated;
revoke all on function public.cycle_local_instant(date, text, text) from public, anon, authenticated;
