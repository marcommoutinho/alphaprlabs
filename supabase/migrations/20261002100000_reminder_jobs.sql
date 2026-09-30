-- S13: the reminder queue ("Reminder delivery design"; Marco's decisions of
-- 2026-09-26: doses follow the phone's clock, a due reminder more than 15
-- minutes late is skipped, follow-ups stop once the dose is logged; and of
-- 2026-09-30, superseding plan D3's 30-minute and 2-hour follow-ups: one
-- follow-up an hour after the planned time, the last reminder for that dose,
-- and a heads-up before each dose time, on by default 15 minutes before).
--
-- Records:
--   reminder_jobs   one row per occurrence x reminder x device:
--                     source 'dose': a peptide dose occurrence (plan_id,
--                       occurrence_key: the engine's key) with two
--                       reminders: 'due' and 'follow-up-1h'
--                       (src/lib/schedule/reminders.ts REMINDER_OFFSETS);
--                     source 'heads-up': ONE per owner and planned instant,
--                       grouping every dose planned at that time (kind
--                       'heads-up'; no plan_id). occurrence_key is the
--                       instant's text, occurrence_at the instant, and
--                       lead_minutes the owner's setting when it was planned
--                       (account_preferences.heads_up_minutes: 15, 30 or 60;
--                       0 is Off and plans none; no row reads 15), so
--                       send_at = occurrence_at - lead_minutes;
--                     source 'supplement': a supplement routine occurrence
--                       (routine_id, occurrence_key "<routine>:<date>") with
--                       'due' only (no follow-up and no heads-up; the badge
--                       never counts supplements).
--                   A job is for a DEVICE (push_subscriptions.device_id: one
--                   browser), not for a subscription row: a device whose push
--                   endpoint rotated can hold two active rows, and it still
--                   gets one notification. subscription_id is the device's
--                   newest active row when planned; the claim moves it to
--                   the device's newest active row at that moment, the one
--                   it is sent to. A row without
--                   a device id (none exist since S3.1) is its own device.
--                   job_key is stable and unique: source, occurrence key
--                   (the owner for a heads-up), the occurrence's scheduled
--                   instant (a dose whose time moves gets new keys;
--                   src/lib/schedule/reminders.ts), reminder (a heads-up's
--                   lead) and device. The planner inserts ON CONFLICT on the
--                   key, so a duplicate or overlapping cron call never adds
--                   a second row, and a row is sent at most once by the
--                   dispatcher. The one update on conflict: a job suppressed
--                   only for a reason that has since cleared ("terms
--                   outdated", "device off": the planner plans only for an
--                   owner on the current terms and a device that is on) goes
--                   back to pending while the planner still plans it (still
--                   relevant). It was never sent, so it still goes out at
--                   most once.
--                   status: pending -> claimed (a lease) -> sent | suppressed
--                   | failed | gone, or back to pending for a retry. "sent"
--                   means the push service ACCEPTED the message, never that
--                   it was delivered, seen or acted on. result holds the
--                   suppression reason or the error.
--   reminder_plan_next   per peptide plan: when the planner next needs to
--                   expand it (next_at), as of its schedule_version. Planning
--                   cost follows what is due near now, not every schedule:
--                   a plan is expanded only when one of its open occurrences
--                   has a reminder moment in the next minute (the heads-up
--                   leads 60, 30 and 15 minutes before, the due time, the
--                   follow-up an hour after), when it has never been
--                   expanded, or when its schedule changed
--                   (cycle_plans.schedule_version: a dose recorded, skipped
--                   or undone, or an edit that added a revision), or when
--                   its owner's reminder inputs changed (inputs_version:
--                   reminder_owner_inputs). The expansion is still the whole
--                   plan: the every-N-days rule depends on every earlier
--                   dose, so a window of it cannot be computed alone. Filled
--                   at deploy for the plans already there
--                   (reminder_plan_next_backfill), with their real next
--                   moments.
--   reminder_owner_inputs  per owner, a stamp bumped by triggers whenever
--                   anything besides the schedule that decides their
--                   reminders changes (the heads-up setting, their devices,
--                   the terms agreement).
--   reminder_planner_state  the supplement feed's cursor while a planning
--                   window holds more rows than one call reads.
--
-- The dispatcher (src/lib/reminders/dispatch.ts, called every minute by
-- /api/cron/reminders) does, per call:
--   1. plan_reminder_jobs(p_now, p_max_plans, p_max_supplements,
--      p_budget_ms): plans the reminders whose time is in (now - 30 minutes,
--      now + 1 minute] (a follow-up's: [now - 2 hours, now + 1 minute],
--      while it stays relevant, src/lib/schedule/reminders.ts
--      FOLLOW_UP_RELEVANCE_MINUTES, inclusive at both ends as there) for
--      every device of an owner on the current research terms, from
--      cycle_plan_occurrences() (plans in the current revision of each cycle
--      with an active phase around now; not logged, not skipped; a heads-up
--      when the owner's setting is on) and due_supplement_occurrences().
--      Bounded: at most p_max_plans plan expansions (most urgent first) and
--      p_max_supplements supplement rows, and it stops starting new work
--      once p_budget_ms has passed, leaving the rest to the next call
--      (plans stay due in reminder_plan_next; the supplement cursor is
--      kept), so repeated calls converge and the call's sending always gets
--      its share of time. A missed call is caught up by the next one; a
--      reminder already too late is still planned so the dispatcher records
--      it as skipped ("late"). It also purges finished jobs older than 30
--      days (bounded). Returns the clock it used: the database's now()
--      unless the caller passes one (tests).
--   2. claim_reminder_jobs(p_now, p_limit, p_lease_seconds, p_max_attempts):
--      claims up to p_limit jobs that are due (pending, next_attempt_at <=
--      now) or whose lease expired (an interrupted call), with FOR UPDATE
--      SKIP LOCKED, so overlapping calls never claim the same job. Each
--      claim takes a new lease token and counts one attempt; an expired
--      lease already at p_max_attempts fails instead. It returns each job
--      with its device's newest active row (endpoint and keys) and the
--      send-time facts only the database knows: whether the device is still
--      on for the job's owner (active, still that owner's, not marked off in
--      push_device_off) and whether the owner still agrees to the current
--      terms.
--   3. The dispatcher rechecks the occurrence itself (logged, skipped, gone
--      or moved by an edit, cycle or phase ended, superseded, late; for a
--      heads-up: the setting, and every dose still planned at that instant)
--      from the owner's records read after the claim (a supplement: only the
--      claimed occurrences, reminder_supplement_occurrences), rereads the
--      subscription right before sending (still active, the owner's, the
--      same endpoint and keys, and still its device's newest active row
--      whoever it belongs to), and sends through src/lib/push/send.ts.
--   4. finish_reminder_job(p_id, p_lease_token, ...): records the outcome,
--      only while the caller still holds the lease (a call whose lease
--      expired and was taken over records nothing), or puts the job back to
--      pending for a bounded retry at p_retry_at.
--
-- Time: every function takes the dispatcher's clock (p_now; null = now()),
-- so tests run whole reminder timelines against the real database.
--
-- Access (deny by default): the queue is server-only. No API role reads or
-- writes these tables, and the functions are the service role's only (the
-- cron route, with the secret key). The service role may read the tables
-- (operations and tests); it writes only through the functions.

create table public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null check (char_length(job_key) <= 400),
  source text not null check (source in ('dose', 'heads-up', 'supplement')),
  kind text not null check (kind in ('due', 'follow-up-1h', 'heads-up')),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  -- The device (push_subscriptions.device_id), or null: the row is its own device.
  device_id uuid,
  plan_id uuid,
  routine_id uuid,
  occurrence_key text not null check (char_length(occurrence_key) <= 200),
  -- The occurrence's scheduled instant when the job was planned.
  occurrence_at timestamptz not null,
  -- When the reminder is meant to go out (occurrence_at + the reminder's
  -- offset; a heads-up's occurrence_at - lead_minutes).
  send_at timestamptz not null,
  -- A heads-up's lead: the owner's setting when it was planned.
  lead_minutes smallint check (lead_minutes in (15, 30, 60)),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'sent', 'suppressed', 'failed', 'gone')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  -- Pending: when it may be claimed. Claimed: when its lease expires.
  next_attempt_at timestamptz not null,
  lease_token uuid,
  -- Suppression reason or error (never a payload).
  result text not null default '' check (char_length(result) <= 300),
  -- The push service's HTTP status, when it answered.
  status_code integer,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_jobs_key unique (job_key),
  constraint reminder_jobs_source_shape check (
    (source = 'dose' and kind in ('due', 'follow-up-1h') and plan_id is not null and routine_id is null
      and lead_minutes is null)
    or (source = 'heads-up' and kind = 'heads-up' and plan_id is null and routine_id is null
      and lead_minutes is not null and send_at = occurrence_at - make_interval(mins => lead_minutes))
    or (source = 'supplement' and kind = 'due' and routine_id is not null and plan_id is null
      and lead_minutes is null)
  ),
  constraint reminder_jobs_lease check ((status = 'claimed') = (lease_token is not null)),
  constraint reminder_jobs_finished check ((status in ('sent', 'suppressed', 'failed', 'gone')) = (finished_at is not null))
);

-- The claim's one range: open jobs (pending or claimed) by next_attempt_at.
create index reminder_jobs_open on public.reminder_jobs (next_attempt_at, id) where status in ('pending', 'claimed');
create index reminder_jobs_finished_at on public.reminder_jobs (finished_at) where finished_at is not null;
create index reminder_jobs_by_owner on public.reminder_jobs (owner_id);
create index reminder_jobs_by_subscription on public.reminder_jobs (subscription_id);

alter table public.reminder_jobs enable row level security;
revoke all on table public.reminder_jobs from public, anon, authenticated, service_role;
grant select on table public.reminder_jobs to service_role;

create table public.reminder_plan_next (
  plan_id uuid primary key references public.cycle_plans (id) on delete cascade,
  -- The plan's schedule_version when it was expanded.
  schedule_version integer not null,
  -- The owner's reminder_owner_inputs.version when it was expanded.
  inputs_version bigint not null default 0,
  -- The next reminder moment of its open occurrences after that expansion
  -- ('infinity': none left); the plan is expanded again once it is within a minute.
  next_at timestamptz not null,
  checked_at timestamptz not null
);

create index reminder_plan_next_due on public.reminder_plan_next (next_at);

alter table public.reminder_plan_next enable row level security;
revoke all on table public.reminder_plan_next from public, anon, authenticated, service_role;
grant select on table public.reminder_plan_next to service_role;

create table public.reminder_planner_state (
  id boolean primary key default true check (id),
  -- Where the supplement feed resumes within the window (null: its start).
  supplement_after_at timestamptz,
  supplement_after_routine uuid,
  constraint reminder_planner_state_cursor check ((supplement_after_at is null) = (supplement_after_routine is null))
);

insert into public.reminder_planner_state default values;

alter table public.reminder_planner_state enable row level security;
revoke all on table public.reminder_planner_state from public, anon, authenticated, service_role;
grant select on table public.reminder_planner_state to service_role;

-- Per owner: a stamp of everything besides the schedule that decides which
-- reminders are planned for them. Bumped by triggers whenever it changes: the
-- Advance heads-up setting (account_preferences.heads_up_minutes), a push
-- subscription added, removed, enabled, disabled, moved to another owner or
-- device, or re-keyed (every owner with an active row on that device), a
-- device marked off or on again (push_device_off), and the research terms
-- agreement (profiles.acknowledged_at, acknowledgement_version). The planner
-- expands an owner's plans again when their stamp differs from the one they
-- were expanded with. Supplements need none: the planner reads the whole
-- supplement window on every call (due_supplement_occurrences follows the
-- routines, tracking and terms as they are then).
create table public.reminder_owner_inputs (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  version bigint not null default 1,
  changed_at timestamptz not null default now()
);

alter table public.reminder_owner_inputs enable row level security;
revoke all on table public.reminder_owner_inputs from public, anon, authenticated, service_role;
grant select on table public.reminder_owner_inputs to service_role;

-- The owners' stamps, bumped (an owner being deleted is skipped).
create function public.reminder_inputs_bump(p_owners uuid[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.reminder_owner_inputs as i (owner_id)
  select distinct o from unnest(p_owners) o
  where o is not null and exists (select 1 from public.profiles p where p.id = o)
  on conflict (owner_id) do update set version = i.version + 1, changed_at = now();
$$;

revoke all on function public.reminder_inputs_bump(uuid[]) from public, anon, authenticated;

create function public.reminder_inputs_on_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reminder_inputs_bump(array[case when tg_op = 'DELETE' then old.owner_id else new.owner_id end]);
  return null;
end;
$$;

create function public.reminder_inputs_on_push_subscriptions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owners uuid[] := '{}';
  v_devices uuid[] := '{}';
begin
  if tg_op <> 'INSERT' then
    v_owners := v_owners || old.profile_id;
    v_devices := v_devices || old.device_id;
  end if;
  if tg_op <> 'DELETE' then
    v_owners := v_owners || new.profile_id;
    v_devices := v_devices || new.device_id;
  end if;
  -- Every owner with an active row on the device: which of them the device
  -- now belongs to (its newest active row) may have changed.
  perform public.reminder_inputs_bump(v_owners || array(
    select s.profile_id from public.push_subscriptions s
    where s.device_id = any(v_devices) and s.disabled_at is null));
  return null;
end;
$$;

create function public.reminder_inputs_on_device_off()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reminder_inputs_bump(array[case when tg_op = 'DELETE' then old.profile_id else new.profile_id end]);
  return null;
end;
$$;

create function public.reminder_inputs_on_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reminder_inputs_bump(array[new.id]);
  return null;
end;
$$;

revoke all on function public.reminder_inputs_on_preferences() from public, anon, authenticated;
revoke all on function public.reminder_inputs_on_push_subscriptions() from public, anon, authenticated;
revoke all on function public.reminder_inputs_on_device_off() from public, anon, authenticated;
revoke all on function public.reminder_inputs_on_terms() from public, anon, authenticated;

create trigger reminder_inputs_added_removed
  after insert or delete on public.account_preferences
  for each row execute function public.reminder_inputs_on_preferences();
create trigger reminder_inputs_heads_up
  after update on public.account_preferences
  for each row when (old.heads_up_minutes is distinct from new.heads_up_minutes)
  execute function public.reminder_inputs_on_preferences();

-- (A sync that only refreshes last_seen_at or the label changes nothing planned.)
create trigger reminder_inputs_added_removed
  after insert or delete on public.push_subscriptions
  for each row execute function public.reminder_inputs_on_push_subscriptions();
create trigger reminder_inputs_changed
  after update on public.push_subscriptions
  for each row when (
    old.profile_id is distinct from new.profile_id or old.disabled_at is distinct from new.disabled_at
    or old.device_id is distinct from new.device_id or old.endpoint is distinct from new.endpoint
    or old.p256dh is distinct from new.p256dh or old.auth is distinct from new.auth)
  execute function public.reminder_inputs_on_push_subscriptions();

create trigger reminder_inputs_off_on
  after insert or delete on public.push_device_off
  for each row execute function public.reminder_inputs_on_device_off();

create trigger reminder_inputs_terms
  after update on public.profiles
  for each row when (
    old.acknowledged_at is distinct from new.acknowledged_at
    or old.acknowledgement_version is distinct from new.acknowledgement_version)
  execute function public.reminder_inputs_on_terms();

-- A device's active rows, whoever they belong to (its newest one decides whose it is).
create index push_subscriptions_active_by_device on public.push_subscriptions (device_id)
  where disabled_at is null and device_id is not null;

-- "2026-09-30T12:05:00.000000Z": one spelling per instant for job keys.
create function public.reminder_instant_text(p_at timestamptz)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

revoke all on function public.reminder_instant_text(timestamptz) from public, anon, authenticated;
grant execute on function public.reminder_instant_text(timestamptz) to service_role;

-- An owner's devices that may receive reminders: one row per device (a row
-- without a device id is its own device), the device's newest active
-- subscription WHOEVER it belongs to, kept only when it is the owner's (a
-- device another account registered on since, even under a new endpoint, is
-- no longer this owner's), and not marked off. The terms are checked by the
-- callers. Older rows are not retired: the newest one decides.
create function public.reminder_devices(p_owner uuid)
returns table (subscription_id uuid, device_id uuid, device_key uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.device_id, coalesce(n.device_id, n.id)
  from (
    select distinct on (coalesce(s.device_id, s.id)) s.id, s.device_id, s.profile_id
    from public.push_subscriptions s
    where s.disabled_at is null
      and (s.profile_id = p_owner
           or s.device_id in (
             select m.device_id from public.push_subscriptions m
             where m.profile_id = p_owner and m.disabled_at is null and m.device_id is not null))
    order by coalesce(s.device_id, s.id), s.last_seen_at desc, s.created_at desc, s.id
  ) n
  where n.profile_id = p_owner
    and not exists (
      select 1 from public.push_device_off o where o.profile_id = p_owner and o.device_id = n.device_id);
$$;

revoke all on function public.reminder_devices(uuid) from public, anon, authenticated;
grant execute on function public.reminder_devices(uuid) to service_role;

-- A plan's reminder moments: the heads-up leads (every choice,
-- src/lib/preferences/rules.ts HEADS_UP_CHOICES), the due time and the
-- follow-up an hour after.
create function public.reminder_moments(p_at timestamptz)
returns setof timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$
  values (p_at - interval '60 minutes'), (p_at - interval '30 minutes'), (p_at - interval '15 minutes'), (p_at), (p_at + interval '1 hour');
$$;

revoke all on function public.reminder_moments(timestamptz) from public, anon, authenticated;

-- A cheap estimate of a plan's next reminder moment from p_from on, without
-- expanding it (a ranking, never a schedule): its active phases' planned
-- time of day on the local dates around [p_from, p_to], whether or not a dose
-- falls on that date (weekdays, every N days and time changes ignored), so
-- it is at worst early. Null: no moment around now.
create function public.reminder_plan_estimate(p_plan uuid, p_revision uuid, p_time_zone text, p_from timestamptz, p_to timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(m.at)
  from public.cycle_revision_phases ph
  cross join lateral generate_series(
    greatest(ph.start_date, ((p_from - interval '1 hour') at time zone p_time_zone)::date),
    least(ph.end_date, ((p_to + interval '1 hour') at time zone p_time_zone)::date),
    interval '1 day') d(day)
  cross join lateral public.reminder_moments(public.cycle_local_instant(d.day::date, ph.local_time, p_time_zone)) m(at)
  where ph.revision_id = p_revision and ph.plan_id = p_plan and ph.kind = 'active'
    and m.at >= p_from;
$$;

revoke all on function public.reminder_plan_estimate(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;

-- ── 1. Plan the reminders around now (bounded) ─────────────────────────────
-- Returns { now: the clock used, planned: new rows, purged: old rows removed,
-- expanded: plans expanded, plans_more: plans left for the next call,
-- supplements_read: feed rows read, supplements_more: feed rows left }.
create function public.plan_reminder_jobs(
  p_now timestamptz default null,
  p_max_plans integer default 200,
  p_max_supplements integer default 2000,
  p_budget_ms integer default 10000
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  -- Due reminders and heads-ups whose time is in (v_from, v_to]; follow-ups in [v_follow_from, v_to].
  v_from timestamptz := coalesce(p_now, now()) - interval '30 minutes';
  v_follow_from timestamptz := coalesce(p_now, now()) - interval '2 hours';
  v_to timestamptz := coalesce(p_now, now()) + interval '1 minute';
  v_started timestamptz := clock_timestamp();
  v_budget interval;
  v_planned integer := 0;
  v_rows integer;
  v_next timestamptz;
  v_expanded integer := 0;
  v_plans_more boolean := false;
  v_read integer := 0;
  v_page integer;
  v_feed integer;
  v_after_at timestamptz;
  v_after_routine uuid;
  v_last_at timestamptz;
  v_last_routine uuid;
  v_supplements_more boolean := false;
  v_purged integer;
  r record;
begin
  if p_max_plans is null or p_max_plans not between 0 and 1000
     or p_max_supplements is null or p_max_supplements not between 0 and 10000
     or p_budget_ms is null or p_budget_ms not between 100 and 50000 then
    raise exception 'invalid planning bounds' using errcode = '22023';
  end if;
  v_budget := make_interval(secs => p_budget_ms / 1000.0);

  -- Peptide doses, a plan at a time: the plans with a reminder moment within
  -- the next minute (or before it, missed), never expanded, or changed since
  -- (their schedule, or their owner's reminder inputs); the most urgent
  -- first. A plan never expanded, or changed, is ranked by its estimated
  -- next moment (reminder_plan_estimate: its phases' planned time of day
  -- around now, every heads-up lead included; a changed plan also by its
  -- recorded next moment, whichever is sooner), so one due in the next
  -- minutes goes ahead of others however many there are; one with no
  -- moment around now goes last.
  for r in
    with candidates as materialized (
      select cp.id as plan_id, c.owner_id, cp.schedule_version, coalesce(oi.version, 0) as inputs_version,
             rv.id as revision_id, rv.time_zone,
             n.plan_id is null as unseen,
             n.plan_id is not null and (n.schedule_version <> cp.schedule_version or n.inputs_version <> coalesce(oi.version, 0)) as changed,
             n.next_at
      from public.cycles c
      join public.cycle_revisions rv on rv.cycle_id = c.id and rv.number = c.current_revision
      join public.cycle_revision_plans rp on rp.revision_id = rv.id
      join public.cycle_plans cp on cp.id = rp.plan_id
      left join public.reminder_plan_next n on n.plan_id = cp.id
      left join public.reminder_owner_inputs oi on oi.owner_id = c.owner_id
      where (n.plan_id is null or n.schedule_version <> cp.schedule_version
             or n.inputs_version <> coalesce(oi.version, 0) or n.next_at <= v_to)
        and exists (
          select 1 from public.cycle_revision_phases ph
          where ph.revision_id = rv.id and ph.plan_id = rp.plan_id and ph.kind = 'active'
            and ph.start_date <= ((v_to + interval '1 hour') at time zone rv.time_zone)::date
            and ph.end_date >= ((v_follow_from - interval '1 hour') at time zone rv.time_zone)::date)
        and exists (select 1 from public.reminder_devices(c.owner_id))
        and public.agreed_to_current_terms(c.owner_id)
    )
    select k.plan_id, k.owner_id, k.schedule_version, k.inputs_version
    from candidates k
    order by case when k.unseen then coalesce(public.reminder_plan_estimate(k.plan_id, k.revision_id, k.time_zone, v_follow_from, v_to), 'infinity')
                  when k.changed then least(k.next_at, coalesce(public.reminder_plan_estimate(k.plan_id, k.revision_id, k.time_zone, v_follow_from, v_to), 'infinity'))
                  else k.next_at end,
             k.plan_id
    limit p_max_plans + 1
  loop
    if v_expanded >= p_max_plans or clock_timestamp() - v_started >= v_budget then
      v_plans_more := true;
      exit;
    end if;

    with devices as (
      select d.* from public.reminder_devices(r.owner_id) d
    ),
    lead_setting as (
      select coalesce((select ap.heads_up_minutes from public.account_preferences ap where ap.owner_id = r.owner_id), 15)::integer as minutes
    ),
    -- The plan's open occurrences (not logged, not skipped), once.
    open_occ as materialized (
      select o.occurrence_key, o.scheduled_at
      from public.cycle_plan_occurrences(r.plan_id) o
      where o.actual_at is null
        and not exists (
          select 1 from public.dose_skips sk where sk.plan_id = r.plan_id and sk.occurrence_key = o.occurrence_key)
    ),
    slots as (
      select o.occurrence_key, o.scheduled_at, k.kind, o.scheduled_at + k.offset_by as send_at
      from open_occ o
      cross join (values ('due', interval '0 minutes'), ('follow-up-1h', interval '1 hour')) k(kind, offset_by)
      where o.scheduled_at + k.offset_by <= v_to
        and case when k.kind = 'due' then o.scheduled_at + k.offset_by > v_from
                 else o.scheduled_at + k.offset_by >= v_follow_from end
    ),
    heads_up as (
      select o.scheduled_at, l.minutes as lead, o.scheduled_at - make_interval(mins => l.minutes) as send_at
      from open_occ o cross join lead_setting l
      where l.minutes > 0
        and o.scheduled_at - make_interval(mins => l.minutes) > v_from
        and o.scheduled_at - make_interval(mins => l.minutes) <= v_to
    ),
    dose_jobs as (
      insert into public.reminder_jobs as j
        (job_key, source, kind, owner_id, subscription_id, device_id, plan_id, occurrence_key, occurrence_at, send_at, next_attempt_at)
      select 'dose:' || s.occurrence_key || '@' || public.reminder_instant_text(s.scheduled_at) || '#' || s.kind || ':' || d.device_key,
             'dose', s.kind, r.owner_id, d.subscription_id, d.device_id, r.plan_id, s.occurrence_key, s.scheduled_at, s.send_at, s.send_at
      from slots s
      cross join devices d
      on conflict (job_key) do update set
        status = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at, subscription_id = excluded.subscription_id,
        result = '', status_code = null, finished_at = null, updated_at = now()
      where j.status = 'suppressed' and j.result in ('terms outdated', 'device off')
      returning 1
    ),
    -- One per owner, instant and device: another plan with a dose at the same time plans the same key.
    heads_up_jobs as (
      insert into public.reminder_jobs as j
        (job_key, source, kind, owner_id, subscription_id, device_id, occurrence_key, occurrence_at, send_at, lead_minutes, next_attempt_at)
      select 'heads-up:' || r.owner_id || '@' || public.reminder_instant_text(h.scheduled_at) || '#' || h.lead || 'm:' || d.device_key,
             'heads-up', 'heads-up', r.owner_id, d.subscription_id, d.device_id, public.reminder_instant_text(h.scheduled_at),
             h.scheduled_at, h.send_at, h.lead, h.send_at
      from heads_up h
      cross join devices d
      on conflict (job_key) do update set
        status = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at, subscription_id = excluded.subscription_id,
        result = '', status_code = null, finished_at = null, updated_at = now()
      where j.status = 'suppressed' and j.result in ('terms outdated', 'device off')
      returning 1
    )
    select (select count(*) from dose_jobs) + (select count(*) from heads_up_jobs),
           -- The next reminder moment after this window: a heads-up lead
           -- (every choice, src/lib/preferences/rules.ts HEADS_UP_CHOICES),
           -- the due time or the follow-up.
           (select min(e.at)
            from open_occ o
            cross join lateral public.reminder_moments(o.scheduled_at) e(at)
            where e.at > v_to)
    into v_rows, v_next;
    v_planned := v_planned + v_rows;
    v_expanded := v_expanded + 1;

    -- The versions read before the expansion: a change since shows as a newer version.
    insert into public.reminder_plan_next as n (plan_id, schedule_version, inputs_version, next_at, checked_at)
    values (r.plan_id, r.schedule_version, r.inputs_version, coalesce(v_next, 'infinity'), v_now)
    on conflict (plan_id) do update
      set schedule_version = excluded.schedule_version, inputs_version = excluded.inputs_version,
          next_at = excluded.next_at, checked_at = excluded.checked_at;
  end loop;

  -- Supplements: one reminder when due, from the feed a page at a time, at
  -- most p_max_supplements rows per call. When the window holds more, the
  -- cursor keeps the place for the next call; once the feed is read to the
  -- end, the next call reads the window from its start again.
  select s.supplement_after_at, s.supplement_after_routine into v_after_at, v_after_routine
  from public.reminder_planner_state s where s.id for update;
  if v_after_at is not null and v_after_at <= v_from then
    v_after_at := null;
    v_after_routine := null;
  end if;
  loop
    if v_read >= p_max_supplements or clock_timestamp() - v_started >= v_budget then
      v_supplements_more := p_max_supplements > 0;
      exit;
    end if;
    v_page := least(500, p_max_supplements - v_read);
    with feed as (
      -- Its window's end is exclusive: + 1 microsecond includes v_to.
      select f.* from public.due_supplement_occurrences(v_from, v_to + interval '1 microsecond', v_after_at, v_after_routine, v_page) f
    ),
    last_row as (
      select f.scheduled_at, f.routine_id from feed f order by f.scheduled_at desc, f.routine_id desc limit 1
    ),
    inserted as (
      insert into public.reminder_jobs as j
        (job_key, source, kind, owner_id, subscription_id, device_id, routine_id, occurrence_key, occurrence_at, send_at, next_attempt_at)
      select 'supplement:' || f.occurrence_key || '@' || public.reminder_instant_text(f.scheduled_at) || '#due:' || d.device_key,
             'supplement', 'due', f.owner_id, d.subscription_id, d.device_id, f.routine_id, f.occurrence_key, f.scheduled_at,
             f.scheduled_at, f.scheduled_at
      from feed f
      cross join lateral public.reminder_devices(f.owner_id) d
      where f.scheduled_at > v_from
      on conflict (job_key) do update set
        status = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at, subscription_id = excluded.subscription_id,
        result = '', status_code = null, finished_at = null, updated_at = now()
      where j.status = 'suppressed' and j.result in ('terms outdated', 'device off')
      returning 1
    )
    select (select count(*) from inserted), l.scheduled_at, l.routine_id, (select count(*) from feed)
    into v_rows, v_last_at, v_last_routine, v_feed
    from (select 1) one left join last_row l on true;
    v_planned := v_planned + v_rows;
    v_read := v_read + v_feed;
    if v_feed < v_page then
      -- Read to the end of the window.
      v_after_at := null;
      v_after_routine := null;
      exit;
    end if;
    v_after_at := v_last_at;
    v_after_routine := v_last_routine;
  end loop;
  update public.reminder_planner_state s
  set supplement_after_at = v_after_at, supplement_after_routine = v_after_routine
  where s.id;

  -- Finished jobs are kept 30 days (operations), then removed a bounded batch at a time.
  delete from public.reminder_jobs j
  where j.id in (
    select x.id from public.reminder_jobs x
    where x.finished_at is not null and x.finished_at < v_now - interval '30 days'
    limit 1000);
  get diagnostics v_purged = row_count;

  return jsonb_build_object(
    'now', v_now, 'planned', v_planned, 'purged', v_purged,
    'expanded', v_expanded, 'plans_more', v_plans_more,
    'supplements_read', v_read, 'supplements_more', v_supplements_more);
end;
$$;

revoke all on function public.plan_reminder_jobs(timestamptz, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.plan_reminder_jobs(timestamptz, integer, integer, integer) to service_role;

-- Records the real next reminder moment of every plan the planner could
-- consider and has not seen (in its cycle's current revision, an active phase
-- not over, its owner with a device and on the current terms), so the first
-- planning calls after a deploy go straight to what is due: the earliest
-- moment of an open occurrence from p_now - 2 hours on (the follow-up's
-- catch-up; a moment already reached makes the plan due at once), or
-- 'infinity'. Idempotent (a plan already recorded is left as it is). Run once
-- below; the service role may run it again. Returns the plans recorded.
create function public.reminder_plan_next_backfill(p_now timestamptz default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_rows integer;
begin
  insert into public.reminder_plan_next as n (plan_id, schedule_version, inputs_version, next_at, checked_at)
  select cp.id, cp.schedule_version, coalesce(oi.version, 0), coalesce(nx.at, 'infinity'), v_now
  from public.cycles c
  join public.cycle_revisions rv on rv.cycle_id = c.id and rv.number = c.current_revision
  join public.cycle_revision_plans rp on rp.revision_id = rv.id
  join public.cycle_plans cp on cp.id = rp.plan_id
  left join public.reminder_owner_inputs oi on oi.owner_id = c.owner_id
  cross join lateral (
    select min(e.at) as at
    from public.cycle_plan_occurrences(cp.id) o
    cross join lateral public.reminder_moments(o.scheduled_at) e(at)
    where o.actual_at is null
      and not exists (select 1 from public.dose_skips sk where sk.plan_id = cp.id and sk.occurrence_key = o.occurrence_key)
      and e.at >= v_now - interval '2 hours'
  ) nx
  where not exists (select 1 from public.reminder_plan_next x where x.plan_id = cp.id)
    and exists (
      select 1 from public.cycle_revision_phases ph
      where ph.revision_id = rv.id and ph.plan_id = rp.plan_id and ph.kind = 'active'
        and ph.end_date >= ((v_now - interval '3 hours') at time zone rv.time_zone)::date)
    and exists (select 1 from public.reminder_devices(c.owner_id))
    and public.agreed_to_current_terms(c.owner_id)
  on conflict (plan_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.reminder_plan_next_backfill(timestamptz) from public, anon, authenticated;
grant execute on function public.reminder_plan_next_backfill(timestamptz) to service_role;

select public.reminder_plan_next_backfill();

-- ── Supplement facts at send time ──────────────────────────────────────────
-- The claimed supplement occurrences (at most 100 keys "<routine>:<date>")
-- as the due feed (due_supplement_occurrences) would give them now: a row
-- when the routine's current definition covers that date, tracking is on and
-- the owner is on the current terms, with the instant it is planned for now
-- and whether it has been taken. Reads only those routines and dates.
create function public.reminder_supplement_occurrences(p_occurrence_keys text[])
returns table (
  routine_id uuid,
  occurrence_key text,
  scheduled_at timestamptz,
  name text,
  amount text,
  unit text,
  taken boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_occurrence_keys is null or cardinality(p_occurrence_keys) > 100 then
    raise exception 'invalid occurrence keys' using errcode = '22023';
  end if;
  return query
  select r.id, k.key, public.cycle_local_instant(k.local_date, r.time_of_day, r.time_zone), r.name, r.amount::text, r.unit,
         exists (select 1 from public.supplement_taken t where t.routine_id = r.id and t.occurrence_key = k.key)
  from (
    select distinct x as key, split_part(x, ':', 1)::uuid as routine_id, to_date(split_part(x, ':', 2), 'YYYY-MM-DD') as local_date
    from unnest(p_occurrence_keys) x
    where x ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ) k
  join public.supplement_routines r on r.id = k.routine_id
  join public.supplement_settings s on s.owner_id = r.owner_id and s.tracking_enabled
  where k.local_date >= r.definition_from and k.local_date <= coalesce(r.end_date, 'infinity'::date)
    and public.agreed_to_current_terms(r.owner_id);
end;
$$;

revoke all on function public.reminder_supplement_occurrences(text[]) from public, anon, authenticated;
grant execute on function public.reminder_supplement_occurrences(text[]) to service_role;

-- ── 2. Claim a bounded batch ───────────────────────────────────────────────
create function public.claim_reminder_jobs(
  p_now timestamptz default null,
  p_limit integer default 25,
  p_lease_seconds integer default 120,
  p_max_attempts integer default 3
)
returns table (
  id uuid,
  lease_token uuid,
  source text,
  kind text,
  owner_id uuid,
  plan_id uuid,
  routine_id uuid,
  occurrence_key text,
  occurrence_at timestamptz,
  send_at timestamptz,
  lead_minutes smallint,
  attempts integer,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  device_on boolean,
  owner_agreed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_limit is null or p_limit not between 1 and 100
     or p_lease_seconds is null or p_lease_seconds not between 30 and 900
     or p_max_attempts is null or p_max_attempts not between 1 and 10 then
    raise exception 'invalid claim' using errcode = '22023';
  end if;

  -- An interrupted call's jobs come back once their lease expires; one that
  -- has used every attempt fails instead of going out again.
  update public.reminder_jobs j
  set status = 'failed', lease_token = null, finished_at = v_now, updated_at = now(),
      result = 'lease expired after ' || j.attempts || ' attempts'
  where j.id in (
    select x.id from public.reminder_jobs x
    where x.status = 'claimed' and x.next_attempt_at <= v_now and x.attempts >= p_max_attempts
    for update skip locked);

  return query
  with picked as (
    select x.id from public.reminder_jobs x
    where x.status in ('pending', 'claimed') and x.next_attempt_at <= v_now
    order by x.next_attempt_at, x.id
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.reminder_jobs j
    set status = 'claimed',
        lease_token = gen_random_uuid(),
        next_attempt_at = v_now + make_interval(secs => p_lease_seconds),
        attempts = j.attempts + 1,
        -- The device's newest active row now (its endpoint may have rotated
        -- since planning), else the row the job was planned for (then off,
        -- or gone): the job records the row it is sent to.
        subscription_id = coalesce(
          (select x.id from public.push_subscriptions x
           where j.device_id is not null and x.profile_id = j.owner_id and x.device_id = j.device_id and x.disabled_at is null
           order by x.last_seen_at desc, x.created_at desc, x.id
           limit 1),
          j.subscription_id),
        updated_at = now()
    from picked
    where j.id = picked.id
    returning j.*
  )
  select c.id, c.lease_token, c.source, c.kind, c.owner_id, c.plan_id, c.routine_id, c.occurrence_key,
         c.occurrence_at, c.send_at, c.lead_minutes, c.attempts, s.id, s.endpoint, s.p256dh, s.auth,
         (s.disabled_at is null and s.profile_id = c.owner_id
           and not exists (
             select 1 from public.push_device_off o where o.profile_id = c.owner_id and o.device_id = s.device_id)),
         public.agreed_to_current_terms(c.owner_id)
  from claimed c
  join public.push_subscriptions s on s.id = c.subscription_id
  order by c.send_at, c.id;
end;
$$;

revoke all on function public.claim_reminder_jobs(timestamptz, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_reminder_jobs(timestamptz, integer, integer, integer) to service_role;

-- ── 3. Record the outcome (only under the caller's lease) ──────────────────
-- p_outcome: 'sent', 'suppressed', 'failed', 'gone', or 'retry' (back to
-- pending at p_retry_at). Returns false when the lease is no longer the
-- caller's (it expired and another call took the job): nothing is written.
create function public.finish_reminder_job(
  p_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_result text default '',
  p_status_code integer default null,
  p_retry_at timestamptz default null,
  p_now timestamptz default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_outcome is null or p_outcome not in ('sent', 'suppressed', 'failed', 'gone', 'retry')
     or (p_outcome = 'retry') <> (p_retry_at is not null) then
    raise exception 'invalid outcome' using errcode = '22023';
  end if;

  update public.reminder_jobs j
  set status = case when p_outcome = 'retry' then 'pending' else p_outcome end,
      lease_token = null,
      next_attempt_at = case when p_outcome = 'retry' then p_retry_at else j.next_attempt_at end,
      finished_at = case when p_outcome = 'retry' then null else v_now end,
      result = left(coalesce(p_result, ''), 300),
      status_code = p_status_code,
      updated_at = now()
  where j.id = p_id and j.status = 'claimed' and j.lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.finish_reminder_job(uuid, uuid, text, text, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.finish_reminder_job(uuid, uuid, text, text, integer, timestamptz, timestamptz) to service_role;
