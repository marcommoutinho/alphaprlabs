-- S13: the reminder queue ("Reminder delivery design"; plan D3; Marco's
-- decisions of 2026-09-26: doses follow the phone's clock, a reminder more
-- than 15 minutes late is skipped while the 30-minute and 2-hour follow-ups
-- still go out, follow-ups stop once the dose is logged).
--
-- Records:
--   reminder_jobs   one row per occurrence x reminder x device:
--                     source 'dose': a peptide dose occurrence (plan_id,
--                       occurrence_key: the engine's key) with three
--                       reminders: 'due', 'follow-up-30m', 'follow-up-2h'
--                       (src/lib/schedule/reminders.ts REMINDER_OFFSETS);
--                     source 'supplement': a supplement routine occurrence
--                       (routine_id, occurrence_key "<routine>:<date>") with
--                       'due' only (D3's follow-ups are for doses; the badge
--                       and follow-ups never count supplements).
--                   job_key is stable and unique: source, occurrence key,
--                   the occurrence's scheduled instant (a dose whose time
--                   moves gets new keys; src/lib/schedule/reminders.ts),
--                   reminder and device (push_subscriptions.id). The
--                   planner inserts with ON CONFLICT DO NOTHING, so a
--                   duplicate or overlapping cron call never adds a second
--                   row, and a row is sent at most once by the dispatcher.
--                   status: pending -> claimed (a lease) -> sent | suppressed
--                   | failed | gone, or back to pending for a retry. "sent"
--                   means the push service ACCEPTED the message, never that
--                   it was delivered, seen or acted on. result holds the
--                   suppression reason or the error.
--
-- The dispatcher (src/lib/reminders/dispatch.ts, called every minute by
-- /api/cron/reminders) does, per call:
--   1. plan_reminder_jobs(p_now): plans the reminders whose time is in
--      (now - 30 minutes, now + 1 minute] for every active device of an
--      owner on the current research terms (agreed_to_current_terms), from
--      cycle_plan_occurrences() (plans in the current revision of each cycle
--      with an active phase around now; not logged, not skipped) and
--      due_supplement_occurrences() (paged by cursor). A missed call is
--      caught up by the next one; a reminder already more than 15 minutes
--      late is still planned so the dispatcher records it as skipped
--      ("late"). It also purges finished jobs older than 30 days (bounded).
--      Returns the clock it used: the database's now() unless the caller
--      passes one (tests).
--   2. claim_reminder_jobs(p_now, p_limit, p_lease_seconds, p_max_attempts):
--      claims up to p_limit jobs that are due (pending, next_attempt_at <=
--      now) or whose lease expired (an interrupted call), with FOR UPDATE
--      SKIP LOCKED, so overlapping calls never claim the same job. Each
--      claim takes a new lease token and counts one attempt; an expired
--      lease already at p_max_attempts fails instead. It returns each job
--      with its device (endpoint and keys) and the send-time facts only the
--      database knows: whether the device is still on for the job's owner
--      (active, still that owner's, not marked off in push_device_off) and
--      whether the owner still agrees to the current terms.
--   3. The dispatcher rechecks the occurrence itself (logged, skipped, gone
--      or moved by an edit, cycle or phase ended, superseded, late) from the
--      owner's current records, and sends through src/lib/push/send.ts.
--   4. finish_reminder_job(p_id, p_lease_token, ...): records the outcome,
--      only while the caller still holds the lease (a call whose lease
--      expired and was taken over records nothing), or puts the job back to
--      pending for a bounded retry at p_retry_at.
--
-- Time: every function takes the dispatcher's clock (p_now; null = now()),
-- so tests run whole reminder timelines against the real database.
--
-- Access (deny by default): the queue is server-only. No API role reads or
-- writes reminder_jobs, and the functions are the service role's only
-- (the cron route, with the secret key). The service role may read the
-- table (operations and tests); it writes only through the functions.

create table public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null check (char_length(job_key) <= 400),
  source text not null check (source in ('dose', 'supplement')),
  kind text not null check (kind in ('due', 'follow-up-30m', 'follow-up-2h')),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  plan_id uuid,
  routine_id uuid,
  occurrence_key text not null check (char_length(occurrence_key) <= 200),
  -- The occurrence's scheduled instant when the job was planned.
  occurrence_at timestamptz not null,
  -- When the reminder is meant to go out (occurrence_at + the reminder's offset).
  send_at timestamptz not null,
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
    (source = 'dose' and plan_id is not null and routine_id is null)
    or (source = 'supplement' and routine_id is not null and plan_id is null and kind = 'due')
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

-- ── 1. Plan the reminders around now ───────────────────────────────────────
-- Returns { "now": the clock used, "planned": new rows, "purged": old rows removed }.
create function public.plan_reminder_jobs(p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  -- Reminders whose time is in (v_from, v_to].
  v_from timestamptz := coalesce(p_now, now()) - interval '30 minutes';
  v_to timestamptz := coalesce(p_now, now()) + interval '1 minute';
  v_planned integer := 0;
  v_rows integer;
  v_after_at timestamptz;
  v_after_routine uuid;
  v_feed integer;
  v_purged integer;
begin
  -- Peptide doses: due, then follow-ups 30 minutes and 2 hours later.
  with devices as (
    select s.id, s.profile_id
    from public.push_subscriptions s
    where s.disabled_at is null
      and not exists (
        select 1 from public.push_device_off o where o.profile_id = s.profile_id and o.device_id = s.device_id)
      and public.agreed_to_current_terms(s.profile_id)
  ),
  plans as (
    select rp.plan_id, c.owner_id
    from public.cycles c
    join public.cycle_revisions rv on rv.cycle_id = c.id and rv.number = c.current_revision
    join public.cycle_revision_plans rp on rp.revision_id = rv.id
    where c.owner_id in (select d.profile_id from devices d)
      and exists (
        select 1 from public.cycle_revision_phases ph
        where ph.revision_id = rv.id and ph.plan_id = rp.plan_id and ph.kind = 'active'
          and ph.start_date <= (v_to at time zone rv.time_zone)::date
          and ph.end_date >= ((v_from - interval '2 hours') at time zone rv.time_zone)::date)
  ),
  slots as (
    select p.plan_id, p.owner_id, o.occurrence_key, o.scheduled_at, k.kind, o.scheduled_at + k.offset_by as send_at
    from plans p
    cross join lateral public.cycle_plan_occurrences(p.plan_id) o
    cross join (values
      ('due', interval '0 minutes'),
      ('follow-up-30m', interval '30 minutes'),
      ('follow-up-2h', interval '2 hours')) k(kind, offset_by)
    where o.actual_at is null
      and o.scheduled_at > v_from - interval '2 hours' and o.scheduled_at <= v_to
      and o.scheduled_at + k.offset_by > v_from and o.scheduled_at + k.offset_by <= v_to
      and not exists (
        select 1 from public.dose_skips sk where sk.plan_id = p.plan_id and sk.occurrence_key = o.occurrence_key)
  )
  insert into public.reminder_jobs as j
    (job_key, source, kind, owner_id, subscription_id, plan_id, occurrence_key, occurrence_at, send_at, next_attempt_at)
  select 'dose:' || s.occurrence_key || '@' || public.reminder_instant_text(s.scheduled_at) || '#' || s.kind || ':' || d.id,
         'dose', s.kind, s.owner_id, d.id, s.plan_id, s.occurrence_key, s.scheduled_at, s.send_at, s.send_at
  from slots s
  join devices d on d.profile_id = s.owner_id
  on conflict (job_key) do nothing;
  get diagnostics v_rows = row_count;
  v_planned := v_planned + v_rows;

  -- Supplements: one reminder when due, a page of the feed at a time.
  loop
    with feed as (
      -- Its window's end is exclusive: + 1 microsecond includes v_to.
      select f.* from public.due_supplement_occurrences(v_from, v_to + interval '1 microsecond', v_after_at, v_after_routine, 1000) f
    ),
    last_row as (
      select f.scheduled_at, f.routine_id from feed f order by f.scheduled_at desc, f.routine_id desc limit 1
    ),
    inserted as (
      insert into public.reminder_jobs as j
        (job_key, source, kind, owner_id, subscription_id, routine_id, occurrence_key, occurrence_at, send_at, next_attempt_at)
      select 'supplement:' || f.occurrence_key || '@' || public.reminder_instant_text(f.scheduled_at) || '#due:' || s.id,
             'supplement', 'due', f.owner_id, s.id, f.routine_id, f.occurrence_key, f.scheduled_at, f.scheduled_at, f.scheduled_at
      from feed f
      join public.push_subscriptions s on s.profile_id = f.owner_id and s.disabled_at is null
      where f.scheduled_at > v_from
        and not exists (
          select 1 from public.push_device_off o where o.profile_id = s.profile_id and o.device_id = s.device_id)
      on conflict (job_key) do nothing
      returning 1
    )
    select (select count(*) from inserted), l.scheduled_at, l.routine_id, (select count(*) from feed)
    into v_rows, v_after_at, v_after_routine, v_feed
    from (select 1) one left join last_row l on true;
    v_planned := v_planned + v_rows;
    exit when v_feed < 1000;
  end loop;

  -- Finished jobs are kept 30 days (operations), then removed a bounded batch at a time.
  delete from public.reminder_jobs j
  where j.id in (
    select x.id from public.reminder_jobs x
    where x.finished_at is not null and x.finished_at < v_now - interval '30 days'
    limit 1000);
  get diagnostics v_purged = row_count;

  return jsonb_build_object('now', v_now, 'planned', v_planned, 'purged', v_purged);
end;
$$;

revoke all on function public.plan_reminder_jobs(timestamptz) from public, anon, authenticated;
grant execute on function public.plan_reminder_jobs(timestamptz) to service_role;

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
        updated_at = now()
    from picked
    where j.id = picked.id
    returning j.*
  )
  select c.id, c.lease_token, c.source, c.kind, c.owner_id, c.plan_id, c.routine_id, c.occurrence_key,
         c.occurrence_at, c.send_at, c.attempts, s.id, s.endpoint, s.p256dh, s.auth,
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
